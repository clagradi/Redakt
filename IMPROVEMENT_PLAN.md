# Epsteiner — Serious Improvement Plan

Status: deployed on Vercel. Goal: turn it from "fun beta" into a tool people pay for and trust.

Each item: **Why → What → Where**. Ordered by impact / effort.

---

## P0 — Trust & correctness (ship this week)

These directly affect whether redactions actually protect users. Today the app *looks* like a redaction tool but has bugs that leak data.

### 1. Burn redactions into exported PDF as raster, not just black rectangles
- **Risk today**: `exportPdfWithRedactions` in [redakt-services.ts](redakt-services.ts) draws black rects on top of the original page image. If the source page image is preserved or the underlying text layer survives, opening the export in a forensic tool can recover content.
- **Fix**: For each page, composite original image + black rects to a single canvas, then embed only the **flattened raster** in the output PDF. Strip text layer entirely. Re-encode as JPEG at controlled quality.
- **Verify**: open exported PDF in Preview → Cmd+A → paste. Should yield nothing. Add an automated test.

### 2. Visible redaction badge on every exported page
Add a thin footer "Redacted with Epsteiner — N regions" so an exported file is auditable. No PII, just count + timestamp.

### 3. Auto-redact preview before commit
- **Why**: today auto-redact silently dumps regex hits onto the doc. False positives are invisible until the user finds them.
- **What**: show a modal listing each detected hit grouped by category (Email, Phone, Name, Code, Date, Amount) with checkboxes + "redact selected". Default all checked.
- **Where**: new `AutoRedactReviewModal` in [redakt-components.tsx](redakt-components.tsx); wire from [redakt-v7.tsx:410](redakt-v7.tsx:410).

### 4. OCR fallback for scanned PDFs
- **Why**: today scanned PDFs land in `rect` mode with no text → smart/auto are dead. Most legal/medical docs people want to redact are scanned.
- **What**: integrate `tesseract.js` lazily (dynamic import, only when a page has 0 textItems). Show "Scanning page N…" progress. Cache OCR result per page.
- **Cost**: ~2MB worker, runs in browser, stays on-brand for "100% local".

