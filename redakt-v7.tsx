/**
 * REDAKT — Classified-Grade Document Redaction
 *
 * A single-page PDF redaction tool that runs entirely in the browser.
 * Users can upload PDFs and obscure sensitive information using:
 *   - Smart mode: click/drag on words (uses extracted text positions)
 *   - Rect mode:  draw arbitrary rectangles (works on images/scans)
 *   - AI mode:    Claude identifies sensitive entities to redact
 *   - Search:     find a string and redact every occurrence
 *
 * Architecture:
 *   1. Constants & types
 *   2. Pure utilities (no React)
 *   3. Custom hooks (audio, history, shortcuts, scroll-spy, toast)
 *   4. Services (PDF load, sample generation, export, AI call)
 *   5. Presentational subcomponents
 *   6. Main orchestration component
 */

import {
  useState, useRef, useCallback, useEffect, useMemo,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { REDAKT_STYLES } from "./redakt-styles";

// ─── 1. CONSTANTS ─────────────────────────────────────────────────────────────

const CDN = {
  pdfJs:     "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  jsPdf:     "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
} as const;

const RENDER_SCALE   = 2.0;
const WORD_PADDING   = 3;
const MIN_DRAW_SIZE  = 6;
const TOAST_MS       = 3000;
const SCROLL_OFFSET  = 140;

const ZOOM = { MIN: 0.5, MAX: 2.5, STEP: 0.25 } as const;

const STAMP_LABELS = {
  none:         "None",
  redacted:     "REDACTED",
  classified:   "CLASSIFIED",
  topSecret:    "TOP SECRET",
  confidential: "CONFIDENTIAL",
} as const;

const AI_MODEL = "claude-sonnet-4-20250514";

// ─── 2. TYPES ─────────────────────────────────────────────────────────────────

/** A single piece of text extracted from a PDF, with bounding box in canvas px. */
interface TextItem { text: string; x: number; y: number; w: number; h: number }

/** A rendered PDF page: rasterised image + extracted text positions. */
interface PageData {
  dataUrl: string;
  width:   number;  // canvas pixels at RENDER_SCALE
  height:  number;
  textItems: TextItem[];
}

/** A user-drawn redaction rectangle, in canvas coordinates. */
interface RedactionBox { pageIdx: number; x: number; y: number; w: number; h: number }

/** Editor interaction modes. */
type EditorMode = "view" | "smart" | "rect" | "erase";
type ToolMode = Exclude<EditorMode, "view">;

type StampStyle = keyof typeof STAMP_LABELS;

interface ExportOptions {
  filename:  string;
  stamp:     StampStyle;
  watermark: string;
}

interface ToastMessage { text: string; tone: "info" | "error" | "success" }

interface Point2D { x: number; y: number }

type SmartSelectionKey = `${number}:${number}`;

interface ToolModeConfig {
  activeClass: string;
  buttonLabel: string;
  indicatorColor: string;
  indicatorLabel: string;
  shortcut: string;
}

interface LandingFeature {
  icon: string;
  title: string;
  description: string;
}

interface WorkflowStep {
  number: string;
  title: string;
  description: string;
}

const TOOL_MODE_CONFIG: Record<ToolMode, ToolModeConfig> = {
  smart: {
    activeClass: "active-blue",
    buttonLabel: "⊞ Smart",
    indicatorColor: "var(--blue2)",
    indicatorLabel: "● SMART",
    shortcut: "S",
  },
  rect: {
    activeClass: "active-red",
    buttonLabel: "⬛ Rectangle",
    indicatorColor: "#ff7070",
    indicatorLabel: "● RECTANGLE",
    shortcut: "R",
  },
  erase: {
    activeClass: "active-amber",
    buttonLabel: "✕ Erase",
    indicatorColor: "#e0b020",
    indicatorLabel: "● ERASE",
    shortcut: "E",
  },
};

const TOOL_MODES: ToolMode[] = ["smart", "rect", "erase"];

const SHORTCUTS: Array<[label: string, key: string]> = [
  ["Smart mode (words)", "S"],
  ["Rectangle mode",     "R"],
  ["Erase mode",         "E"],
  ["Exit mode",          "Esc"],
  ["Find text",          "/"],
  ["Help",               "?"],
  ["Undo",               "⌘Z"],
  ["Redo",               "⌘Y"],
  ["Zoom in",            "+"],
  ["Zoom out",           "−"],
];

const LANDING_FEATURES: LandingFeature[] = [
  {
    icon: "⊞",
    title: "Smart selection",
    description: "Click on a word to redact it, drag across multiple words to redact a sequence",
  },
  {
    icon: "⬛",
    title: "Free rectangle",
    description: "Draw arbitrary rectangles anywhere — also on images, charts, or signatures",
  },
  {
    icon: "★",
    title: "AI auto-redact",
    description: "Claude identifies names, locations, dates, and sensitive numbers automatically",
  },
  {
    icon: "🔍",
    title: "Find & redact",
    description: "Type a string and obscure every occurrence in the document at once",
  },
  {
    icon: "📑",
    title: "Export PDF",
    description: "Export with TOP SECRET, REDACTED, CLASSIFIED stamps and custom watermarks",
  },
  {
    icon: "🔒",
    title: "Total privacy",
    description: "Everything happens in your browser. The document never leaves your device",
  },
];

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    number: "01",
    title: "Upload",
    description: "Drag a PDF in or click to select. The file stays in your browser.",
  },
  {
    number: "02",
    title: "Redact",
    description: "Click on words, drag across paragraphs, or let the AI handle it.",
  },
  {
    number: "03",
    title: "Export",
    description: "Download the PDF with permanent black bars baked in.",
  },
];

// ─── 3. PURE UTILITIES ────────────────────────────────────────────────────────

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Lazy-load an external script tag once; resolves when ready. */
function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload  = () => resolve();
    tag.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(tag);
  });
}

/** Convert client (viewport) coordinates to canvas pixel coordinates of a page. */
function clientToCanvas(
  clientX: number,
  clientY: number,
  containerEl: HTMLElement,
  page: PageData,
): Point2D {
  const rect = containerEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (page.width  / rect.width),
    y: (clientY - rect.top)  * (page.height / rect.height),
  };
}

