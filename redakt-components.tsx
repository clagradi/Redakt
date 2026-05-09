import { REDAKT_STYLES } from "./redakt-styles";
import { STAMP_LABELS, SHORTCUTS, TOOL_MODE_CONFIG, TOOL_MODES, LANDING_FEATURES, WORKFLOW_STEPS } from "./redakt-constants";
import { boxToPercentStyle, toSmartSelectionKey, wordToBox } from "./redakt-utils";
import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  EditorMode,
  SmartSelectionKey,
  PageData,
  RedactionBox,
  ExportOptions,
  ToolMode,
  LandingFeature,
  WorkflowStep,
  ToastMessage,
} from "./redakt-types";

export const Styles = () => <style>{REDAKT_STYLES}</style>;

export const Toast = ({ toast }: { toast: ToastMessage | null }) =>
  toast ? <div className={`toast toast-${toast.tone}`}>{toast.text}</div> : null;

export const FileDropOverlay = ({ visible }: { visible: boolean }) =>
  visible ? (
    <div className="drop-overlay">
      <div style={{ fontSize: 48 }}>📁</div>
      <div className="drop-overlay-text">Drop your PDF</div>
    </div>
  ) : null;

export interface HeaderProps {
  documentName: string;
  redactionCount: number;
  onHelpClick: () => void;
}

export const Header = ({ documentName, redactionCount, onHelpClick }: HeaderProps) => (
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
          📄 {documentName.length > 24 ? `${documentName.slice(0, 24)}…` : documentName}
        </div>
      )}
      {redactionCount > 0 && <div className="stat-pill">{redactionCount} REDACTIONS</div>}
      <button className="btn btn-ghost" onClick={onHelpClick} aria-label="Show keyboard shortcuts">?</button>
    </div>
  </div>
);

export interface ToolbarProps {
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

export const Toolbar = (p: ToolbarProps) => {
  const activeMode = p.mode === "view" ? null : TOOL_MODE_CONFIG[p.mode];
  const toggleMode = (nextMode: ToolMode) => p.onSetMode(p.mode === nextMode ? "view" : nextMode);

  return (
    <div className="toolbar">
      <button className="btn btn-ghost" onClick={p.onPickFile}>↑ New</button>
      <div className="sep" />
      {TOOL_MODES.map((toolMode) => {
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

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export const SearchBar = ({ value, onChange, onSubmit, onClose }: SearchBarProps) => (
  <div className="search-bar">
    <input
      className="search-input"
      placeholder="Find text to redact across all pages…"
      value={value}
      autoFocus
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") onSubmit();
        if (e.key === "Escape") onClose();
      }}
    />
    <button className="btn btn-green" onClick={onSubmit} disabled={!value.trim()}>Redact all</button>
    <span className="search-hint">↵ Confirm · Esc Close</span>
  </div>
);

export interface SidebarProps {
  pages: PageData[];
  activeIndex: number;
  redactionsPerPage: Map<number, number>;
  onJumpToPage: (i: number) => void;
}

export const Sidebar = ({ pages, activeIndex, redactionsPerPage, onJumpToPage }: SidebarProps) => (
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

export interface StatsPanelProps {
  pages: PageData[];
  boxes: RedactionBox[];
  redactionsPerPage: Map<number, number>;
  isLoading: boolean;
  onAiRedact: () => void;
  onExport: () => void;
}

export const StatsPanel = ({
  pages,
  boxes,
  redactionsPerPage,
  isLoading,
  onAiRedact,
  onExport,
}: StatsPanelProps) => {
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

export interface PageViewProps {
  page: PageData;
  pageIdx: number;
  pageCount: number;
  zoom: number;
  mode: EditorMode;
  boxes: RedactionBox[];
  drawing: RedactionBox | null;
  smartSelection: ReadonlySet<SmartSelectionKey>;
  key?: number;
  onPointerDown: (e: ReactPointerEvent, pi: number) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onEraseBox: (globalIdx: number) => void;
  globalBoxes: RedactionBox[];
  containerRef: (el: HTMLDivElement | null) => void;
  redactionCount: number;
}

export const PageView = (p: PageViewProps) => {
  const pageBoxes = p.boxes.filter((b: RedactionBox) => b.pageIdx === p.pageIdx);
  const isErase = p.mode === "erase";
  const isSmart = p.mode === "smart";
  const isView = p.mode === "view";

  return (
    <div className="page-outer" ref={p.containerRef}>
      <div className="page-wrap" style={{ width: `min(${p.zoom * 100}%, ${p.zoom * 820}px)` }}>
        <img className="page-img" src={p.page.dataUrl} alt={`Page ${p.pageIdx + 1}`} draggable={false} />

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

        {p.drawing?.pageIdx === p.pageIdx && p.drawing.w > 2 && p.drawing.h > 2 && (
          <div className="rect-ghost" style={boxToPercentStyle(p.drawing, p.page)} />
        )}

        <div
          className={`overlay ${p.mode}`}
          style={
            isView
              ? { display: "none" }
              : { display: "block" }
          }
          onPointerDown={(e: ReactPointerEvent) => p.onPointerDown(e, p.pageIdx)}
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

export interface ModalProps {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}

export const Modal = ({ title, onClose, children, footer }: ModalProps) => (
  <div className="modal-bg" onClick={onClose}>
    <div className="modal" onClick={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title">{title}</div>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>
);

export interface ExportModalProps {
  options: ExportOptions;
  onChange: (next: ExportOptions) => void;
  onClose: () => void;
  onExport: () => void;
}

export const ExportModal = ({ options, onChange, onClose, onExport }: ExportModalProps) => {
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
        <input
          className="field-input"
          value={options.filename}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setOpt("filename", e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label">Stamp on every page</label>
        <div className="stamp-grid">
          {(Object.keys(STAMP_LABELS) as Array<keyof typeof STAMP_LABELS>).map((id) => (
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => setOpt("watermark", e.target.value)}
        />
      </div>
    </Modal>
  );
};

export const HelpModal = ({ onClose }: { onClose: () => void }) => (
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

export interface LandingProps {
  onTrySample: () => void;
  onPickFile: () => void;
}

export const LandingPage = ({ onTrySample, onPickFile }: LandingProps) => (
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
        <button className="cta-primary" onClick={onTrySample}>★ Try with a sample</button>
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
        {LANDING_FEATURES.map((feature: LandingFeature) => (
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
        {WORKFLOW_STEPS.map((step: WorkflowStep) => (
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
