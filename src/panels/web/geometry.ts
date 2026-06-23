import type { WebRect } from "../../lib/ipc";

/**
 * Read an element's viewport rect and round to integer CSS px. The main webview
 * fills the window client area, so getBoundingClientRect coords map directly to
 * the child webview's position relative to the window.
 */
export function measureRect(el: HTMLElement): WebRect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}
