import { REDAKT_STYLES } from "./redakt-styles";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BILLING, STAMP_LABELS, SHORTCUTS, TOOL_MODE_CONFIG, TOOL_MODES, LANDING_FEATURES, WORKFLOW_STEPS } from "./redakt-constants";
import { boxToPercentStyle, toSmartSelectionKey, wordToBox } from "./redakt-utils";
import type {
  AccountState,
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
  accountLabel: string;
  allowanceLabel: string;
  onHelpClick: () => void;
  onAccountClick: () => void;
}

export const Header = ({
  documentName,
  redactionCount,
  accountLabel,
  allowanceLabel,
  onHelpClick,
  onAccountClick,
}: HeaderProps) => (
  <div className="header">
    <div className="brand">
      <div className="seal">SIC</div>
      <div>
        <div className="brand-name">EPSTEINER</div>
        <span className="brand-tag">Redaction Bureau (SIC Certified)</span>
      </div>
    </div>
    <div className="header-right">
      {documentName && (
        <div className="doc-name" title={documentName}>
          📄 {documentName.length > 24 ? `${documentName.slice(0, 24)}…` : documentName}
        </div>
      )}
      {redactionCount > 0 && <div className="stat-pill">{redactionCount} REDACTIONS</div>}
      <button className="account-pill" onClick={onAccountClick}>
        <span>{accountLabel}</span>
        <small>{allowanceLabel}</small>
      </button>
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
  onAutoRedact: () => void;
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
      <button className="btn btn-gold" onClick={p.onAutoRedact} disabled={p.isLoading}>★ Auto</button>
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
  wholeWord: boolean;
  onToggleWholeWord: () => void;
}

export const SearchBar = ({ value, onChange, onSubmit, onClose, wholeWord, onToggleWholeWord }: SearchBarProps) => (
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
    <button
      className={`btn btn-ghost ${wholeWord ? "active-amber" : ""}`}
      onClick={onToggleWholeWord}
      title="Match whole words only"
    >
      Aa
    </button>
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
  onAutoRedact: () => void;
  onExport: () => void;
}

