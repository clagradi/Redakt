import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabase-admin";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" }) : null;

// Vercel: disable JSON body parsing so we can verify the raw signature.
export const config = { api: { bodyParser: false } };

const readRawBody = (req: VercelRequest): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  if (!stripe || !webhookSecret || !supabaseAdmin) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing signature" });
    return;
  }

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    console.error("[stripe-webhook] verification failed:", msg);
    res.status(400).json({ error: `Webhook Error: ${msg}` });
    return;
  }

  const setPlan = async (
    userId: string | null | undefined,
    customerId: string | null | undefined,
    plan: "free" | "annual",
    extras: Record<string, unknown> = {},
  ) => {
    let query = supabaseAdmin!.from("accounts").update({ plan, ...extras });
    if (userId) query = query.eq("user_id", userId);
    else if (customerId) query = query.eq("stripe_customer_id", customerId);
    else return;
    const { error } = await query;
    if (error) console.error("[stripe-webhook] update failed:", error.message);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.supabase_user_id || null;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      await setPlan(userId, customerId, "annual", {
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      });
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const active = sub.status === "active" || sub.status === "trialing";
      const periodEndSec = (sub as unknown as { current_period_end?: number }).current_period_end;
      const periodEnd = typeof periodEndSec === "number" ? new Date(periodEndSec * 1000).toISOString() : null;
      await setPlan(null, customerId, active ? "annual" : "free", {
        stripe_subscription_id: sub.id,
        current_period_end: periodEnd,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await setPlan(null, customerId, "free", { stripe_subscription_id: null });
      break;
    }
    default:
      // Ignore other events — we only care about subscription lifecycle.
      break;
  }

  res.status(200).json({ received: true });
}
