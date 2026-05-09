import type { CSSProperties } from "react";
import type { PageData, TextItem, Point2D, RedactionBox, SmartSelectionKey } from "./redakt-types";
import { WORD_PADDING } from "./redakt-constants";

export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const loadExternalScript = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(tag);
  });
};

export const clientToCanvas = (
  clientX: number,
  clientY: number,
  containerEl: HTMLElement,
  page: PageData,
): Point2D => {
  const rect = containerEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (page.width / rect.width),
    y: (clientY - rect.top) * (page.height / rect.height),
  };
};

export const findWordIndexAt = (point: Point2D, items: TextItem[]): number => {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (point.x >= it.x && point.x <= it.x + it.w &&
        point.y >= it.y && point.y <= it.y + it.h) {
      return i;
    }
  }
  return -1;
};

export const wordToBox = (pageIdx: number, item: TextItem): RedactionBox => ({
  pageIdx,
  x: item.x - WORD_PADDING,
  y: item.y - WORD_PADDING,
  w: item.w + WORD_PADDING * 2,
  h: item.h + WORD_PADDING * 2,
});

export type SearchOptions = { wholeWord?: boolean; caseSensitive?: boolean };

export const matchTextAcrossPages = (
  pages: PageData[],
  term: string,
  opts: SearchOptions = {},
): RedactionBox[] => {
  const trimmed = term.trim();
  return trimmed ? matchTermsAcrossPages(pages, [trimmed], opts) : [];
};

export const matchTermsAcrossPages = (
  pages: PageData[],
  terms: string[],
  opts: SearchOptions = {},
): RedactionBox[] => {
  const wholeWord = !!opts.wholeWord;
  const ci = !opts.caseSensitive;
  const needles = terms.map((t) => (ci ? t.trim().toLowerCase() : t.trim())).filter(Boolean);
  const out: RedactionBox[] = [];
  if (needles.length === 0) return out;

  const stripPunct = (s: string) => s.replace(/^[^\w]+|[^\w]+$/g, "");
  pages.forEach((p, pi) => {
    p.textItems.forEach((it) => {
      const haystack = ci ? it.text.toLowerCase() : it.text;
      const hay = wholeWord ? stripPunct(haystack) : haystack;
      for (const needle of needles) {
        const matches = wholeWord ? hay === needle : haystack.includes(needle);
        if (matches) {
          out.push(wordToBox(pi, it));
          break;
        }
      }
    });
  });
  return out;
};

export const toSmartSelectionKey = (pageIdx: number, wordIdx: number): SmartSelectionKey =>
  `${pageIdx}:${wordIdx}`;

export const parseSmartSelectionKey = (
  key: SmartSelectionKey,
): [pageIdx: number, wordIdx: number] | null => {
  const parts = key.split(":");
  if (parts.length !== 2) return null;

  const pageIdx = Number(parts[0]);
  const wordIdx = Number(parts[1]);
  return Number.isInteger(pageIdx) && Number.isInteger(wordIdx) ? [pageIdx, wordIdx] : null;
};

export const smartSelectionToBoxes = (
  pages: PageData[],
  selection: ReadonlySet<SmartSelectionKey>,
): RedactionBox[] =>
  Array.from(selection).flatMap((key) => {
    const parsed = parseSmartSelectionKey(key);
    if (!parsed) return [];

    const [pageIdx, wordIdx] = parsed;
    const item = pages[pageIdx]?.textItems[wordIdx];
    return item ? [wordToBox(pageIdx, item)] : [];
  });

export const boxToPercentStyle = (
  box: { x: number; y: number; w: number; h: number },
  page: PageData,
): CSSProperties => ({
  left: `${(box.x / page.width) * 100}%`,
  top: `${(box.y / page.height) * 100}%`,
  width: `${(box.w / page.width) * 100}%`,
  height: `${(box.h / page.height) * 100}%`,
});

export const stripFileExt = (name: string): string => name.replace(/\.[^/.]+$/, "");
