import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";

import {
  AccountModal,
  ExportModal,
  FileDropOverlay,
  Header,
  HelpModal,
  LandingPage,
  PageView,
  PaywallModal,
  SearchBar,
  Sidebar,
  StatsPanel,
  Styles,
  Toast,
  Toolbar,
} from "./redakt-components";
import {
  canExportPdf,
  fetchCurrentAccount,
  getBillingView,
  isBackendConfigured,
  onAccountChange,
  recordPdfExport,
  requestSignIn,
  signOut,
  startCheckout,
} from "./redakt-billing";
import { ZOOM, MIN_DRAW_SIZE } from "./redakt-constants";
import {
  clamp,
  clientToCanvas,
  findWordIndexAt,
  matchTermsAcrossPages,
  matchTextAcrossPages,
  smartSelectionToBoxes,
  stripFileExt,
} from "./redakt-utils";
import { loadPdfDocument, generateSampleDocument, detectSensitiveRedactionBoxes, exportRedactedPdf } from "./redakt-services";
import { useAudio, useHistory, useIsTouchOrNarrow, useKeyboardShortcuts, useScrollSpy, useToast } from "./redakt-hooks";
import type {
  AccountState,
  EditorMode,
  ExportOptions,
  PageData,
  Point2D,
  RedactionBox,
  SmartSelectionKey,
} from "./redakt-types";
import { round2 } from "./redakt-utils";

