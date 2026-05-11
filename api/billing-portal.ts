import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { supabaseAdmin, getUserFromAuthHeader } from "./_lib/supabase-admin";
import { resolveAppOrigin } from "./_lib/request-origin";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" }) : null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!stripe || !supabaseAdmin) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { data: row } = await supabaseAdmin
    .from("accounts")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    res.status(400).json({ error: "No Stripe customer found for this account" });
    return;
  }

  const bodyOrigin = req.body && typeof req.body === "object"
    ? (req.body as { origin?: string }).origin
    : undefined;
  const origin = resolveAppOrigin(req, bodyOrigin);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${origin}/?billing=return`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Billing portal failed";
    res.status(500).json({ error: message });
  }
}
