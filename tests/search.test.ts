import { describe, expect, it } from "vitest";
import { matchTextAcrossPages } from "../redakt-utils";
import type { PageData } from "../redakt-types";

const mkPage = (words: string[]): PageData => ({
  dataUrl: "data:,",
  width: 800, height: 1000,
  textItems: words.map((w, i) => ({ text: w, x: i * 50, y: 0, w: 40, h: 12 })),
});

describe("matchTextAcrossPages", () => {
  const pages = [mkPage(["Anna", "banana", "Mariana", "an"])];

  it("substring match by default (case-insensitive)", () => {
    const hits = matchTextAcrossPages(pages, "an");
    // matches Anna, banana, Mariana, an → 4
    expect(hits.length).toBe(4);
  });

  it("whole-word match excludes substrings", () => {
    const hits = matchTextAcrossPages(pages, "an", { wholeWord: true });
    // only "an" itself
    expect(hits.length).toBe(1);
  });

  it("returns empty for empty term", () => {
    expect(matchTextAcrossPages(pages, "  ")).toEqual([]);
  });
});