/** Find the index of the text item containing the given canvas point, or -1. */
function findWordIndexAt(point: Point2D, items: TextItem[]): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (point.x >= it.x && point.x <= it.x + it.w &&
        point.y >= it.y && point.y <= it.y + it.h) return i;
  }
  return -1;
}

/** Convert a TextItem into a padded RedactionBox for a given page. */
function wordToBox(pageIdx: number, item: TextItem): RedactionBox {
  return {
    pageIdx,
    x: item.x - WORD_PADDING,
    y: item.y - WORD_PADDING,
    w: item.w + WORD_PADDING * 2,
    h: item.h + WORD_PADDING * 2,
  };
}

/** Find every text item across all pages whose text contains `term`. */
function matchTextAcrossPages(pages: PageData[], term: string): RedactionBox[] {
  const needle = term.trim().toLowerCase();
  return needle ? matchTermsAcrossPages(pages, [needle]) : [];
}

/** Find every text item across all pages matching one of the supplied terms. */
function matchTermsAcrossPages(pages: PageData[], terms: string[]): RedactionBox[] {
  const needles = terms.map(term => term.trim().toLowerCase()).filter(Boolean);
  const out: RedactionBox[] = [];
  if (needles.length === 0) return out;

  pages.forEach((p, pi) => {
    needles.forEach(needle => {
      p.textItems.forEach(it => {
        if (it.text.toLowerCase().includes(needle)) out.push(wordToBox(pi, it));
      });
    });
  });
  return out;
}

const toSmartSelectionKey = (pageIdx: number, wordIdx: number): SmartSelectionKey =>
  `${pageIdx}:${wordIdx}`;

function parseSmartSelectionKey(key: SmartSelectionKey): [pageIdx: number, wordIdx: number] | null {
  const parts = key.split(":");
  if (parts.length !== 2) return null;

  const pageIdx = Number(parts[0]);
  const wordIdx = Number(parts[1]);
  return Number.isInteger(pageIdx) && Number.isInteger(wordIdx) ? [pageIdx, wordIdx] : null;
}

function smartSelectionToBoxes(
  pages: PageData[],
  selection: ReadonlySet<SmartSelectionKey>,
): RedactionBox[] {
  return Array.from(selection).flatMap(key => {
    const parsed = parseSmartSelectionKey(key);
    if (!parsed) return [];

    const [pageIdx, wordIdx] = parsed;
    const item = pages[pageIdx]?.textItems[wordIdx];
    return item ? [wordToBox(pageIdx, item)] : [];
  });
}

/** Convert a RedactionBox to CSS percentage coords for a given page. */
function boxToPercentStyle(
  box: { x: number; y: number; w: number; h: number },
  page: PageData,
): CSSProperties {
  return {
    left:   `${(box.x / page.width)  * 100}%`,
    top:    `${(box.y / page.height) * 100}%`,
    width:  `${(box.w / page.width)  * 100}%`,
    height: `${(box.h / page.height) * 100}%`,
  };
}

const stripFileExt = (name: string): string => name.replace(/\.[^/.]+$/, "");

// ─── 4. CUSTOM HOOKS ──────────────────────────────────────────────────────────

/** Procedurally-generated audio cues for stamp/click feedback. */
function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = (): AudioContext =>
    (ctxRef.current ??= new ((window as any).AudioContext || (window as any).webkitAudioContext)());

  const stamp = useCallback(() => {
    try {
      const ctx = getCtx(), duration = 0.3;
      const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = Math.sin(2 * Math.PI * 50 * t) * Math.exp(-t * 25) * 0.7
                + (Math.random() * 2 - 1) * Math.exp(-t * 130) * 0.45;
      }
      const src  = ctx.createBufferSource(); src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.9, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      src.connect(gain); gain.connect(ctx.destination); src.start();
    } catch { /* audio is non-critical */ }
  }, []);

  const click = useCallback(() => {
    try {
      const ctx = getCtx(), duration = 0.04;
      const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 200) * 0.15;
      }
      const src    = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter(); filter.type = "highpass"; filter.frequency.value = 4000;
      src.connect(filter); filter.connect(ctx.destination); src.start();
    } catch { /* audio is non-critical */ }
  }, []);

  return { stamp, click };
}

/**
 * Generic undo/redo state container. Kept fully in React state so derived
 * flags (canUndo/canRedo) are reactive.
 */
function useHistory<T>(initial: T) {
  type Snapshot = { items: T[]; index: number };
  const [snap, setSnap] = useState<Snapshot>({ items: [initial], index: 0 });

  const set = useCallback((next: T) => {
    setSnap(({ items, index }) => ({
      items: [...items.slice(0, index + 1), next],
      index: index + 1,
    }));
  }, []);

  const undo = useCallback(() => {
    setSnap(s => s.index > 0 ? { ...s, index: s.index - 1 } : s);
  }, []);

  const redo = useCallback(() => {
    setSnap(s => s.index < s.items.length - 1 ? { ...s, index: s.index + 1 } : s);
  }, []);

  const reset = useCallback((next: T) => {
    setSnap({ items: [next], index: 0 });
  }, []);

  return {
    state:   snap.items[snap.index],
    set, undo, redo, reset,
    canUndo: snap.index > 0,
    canRedo: snap.index < snap.items.length - 1,
  };
}

