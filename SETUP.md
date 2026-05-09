# Epsteiner — Backend Setup

The code is done. These are the only manual steps that need your hands (dashboards I can't log into for you). ~15 minutes.

---

## 1. Supabase project

1. Go to https://supabase.com → **New project** (Free plan is fine).
2. **SQL editor** → paste the contents of [`supabase/migrations/20260509000000_init.sql`](supabase/migrations/20260509000000_init.sql) → **Run**.
3. **Authentication → URL Configuration**:
   - **Site URL**: your Vercel URL (e.g. `https://redakt.vercel.app`)
   - **Redirect URLs**: add the same URL + `http://localhost:5173` for local dev.
4. **Authentication → Email Templates → Magic Link**: works out of the box. (Optional: customise the sender.)
5. **Settings → API**: copy these three values, you'll paste them into Vercel below:
   - `Project URL` → `SUPABASE_URL` and `VITE_SUPABASE_URL`
   - `anon` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(secret — never put in client code)*

## 2. Stripe product

1. Stripe Dashboard → **Products** → **+ Add product**.
   - Name: `Epsteiner Annual Pass`
   - Pricing model: **Recurring**, **Yearly**, **$9.00 USD**.
2. After creating, click the price → copy the **Price ID** (`price_...`) → this is `STRIPE_PRICE_ID`.
3. **Developers → API keys**: copy your **Secret key** (`sk_live_...` or `sk_test_...`) → `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks → + Add endpoint**:
   - URL: `https://YOUR_DOMAIN/api/stripe-webhook`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - After saving, click the endpoint → **Signing secret** → reveal → copy → this is `STRIPE_WEBHOOK_SECRET`.

## 3. Vercel environment variables

Project → **Settings → Environment Variables**. Add for **Production** (and Preview if you want):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | from Supabase step 1.5 |
| `VITE_SUPABASE_ANON_KEY` | from Supabase step 1.5 |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase step 1.5 |
| `STRIPE_SECRET_KEY` | from Stripe step 2.3 |
| `STRIPE_WEBHOOK_SECRET` | from Stripe step 2.4 |
| `STRIPE_PRICE_ID` | from Stripe step 2.2 |
| `PUBLIC_APP_URL` | `https://your-domain.vercel.app` |

Then **Deployments → Redeploy** the latest commit (env var changes only take effect on a new build).

---

## How to verify it works

1. Open the deployed URL.
2. Click **Sign in** → enter your email → click the link in your inbox.
3. You're back on the site, signed in (top-right shows your email, "3 free exports left").
4. Try to export 3 PDFs. The 4th should pop the paywall.
5. Click **Continue to checkout** → Stripe test card `4242 4242 4242 4242` → any future date / any CVC.
6. After payment you're redirected back with `?checkout=success`. Within ~5 seconds the badge flips to **Annual Pass**.

If step 4–6 fail, check **Stripe Dashboard → Developers → Webhooks → your endpoint → Recent deliveries** to see if the webhook fired and what it returned.

---

## Local dev

Create `.env.local` at repo root with the same vars (see `.env.example`). Then:

```bash
npm install
npm run dev
```

For testing the Stripe webhook locally, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:5173/api/stripe-webhook
```

If `VITE_SUPABASE_URL` is unset the app falls back to localStorage-only mode (the old behaviour), so the UI doesn't break before you've finished setup.
