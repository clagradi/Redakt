import { describe, expect, it } from "vitest";
import { detectSensitiveRedactionBoxes } from "../redakt-services";
import type { PageData, TextItem } from "../redakt-types";

const mkItem = (text: string, i = 0): TextItem => ({
  text, x: i * 50, y: 0, w: 40, h: 12,
});

const mkPage = (words: string[]): PageData => ({
  dataUrl: "data:,",
  width: 800, height: 1000,
  textItems: words.map((w, i) => mkItem(w, i)),
});

describe("detectSensitiveRedactionBoxes", () => {
  it("flags emails, phones, IBANs, SSNs, IPs, MACs, URLs", () => {
    const page = mkPage([
      "John", "Doe",
      "alice@example.com",
      "+39", "333-1234567",
      "IT60X0542811101000000123456",
      "123-45-6789",
      "192.168.1.1",
      "aa:bb:cc:dd:ee:ff",
      "https://evil.com/path",
    ]);
    const hits = detectSensitiveRedactionBoxes([page]);
    expect(hits.length).toBeGreaterThanOrEqual(7);
  });

  it("catches a valid credit card via Luhn", () => {
    const page = mkPage(["4242424242424242"]); // Stripe test card
    const hits = detectSensitiveRedactionBoxes([page]);
    expect(hits.length).toBe(1);
  });

  it("catches Italian Codice Fiscale", () => {
    const page = mkPage(["RSSMRA85M01H501Z"]);
    const hits = detectSensitiveRedactionBoxes([page]);
    expect(hits.length).toBe(1);
  });

  it("ignores plain words", () => {
    const page = mkPage(["the", "quick", "brown", "fox"]);
    const hits = detectSensitiveRedactionBoxes([page]);
    expect(hits.length).toBe(0);
  });
});
