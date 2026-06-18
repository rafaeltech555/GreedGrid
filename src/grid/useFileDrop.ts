import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { physicalToCss, hitTestCell } from "./dropHitTest";
import type { CellRect } from "./dropHitTest";
import { isTauri, fsList } from "../lib/ipc";
import { parentPath } from "../panels/file/path";

/**
 * Collect CSS-pixel bounding rects for every grid cell currently in the DOM.
 * Cells are identified by `data-grid-cell-id` attributes.
 */
export function collectCellRects(): CellRect[] {
  const rects: CellRect[] = [];
  const elements = document.querySelectorAll<HTMLElement>('[data-grid-cell-id]');
  for (const el of elements) {
    const id = el.getAttribute("data-grid-cell-id") ?? "";
    if (!id) continue;
    const r = el.getBoundingClientRect();
    rects.push({
      id,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    });
  }
  return rects;
}

/**
 * 訂閱 Tauri 視窗的 OS file-drop 事件，把落點 hit-test 到某個 grid cell。
 *
 * - No-ops silently when running outside Tauri (browser / Vitest).
 * - Handles the async-subscription race via an `active` flag so cleanup is
 *   safe even if the component unmounts before `onDragDropEvent` resolves.
 *
 * @param onDrop 每次「被接受的 drop」以 (cellId, paths, pos) 呼叫，
 *   其中 pos 是 drop 落點的 CSS viewport 座標。
 *   **caller 應用 `useCallback` 包成穩定參考**，否則每次 render 都會
 *   unlisten + 重新訂閱。
 */
export function useFileDrop(
  onDrop: (cellId: string, paths: string[], pos: { x: number; y: number }) => void,
): void {
  useEffect(() => {
    if (!isTauri()) return;

    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const dpr = window.devicePixelRatio || 1;
        const { x, y } = physicalToCss(event.payload.position, dpr);
        const rects = collectCellRects();
        const cellId = hitTestCell(x, y, rects);
        if (!cellId) return; // dropped outside any cell
        onDrop(cellId, event.payload.paths, { x, y });
      })
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          // Component already unmounted — immediately unsubscribe.
          fn();
        }
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [onDrop]);
}

/**
 * 把拖入的路徑解析成「要開啟的資料夾」:資料夾回自身;若不是資料夾(lister reject)
 * 回其父目錄。lister 預設用 fsList,可注入以利測試。
 */
export async function resolveDropFolder(
  raw: string,
  lister: (path: string) => Promise<unknown> = fsList,
): Promise<string> {
  try {
    await lister(raw);
    return raw;             // 成功 list → 是資料夾
  } catch {
    return parentPath(raw); // reject → 當作檔案,用父目錄
  }
}
