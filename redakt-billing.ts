import { BILLING } from "./redakt-constants";
import type { AccountState, BillingView } from "./redakt-types";

const ACCOUNT_STORAGE_KEY = "epsteiner.account.v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function currentBillingMonth(date = new Date()): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

export function loadAccountState(): AccountState | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
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

export function saveAccountState(account: AccountState | null): void {
  if (!account) {
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    return;
  }

  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({
    ...account,
    updatedAt: new Date().toISOString(),
  }));
}

export function createFreeAccount(email: string): AccountState {
  const now = new Date().toISOString();
  return {
    email: email.trim().toLowerCase(),
    plan: "free",
    exportUsage: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function unlockAnnualPlan(account: AccountState): AccountState {
  return {
    ...account,
    plan: "annual",
    updatedAt: new Date().toISOString(),
  };
}

export function isLaunchCodeValid(code: string): boolean {
  return code.trim().toUpperCase() === BILLING.launchCode;
}

export function getUsedExports(account: AccountState | null): number {
  if (!account) return 0;
  return account.exportUsage[currentBillingMonth()] ?? 0;
}

export function canExportPdf(account: AccountState | null): boolean {
  if (!account) return false;
  if (account.plan === "annual") return true;
  return getUsedExports(account) < BILLING.freeMonthlyExports;
}

export function recordPdfExport(account: AccountState): AccountState {
  if (account.plan === "annual") return account;
  const month = currentBillingMonth();
  return {
    ...account,
    exportUsage: {
      ...account.exportUsage,
      [month]: (account.exportUsage[month] ?? 0) + 1,
    },
    updatedAt: new Date().toISOString(),
  };
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
