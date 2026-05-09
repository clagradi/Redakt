# Epsteiner Launch Checklist

## Ready in code

- App runs as a client-side Vite app.
- PDF parsing, redaction, export, account state, and free export limits work in-browser.
- Auto-redaction is local pattern detection, not an external AI call.
- Free plan is set to 3 PDF exports per month.
- Annual pass is set to $9/year.
- Checkout link is configurable in `BILLING.checkoutUrl`.

## Before publishing

- Pick a public name/domain that is not `epsteiner.com`.
- Add a real checkout URL in `redakt-constants.ts`.
- Replace the temporary launch code before launch, or remove it once checkout is live.
- Deploy to Vercel, Netlify, or another static host.
- Add a short privacy note: files stay in the browser; local account state is stored in `localStorage`.
- Test upload, redact, export, free limit, and annual unlock on the deployed URL.

## Nice to have after launch

- Basic analytics for landing visits, sample clicks, PDF uploads, account creation, and checkout clicks.
- A lightweight refund/contact email.
- A proper server-side account/payment check if the experiment gets traction.
