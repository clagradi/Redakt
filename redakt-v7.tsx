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
  type ReactNode, type PointerEvent as ReactPointerEvent,
} from "react";

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

type StampStyle = keyof typeof STAMP_LABELS;

interface ExportOptions {
  filename:  string;
  stamp:     StampStyle;
  watermark: string;
}

interface ToastMessage { text: string; tone: "info" | "error" | "success" }

interface Point2D { x: number; y: number }

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
  if (!needle) return [];
  const out: RedactionBox[] = [];
  pages.forEach((p, pi) => {
    p.textItems.forEach(it => {
      if (it.text.toLowerCase().includes(needle)) out.push(wordToBox(pi, it));
    });
  });
  return out;
}

/** Convert a RedactionBox to CSS percentage coords for a given page. */
function boxToPercentStyle(
  box: { x: number; y: number; w: number; h: number },
  page: PageData,
): React.CSSProperties {
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
  scrollEl: React.RefObject<HTMLElement>,
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>,
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
  const isMode = (m: EditorMode) => p.mode === m;
  return (
    <div className="toolbar">
      <button className="btn btn-ghost" onClick={p.onPickFile}>↑ New</button>
      <div className="sep" />
      <button className={`btn btn-ghost ${isMode("smart") ? "active-blue"  : ""}`} onClick={() => p.onSetMode(isMode("smart") ? "view" : "smart")} title="S">⊞ Smart</button>
      <button className={`btn btn-ghost ${isMode("rect")  ? "active-red"   : ""}`} onClick={() => p.onSetMode(isMode("rect")  ? "view" : "rect")}  title="R">⬛ Rectangle</button>
      <button className={`btn btn-ghost ${isMode("erase") ? "active-amber" : ""}`} onClick={() => p.onSetMode(isMode("erase") ? "view" : "erase")} title="E">✕ Erase</button>
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

      {p.mode !== "view" && (
        <span className="mode-indicator" style={{
          color: p.mode === "smart" ? "var(--blue2)" : p.mode === "rect" ? "#ff7070" : "#e0b020",
        }}>
          {p.mode === "smart" ? "● SMART" : p.mode === "rect" ? "● RECTANGLE" : "● ERASE"}
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
  smartSelection: Set<string>;
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
          const key = `${p.pageIdx}:${ti}`;
          if (!p.smartSelection.has(key)) return null;
          return (
            <div
              key={`hl-${ti}`}
              className="word-highlight"
              style={boxToPercentStyle(
                { x: it.x - WORD_PADDING, y: it.y - WORD_PADDING, w: it.w + WORD_PADDING * 2, h: it.h + WORD_PADDING * 2 },
                p.page,
              )}
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

const HelpModal = ({ onClose }: { onClose: () => void }) => {
  const shortcuts: Array<[string, string]> = [
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
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <div className="help-grid">
        {shortcuts.map(([label, key]) => (
          <div className="help-row" key={label}>
            <span className="help-label">{label}</span>
            <span className="kbd">{key}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
};

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
        {[
          ["⊞", "Smart selection", "Click on a word to redact it, drag across multiple words to redact a sequence"],
          ["⬛", "Free rectangle", "Draw arbitrary rectangles anywhere — also on images, charts, or signatures"],
          ["★", "AI auto-redact", "Claude identifies names, locations, dates, and sensitive numbers automatically"],
          ["🔍", "Find & redact", "Type a string and obscure every occurrence in the document at once"],
          ["📑", "Export PDF",   "Export with TOP SECRET, REDACTED, CLASSIFIED stamps and custom watermarks"],
          ["🔒", "Total privacy", "Everything happens in your browser. The document never leaves your device"],
        ].map(([icon, title, desc]) => (
          <div className="feature" key={title}>
            <div className="feature-icon">{icon}</div>
            <div className="feature-t">{title}</div>
            <div className="feature-d">{desc}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="how">
      <div className="how-h">— Workflow —</div>
      <div className="how-t">Three steps</div>
      <div className="how-grid">
        {[
          ["01", "Upload",  "Drag a PDF in or click to select. The file stays in your browser."],
          ["02", "Redact",  "Click on words, drag across paragraphs, or let the AI handle it."],
          ["03", "Export",  "Download the PDF with permanent black bars baked in."],
        ].map(([n, t, d]) => (
          <div className="step" key={n}>
            <div className="step-n">{n}</div>
            <div className="step-t">{t}</div>
            <div className="step-d">{d}</div>
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
  const [smartSelection, setSmartSel]     = useState<Set<string>>(new Set());

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
  const smartBufferRef       = useRef<Set<string>>(new Set());
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

  const handleDrop = useCallback((e: React.DragEvent) => {
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
      if (wi !== -1) smartBufferRef.current.add(`${pageIdx}:${wi}`);
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
        const key = `${pi}:${wi}`;
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
        const newBoxes: RedactionBox[] = Array.from(smartBufferRef.current).map(key => {
          const [piStr, wiStr] = key.split(":");
          const it = pages[+piStr].textItems[+wiStr];
          return wordToBox(+piStr, it);
        });
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
      const hits: RedactionBox[] = [];
      pages.forEach((p, pi) => terms.forEach(term => p.textItems.forEach(it => {
        if (it.text.toLowerCase().includes(term.toLowerCase())) hits.push(wordToBox(pi, it));
      })));
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

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=Oswald:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');

    :root {
      --bg:#020202; --bg2:#070707; --bg3:#0c0c0c; --bg4:#121212; --bg5:#181818;
      --border:#1a1a1a; --border2:#252525; --border3:#333;
      --text:#aaa; --text2:#777; --text3:#555; --text4:#3a3a3a;
      --red:#a30000; --red2:#cc1111; --red-dim:rgba(180,0,0,.12);
      --gold:#b8960c; --gold2:#d4af37;
      --green:#2d7a2d; --green2:#4caf50;
      --blue:#3a5e8e; --blue2:#5b8eff;
    }

    *, *::before, *::after { box-sizing:border-box; -webkit-font-smoothing:antialiased; }
    body { margin:0; }

    .redakt-app {
      display:flex; flex-direction:column; height:100vh;
      background:var(--bg); overflow:hidden; color:var(--text);
      font-family:'Inter','system-ui',sans-serif;
    }

    ::-webkit-scrollbar { width:6px; height:6px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:#1c1c1c; border-radius:3px; }
    ::-webkit-scrollbar-thumb:hover { background:#2a2a2a; }

    /* ── header ─────────────────────────────────────────────────────────────── */
    .header { background:var(--bg2); border-bottom:1px solid var(--border);
      padding:0 18px; height:54px; display:flex; align-items:center; gap:12px;
      flex-shrink:0; position:relative; z-index:100; }
    .header::after { content:''; position:absolute; bottom:0; left:0; right:0; height:1.5px;
      background:linear-gradient(90deg,transparent 0%,var(--red) 30%,var(--gold) 70%,transparent 100%); }
    .brand { display:flex; align-items:center; gap:10px; }
    .seal { width:36px; height:36px; border-radius:50%; border:1.5px solid var(--gold);
      display:flex; align-items:center; justify-content:center;
      font-family:'Oswald',sans-serif; font-weight:700; font-size:11px; color:var(--gold);
      flex-shrink:0; position:relative; box-shadow:0 0 14px rgba(184,150,12,.18); }
    .seal::before { content:''; position:absolute; inset:-3px; border-radius:50%; border:1px solid rgba(184,150,12,.25); }
    .brand-name { font-family:'Oswald',sans-serif; font-weight:700; font-size:18px;
      letter-spacing:6px; color:var(--gold); }
    .brand-tag { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:3px;
      color:var(--text3); display:block; margin-top:1px; }
    .header-right { margin-left:auto; display:flex; align-items:center; gap:10px; }
    .doc-name { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text2);
      padding:4px 10px; background:var(--bg3); border:1px solid var(--border); }
    .stat-pill { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:1.5px;
      color:var(--red2); background:var(--red-dim);
      border:1px solid rgba(204,17,17,.25); padding:4px 8px; }

    /* ── toolbar ────────────────────────────────────────────────────────────── */
    .toolbar { background:var(--bg2); border-bottom:1px solid var(--border);
      padding:8px 16px; display:flex; gap:4px; flex-wrap:wrap; align-items:center; flex-shrink:0; }
    .btn { font-family:'Oswald',sans-serif; font-size:9.5px; letter-spacing:1.5px;
      text-transform:uppercase; padding:7px 12px; cursor:pointer; border:none; outline:none;
      transition:all .12s; white-space:nowrap; display:inline-flex; align-items:center; gap:5px; }
    .btn:disabled { opacity:.3; cursor:not-allowed; }
    .btn-ghost { background:transparent; color:var(--text2); border:1px solid var(--border2); }
    .btn-ghost:not(:disabled):hover { border-color:#444; color:#bbb; background:var(--bg3); }
    .btn-gold { background:linear-gradient(180deg,var(--gold2),var(--gold)); color:#0a0a0a;
      font-weight:700; box-shadow:inset 0 1px 0 rgba(255,255,255,.2); }
    .btn-gold:not(:disabled):hover { background:var(--gold2); }
    .btn-red { background:linear-gradient(180deg,#b81515,var(--red)); color:#fff;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.15); }
    .btn-red:not(:disabled):hover { background:#b81515; }
    .btn-green { background:rgba(45,122,45,.5); color:var(--green2); border:1px solid var(--green); }
    .btn-green:not(:disabled):hover { background:rgba(45,122,45,.7); }
    .active-blue  { background:rgba(20,40,80,.55)!important; color:var(--blue2)!important; border:1px solid var(--blue)!important; }
    .active-red   { background:rgba(110,0,0,.55)!important; color:#ff8080!important; border:1px solid #770000!important; }
    .active-amber { background:rgba(80,55,0,.55)!important; color:#e0b020!important; border:1px solid #604a00!important; }
    .sep { width:1px; height:22px; background:var(--border2); margin:0 3px; flex-shrink:0; }
    .zoom-group { display:flex; align-items:center; gap:1px; }
    .zoom-value { font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--text2);
      min-width:38px; text-align:center; padding:0 4px; }
    .mode-indicator { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2.5px;
      animation:blink 1.2s step-end infinite; margin-left:auto; padding:5px 10px; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
    .full-width { width:100%; justify-content:center; }
    .mt-6 { margin-top:6px; }

    /* ── search bar ─────────────────────────────────────────────────────────── */
    .search-bar { background:var(--bg3); border-bottom:1px solid var(--border);
      padding:8px 16px; display:flex; align-items:center; gap:8px; flex-shrink:0;
      animation:slideDown .2s ease; }
    @keyframes slideDown { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
    .search-input { flex:1; background:var(--bg4); border:1px solid var(--border2); color:#ccc;
      font-family:'JetBrains Mono',monospace; font-size:12px; padding:7px 12px; outline:none; max-width:380px; }
    .search-input:focus { border-color:var(--gold); }
    .search-input::placeholder { color:#3a3a3a; }
    .search-hint { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:1.5px; color:var(--text3); }

    /* ── loading ────────────────────────────────────────────────────────────── */
    .lbar-indeterminate { height:2px;
      background:linear-gradient(90deg,transparent,var(--gold) 40%,var(--red2) 60%,transparent);
      background-size:300% 100%; animation:lb 1s linear infinite; flex-shrink:0; }
    @keyframes lb { 0%{background-position:100% 0} 100%{background-position:-200% 0} }
    .lbar-track { height:2px; background:var(--bg3); flex-shrink:0; }
    .lbar-fill { height:100%; background:linear-gradient(90deg,var(--red),var(--gold)); transition:width .3s; }
    .lmsg { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:3px; color:var(--gold);
      text-align:center; padding:5px; background:var(--bg2); text-transform:uppercase;
      border-bottom:1px solid var(--border); flex-shrink:0; }

    /* ── body / sidebar / main ──────────────────────────────────────────────── */
    .body { display:flex; flex:1; overflow:hidden; min-height:0; }
    .sidebar { width:158px; flex-shrink:0; background:var(--bg2);
      border-right:1px solid var(--border); overflow-y:auto; }
    .sidebar-header { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:2.5px;
      color:var(--text3); padding:11px 11px 7px; text-transform:uppercase;
      border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg2); z-index:1; }
    .sidebar-page { padding:9px; cursor:pointer; border-bottom:1px solid var(--border);
      transition:background .12s; position:relative; }
    .sidebar-page:hover { background:var(--bg3); }
    .sidebar-page.active { background:var(--bg4); }
    .sidebar-page.active::before { content:''; position:absolute; left:0; top:0; bottom:0;
      width:2px; background:var(--gold); }
    .thumbnail { width:100%; aspect-ratio:.707; background:var(--bg4); overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,.5); }
    .thumbnail img { width:100%; height:100%; object-fit:cover; object-position:top; display:block; }
    .thumb-meta { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
    .thumb-num { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:1.5px; color:var(--text3); }
    .thumb-count { font-family:'Oswald',sans-serif; font-size:8px; padding:1.5px 6px;
      background:var(--red-dim); color:var(--red2); border:1px solid rgba(204,17,17,.25); }

    .main-scroll { flex:1; overflow:auto; background:var(--bg); min-width:0; }
    .pages-wrap { padding:24px 24px 64px; display:flex; flex-direction:column; align-items:center; gap:20px; }
    .page-outer { display:flex; flex-direction:column; align-items:center; }
    .page-wrap { position:relative; box-shadow:0 2px 12px rgba(0,0,0,.6),0 8px 40px rgba(0,0,0,.5);
      transition:width .15s; }
    .page-img { display:block; width:100%; height:auto; user-select:none; -webkit-user-drag:none; }
    .overlay { position:absolute; inset:0; z-index:10; touch-action:none; }
    .overlay.rect  { cursor:crosshair; }
    .overlay.smart { cursor:text; }
    .overlay.erase { cursor:default; }
    .redaction-box { position:absolute; background:#040404; pointer-events:none; }
    .redaction-box.erasable { pointer-events:all; cursor:pointer; transition:background .1s; }
    .redaction-box.erasable:hover { background:rgba(100,0,0,.92); outline:1px solid var(--red2); }
    .redaction-box.erasable:hover::after { content:'✕'; position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      color:var(--red2); font-size:14px; font-family:'Oswald',sans-serif; font-weight:700; }
    .rect-ghost { position:absolute; background:rgba(180,0,0,.3);
      border:1.5px dashed var(--red2); pointer-events:none; z-index:20; }
    .word-highlight { position:absolute; background:rgba(180,0,0,.45); pointer-events:none;
      z-index:15; transition:background .08s; outline:1px solid rgba(255,80,80,.6); }
    .page-label { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:3px;
      color:var(--text3); padding:5px; text-transform:uppercase; }

    /* ── stats panel ────────────────────────────────────────────────────────── */
    .stats-panel { width:240px; flex-shrink:0; background:var(--bg2);
      border-left:1px solid var(--border); overflow-y:auto; }
    .stats-section { padding:14px; border-bottom:1px solid var(--border); }
    .stats-header { font-family:'Oswald',sans-serif; font-size:8.5px; letter-spacing:2.5px;
      color:var(--text3); text-transform:uppercase; margin-bottom:10px; }
    .stat-big { font-family:'Oswald',sans-serif; font-size:32px; font-weight:300;
      color:var(--gold); line-height:1; }
    .stat-big-sub { font-family:'Oswald',sans-serif; font-size:8px; letter-spacing:2px;
      color:var(--text3); text-transform:uppercase; margin-top:4px; }
    .stat-row { display:flex; justify-content:space-between; align-items:center;
      margin-bottom:6px; font-family:'JetBrains Mono',monospace; font-size:11px; }
    .stat-row span:first-child { color:var(--text2); }
    .stat-row span:last-child  { color:#ccc; font-weight:500; }
    .page-bar { display:flex; align-items:center; gap:8px; margin-bottom:5px; font-size:10px; }
    .page-bar-label { font-family:'JetBrains Mono',monospace; color:var(--text2);
      width:48px; flex-shrink:0; font-size:10px; }
    .page-bar-track { flex:1; height:6px; background:var(--bg4); position:relative; overflow:hidden; }
    .page-bar-fill { position:absolute; left:0; top:0; bottom:0;
      background:linear-gradient(90deg,var(--red),var(--red2)); }
    .page-bar-num { font-family:'JetBrains Mono',monospace; color:#ccc;
      width:20px; text-align:right; flex-shrink:0; }

    /* ── landing page ───────────────────────────────────────────────────────── */
    .landing { padding:0; background:var(--bg); }
    .hero { position:relative; min-height:calc(100vh - 110px); display:flex;
      flex-direction:column; align-items:center; justify-content:center; padding:40px 24px;
      text-align:center; gap:20px; overflow:hidden; }
    .hero::before { content:''; position:absolute; inset:0;
      background:radial-gradient(ellipse at center, rgba(184,150,12,.04) 0%, transparent 60%);
      pointer-events:none; }
    .hero-stamp { position:absolute; opacity:.04; font-family:'Oswald',sans-serif;
      font-weight:700; font-size:clamp(80px,16vw,200px); letter-spacing:8px; color:var(--red);
      transform:rotate(-15deg); pointer-events:none; user-select:none;
      animation:stampFloat 6s ease-in-out infinite; }
    @keyframes stampFloat { 0%,100%{transform:rotate(-15deg) translateY(0)} 50%{transform:rotate(-13deg) translateY(-10px)} }
    .hero-pretitle { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:5px;
      color:var(--gold); text-transform:uppercase; opacity:0; animation:fadeUp .8s ease forwards; }
    .hero-title { font-family:'Oswald',sans-serif; font-weight:700;
      font-size:clamp(48px,9vw,108px); letter-spacing:clamp(8px,1.5vw,18px); color:#e8e8e8;
      text-transform:uppercase; line-height:.95; margin:0;
      opacity:0; animation:fadeUp .8s ease .15s forwards; }
    .hero-sub { font-family:'Inter',sans-serif; font-weight:300; font-size:clamp(13px,1.6vw,17px);
      color:var(--text2); max-width:600px; line-height:1.6;
      opacity:0; animation:fadeUp .8s ease .3s forwards; margin:0; }
    .hero-divider { width:60px; height:1px; background:var(--gold);
      opacity:0; animation:fadeUp .8s ease .35s forwards; }
    .hero-cta { display:flex; gap:10px; flex-wrap:wrap; justify-content:center;
      margin-top:8px; opacity:0; animation:fadeUp .8s ease .45s forwards; }
    .cta-primary { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2.5px;
      padding:14px 28px; background:linear-gradient(180deg,var(--gold2),var(--gold));
      color:#0a0a0a; font-weight:700; cursor:pointer; border:none; text-transform:uppercase;
      box-shadow:0 4px 20px rgba(184,150,12,.3); transition:transform .15s, box-shadow .15s; }
    .cta-primary:hover { transform:translateY(-2px); box-shadow:0 6px 28px rgba(184,150,12,.4); }
    .cta-secondary { font-family:'Oswald',sans-serif; font-size:11px; letter-spacing:2.5px;
      padding:14px 28px; background:transparent; color:#aaa; font-weight:600; cursor:pointer;
      border:1px solid var(--border3); text-transform:uppercase; transition:all .15s; }
    .cta-secondary:hover { border-color:var(--gold); color:var(--gold); }
    .hero-meta { display:flex; gap:20px; font-family:'Oswald',sans-serif; font-size:9px;
      letter-spacing:2px; color:var(--text3); text-transform:uppercase; margin-top:10px;
      opacity:0; animation:fadeUp .8s ease .6s forwards; }
    .hero-meta span::before { content:'■ '; color:var(--green2); }
    @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }

    .features { padding:60px 24px; background:var(--bg2);
      border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
    .features-h { text-align:center; font-family:'Oswald',sans-serif; font-size:11px;
      letter-spacing:4px; color:var(--gold); text-transform:uppercase; margin-bottom:8px; }
    .features-t { text-align:center; font-family:'Oswald',sans-serif; font-size:28px;
      letter-spacing:3px; color:#ddd; text-transform:uppercase; margin-bottom:48px; font-weight:400; }
    .features-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
      gap:1px; max-width:1100px; margin:0 auto; background:var(--border); border:1px solid var(--border); }
    .feature { padding:28px 22px; background:var(--bg2); transition:background .2s; }
    .feature:hover { background:var(--bg3); }
    .feature-icon { font-size:26px; margin-bottom:12px; }
    .feature-t { font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:2px;
      color:#ddd; text-transform:uppercase; margin-bottom:8px; font-weight:600; }
    .feature-d { font-family:'Inter',sans-serif; font-size:12.5px; line-height:1.6;
      color:var(--text2); font-weight:300; }

    .how { padding:50px 24px; }
    .how-h { text-align:center; font-family:'Oswald',sans-serif; font-size:11px;
      letter-spacing:4px; color:var(--gold); text-transform:uppercase; margin-bottom:8px; }
    .how-t { text-align:center; font-family:'Oswald',sans-serif; font-size:24px;
      letter-spacing:3px; color:#ddd; text-transform:uppercase; margin-bottom:36px; font-weight:400; }
    .how-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:32px; max-width:900px; margin:0 auto; }
    @media (max-width:720px) { .how-grid { grid-template-columns:1fr; } }
    .step { text-align:center; padding:0 12px; }
    .step-n { font-family:'Oswald',sans-serif; font-size:42px; font-weight:300;
      color:var(--gold); margin-bottom:8px; line-height:1; }
    .step-t { font-family:'Oswald',sans-serif; font-size:12px; letter-spacing:2.5px;
      color:#ccc; text-transform:uppercase; margin-bottom:8px; font-weight:600; }
    .step-d { font-family:'Inter',sans-serif; font-size:13px; color:var(--text2); line-height:1.6; }

    .footer { padding:24px; text-align:center; border-top:1px solid var(--border); background:var(--bg2); }
    .footer-text { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text4); text-transform:uppercase; }

    /* ── modals ─────────────────────────────────────────────────────────────── */
    .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:9990;
      display:flex; align-items:center; justify-content:center; padding:20px;
      backdrop-filter:blur(4px); animation:fadeIn .15s ease; }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    .modal { background:var(--bg2); border:1px solid var(--border2); padding:0;
      max-width:520px; width:100%; max-height:90vh; overflow:auto;
      box-shadow:0 20px 80px rgba(0,0,0,.8); animation:modalIn .2s ease; }
    @keyframes modalIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    .modal-header { padding:18px 22px; border-bottom:1px solid var(--border);
      display:flex; align-items:center; justify-content:space-between; }
    .modal-title { font-family:'Oswald',sans-serif; font-size:13px; letter-spacing:3px;
      color:var(--gold); text-transform:uppercase; }
    .modal-close { background:none; border:none; color:var(--text3); cursor:pointer;
      font-size:18px; line-height:1; padding:4px; }
    .modal-close:hover { color:#fff; }
    .modal-body { padding:20px 22px; }
    .modal-footer { padding:16px 22px; border-top:1px solid var(--border);
      display:flex; gap:10px; justify-content:flex-end; }

    .field { margin-bottom:16px; }
    .field-label { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text2); text-transform:uppercase; margin-bottom:6px; display:block; }
    .field-input { width:100%; background:var(--bg4); border:1px solid var(--border2);
      color:#ccc; font-family:'JetBrains Mono',monospace; font-size:12px;
      padding:8px 10px; outline:none; }
    .field-input:focus { border-color:var(--gold); }
    .stamp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:6px; }
    .stamp-option { padding:8px 10px; background:var(--bg4); border:1px solid var(--border2);
      cursor:pointer; text-align:center; font-family:'Oswald',sans-serif; font-size:9.5px;
      letter-spacing:1.5px; color:var(--text2); transition:all .12s; text-transform:uppercase; }
    .stamp-option:hover { color:#ccc; border-color:#444; }
    .stamp-option.active { background:var(--red-dim); border-color:var(--red2); color:#ff6060; }

    .help-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; }
    .help-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; }
    .help-label { font-family:'Inter',sans-serif; font-size:12px; color:var(--text); }
    .kbd { font-family:'JetBrains Mono',monospace; font-size:10px; background:var(--bg4);
      border:1px solid var(--border2); padding:2px 6px; color:#aaa; box-shadow:0 1px 0 var(--border); }

    /* ── toast & overlays ───────────────────────────────────────────────────── */
    .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      font-family:'Oswald',sans-serif; font-size:9.5px; letter-spacing:2px;
      text-transform:uppercase; padding:10px 18px; background:var(--bg2);
      border:1px solid var(--border2); color:var(--text); z-index:9999; pointer-events:none;
      animation:tin .2s ease; box-shadow:0 4px 20px rgba(0,0,0,.6); }
    .toast-error   { border-color:var(--red); color:#ff7070; }
    .toast-success { border-color:var(--green); color:var(--green2); }
    @keyframes tin { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

    .drop-overlay { position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,.92);
      border:2px dashed var(--gold); display:flex; align-items:center; justify-content:center;
      flex-direction:column; gap:14px; pointer-events:none; }
    .drop-overlay-text { font-family:'Oswald',sans-serif; font-size:14px; letter-spacing:4px;
      color:var(--gold); text-transform:uppercase; }

    .hint-bar { font-family:'Oswald',sans-serif; font-size:9px; letter-spacing:2px;
      color:var(--text3); text-align:center; padding:6px; text-transform:uppercase;
      background:var(--bg2); border-top:1px solid var(--border); }

    input[type=file] { display:none; }

    /* ── responsive ─────────────────────────────────────────────────────────── */
    @media (max-width:1024px) { .stats-panel { display:none; } }
    @media (max-width:640px) {
      .sidebar { display:none; }
      .toolbar { padding:8px 10px; }
      .btn { font-size:9px; padding:6px 9px; }
      .hero-meta { flex-direction:column; gap:6px; }
      .doc-name { display:none; }
    }
  `}</style>
);