/** Bind global keyboard shortcuts. Latest handler is always called (no stale). */
type ShortcutHandler = (e: KeyboardEvent) => void;
function useKeyboardShortcuts(handler: ShortcutHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Track which page is currently centered in the viewport. */
function useScrollSpy(
  scrollEl: RefObject<HTMLElement | null>,
  itemRefs: MutableRefObject<(HTMLElement | null)[]>,
  count: number,
): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = scrollEl.current; if (!el) return;
    const handler = () => {
      let best = 0, bestDist = Infinity;
      itemRefs.current.forEach((ref, i) => {
        if (!ref) return;
        const dist = Math.abs(ref.getBoundingClientRect().top - SCROLL_OFFSET);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setActive(best);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [scrollEl, itemRefs, count]);
  return active;
}

/** Show transient toast messages. */
function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  return { toast, show };
}

// ─── 5. SERVICES ──────────────────────────────────────────────────────────────

/** Render a PDF File into rasterised pages plus extracted text positions. */
async function loadPdfDocument(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<PageData[]> {
  await loadExternalScript(CDN.pdfJs);
  const pdfjs = (window as any).pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: PageData[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(i, pdf.numPages);
    const page     = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const canvas   = document.createElement("canvas");
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const tc = await page.getTextContent();
    const textItems: TextItem[] = (tc.items as any[])
      .filter(it => it.str?.trim().length > 0)
      .map(it => {
        const [cx, cy]: [number, number] =
          viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fontSize = Math.abs(it.transform[3]) * RENDER_SCALE;
        return {
          text: it.str,
          x: cx,
          y: cy - fontSize,
          w: it.width * RENDER_SCALE,
          h: fontSize * 1.3,
        };
      });

    out.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.94),
      width:   viewport.width,
      height:  viewport.height,
      textItems,
    });
  }

  return out;
}

/** Build a sample PDF in-memory so users can try the app without uploading. */
async function generateSampleDocument(): Promise<File> {
  await loadExternalScript(CDN.jsPdf);
  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 18;

  // page 1 background + header
  doc.setFillColor(245, 240, 225); doc.rect(0, 0, 210, 297, "F");
  doc.setFont("courier", "bold"); doc.setFontSize(8); doc.setTextColor(140, 0, 0);
  doc.text("— TOP SECRET / SCI / NOFORN / ORCON —", 105, 14, { align: "center" });
  doc.setDrawColor(140, 0, 0); doc.setLineWidth(0.4);
  doc.line(M, 17, 210 - M, 17); doc.line(M, 17.8, 210 - M, 17.8);

  doc.setFont("courier", "bold"); doc.setFontSize(11); doc.setTextColor(20, 10, 0);
  doc.text("INTELLIGENCE REPORT — OPERATION SILENT NIGHT", 105, 28, { align: "center" });
  doc.setFont("courier", "normal"); doc.setFontSize(8.5); doc.setTextColor(60, 40, 20);
  doc.text("File: 7741-B/OMEGA   Date: March 14, 1987   Classification: TOP SECRET", 105, 34, { align: "center" });

  doc.setFont("courier", "normal"); doc.setFontSize(10); doc.setTextColor(20, 10, 0);
  const body = `Special Agent Marcus D. Holloway, badge 3847-F, has confirmed
contact with the source codenamed FALCON at 23:14 hours on March 12.
The meeting took place at the abandoned warehouse on 47 Hope Street,
Manhattan.

The source revealed that the head of the organization, known as
THE GHOST, is currently residing at the residence of Senator
Anthony Carlucci, Hampton, NY. Encrypted contact: +1 631-447-2291.

Wire transfers to offshore accounts in the Cayman Islands, bank
KY-447821, are scheduled for March 19. Estimated amount:
USD 4,700,000.

Identified courier: Elena Vasquez, passport RU-449821,
Delta flight DL-447 at 06:30 from JFK International.

Agent Holloway recommends immediate surveillance of the Hampton
residence. Coordinate with the New York field office and local
handler, codename OMEGA-7. Maximum operational discretion required.

SECONDARY CONTACTS:
  - Maria Bellini, Plaza Hotel, NY (room 412)
  - Giuseppe Moretti, First National Bank, Chicago
  - Sofia Ricci, Ricci & Associates Law Firm, Boston`;
  let y = 44;
  doc.splitTextToSize(body, 210 - M * 2).forEach((ln: string) => { doc.text(ln, M, y); y += 6; });

  doc.setFont("courier", "bold"); doc.setFontSize(8); doc.setTextColor(80, 60, 30);
  doc.text("SIGNATURE: Director R. Malone   |   Special Operations Unit — DC", 105, 280, { align: "center" });
  doc.setFontSize(7); doc.setTextColor(150, 130, 100);
  doc.text("DISTRIBUTION: strictly confidential — authorized recipients only", 105, 287, { align: "center" });

  // page 2
  doc.addPage();
  doc.setFillColor(245, 240, 225); doc.rect(0, 0, 210, 297, "F");
  doc.setFont("courier", "bold"); doc.setFontSize(8); doc.setTextColor(140, 0, 0);
  doc.text("— TOP SECRET / SCI / NOFORN —", 105, 14, { align: "center" });
  doc.setDrawColor(140, 0, 0); doc.line(M, 17, 210 - M, 17); doc.line(M, 17.8, 210 - M, 17.8);
  doc.setFont("courier", "bold"); doc.setFontSize(11); doc.setTextColor(20, 10, 0);
  doc.text("ANNEX A — OPERATIONAL DETAILS", 105, 28, { align: "center" });

  doc.setFont("courier", "normal"); doc.setFontSize(10); doc.setTextColor(20, 10, 0);
  const body2 = `RESOURCES DEPLOYED:

Team A (Manhattan):
  Lead:      Cpt. Lawrence Bishop    badge 2891-D
  Operators: Sgt. Pamela Reid        badge 4477-G
             Sgt. David Cohen        badge 5512-H
  Vehicles:  Ford Crown Victoria — plate AB 447 PQ
             Chevy Suburban         — plate CD 991 RS

Team B (Long Island):
  Lead:      Maj. Steven Greco       badge 1102-K
  Operators: Sgt. Linda Marino       badge 3344-J
             Sgt. Robert Esposito    badge 6678-L

MONITORED ACCOUNTS:
  US-CHASE-1010-0000-0123-456   (Carlucci, A.)
  KY-447821 / Cayman National Bank (Vasquez, E.)
  CH93-0076-2011-6238-5295-7    (Moretti, G.)

ACTIVE WIRETAPS:
  - +1 631-447-2291  (Carlucci residence, Hampton)
  - +1 212-885-7441  (Bellini's suite, Plaza)
  - +41 22-778-9920  (Geneva, contact X)

NEXT OPERATIONAL MEETING: March 16, 1987, 09:00,
temporary location: 12 Park Avenue, NY. Access code: 4477-OMEGA.`;
  y = 40;
  doc.splitTextToSize(body2, 210 - M * 2).forEach((ln: string) => { doc.text(ln, M, y); y += 6; });

  doc.setFontSize(7); doc.setTextColor(150, 130, 100);
  doc.text("PAGE 2 / 2 — REDAKT SAMPLE DOCUMENT", 105, 287, { align: "center" });

  const blob = doc.output("blob");
  return new File([blob], "sample_classified.pdf", { type: "application/pdf" });
}