### 5. Detection upgrade
Replace ad-hoc regex in [redakt-services.ts:248-339](redakt-services.ts:248) with a tagged detector pipeline:
- IBAN, SSN (US), Codice Fiscale (IT), VAT numbers, credit card (Luhn-validated), IP addresses, MAC addresses, URLs, license plates per country.
- Use `compromise` or a tiny NER model (transformers.js, distilbert-NER, ~30MB lazy) for actual person/org/location detection instead of "two capitalized words in a row".
- Each hit carries `{kind, confidence}` so the review modal (#3) can group and color-code.

---

## P1 — Production readiness (next 2 weeks)

### 6. Real backend for billing
Today everything is `localStorage`. User clears cookies → they get unlimited free exports. Or pays $9 → switches devices → loses access.

- Stripe Checkout + Stripe Customer Portal.
- Vercel serverless function `/api/license` issues a signed JWT keyed to email after webhook confirms payment.
- Client stores JWT, validates signature locally (public key embedded), gates `canExportPdf`.
- Keep it simple: no user accounts, no passwords. Email + magic link to retrieve license.
- Replace hardcoded `SIC2026` ([redakt-constants.ts:20](redakt-constants.ts:20)) with server-issued promo codes.

### 7. Telemetry (privacy-respecting)
- PostHog or Plausible (self-host on Vercel).
- Events: `landing_view`, `sample_click`, `pdf_loaded {pages, sizeMB}`, `auto_redact_run {hits}`, `export_success`, `paywall_view`, `checkout_click`.
- No file content, no PII. Funnel will tell you where to invest next.

### 8. Error boundary + Sentry
Single PDF parse error currently white-screens the app. Add React `ErrorBoundary` around the editor with "Reload / Report" actions and Sentry capture.

### 9. SEO + landing
- `index.html`: title, description, OG image, Twitter card, JSON-LD SoftwareApplication.
- Static `/privacy` and `/terms` routes (Vercel rewrites).
- `robots.txt`, `sitemap.xml`.
- Real domain. Drop the Epstein joke for the public name; keep the irreverent tone in copy.

### 10. Mobile actually works
The redact-on-PDF interaction is fundamentally bad on touch. Two paths:
- **Easy**: detect touch, show "Best on desktop — open on a laptop to redact" + email-yourself-the-link button.
- **Right**: rebuild toolbar as a bottom sheet, replace freehand rect with tap-to-place + corner handles, increase hit targets to 44px, add `touch-action: none` on overlay.

Pick easy now, right later.

---

## P2 — Code health (parallel track)

### 11. Break up the monoliths
- [redakt-v7.tsx](redakt-v7.tsx) (646 lines, 30+ useState) → split into `useDocument`, `useRedactionTool`, `useAccount`, `<Editor/>`, `<Landing/>`.
- [redakt-components.tsx](redakt-components.tsx) (624 lines) → one component per file under `src/components/`.
- Move pointer state machine to a `useReducer` keyed on `EditorMode`. Refs-as-state is the source of half the smart/erase bugs.

### 12. Tests
- `vitest` + `@testing-library/react`.
- Unit: `detectSensitiveRedactionBoxes`, `smartSelectionToBoxes`, `clientToCanvas`, billing math.
- E2E with Playwright: load sample → auto-redact → export → assert exported PDF has no extractable text in redacted regions (this is the test that matters).

### 13. Performance
- Lazy-render pages via IntersectionObserver. Don't rasterize a 200-page PDF up front.
- Use OffscreenCanvas + Web Worker for page render, so the UI stays responsive.
- Memoize `redactionsPerPage` properly ([redakt-v7.tsx:110](redakt-v7.tsx:110)).
- Cap history depth (currently unbounded; large docs + many edits = memory bloat).

### 14. Accessibility pass
- Replace clickable `<div>`s with `<button>` (modals, stamp picker, tool buttons).
- Focus trap + ESC close on every modal.
- ARIA labels on tool buttons; aria-live for toasts.
- Keyboard shortcuts: `S/R/E/V` for modes, `Ctrl+Z/Y`, `Ctrl+F`, `Ctrl+E` export. Show in a `?` cheatsheet.

### 15. Security headers (Vercel `vercel.json`)
- `Content-Security-Policy` (script-src self + pinned CDNs).
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
- `Referrer-Policy: no-referrer`.
- Self-host pdf.js + jsPDF instead of CDN to honor the "zero network" promise.

---

## P3 — Features that justify a higher price

Once the above is solid, these turn it from $9/yr novelty into something a paralegal or journalist puts on their toolbar.

- **Batch mode**: drag 20 PDFs, apply same auto-redact rules, export zip.
- **Saved rule sets**: "Always redact emails + IBANs + names" as a one-click profile.
- **Redact by selection on scanned regions** (rect + OCR-of-region in case OCR missed it).
- **Diff view**: side-by-side original vs redacted with redaction count and category breakdown.
- **Multi-format**: DOCX in/out (via `docx` lib), PNG/JPG single-image redaction.
- **Stamp library**: custom stamps with logo upload (kept local).
- **Page operations**: reorder, delete, rotate before export.
- **Annotations layer** separate from redactions (notes, highlights) — useful for review then strip on export.
- **Local "vault"**: optional encrypted IndexedDB to resume sessions across reloads. Passphrase-gated.
- **Pricing tiers**: Free (3/mo), Pro $9/yr (unlimited, single user), Team $49/yr (5 seats, shared rule sets).

---

## Suggested execution order

Week 1: #1, #2, #3, #8 — trust + don't crash.
Week 2: #4, #5 — detection that earns its name.
Week 3: #6, #7, #9 — make the business real.
Week 4: #11, #12 — refactor + tests so future weeks are cheaper.
Then pick from P3 based on #7 telemetry showing what users actually do.
