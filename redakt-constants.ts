import type { LandingFeature, ToolModeConfig, ToolMode as ToolModeType, WorkflowStep } from "./redakt-types";

export const CDN = {
  pdfJs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  jsPdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
} as const;

export const RENDER_SCALE = 2.0;
export const WORD_PADDING = 3;
export const MIN_DRAW_SIZE = 6;
export const TOAST_MS = 3000;
export const SCROLL_OFFSET = 140;

export const ZOOM = { MIN: 0.5, MAX: 2.5, STEP: 0.25 } as const;

export const STAMP_LABELS = {
  none: "None",
  redacted: "REDACTED",
  classified: "CLASSIFIED",
  topSecret: "TOP SECRET",
  confidential: "CONFIDENTIAL",
} as const;

export const AI_MODEL = "claude-sonnet-4-20250514";

export const TOOL_MODE_CONFIG: Record<ToolModeType, ToolModeConfig> = {
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

export const TOOL_MODES: ToolModeType[] = ["smart", "rect", "erase"];

export const SHORTCUTS: Array<[label: string, key: string]> = [
  ["Smart mode (words)", "S"],
  ["Rectangle mode", "R"],
  ["Erase mode", "E"],
  ["Exit mode", "Esc"],
  ["Find text", "/"],
  ["Help", "?"],
  ["Undo", "⌘Z"],
  ["Redo", "⌘Y"],
  ["Zoom in", "+"],
  ["Zoom out", "−"],
];

export const LANDING_FEATURES: LandingFeature[] = [
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

export const WORKFLOW_STEPS: WorkflowStep[] = [
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
