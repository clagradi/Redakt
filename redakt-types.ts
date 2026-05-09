export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageData {
  dataUrl: string;
  width: number;
  height: number;
  textItems: TextItem[];
}

export interface RedactionBox {
  pageIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EditorMode = "view" | "smart" | "rect" | "erase";
export type ToolMode = Exclude<EditorMode, "view">;

export type StampStyle = "none" | "redacted" | "classified" | "topSecret" | "confidential";

export interface ExportOptions {
  filename: string;
  stamp: StampStyle;
  watermark: string;
}

export type AccountPlan = "free" | "annual";

export interface AccountState {
  email: string;
  plan: AccountPlan;
  exportUsage: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface BillingView {
  accountLabel: string;
  allowanceLabel: string;
  isSignedIn: boolean;
  isAnnual: boolean;
  usedExports: number;
  remainingExports: number;
}

export interface ToastMessage {
  text: string;
  tone: "info" | "error" | "success";
}

export interface Point2D {
  x: number;
  y: number;
}

export type SmartSelectionKey = `${number}:${number}`;

export interface ToolModeConfig {
  activeClass: string;
  buttonLabel: string;
  indicatorColor: string;
  indicatorLabel: string;
  shortcut: string;
}

export interface LandingFeature {
  icon: string;
  title: string;
  description: string;
}

export interface WorkflowStep {
  number: string;
  title: string;
  description: string;
}
