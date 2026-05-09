import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { supabaseAdmin, getUserFromAuthHeader } from "./_lib/supabase-admin";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID;

const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" }) : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!stripe || !priceId || !supabaseAdmin) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user || !user.email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const origin = (req.body && typeof req.body === "object" && (req.body as { origin?: string }).origin) ||
    process.env.PUBLIC_APP_URL ||
    `https://${req.headers.host}`;

  // Reuse existing Stripe customer if we already have one for this user.
  const { data: row } = await supabaseAdmin
    .from("accounts")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = row?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabaseAdmin
      .from("accounts")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`,
    allow_promotion_codes: true,
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id },
  });

  res.status(200).json({ url: session.url });
}
