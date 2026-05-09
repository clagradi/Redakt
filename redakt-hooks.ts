import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from "react";

import { SCROLL_OFFSET, TOAST_MS } from "./redakt-constants";
import type { ToastMessage } from "./redakt-types";

export function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = (): AudioContext => (
    ctxRef.current ??= new ((window as any).AudioContext || (window as any).webkitAudioContext)()
  );

  const stamp = useCallback(() => {
    try {
      const ctx = getCtx();
      const duration = 0.3;
      const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] =
          Math.sin(2 * Math.PI * 50 * t) * Math.exp(-t * 25) * 0.7 +
          (Math.random() * 2 - 1) * Math.exp(-t * 130) * 0.45;
      }
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      gain.gain.setValueAtTime(0.9, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    } catch {
      // Audio errors are intentionally non-blocking.
    }
  }, []);

  const click = useCallback(() => {
    try {
      const ctx = getCtx();
      const duration = 0.04;
      const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 200) * 0.15;
      }
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      src.buffer = buf;
      filter.type = "highpass";
      filter.frequency.value = 4000;
      src.connect(filter);
      filter.connect(ctx.destination);
      src.start();
    } catch {
      // Audio errors are intentionally non-blocking.
    }
  }, []);

  return { stamp, click };
}

export function useHistory<T>(initial: T) {
  type Snapshot = { items: T[]; index: number };
  const [snap, setSnap] = useState<Snapshot>({ items: [initial], index: 0 });

  const set = useCallback((next: T) => {
    setSnap(({ items, index }: Snapshot) => ({
      items: [...items.slice(0, index + 1), next],
      index: index + 1,
    }));
  }, []);

  const undo = useCallback(() => {
    setSnap((s: Snapshot) => (s.index > 0 ? { ...s, index: s.index - 1 } : s));
  }, []);

  const redo = useCallback(() => {
    setSnap((s: Snapshot) =>
      s.index < s.items.length - 1 ? { ...s, index: s.index + 1 } : s,
    );
  }, []);

  const reset = useCallback((next: T) => {
    setSnap({ items: [next], index: 0 });
  }, []);

  return {
    state: snap.items[snap.index],
    set,
    undo,
    redo,
    reset,
    canUndo: snap.index > 0,
    canRedo: snap.index < snap.items.length - 1,
  };
}

export type ShortcutHandler = (e: ReactKeyboardEvent) => void;

export function useKeyboardShortcuts(handler: ShortcutHandler) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ref.current(e as unknown as ReactKeyboardEvent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function useScrollSpy(
  scrollEl: RefObject<HTMLElement | null>,
  itemRefs: MutableRefObject<(HTMLElement | null)[]>,
  count: number,
): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = scrollEl.current;
    if (!el) return;
    const handler = () => {
      let best = 0;
      let bestDist = Infinity;
      itemRefs.current.forEach((ref: HTMLDivElement | null, i: number) => {
        if (!ref) return;
        const dist = Math.abs(ref.getBoundingClientRect().top - SCROLL_OFFSET);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActive(best);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [scrollEl, itemRefs, count]);
  return active;
}

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  return { toast, show };
}