/** Render the currently-redacted document into a downloadable PDF. */
async function exportRedactedPdf(
  pages: PageData[],
  boxes: RedactionBox[],
  opts: ExportOptions,
): Promise<void> {
  await loadExternalScript(CDN.jsPdf);
  const { jsPDF } = (window as any).jspdf;
  const first = pages[0];
  const doc = new jsPDF({ unit: "px", format: [first.width, first.height], compress: true });

  pages.forEach((page, pi) => {
    if (pi > 0) doc.addPage([page.width, page.height]);
    doc.addImage(page.dataUrl, "JPEG", 0, 0, page.width, page.height);

    // Black redaction bars
    doc.setFillColor(0, 0, 0);
    boxes.filter(b => b.pageIdx === pi).forEach(b => doc.rect(b.x, b.y, b.w, b.h, "F"));

    // Stamp
    if (opts.stamp !== "none") {
      const label = STAMP_LABELS[opts.stamp];
      doc.setFont("helvetica", "bold");
      const fs = Math.max(40, page.width * 0.06);
      doc.setFontSize(fs);
      doc.setTextColor(180, 0, 0);
      doc.text(label, page.width - fs * 4.5, fs * 1.5, { angle: 18 });
      doc.setDrawColor(180, 0, 0); doc.setLineWidth(fs / 12);
      const tw = doc.getTextWidth(label);
      doc.rect(page.width - fs * 4.7, fs * 0.55, tw + fs * 0.3, fs * 1.15);
    }

    // Watermark
    const wm = opts.watermark.trim();
    if (wm) {
      doc.setFont("courier", "normal");
      doc.setFontSize(36);
      doc.setTextColor(180, 180, 180);
      (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.1 }));
      doc.text(wm, page.width / 2, page.height / 2, { align: "center", angle: -30 });
      (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));
    }
  });

  doc.save(`${opts.filename || "redacted_document"}.pdf`);
}