export const StatsPanel = ({
  pages,
  boxes,
  redactionsPerPage,
  isLoading,
  onAutoRedact,
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
        <button className="btn btn-gold full-width" onClick={onAutoRedact} disabled={isLoading}>★ Auto-Redact</button>
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
  pendingEraseIndexes: ReadonlySet<number>;
  eraseHoverIdx?: number | null;
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
    <div className="page-outer">
      <div className="page-wrap" ref={p.containerRef} style={{ width: `min(${p.zoom * 100}%, ${p.zoom * 820}px)` }}>
        <img className="page-img" src={p.page.dataUrl} alt={`Page ${p.pageIdx + 1}`} draggable={false} />

        {pageBoxes.map((box, _bi) => {
          const globalIdx = p.globalBoxes.indexOf(box);
          const isPendingErase = p.pendingEraseIndexes.has(globalIdx);
          const isHovered = isErase && p.eraseHoverIdx === globalIdx && !isPendingErase;
          return (
            <div
              key={globalIdx}
              className={`redaction-box ${isErase ? "erasable" : ""} ${isPendingErase ? "erase-pending" : ""} ${isHovered ? "erase-hover" : ""}`}
              style={boxToPercentStyle(box, p.page)}
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

export const Modal = ({ title, onClose, children, footer }: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    lastFocusRef.current = document.activeElement as HTMLElement | null;
    const root = modalRef.current;
    if (!root) return;

    const focusable = () => Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

    // Focus first interactive element (or the modal itself).
    const first = focusable()[0];
    (first ?? root).focus({ preventScroll: true });

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        }
      } else {
        if (idx === items.length - 1 || idx === -1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };

    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      lastFocusRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

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

      <div className="field">
        <label className="field-label">Password (optional)</label>
        <input
          className="field-input"
          type="password"
          autoComplete="new-password"
          placeholder="Lock the PDF — printing & copy disabled"
          value={options.password ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setOpt("password", e.target.value)}
        />
        <div className="field-hint">
          Required to open. Cannot be recovered if lost — keep a copy.
        </div>
      </div>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={!!options.generateReceipt}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setOpt("generateReceipt", e.target.checked)}
        />
        <span>
          <strong>Download audit receipt</strong>
          <small>JSON sidecar with SHA-256 hash, region map, timestamp — for compliance / records.</small>
        </span>
      </label>
    </Modal>
  );
};

export interface AccountModalProps {
  account: AccountState | null;
  onClose: () => void;
  onRequestSignIn: (email: string) => Promise<void> | void;
  onSignOut: () => void;
  onUpgrade: () => void;
}

export const AccountModal = ({ account, onClose, onRequestSignIn, onSignOut, onUpgrade }: AccountModalProps) => {
  const [email, setEmail] = useState(account?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onRequestSignIn(email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Epsteiner Account" onClose={onClose}>
      {account ? (
        <div className="account-box">
          <div className="account-email">{account.email}</div>
          <div className="account-plan">{account.plan === "annual" ? "Annual Pass" : "Free account"}</div>
          <div className="account-actions">
            {account.plan === "free" && (
              <button className="btn btn-gold" onClick={onUpgrade}>Unlock {BILLING.annualPrice}</button>
            )}
            <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      ) : sent ? (
        <div className="account-box">
          <div className="account-email">Check your inbox</div>
          <div className="account-note">
            We just sent a sign-in link to <strong>{email}</strong>. Click it to finish signing in.
          </div>
          <button className="btn btn-ghost" onClick={() => setSent(false)}>Use a different email</button>
        </div>
      ) : (
        <form className="account-form" onSubmit={submit}>
          <label className="field-label">Email</label>
          <input
            className="field-input"
            type="email"
            inputMode="email"
            value={email}
            placeholder="you@example.com"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <button className="btn btn-gold full-width" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
          <div className="account-note">
            We email you a one-tap link. No password. Free accounts get {BILLING.freeMonthlyExports} exports per month.
          </div>
        </form>
      )}
    </Modal>
  );
};

export interface PaywallModalProps {
  account: AccountState | null;
  checkoutConfigured: boolean;
  onClose: () => void;
  onOpenAccount: () => void;
  onCheckout: () => void;
}

export const PaywallModal = ({
  account,
  checkoutConfigured,
  onClose,
  onOpenAccount,
  onCheckout,
}: PaywallModalProps) => {
  const [busy, setBusy] = useState(false);
  const handleCheckout = async () => {
    setBusy(true);
    try { await onCheckout(); } finally { setBusy(false); }
  };
  return (
    <Modal title="Unlock Epsteiner" onClose={onClose}>
      <div className="paywall">
        <div className="paywall-price">{BILLING.annualPrice}</div>
        <div className="paywall-copy">
          Annual pass unlocks unlimited PDF exports. Free accounts include {BILLING.freeMonthlyExports} exports per month.
        </div>

        {!account ? (
          <button className="btn btn-gold full-width" onClick={onOpenAccount}>Sign in first</button>
        ) : (
          <button
            className="btn btn-gold full-width"
            onClick={handleCheckout}
            disabled={busy || !checkoutConfigured}
          >
            {busy ? "Opening checkout…" : checkoutConfigured ? "Continue to checkout" : "Checkout unavailable"}
          </button>
        )}
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
  onAccountClick: () => void;
  onUpgradeClick: () => void;
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Do my files ever leave my browser?",
    a: "No. PDFs are parsed, edited and re-rendered entirely client-side using pdf.js and jsPDF. Nothing is uploaded — open DevTools → Network and you'll see no PDF traffic.",
  },
  {
    q: "Are redactions actually irreversible?",
    a: "Yes. Each page is flattened (page image + black rectangles) into a single raster before being embedded in the export. The text layer is dropped. Cmd+A on the export yields nothing.",
  },
  {
    q: "What does Auto detect?",
    a: "Local pattern detection: emails, phone numbers, dates, currency, IBANs, credit cards (Luhn-validated), US SSNs, Italian Codice Fiscale, IPs, MACs, URLs, plus capitalised name pairs after honorifics. No model. No API call.",
  },
  {
    q: "What's in the audit receipt?",
    a: "Optional JSON sidecar with a SHA-256 of the exported PDF, page count, region map, your email, timestamp, and stamp/watermark/password flags. For records & compliance.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. The annual pass renews yearly via Stripe — open your billing portal anytime. We don't store card details.",
  },
];

export const LandingPage = ({ onTrySample, onPickFile, onAccountClick, onUpgradeClick }: LandingProps) => (
  <div className="landing">
    <div className="hero">
      <div className="hero-stamp" style={{ top: "10%", left: "5%" }}>CLASSIFIED</div>
      <div className="hero-stamp" style={{ bottom: "15%", right: "3%", animationDelay: "-3s" }}>TOP SECRET</div>

      <div className="hero-pretitle">— Local PDF redaction —</div>
      <h1 className="hero-title">EPSTEINER</h1>
      <div className="hero-divider" />
      <p className="hero-sub">
        Black-bar sensitive text in any PDF in seconds. Auto-detect emails, phones, IBANs, credit cards.
        Files never leave your browser — there is no server to send them to.
      </p>
      <div className="hero-cta">
        <button className="cta-primary" onClick={onTrySample}>★ Try with a sample · 30s</button>
        <button className="cta-secondary" onClick={onPickFile}>↑ Open your PDF</button>
      </div>
      <div className="hero-meta">
        <span>● 100% in-browser</span>
        <span>● Burned-in redactions</span>
        <span>● {BILLING.freeMonthlyExports} free exports / month</span>
      </div>
    </div>

    <div className="trust-band">
      <div className="trust-cell">
        <div className="trust-num">0</div>
        <div className="trust-label">Bytes uploaded</div>
      </div>
      <div className="trust-cell">
        <div className="trust-num">SHA-256</div>
        <div className="trust-label">Audit receipt on every export</div>
      </div>
      <div className="trust-cell">
        <div className="trust-num">AES-128</div>
        <div className="trust-label">Optional PDF password lock</div>
      </div>
      <div className="trust-cell">
        <div className="trust-num">12+</div>
        <div className="trust-label">PII patterns auto-detected</div>
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

    <div className="pricing-band">
      <div className="pricing-head">
        <span>Pricing</span>
        <strong>{BILLING.annualPrice}</strong>
      </div>
      <div className="pricing-grid">
        <div className="pricing-plan">
          <div className="plan-kicker">Free</div>
          <div className="plan-price">$0</div>
          <ul className="plan-list">
            <li>{BILLING.freeMonthlyExports} PDF exports per month</li>
            <li>All redaction tools</li>
            <li>Auto-detect of 12+ PII patterns</li>
            <li>Audit receipt + password-locked PDFs</li>
          </ul>
          <button className="btn btn-ghost full-width" onClick={onAccountClick}>Sign in with email</button>
        </div>
        <div className="pricing-plan featured">
          <div className="plan-kicker">Annual pass</div>
          <div className="plan-price">{BILLING.annualPrice}</div>
          <ul className="plan-list">
            <li><strong>Unlimited</strong> exports</li>
            <li>Priority email support</li>
            <li>Everything in Free</li>
            <li>Cancel anytime via Stripe portal</li>
          </ul>
          <button className="btn btn-gold full-width" onClick={onUpgradeClick}>Unlock unlimited</button>
        </div>
      </div>
    </div>

    <div className="faq">
      <div className="faq-h">— FAQ —</div>
      <div className="faq-t">Things you might be wondering</div>
      <div className="faq-list">
        {FAQ.map(({ q, a }) => (
          <details className="faq-row" key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>

    <div className="footer">
      <div className="footer-text">EPSTEINER · Files stay in your browser · <a href="mailto:hi@epsteiner.local" style={{ color: "inherit" }}>contact</a></div>
    </div>
  </div>
);
