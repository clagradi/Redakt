import { describe, expect, it } from "vitest";
import { canExportPdf, currentBillingMonth, getUsedExports } from "../redakt-billing";
import type { AccountState } from "../redakt-types";

const mkAccount = (over: Partial<AccountState> = {}): AccountState => ({
  email: "test@example.com",
  plan: "free",
  exportUsage: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

describe("billing", () => {
  it("formats current billing month YYYY-MM", () => {
    const m = currentBillingMonth(new Date("2026-03-01T12:00:00Z"));
    expect(m).toBe("2026-03");
  });

  it("free plan blocks after 3 exports in current month", () => {
    const month = currentBillingMonth();
    const acc = mkAccount({ exportUsage: { [month]: 3 } });
    expect(getUsedExports(acc)).toBe(3);
    expect(canExportPdf(acc)).toBe(false);
  });

  it("annual plan always allowed", () => {
    const month = currentBillingMonth();
    const acc = mkAccount({ plan: "annual", exportUsage: { [month]: 9999 } });
    expect(canExportPdf(acc)).toBe(true);
  });

  it("free plan allows export when under cap", () => {
    const month = currentBillingMonth();
    const acc = mkAccount({ exportUsage: { [month]: 1 } });
    expect(canExportPdf(acc)).toBe(true);
  });

  it("null account cannot export", () => {
    expect(canExportPdf(null)).toBe(false);
  });
});
