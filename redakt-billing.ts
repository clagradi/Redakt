import { BILLING } from "./redakt-constants";
import type { AccountState, BillingView } from "./redakt-types";
import { supabase, isSupabaseConfigured, type AccountRow } from "./src/supabase";

const LOCAL_FALLBACK_KEY = "epsteiner.account.v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isBackendConfigured = isSupabaseConfigured;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function currentBillingMonth(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

const rowToAccount = (row: AccountRow): AccountState => ({
  email: row.email,
  plan: row.plan,
  exportUsage: row.export_usage ?? {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ─────────────────────────────────────────────────────────────────────────────
// Magic-link sign-in (Supabase). Falls back to localStorage if not configured.
// ─────────────────────────────────────────────────────────────────────────────

export type SignInResult =
  | { ok: true; mode: "magic-link" | "local" }
  | { ok: false; error: string };

export async function requestSignIn(email: string): Promise<SignInResult> {
  const trimmed = email.trim().toLowerCase();
  if (!isValidEmail(trimmed)) return { ok: false, error: "Invalid email address." };

  if (supabase) {
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, mode: "magic-link" };
  }

  // Local fallback (used only when env vars aren't set — dev/preview).
  const now = new Date().toISOString();
  const account: AccountState = {
    email: trimmed,
    plan: "free",
    exportUsage: {},
    createdAt: now,
    updatedAt: now,
  };
  localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(account));
  return { ok: true, mode: "local" };
}

export async function signOut(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
  localStorage.removeItem(LOCAL_FALLBACK_KEY);
}

export async function fetchCurrentAccount(): Promise<AccountState | null> {
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !data) return null;
    return rowToAccount(data as AccountRow);
  }

  // Local fallback
  try {
    const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountState>;
    if (!parsed.email || !isValidEmail(parsed.email)) return null;
    if (parsed.plan !== "free" && parsed.plan !== "annual") return null;
    return {
      email: parsed.email,
      plan: parsed.plan,
      exportUsage: parsed.exportUsage ?? {},
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function onAccountChange(cb: (account: AccountState | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(async (_event, _session) => {
    const acc = await fetchCurrentAccount();
    cb(acc);
  });
  return () => data.subscription.unsubscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe checkout
// ─────────────────────────────────────────────────────────────────────────────

export async function startCheckout(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Backend not configured." };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ origin: window.location.origin }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: body || `Checkout failed (${res.status})` };
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export quotas
// ─────────────────────────────────────────────────────────────────────────────

export function getUsedExports(account: AccountState | null): number {
  if (!account) return 0;
  return account.exportUsage[currentBillingMonth()] ?? 0;
}

export function canExportPdf(account: AccountState | null): boolean {
  if (!account) return false;
  if (account.plan === "annual") return true;
  return getUsedExports(account) < BILLING.freeMonthlyExports;
}

export async function recordPdfExport(account: AccountState): Promise<AccountState> {
  if (account.plan === "annual") return account;

  if (supabase) {
    const { data } = await supabase.rpc("increment_export_usage");
    const month = currentBillingMonth();
    return {
      ...account,
      exportUsage: { ...account.exportUsage, [month]: typeof data === "number" ? data : (account.exportUsage[month] ?? 0) + 1 },
      updatedAt: new Date().toISOString(),
    };
  }

  // Local fallback
  const month = currentBillingMonth();
  const next: AccountState = {
    ...account,
    exportUsage: { ...account.exportUsage, [month]: (account.exportUsage[month] ?? 0) + 1 },
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(next));
  return next;
}

export function getBillingView(account: AccountState | null): BillingView {
  const usedExports = getUsedExports(account);
  const remainingExports = Math.max(BILLING.freeMonthlyExports - usedExports, 0);

  if (!account) {
    return {
      accountLabel: "Sign in",
      allowanceLabel: `${BILLING.freeMonthlyExports} free exports`,
      isSignedIn: false,
      isAnnual: false,
      usedExports,
      remainingExports,
    };
  }

  if (account.plan === "annual") {
    return {
      accountLabel: "Annual Pass",
      allowanceLabel: "Unlimited exports",
      isSignedIn: true,
      isAnnual: true,
      usedExports,
      remainingExports: Number.POSITIVE_INFINITY,
    };
  }

  return {
    accountLabel: account.email,
    allowanceLabel: `${remainingExports} free export${remainingExports === 1 ? "" : "s"} left`,
    isSignedIn: true,
    isAnnual: false,
    usedExports,
    remainingExports,
  };
}
