import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";

import {
  ExportModal,
  FileDropOverlay,
  Header,
  HelpModal,
  LandingPage,
  PageView,
  SearchBar,
  Sidebar,
  StatsPanel,
  Styles,
  Toast,
  Toolbar,
} from "./redakt-components";
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
import { loadPdfDocument, generateSampleDocument, requestAiRedactionTerms, exportRedactedPdf } from "./redakt-services";
import { useAudio, useHistory, useKeyboardShortcuts, useScrollSpy, useToast } from "./redakt-hooks";
import type { EditorMode, ExportOptions, PageData, Point2D, RedactionBox, SmartSelectionKey } from "./redakt-types";
import { round2 } from "./redakt-utils";

export default function RedaktApp() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [documentName, setDocumentName] = useState("");

  const [mode, setMode] = useState<EditorMode>("view");
  const [zoom, setZoom] = useState(1);
  const [drawing, setDrawing] = useState<RedactionBox | null>(null);
  const [smartSelection, setSmartSel] = useState<Set<SmartSelectionKey>>(new Set());

  const history = useHistory<RedactionBox[]>([]);
  const boxes = history.state;

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadProgress, setLoadProgress] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fileOver, setFileOver] = useState(false);
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
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const audio = useAudio();
  const { toast, show: showToast } = useToast();

  const hasDocument = pages.length > 0;
  const zoomPercent = Math.round(zoom * 100);
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
      else if (k === "escape") { setMode("view"); setHelpOpen(false); setExportOpen(false); }
      else if (k === "+" || k === "=") zoomIn();
      else if (k === "-") zoomOut();
      else if (e.key === "?") setHelpOpen((o: boolean) => !o);
      else if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
  }, [audio, history]));

  const handleLoadFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showToast("Unsupported format — PDF only", "error");
      return;
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
  }, [history, showToast]);

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

  const handlePointerDown = useCallback((e: ReactPointerEvent, pageIdx: number) => {
    if (mode === "view" || mode === "erase") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const containerEl = pageRefs.current[pageIdx];
    if (!containerEl) return;
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
      if (wi !== -1) smartBufferRef.current.add(`${pageIdx}:${wi}` as SmartSelectionKey);
      setSmartSel(new Set(smartBufferRef.current));
    }
  }, [mode, pages]);

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
    }
  }, [mode, pages]);

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
    }
  }, [mode, drawing, boxes, pages, history, audio]);

  const handleEraseBox = useCallback((globalIdx: number) => {
    if (mode !== "erase") return;
    history.set(boxes.filter((_: RedactionBox, i: number) => i !== globalIdx));
    audio.click();
  }, [mode, boxes, history, audio]);

  const handleSearchSubmit = useCallback(() => {
    const matches = matchTextAcrossPages(pages, searchTerm);
    if (matches.length === 0) {
      showToast("No matches found", "error");
      return;
    }
    history.set([...boxes, ...matches]);
    audio.stamp();
    showToast(`${matches.length} occurrence${matches.length === 1 ? "" : "s"} redacted`, "success");
  }, [audio, boxes, history, pages, searchTerm, showToast]);

  const handleAiRedact = useCallback(async () => {
    if (!hasDocument) {
      showToast("Load a PDF first", "error");
      return;
    }

    setIsLoading(true);
    setLoadingMsg("Running AI analysis…");
    try {
      const terms = await requestAiRedactionTerms(pages);
      const hits = matchTermsAcrossPages(pages, terms);
      history.set([...boxes, ...hits]);
      audio.stamp();
      showToast(`${hits.length} items redacted by AI`, "success");
    } catch {
      showToast("AI service error", "error");
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [audio, boxes, hasDocument, history, pages, showToast]);

  const handleExport = useCallback(async () => {
    if (!hasDocument) {
      showToast("Nothing to export", "error");
      return;
    }

    setExportOpen(false);
    setIsLoading(true);
    setLoadingMsg("Generating redacted PDF…");
    try {
      await exportRedactedPdf(pages, boxes, exportOpts);
      audio.stamp();
      showToast("PDF exported", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Export error: ${msg}`, "error");
    } finally {
      setIsLoading(false);
      setLoadingMsg("");
    }
  }, [audio, boxes, exportOpts, hasDocument, pages, showToast]);

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
          onAiRedact={handleAiRedact}
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
              onAiRedact={handleAiRedact}
              onExport={() => setExportOpen(true)}
            />
          </div>

          {mode === "smart" && <div className="hint-bar">Click a word · Hold and drag for multi-select</div>}
          {mode === "rect" && <div className="hint-bar">Hold and drag to draw a rectangle</div>}
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
