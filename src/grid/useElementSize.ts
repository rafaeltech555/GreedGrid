import { useEffect, useRef, useState } from "react";

/**
 * Track an element's content-box size via ResizeObserver. Returns a ref to
 * attach and the current `{ width, height }` in px. Splitter positioning needs
 * real pixel dimensions to convert drag distance into `fr` deltas.
 *
 * Guarded for environments without ResizeObserver (jsdom in unit tests), where
 * the size simply stays {0,0} and the grid still renders structurally.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}