export default function EpsteinerApp() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [documentName, setDocumentName] = useState("");

  const [mode, setMode] = useState<EditorMode>("view");
  const [zoom, setZoom] = useState(1);
  const [drawing, setDrawing] = useState<RedactionBox | null>(null);
  const [smartSelection, setSmartSel] = useState<Set<SmartSelectionKey>>(new Set());
  const [pendingEraseIndexes, setPendingEraseIndexes] = useState<Set<number>>(new Set());
  const [eraseHoverIdx, setEraseHoverIdx] = useState<number | null>(null);
  useEffect(() => {
    if (mode !== "erase" && eraseHoverIdx !== null) setEraseHoverIdx(null);
  }, [mode, eraseHoverIdx]);

  const history = useHistory<RedactionBox[]>([]);
  const boxes = history.state;

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadProgress, setLoadProgress] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [exportOpts, setExportOpts] = useState<ExportOptions>({
    filename: "redacted_document",
    stamp: "redacted",
    watermark: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawStartRef = useRef<Point2D | null>(null);
  const activeDrawPageRef = useRef<number | null>(null);
  const smartActiveRef = useRef<boolean>(false);
  const smartBufferRef = useRef<Set<SmartSelectionKey>>(new Set());
  const smartActivePageRef = useRef<number | null>(null);
  const eraseActiveRef = useRef<boolean>(false);
  const eraseActivePageRef = useRef<number | null>(null);
  const eraseBufferRef = useRef<Set<number>>(new Set());
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const audio = useAudio();
  const { toast, show: showToast } = useToast();
  const isMobile = useIsTouchOrNarrow();
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(false);

  const hasDocument = pages.length > 0;
  const zoomPercent = Math.round(zoom * 100);
  const billingView = useMemo(() => getBillingView(account), [account]);
  const redactionsPerPage = useMemo(() => {
    const m = new Map<number, number>();
    boxes.forEach((b: RedactionBox) => m.set(b.pageIdx, (m.get(b.pageIdx) ?? 0) + 1));
    return m;
  }, [boxes]);

  const activePage = useScrollSpy(mainScrollRef, pageRefs, pages.length);

  const zoomIn = () => setZoom((z: number) => clamp(round2(z + ZOOM.STEP), ZOOM.MIN, ZOOM.MAX));
  const zoomOut = () => setZoom((z: number) => clamp(round2(z - ZOOM.STEP), ZOOM.MIN, ZOOM.MAX));

  useKeyboardShortcuts(useCallback((e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      history.undo();
      audio.click();
    } else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      history.redo();
      audio.click();
    } else if (!mod) {
      const k = e.key.toLowerCase();
      if (k === "s") setMode((m: EditorMode) => (m === "smart" ? "view" : "smart"));
      else if (k === "r") setMode((m: EditorMode) => (m === "rect" ? "view" : "rect"));
      else if (k === "e") setMode((m: EditorMode) => (m === "erase" ? "view" : "erase"));
      else if (k === "escape") {
        // Cancel any in-flight drag/selection first.
        if (drawing) {
          setDrawing(null);
          drawStartRef.current = null;
          activeDrawPageRef.current = null;
        }
        if (smartActiveRef.current) {
          smartActiveRef.current = false;
          smartBufferRef.current = new Set();
          smartActivePageRef.current = null;
          setSmartSel(new Set());
        }
        if (eraseActiveRef.current) {
          eraseActiveRef.current = false;
          eraseBufferRef.current = new Set();
          eraseActivePageRef.current = null;
          setPendingEraseIndexes(new Set());
        }
        // Close any open overlay.
        if (helpOpen) setHelpOpen(false);
        else if (exportOpen) setExportOpen(false);
        else if (accountOpen) setAccountOpen(false);
        else if (paywallOpen) setPaywallOpen(false);
        else if (searchOpen) setSearchOpen(false);
        else setMode("view");
      }
      else if (k === "+" || k === "=") zoomIn();
      else if (k === "-") zoomOut();
      else if (e.key === "?") setHelpOpen((o: boolean) => !o);
      else if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
  }, [audio, history, drawing, helpOpen, exportOpen, accountOpen, paywallOpen, searchOpen]));

  const handleLoadFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showToast("Unsupported format — PDF only", "error");
      return;
    }
    if (boxes.length > 0) {
      const ok = window.confirm(
        `You have ${boxes.length} redaction${boxes.length === 1 ? "" : "s"} on the current document. Loading a new file will discard them. Continue?`,
      );
      if (!ok) return;
    }

    setIsLoading(true);
    setLoadProgress(0);
    setLoadingMsg("Initializing…");

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
      setExportOpts((o: ExportOptions) => ({ ...o, filename: `${baseName}_redacted` }));

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
      setIsLoading(false);
      setLoadingMsg("");
      setLoadProgress(0);
    }
  }, [boxes.length, history, showToast]);

  const handleTrySample = useCallback(async () => {
    setIsLoading(true);
    setLoadingMsg("Generating sample document…");
    try {
      const file = await generateSampleDocument();
      await handleLoadFile(file);
    } catch {
      showToast("Failed to generate sample", "error");
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [handleLoadFile, showToast]);

  const handleDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    setFileOver(false);
    handleLoadFile(e.dataTransfer.files[0]);
  }, [handleLoadFile]);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentAccount().then((acc) => {
      if (!cancelled) setAccount(acc);
    });
    const unsub = onAccountChange((acc) => {
      if (!cancelled) setAccount(acc);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // After Stripe Checkout returns to ?checkout=success, refresh account.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      showToast("Payment received — unlocking…", "success");
      const refresh = async () => {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const acc = await fetchCurrentAccount();
          if (acc?.plan === "annual") {
            setAccount(acc);
            showToast("Annual pass active", "success");
            break;
          }
        }
      };
      refresh();
      params.delete("checkout");
      const next = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", next);
    } else if (params.get("checkout") === "cancel") {
      showToast("Checkout cancelled", "info");
      params.delete("checkout");
      const next = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", next);
    }
  }, [showToast]);

  const handleRequestSignIn = useCallback(async (email: string) => {
    const result = await requestSignIn(email);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    if (result.mode === "magic-link") {
      showToast("Check your email for the sign-in link", "success");
    } else {
      showToast("Account ready (local mode)", "info");
      const acc = await fetchCurrentAccount();
      setAccount(acc);
      setAccountOpen(false);
    }
  }, [showToast]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setAccount(null);
    setAccountOpen(false);
    showToast("Signed out", "info");
  }, [showToast]);

  const handleOpenPaywall = useCallback(() => {
    setAccountOpen(false);
    setPaywallOpen(true);
  }, []);

  const handleOpenCheckout = useCallback(async () => {
    if (!isBackendConfigured) {
      showToast("Backend not configured yet", "error");
      return;
    }
    const res = await startCheckout();
    if (!res.ok) showToast(res.error || "Checkout failed", "error");
  }, [showToast]);

  const removeRedactionByIndex = useCallback((globalIdx: number) => {
    history.set(boxes.filter((_: RedactionBox, i: number) => i !== globalIdx));
    audio.click();
  }, [audio, boxes, history]);

  const handlePointerDown = useCallback((e: ReactPointerEvent, pageIdx: number) => {
    if (mode === "view") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const containerEl = pageRefs.current[pageIdx];
    if (!containerEl) return;
    const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[pageIdx]);

    const hitBoxIdx = (() => {
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (b.pageIdx !== pageIdx) continue;
        if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) return i;
      }
      return null;
    })();

    if (mode === "erase") {
      eraseActiveRef.current = true;
      eraseActivePageRef.current = pageIdx;
      eraseBufferRef.current = new Set();
      if (hitBoxIdx !== null) eraseBufferRef.current.add(hitBoxIdx);
      setPendingEraseIndexes(new Set(eraseBufferRef.current));
      return;
    }

    if (mode === "rect") {
      activeDrawPageRef.current = pageIdx;
      drawStartRef.current = point;
      setDrawing({ pageIdx, x: point.x, y: point.y, w: 0, h: 0 });
    } else if (mode === "smart") {
      if (hitBoxIdx !== null) {
        removeRedactionByIndex(hitBoxIdx);
        return;
      }
      smartActiveRef.current = true;
      smartActivePageRef.current = pageIdx;
      smartBufferRef.current = new Set();
      const wi = findWordIndexAt(point, pages[pageIdx].textItems);
      if (wi !== -1) smartBufferRef.current.add(`${pageIdx}:${wi}` as SmartSelectionKey);
      setSmartSel(new Set(smartBufferRef.current));
    }
  }, [mode, pages, removeRedactionByIndex]);

  const handlePointerMove = useCallback((e: ReactPointerEvent) => {
    if (mode === "rect" && drawStartRef.current && activeDrawPageRef.current !== null) {
      e.preventDefault();
      const pi = activeDrawPageRef.current;
      const containerEl = pageRefs.current[pi];
      if (!containerEl) return;
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
      const containerEl = pageRefs.current[pi];
      if (!containerEl) return;
      const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[pi]);
      const wi = findWordIndexAt(point, pages[pi].textItems);
      if (wi !== -1) {
        const key = `${pi}:${wi}` as SmartSelectionKey;
        if (!smartBufferRef.current.has(key)) {
          smartBufferRef.current.add(key);
          setSmartSel(new Set(smartBufferRef.current));
        }
      }
    } else if (mode === "erase") {
      const dragging = eraseActiveRef.current && eraseActivePageRef.current !== null;
      const pi = dragging ? eraseActivePageRef.current! : null;
      const hoverPage = pi !== null
        ? pi
        : (() => {
            for (let i = 0; i < pageRefs.current.length; i++) {
              const el = pageRefs.current[i];
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return i;
            }
            return null;
          })();
      if (hoverPage === null) {
        if (eraseHoverIdx !== null) setEraseHoverIdx(null);
        return;
      }
      const containerEl = pageRefs.current[hoverPage];
      if (!containerEl) return;
      const point = clientToCanvas(e.clientX, e.clientY, containerEl, pages[hoverPage]);
      let hit: number | null = null;
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (b.pageIdx !== hoverPage) continue;
        if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) {
          hit = i;
          break;
        }
      }
      if (dragging) {
        e.preventDefault();
        if (hit !== null && !eraseBufferRef.current.has(hit)) {
          eraseBufferRef.current.add(hit);
          setPendingEraseIndexes(new Set(eraseBufferRef.current));
        }
      }
      if (hit !== eraseHoverIdx) setEraseHoverIdx(hit);
    }
  }, [mode, pages, boxes, eraseHoverIdx]);

  const handlePointerUp = useCallback(() => {
    if (mode === "rect") {
      if (drawing && drawing.w > MIN_DRAW_SIZE && drawing.h > MIN_DRAW_SIZE) {
        history.set([...boxes, { ...drawing }]);
        audio.stamp();
      }
      setDrawing(null);
      drawStartRef.current = null;
      activeDrawPageRef.current = null;
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
    } else if (mode === "erase" && eraseActiveRef.current) {
      eraseActiveRef.current = false;
      if (eraseBufferRef.current.size > 0) {
        history.set(boxes.filter((_: RedactionBox, i: number) => !eraseBufferRef.current.has(i)));
        audio.click();
      }
      eraseBufferRef.current = new Set();
      eraseActivePageRef.current = null;
      setPendingEraseIndexes(new Set());
    }
  }, [mode, drawing, boxes, pages, history, audio]);

  const handleEraseBox = useCallback((globalIdx: number) => {
    if (mode === "view") return;
    removeRedactionByIndex(globalIdx);
  }, [mode, removeRedactionByIndex]);

  const handleSearchSubmit = useCallback(() => {
    const matches = matchTextAcrossPages(pages, searchTerm, { wholeWord: searchWholeWord });
    if (matches.length === 0) {
      showToast("No matches found", "error");
      return;
    }
    history.set([...boxes, ...matches]);
    audio.stamp();
    showToast(`${matches.length} occurrence${matches.length === 1 ? "" : "s"} redacted`, "success");
  }, [audio, boxes, history, pages, searchTerm, searchWholeWord, showToast]);

  const handleAutoRedact = useCallback(() => {
    if (!hasDocument) {
      showToast("Load a PDF first", "error");
      return;
    }

    const hits = detectSensitiveRedactionBoxes(pages);
    if (hits.length === 0) {
      showToast("No sensitive patterns found", "info");
      return;
    }
    const overlaps = (a: typeof hits[number], b: typeof boxes[number]) => {
      if (a.pageIdx !== b.pageIdx) return false;
      const ax2 = a.x + a.w, ay2 = a.y + a.h;
      const bx2 = b.x + b.w, by2 = b.y + b.h;
      const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
      const inter = ix * iy;
      const minArea = Math.min(a.w * a.h, b.w * b.h) || 1;
      return inter / minArea > 0.5;
    };
    const fresh = hits.filter((h) => !boxes.some((b) => overlaps(h, b)));
    if (fresh.length === 0) {
      showToast("No new items — already auto-redacted", "info");
      return;
    }
    history.set([...boxes, ...fresh]);
    audio.stamp();
    showToast(`${fresh.length} items auto-redacted`, "success");
  }, [audio, boxes, hasDocument, history, pages, showToast]);

  const handleExport = useCallback(async () => {
    if (!hasDocument) {
      showToast("Nothing to export", "error");
      return;
    }

    setExportOpen(false);

    if (!account) {
      setAccountOpen(true);
      showToast("Create a free account to export", "info");
      return;
    }

    if (!canExportPdf(account)) {
      setPaywallOpen(true);
      showToast("Free exports used. Unlock annual pass.", "info");
      return;
    }

    setIsLoading(true);
    setLoadingMsg("Generating redacted PDF…");
    try {
      await exportRedactedPdf(pages, boxes, exportOpts);
      const updated = await recordPdfExport(account);
      setAccount(updated);
      audio.stamp();
      showToast("PDF exported", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Export error: ${msg}`, "error");
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [account, audio, boxes, exportOpts, hasDocument, pages, showToast]);

  const jumpToPage = useCallback((i: number) => {
    pageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div
      className="redakt-app"
      onDragOver={(e: ReactDragEvent) => {
        e.preventDefault();
        setFileOver(true);
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={handleDrop}
    >
      <Styles />
      <FileDropOverlay visible={fileOver} />
      <Toast toast={toast} />

      {isMobile && !mobileBannerDismissed && (
        <div className="mobile-banner">
          <span>This editor is built for desktop. Drawing redactions on a phone is rough — open Epsteiner on a laptop for the real experience.</span>
          <button className="mobile-banner-close" onClick={() => setMobileBannerDismissed(true)} aria-label="Dismiss">×</button>
        </div>
      )}

      <Header
        documentName={documentName}
        redactionCount={boxes.length}
        accountLabel={billingView.accountLabel}
        allowanceLabel={billingView.allowanceLabel}
        onHelpClick={() => setHelpOpen(true)}
        onAccountClick={() => setAccountOpen(true)}
      />

      {isLoading && (
        loadProgress > 0
          ? <div className="lbar-track"><div className="lbar-fill" style={{ width: `${loadProgress}%` }} /></div>
          : <div className="lbar-indeterminate" />
      )}
      {isLoading && <div className="lmsg">⬛ {loadingMsg}</div>}

      {hasDocument && (
        <Toolbar
          mode={mode}
          zoomPercent={zoomPercent}
          isLoading={isLoading}
          searchOpen={searchOpen}
          hasRedactions={boxes.length > 0}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onPickFile={() => fileInputRef.current?.click()}
          onSetMode={setMode}
          onUndo={history.undo}
          onRedo={history.redo}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onToggleSearch={() => setSearchOpen((s: boolean) => !s)}
          onAutoRedact={handleAutoRedact}
          onExport={() => setExportOpen(true)}
          onClearAll={() => history.set([])}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={(e: ChangeEvent<HTMLInputElement>) => handleLoadFile(e.target.files?.[0])}
      />

      {searchOpen && hasDocument && (
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          onSubmit={handleSearchSubmit}
          onClose={() => setSearchOpen(false)}
          wholeWord={searchWholeWord}
          onToggleWholeWord={() => setSearchWholeWord((w) => !w)}
        />
      )}

      {!hasDocument ? (
        <div className="main-scroll">
          <LandingPage
            onTrySample={handleTrySample}
            onPickFile={() => fileInputRef.current?.click()}
            onAccountClick={() => setAccountOpen(true)}
            onUpgradeClick={handleOpenPaywall}
          />
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
                {pages.map((page: PageData, pi: number) => (
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
                    pendingEraseIndexes={pendingEraseIndexes}
                    eraseHoverIdx={eraseHoverIdx}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onEraseBox={handleEraseBox}
                    containerRef={(el) => { pageRefs.current[pi] = el; }}
                    redactionCount={redactionsPerPage.get(pi) ?? 0}
                  />
                ))}
              </div>
            </div>

            <StatsPanel
              pages={pages}
              boxes={boxes}
              redactionsPerPage={redactionsPerPage}
              isLoading={isLoading}
              onAutoRedact={handleAutoRedact}
              onExport={() => setExportOpen(true)}
            />
          </div>

          {mode === "smart" && <div className="hint-bar">Click a word · Hold and drag for multi-select</div>}
          {mode === "rect" && <div className="hint-bar">Hold and drag to draw a rectangle</div>}
          {mode === "erase" && <div className="hint-bar">Tap a redaction to remove it · Hold and drag for batch remove</div>}
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

      {accountOpen && (
        <AccountModal
          account={account}
          onClose={() => setAccountOpen(false)}
          onRequestSignIn={handleRequestSignIn}
          onSignOut={handleSignOut}
          onUpgrade={handleOpenPaywall}
        />
      )}

      {paywallOpen && (
        <PaywallModal
          account={account}
          checkoutConfigured={isBackendConfigured}
          onClose={() => setPaywallOpen(false)}
          onOpenAccount={() => {
            setPaywallOpen(false);
            setAccountOpen(true);
          }}
          onCheckout={handleOpenCheckout}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