/** Ask Claude to identify sensitive entities from extracted text. */
async function requestAiRedactionTerms(pages: PageData[]): Promise<string[]> {
  const corpus = pages
    .map((p, pi) => `[PAGE ${pi + 1}] ` + p.textItems.map(t => t.text).join(" "))
    .join("\n");

  const prompt = `You are a CIA analyst. Return ONLY a JSON array of exact strings to redact from this document. Include: proper names, locations, phone numbers, codes, operational dates, monetary amounts, identification numbers (passport, badge, account, flight).\n\n${corpus}\n\nReturn only the JSON array, nothing else.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL, max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const raw  = (data?.content?.[0]?.text ?? "[]").replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ─── 6. SUBCOMPONENTS ─────────────────────────────────────────────────────────

const Toast = ({ toast }: { toast: ToastMessage | null }) =>
  toast ? <div className={`toast toast-${toast.tone}`}>{toast.text}</div> : null;

const FileDropOverlay = ({ visible }: { visible: boolean }) =>
  visible ? (
    <div className="drop-overlay">
      <div style={{ fontSize: 48 }}>📁</div>
      <div className="drop-overlay-text">Drop your PDF</div>
    </div>
  ) : null;

interface HeaderProps {
  documentName: string;
  redactionCount: number;
  onHelpClick: () => void;
}
const Header = ({ documentName, redactionCount, onHelpClick }: HeaderProps) => (
  <div className="header">
    <div className="brand">
      <div className="seal">FBI</div>
      <div>
        <div className="brand-name">REDAKT</div>
        <span className="brand-tag">Classified-Grade Redaction</span>
      </div>
    </div>
    <div className="header-right">
      {documentName && (
        <div className="doc-name" title={documentName}>
          📄 {documentName.length > 24 ? documentName.slice(0, 24) + "…" : documentName}
        </div>
      )}
      {redactionCount > 0 && <div className="stat-pill">{redactionCount} REDACTIONS</div>}
      <button className="btn btn-ghost" onClick={onHelpClick} aria-label="Show keyboard shortcuts">?</button>
    </div>
  </div>
);

interface ToolbarProps {
  mode: EditorMode;
  zoomPercent: number;
  isLoading: boolean;
  searchOpen: boolean;
  hasRedactions: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onPickFile: () => void;
  onSetMode: (m: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleSearch: () => void;
  onAiRedact: () => void;
  onExport: () => void;
  onClearAll: () => void;
}
const Toolbar = (p: ToolbarProps) => {
  const activeMode = p.mode === "view" ? null : TOOL_MODE_CONFIG[p.mode];
  const toggleMode = (nextMode: ToolMode) =>
    p.onSetMode(p.mode === nextMode ? "view" : nextMode);

  return (
    <div className="toolbar">
      <button className="btn btn-ghost" onClick={p.onPickFile}>↑ New</button>
      <div className="sep" />
      {TOOL_MODES.map(toolMode => {
        const config = TOOL_MODE_CONFIG[toolMode];
        const isActive = p.mode === toolMode;
        return (
          <button
            key={toolMode}
            className={`btn btn-ghost ${isActive ? config.activeClass : ""}`}
            onClick={() => toggleMode(toolMode)}
            title={config.shortcut}
          >
            {config.buttonLabel}
          </button>
        );
      })}
      <div className="sep" />
      <button className="btn btn-ghost" onClick={p.onUndo} disabled={!p.canUndo} title="⌘Z">↩</button>
      <button className="btn btn-ghost" onClick={p.onRedo} disabled={!p.canRedo} title="⌘Y">↪</button>
      <div className="sep" />
      <div className="zoom-group">
        <button className="btn btn-ghost" onClick={p.onZoomOut}>−</button>
        <span className="zoom-value">{p.zoomPercent}%</span>
        <button className="btn btn-ghost" onClick={p.onZoomIn}>+</button>
      </div>
      <div className="sep" />
      <button className={`btn btn-ghost ${p.searchOpen ? "active-amber" : ""}`} onClick={p.onToggleSearch} title="/">🔍 Find</button>
      <button className="btn btn-gold" onClick={p.onAiRedact} disabled={p.isLoading}>★ AI</button>
      <div className="sep" />
      <button className="btn btn-red" onClick={p.onExport} disabled={p.isLoading}>↓ Export</button>
      <button className="btn btn-ghost" onClick={p.onClearAll} disabled={!p.hasRedactions}>↺</button>

      {activeMode && (
        <span className="mode-indicator" style={{ color: activeMode.indicatorColor }}>
          {activeMode.indicatorLabel}
        </span>
      )}
    </div>
  );
};

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}
const SearchBar = ({ value, onChange, onSubmit, onClose }: SearchBarProps) => (
  <div className="search-bar">
    <input
      className="search-input"
      placeholder="Find text to redact across all pages…"
      value={value}
      autoFocus
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") onSubmit();
        if (e.key === "Escape") onClose();
      }}
    />
    <button className="btn btn-green" onClick={onSubmit} disabled={!value.trim()}>Redact all</button>
    <span className="search-hint">↵ Confirm · Esc Close</span>
  </div>
);

interface SidebarProps {
  pages: PageData[];
  activeIndex: number;
  redactionsPerPage: Map<number, number>;
  onJumpToPage: (i: number) => void;
}
const Sidebar = ({ pages, activeIndex, redactionsPerPage, onJumpToPage }: SidebarProps) => (
  <div className="sidebar">
    <div className="sidebar-header">Pages ({pages.length})</div>
    {pages.map((p, pi) => {
      const count = redactionsPerPage.get(pi) ?? 0;
      return (
        <div
          key={pi}
          className={`sidebar-page ${activeIndex === pi ? "active" : ""}`}
          onClick={() => onJumpToPage(pi)}
        >
          <div className="thumbnail"><img src={p.dataUrl} alt={`Page ${pi + 1}`} loading="lazy" /></div>
          <div className="thumb-meta">
            <span className="thumb-num">Page {pi + 1}</span>
            {count > 0 && <span className="thumb-count">{count}</span>}
          </div>
        </div>
      );
    })}
  </div>
);

interface StatsPanelProps {
  pages: PageData[];
  boxes: RedactionBox[];
  redactionsPerPage: Map<number, number>;
  isLoading: boolean;
  onAiRedact: () => void;
  onExport: () => void;
}
const StatsPanel = ({ pages, boxes, redactionsPerPage, isLoading, onAiRedact, onExport }: StatsPanelProps) => {
  const totalWords = pages.reduce((s, p) => s + p.textItems.length, 0);
  const maxPerPage = Math.max(...Array.from(redactionsPerPage.values()), 1);
  const avgPerPage = pages.length > 0 ? (boxes.length / pages.length).toFixed(1) : "0.0";

  return (
    <div className="stats-panel">
      <div className="stats-section">
        <div className="stats-header">Total Redactions</div>
        <div className="stat-big">{boxes.length}</div>
        <div className="stat-big-sub">Across {pages.length} pages</div>
      </div>

      <div className="stats-section">
        <div className="stats-header">Summary</div>
        <div className="stat-row"><span>Pages</span><span>{pages.length}</span></div>
        <div className="stat-row"><span>Redactions</span><span>{boxes.length}</span></div>
        <div className="stat-row"><span>Words detected</span><span>{totalWords}</span></div>
        <div className="stat-row"><span>Avg / page</span><span>{avgPerPage}</span></div>
      </div>

      {boxes.length > 0 && (
        <div className="stats-section">
          <div className="stats-header">Distribution</div>
          {pages.map((_, pi) => {
            const count = redactionsPerPage.get(pi) ?? 0;
            return (
              <div className="page-bar" key={pi}>
                <span className="page-bar-label">P. {pi + 1}</span>
                <div className="page-bar-track">
                  <div className="page-bar-fill" style={{ width: `${(count / maxPerPage) * 100}%` }} />
                </div>
                <span className="page-bar-num">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="stats-section">
        <div className="stats-header">Quick Actions</div>
        <button className="btn btn-gold full-width" onClick={onAiRedact} disabled={isLoading}>★ AI Auto-Redact</button>
        <button className="btn btn-red full-width mt-6" onClick={onExport}>↓ Export PDF</button>
      </div>
    </div>
  );
};

interface PageViewProps {
  page: PageData;
  pageIdx: number;
  pageCount: number;
  zoom: number;
  mode: EditorMode;
  boxes: RedactionBox[];
  drawing: RedactionBox | null;
  smartSelection: ReadonlySet<SmartSelectionKey>;
  onPointerDown: (e: ReactPointerEvent, pi: number) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp:   () => void;
  onEraseBox:    (globalIdx: number) => void;
  globalBoxes:   RedactionBox[];
  containerRef:  (el: HTMLDivElement | null) => void;
  redactionCount: number;
}
const PageView = (p: PageViewProps) => {
  const pageBoxes = p.boxes.filter(b => b.pageIdx === p.pageIdx);
  const isErase   = p.mode === "erase";
  const isSmart   = p.mode === "smart";
  const isView    = p.mode === "view";

  return (
    <div className="page-outer" ref={p.containerRef}>
      <div className="page-wrap" style={{ width: `min(${p.zoom * 100}%, ${p.zoom * 820}px)` }}>
        <img className="page-img" src={p.page.dataUrl} alt={`Page ${p.pageIdx + 1}`} draggable={false} />

        {/* committed redactions */}
        {pageBoxes.map((box, _bi) => {
          const globalIdx = p.globalBoxes.indexOf(box);
          return (
            <div
              key={globalIdx}
              className={`redaction-box ${isErase ? "erasable" : ""}`}
              style={boxToPercentStyle(box, p.page)}
              onClick={() => p.onEraseBox(globalIdx)}
            />
          );
        })}

        {/* smart-mode word highlights */}
        {isSmart && p.page.textItems.map((it, ti) => {
          const key = toSmartSelectionKey(p.pageIdx, ti);
          if (!p.smartSelection.has(key)) return null;
          return (
            <div
              key={`hl-${ti}`}
              className="word-highlight"
              style={boxToPercentStyle(wordToBox(p.pageIdx, it), p.page)}
            />
          );
        })}

        {/* rectangle ghost while drawing */}
        {p.drawing?.pageIdx === p.pageIdx && p.drawing.w > 2 && p.drawing.h > 2 && (
          <div className="rect-ghost" style={boxToPercentStyle(p.drawing, p.page)} />
        )}

        {/* pointer overlay */}
        <div
          className={`overlay ${p.mode}`}
          style={{ display: isView ? "none" : "block" }}
          onPointerDown={e => p.onPointerDown(e, p.pageIdx)}
          onPointerMove={p.onPointerMove}
          onPointerUp={p.onPointerUp}
        />
      </div>
      <div className="page-label">
        Page {p.pageIdx + 1} / {p.pageCount}
        {p.redactionCount > 0 && ` · ${p.redactionCount} redaction${p.redactionCount === 1 ? "" : "s"}`}
        {p.page.textItems.length === 0 && ` · image only`}
      </div>
    </div>
  );
};

interface ModalProps { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; }
const Modal = ({ title, onClose, children, footer }: ModalProps) => (
  <div className="modal-bg" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title">{title}</div>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
);

interface ExportModalProps {
  options: ExportOptions;
  onChange: (next: ExportOptions) => void;
  onClose: () => void;
  onExport: () => void;
}
const ExportModal = ({ options, onChange, onClose, onExport }: ExportModalProps) => {
  const setOpt = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) =>
    onChange({ ...options, [k]: v });

  return (
    <Modal
      title="Export Options"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-red" onClick={onExport}>↓ Export PDF</button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">Filename</label>
        <input className="field-input" value={options.filename} onChange={e => setOpt("filename", e.target.value)} />
      </div>

      <div className="field">
        <label className="field-label">Stamp on every page</label>
        <div className="stamp-grid">
          {(Object.keys(STAMP_LABELS) as StampStyle[]).map(id => (
            <div
              key={id}
              className={`stamp-option ${options.stamp === id ? "active" : ""}`}
              onClick={() => setOpt("stamp", id)}
            >
              {id === "none" ? "No stamp" : STAMP_LABELS[id]}
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Watermark (optional)</label>
        <input
          className="field-input"
          placeholder="e.g. PROPRIETARY & CONFIDENTIAL"
          value={options.watermark}
          onChange={e => setOpt("watermark", e.target.value)}
        />
      </div>
    </Modal>
  );
};

const HelpModal = ({ onClose }: { onClose: () => void }) => (
  <Modal title="Keyboard Shortcuts" onClose={onClose}>
    <div className="help-grid">
      {SHORTCUTS.map(([label, key]) => (
        <div className="help-row" key={label}>
          <span className="help-label">{label}</span>
          <span className="kbd">{key}</span>
        </div>
      ))}
    </div>
  </Modal>
);

interface LandingProps { onTrySample: () => void; onPickFile: () => void; }
const LandingPage = ({ onTrySample, onPickFile }: LandingProps) => (
  <div className="landing">
    <div className="hero">
      <div className="hero-stamp" style={{ top: "10%", left: "5%" }}>CLASSIFIED</div>
      <div className="hero-stamp" style={{ bottom: "15%", right: "3%", animationDelay: "-3s" }}>TOP SECRET</div>

      <div className="hero-pretitle">— Federal-Grade Document Redaction —</div>
      <h1 className="hero-title">Redakt</h1>
      <div className="hero-divider" />
      <p className="hero-sub">
        Upload any PDF and obscure sensitive information with the precision
        of a federal agency. Click words, draw rectangles, search, or let AI
        do the work. Everything runs locally in your browser — zero uploads,
        zero tracking.
      </p>
      <div className="hero-cta">
        <button className="cta-primary"   onClick={onTrySample}>★ Try with a sample</button>
        <button className="cta-secondary" onClick={onPickFile}>↑ Upload your PDF</button>
      </div>
      <div className="hero-meta">
        <span>100% In-Browser</span>
        <span>AI-Powered</span>
        <span>Zero Tracking</span>
      </div>
    </div>

    <div className="features">
      <div className="features-h">— Capabilities —</div>
      <div className="features-t">Everything you need to redact</div>
      <div className="features-grid">
        {LANDING_FEATURES.map(feature => (
          <div className="feature" key={feature.title}>
            <div className="feature-icon">{feature.icon}</div>
            <div className="feature-t">{feature.title}</div>
            <div className="feature-d">{feature.description}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="how">
      <div className="how-h">— Workflow —</div>
      <div className="how-t">Three steps</div>
      <div className="how-grid">
        {WORKFLOW_STEPS.map(step => (
          <div className="step" key={step.number}>
            <div className="step-n">{step.number}</div>
            <div className="step-t">{step.title}</div>
            <div className="step-d">{step.description}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="footer">
      <div className="footer-text">REDAKT · Classified Materials Unit</div>
    </div>
  </div>
);

// ─── 7. MAIN COMPONENT ────────────────────────────────────────────────────────

export default function RedaktApp() {
  // ── core document state
  const [pages, setPages]                 = useState<PageData[]>([]);
  const [documentName, setDocumentName]   = useState<string>("");

  // ── editor state
  const [mode, setMode]                   = useState<EditorMode>("view");
  const [zoom, setZoom]                   = useState<number>(1);
  const [drawing, setDrawing]             = useState<RedactionBox | null>(null);
  const [smartSelection, setSmartSel]     = useState<Set<SmartSelectionKey>>(new Set());

  // ── undo/redo stack of redaction boxes
  const history = useHistory<RedactionBox[]>([]);
  const boxes   = history.state;

  // ── ui state
  const [isLoading, setIsLoading]         = useState(false);
  const [loadingMsg, setLoadingMsg]       = useState("");
  const [loadProgress, setLoadProgress]   = useState(0);
  const [searchTerm, setSearchTerm]       = useState("");
  const [searchOpen, setSearchOpen]       = useState(false);
  const [exportOpen, setExportOpen]       = useState(false);
  const [helpOpen, setHelpOpen]           = useState(false);
  const [fileOver, setFileOver]           = useState(false);
  const [exportOpts, setExportOpts]       = useState<ExportOptions>({
    filename: "redacted_document", stamp: "redacted", watermark: "",
  });

  // ── refs
  const fileInputRef         = useRef<HTMLInputElement>(null);
  const drawStartRef         = useRef<Point2D | null>(null);
  const activeDrawPageRef    = useRef<number | null>(null);
  const smartActiveRef       = useRef<boolean>(false);
  const smartBufferRef       = useRef<Set<SmartSelectionKey>>(new Set());
  const smartActivePageRef   = useRef<number | null>(null);
  const pageRefs             = useRef<(HTMLDivElement | null)[]>([]);
  const mainScrollRef        = useRef<HTMLDivElement>(null);

  const audio        = useAudio();
  const { toast, show: showToast } = useToast();

  // ── derived
  const hasDocument        = pages.length > 0;
  const zoomPercent        = Math.round(zoom * 100);
  const redactionsPerPage  = useMemo(() => {
    const m = new Map<number, number>();
    boxes.forEach(b => m.set(b.pageIdx, (m.get(b.pageIdx) ?? 0) + 1));
    return m;
  }, [boxes]);
  const activePage = useScrollSpy(mainScrollRef, pageRefs, pages.length);

  // ── zoom helpers
  const zoomIn  = () => setZoom(z => clamp(round2(z + ZOOM.STEP), ZOOM.MIN, ZOOM.MAX));
  const zoomOut = () => setZoom(z => clamp(round2(z - ZOOM.STEP), ZOOM.MIN, ZOOM.MAX));

  // ── keyboard shortcuts
  useKeyboardShortcuts(useCallback((e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); audio.click(); }
    else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); history.redo(); audio.click(); }
    else if (!mod) {
      const k = e.key.toLowerCase();
      if      (k === "s")    setMode(m => m === "smart" ? "view" : "smart");
      else if (k === "r")    setMode(m => m === "rect"  ? "view" : "rect");
      else if (k === "e")    setMode(m => m === "erase" ? "view" : "erase");
      else if (k === "escape") { setMode("view"); setHelpOpen(false); setExportOpen(false); }
      else if (k === "+" || k === "=") zoomIn();
      else if (k === "-")    zoomOut();
      else if (e.key === "?") setHelpOpen(o => !o);
      else if (e.key === "/") { e.preventDefault(); setSearchOpen(true); }
    }
  }, [history, audio]));

  // ── file loading
  const handleLoadFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showToast("Unsupported format — PDF only", "error"); return;
    }
    setIsLoading(true); setLoadProgress(0); setLoadingMsg("Initializing…");
    try {
      const rendered = await loadPdfDocument(file, (current, total) => {
        setLoadingMsg(`Rendering page ${current} of ${total}`);
        setLoadProgress(Math.round((current / total) * 100));
      });
      setPages(rendered);
      pageRefs.current = new Array(rendered.length).fill(null);
      history.reset([]);

      const baseName = stripFileExt(file.name);
      setDocumentName(baseName);
      setExportOpts(o => ({ ...o, filename: baseName + "_redacted" }));

      const totalWords = rendered.reduce((s, p) => s + p.textItems.length, 0);
      if (totalWords === 0) {
        setMode("rect");
        showToast("Loaded — rectangle mode only (scanned PDF)", "info");
      } else {
        setMode("smart");
        showToast(`${rendered.length} pages · ${totalWords} words detected`, "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Error: ${msg}`, "error");
    } finally {
      setIsLoading(false); setLoadingMsg(""); setLoadProgress(0);
    }
  }, [history, showToast]);

  const handleTrySample = useCallback(async () => {
    setIsLoading(true); setLoadingMsg("Generating sample document…");
    try {
      const file = await generateSampleDocument();
      await handleLoadFile(file);
    } catch {
      showToast("Failed to generate sample", "error");
      setIsLoading(false); setLoadingMsg("");
    }
  }, [handleLoadFile, showToast]);

  const handleDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault(); setFileOver(false);
    handleLoadFile(e.dataTransfer.files[0]);
  }, [handleLoadFile]);

  // ── pointer handlers
  const handlePointerDown = useCallback((e: ReactPointerEvent, pageIdx: number) => {
    if (mode === "view" || mode === "erase") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const containerEl = pageRefs.current[pageIdx]; if (!containerEl) return;
    const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[pageIdx]);

    if (mode === "rect") {
      activeDrawPageRef.current = pageIdx;
      drawStartRef.current = point;
      setDrawing({ pageIdx, x: point.x, y: point.y, w: 0, h: 0 });
    } else if (mode === "smart") {
      smartActiveRef.current = true;
      smartActivePageRef.current = pageIdx;
      smartBufferRef.current = new Set();
      const wi = findWordIndexAt(point, pages[pageIdx].textItems);
      if (wi !== -1) smartBufferRef.current.add(toSmartSelectionKey(pageIdx, wi));
      setSmartSel(new Set(smartBufferRef.current));
    }
  }, [mode, pages]);

  const handlePointerMove = useCallback((e: ReactPointerEvent) => {
    if (mode === "rect" && drawStartRef.current && activeDrawPageRef.current !== null) {
      e.preventDefault();
      const pi = activeDrawPageRef.current;
      const containerEl = pageRefs.current[pi]; if (!containerEl) return;
      const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[pi]);
      const start = drawStartRef.current;
      setDrawing({
        pageIdx: pi,
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      });
    } else if (mode === "smart" && smartActiveRef.current && smartActivePageRef.current !== null) {
      e.preventDefault();
      const pi = smartActivePageRef.current;
      const containerEl = pageRefs.current[pi]; if (!containerEl) return;
      const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[pi]);
      const wi = findWordIndexAt(point, pages[pi].textItems);
      if (wi !== -1) {
        const key = toSmartSelectionKey(pi, wi);
        if (!smartBufferRef.current.has(key)) {
          smartBufferRef.current.add(key);
          setSmartSel(new Set(smartBufferRef.current));
        }
      }
    }
  }, [mode, pages]);

  const handlePointerUp = useCallback(() => {
    if (mode === "rect") {
      if (drawing && drawing.w > MIN_DRAW_SIZE && drawing.h > MIN_DRAW_SIZE) {
        history.set([...boxes, { ...drawing }]);
        audio.stamp();
      }
      setDrawing(null); drawStartRef.current = null; activeDrawPageRef.current = null;
    } else if (mode === "smart" && smartActiveRef.current) {
      smartActiveRef.current = false;
      if (smartBufferRef.current.size > 0) {
        const newBoxes = smartSelectionToBoxes(pages, smartBufferRef.current);
        history.set([...boxes, ...newBoxes]);
        audio.stamp();
      }
      smartBufferRef.current = new Set();
      smartActivePageRef.current = null;
      setSmartSel(new Set());
    }
  }, [mode, drawing, boxes, pages, history, audio]);

  const handleEraseBox = useCallback((globalIdx: number) => {
    if (mode !== "erase") return;
    history.set(boxes.filter((_, i) => i !== globalIdx));
    audio.click();
  }, [mode, boxes, history, audio]);

  // ── search & AI
  const handleSearchSubmit = useCallback(() => {
    const matches = matchTextAcrossPages(pages, searchTerm);
    if (matches.length === 0) { showToast("No matches found", "error"); return; }
    history.set([...boxes, ...matches]); audio.stamp();
    showToast(`${matches.length} occurrence${matches.length === 1 ? "" : "s"} redacted`, "success");
  }, [pages, searchTerm, boxes, history, audio, showToast]);

  const handleAiRedact = useCallback(async () => {
    if (!hasDocument) { showToast("Load a PDF first", "error"); return; }
    setIsLoading(true); setLoadingMsg("Running AI analysis…");
    try {
      const terms = await requestAiRedactionTerms(pages);
      const hits = matchTermsAcrossPages(pages, terms);
      history.set([...boxes, ...hits]); audio.stamp();
      showToast(`${hits.length} items redacted by AI`, "success");
    } catch {
      showToast("AI service error", "error");
    } finally {
      setIsLoading(false); setLoadingMsg("");
    }
  }, [hasDocument, pages, boxes, history, audio, showToast]);

  // ── export
  const handleExport = useCallback(async () => {
    if (!hasDocument) { showToast("Nothing to export", "error"); return; }
    setExportOpen(false);
    setIsLoading(true); setLoadingMsg("Generating redacted PDF…");
    try {
      await exportRedactedPdf(pages, boxes, exportOpts);
      audio.stamp();
      showToast("PDF exported", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Export error: ${msg}`, "error");
    } finally {
      setIsLoading(false); setLoadingMsg("");
    }
  }, [hasDocument, pages, boxes, exportOpts, audio, showToast]);

  // ── jump to page (sidebar click)
  const jumpToPage = useCallback((i: number) => {
    pageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // ── render
  return (
    <div
      className="redakt-app"
      onDragOver={e => { e.preventDefault(); setFileOver(true); }}
      onDragLeave={() => setFileOver(false)}
      onDrop={handleDrop}
    >
      <Styles />
      <FileDropOverlay visible={fileOver} />
      <Toast toast={toast} />

      <Header
        documentName={documentName}
        redactionCount={boxes.length}
        onHelpClick={() => setHelpOpen(true)}
      />

      {isLoading && (
        loadProgress > 0
          ? <div className="lbar-track"><div className="lbar-fill" style={{ width: `${loadProgress}%` }} /></div>
          : <div className="lbar-indeterminate" />
      )}
      {isLoading && <div className="lmsg">⬛ {loadingMsg}</div>}

      {hasDocument && (
        <Toolbar
          mode={mode} zoomPercent={zoomPercent}
          isLoading={isLoading} searchOpen={searchOpen}
          hasRedactions={boxes.length > 0}
          canUndo={history.canUndo} canRedo={history.canRedo}
          onPickFile={() => fileInputRef.current?.click()}
          onSetMode={setMode}
          onUndo={history.undo} onRedo={history.redo}
          onZoomIn={zoomIn} onZoomOut={zoomOut}
          onToggleSearch={() => setSearchOpen(s => !s)}
          onAiRedact={handleAiRedact}
          onExport={() => setExportOpen(true)}
          onClearAll={() => history.set([])}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={e => handleLoadFile(e.target.files?.[0])}
      />

      {searchOpen && hasDocument && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          onSubmit={handleSearchSubmit}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {!hasDocument ? (
        <div className="main-scroll">
          <LandingPage onTrySample={handleTrySample} onPickFile={() => fileInputRef.current?.click()} />
        </div>
      ) : (
        <>
          <div className="body">
            <Sidebar
              pages={pages}
              activeIndex={activePage}
              redactionsPerPage={redactionsPerPage}
              onJumpToPage={jumpToPage}
            />

            <div className="main-scroll" ref={mainScrollRef}>
              <div className="pages-wrap">
                {pages.map((page, pi) => (
                  <PageView
                    key={pi}
                    page={page}
                    pageIdx={pi}
                    pageCount={pages.length}
                    zoom={zoom}
                    mode={mode}
                    boxes={boxes}
                    globalBoxes={boxes}
                    drawing={drawing}
                    smartSelection={smartSelection}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onEraseBox={handleEraseBox}
                    containerRef={el => { pageRefs.current[pi] = el; }}
                    redactionCount={redactionsPerPage.get(pi) ?? 0}
                  />
                ))}
              </div>
            </div>

            <StatsPanel
              pages={pages} boxes={boxes}
              redactionsPerPage={redactionsPerPage}
              isLoading={isLoading}
              onAiRedact={handleAiRedact}
              onExport={() => setExportOpen(true)}
            />
          </div>

          {mode === "smart" && <div className="hint-bar">Click a word · Hold and drag for multi-select</div>}
          {mode === "rect"  && <div className="hint-bar">Hold and drag to draw a rectangle</div>}
          {mode === "erase" && <div className="hint-bar">Tap a black bar to remove it</div>}
        </>
      )}

      {exportOpen && (
        <ExportModal
          options={exportOpts}
          onChange={setExportOpts}
          onClose={() => setExportOpen(false)}
          onExport={handleExport}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ─── 8. STYLES ────────────────────────────────────────────────────────────────

const Styles = () => <style>{REDAKT_STYLES}</style>;
