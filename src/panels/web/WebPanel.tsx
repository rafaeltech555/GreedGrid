import { useEffect, useRef } from "react";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { WebConfig } from "./types";
import {
  isTauri,
  webClose,
  webReload,
  webSetBounds,
  webSetVisible,
  webUpsert,
} from "../../lib/ipc";
import { useLayoutStore } from "../../store/layoutStore";
import { usePanelUiStore } from "../panelUiStore";
import { PANEL_MOVE_DND } from "../dnd";
import { measureRect } from "./geometry";
import { useWebSuppressed } from "./useWebSuppressed";
import { MaximizeButton } from "../../grid/MaximizeButton";

const RESIZE_DEBOUNCE_MS = 150;
const btn =
  "rounded px-1.5 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white";

/** Always-visible DOM chrome bar (native webview floats above it, so the host's
 *  hover overlay is unusable for web panels — controls live here instead). */
function WebChrome({
  instanceId,
  url,
  slotRef,
  children,
}: {
  instanceId: string;
  url: string;
  slotRef: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
}) {
  const cellId = useLayoutStore(
    (s) => s.layout.cells.find((c) => c.panel?.instanceId === instanceId)?.id,
  );
  const clearPanel = useLayoutStore((s) => s.clearPanel);
  const openEditModal = usePanelUiStore((s) => s.openEditModal);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-white/10 bg-neutral-900 px-2">
        <span className="flex-1 truncate text-xs text-white/50" title={url}>
          {url}
        </span>
        {cellId && <MaximizeButton cellId={cellId} className={btn} />}
        <button type="button" aria-label="Reload page" className={btn}
          onClick={() => void webReload(instanceId).catch(console.error)}>
          ↻
        </button>
        <button type="button" aria-label="Move panel" title="Drag to move this panel"
          draggable className={`${btn} cursor-grab active:cursor-grabbing`}
          onDragStart={(e) => {
            if (!cellId) return;
            e.dataTransfer.setData(PANEL_MOVE_DND, cellId);
            e.dataTransfer.effectAllowed = "move";
          }}>
          ⠿
        </button>
        <button type="button" aria-label="Panel settings" className={btn}
          onClick={() => cellId && openEditModal(cellId, "web")}>
          ⚙
        </button>
        <button type="button" aria-label="Remove panel" className={btn}
          onClick={() => cellId && clearPanel(cellId)}>
          ✕
        </button>
      </div>
      <div ref={slotRef} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}

/** Live view: a native child webview (Tauri) positioned over this cell, or an
 *  iframe fallback outside Tauri (dev/test). */
export function WebView({ instanceId, config }: PanelViewProps) {
  const url = (config as unknown as WebConfig).url;
  const slotRef = useRef<HTMLDivElement>(null);
  const tauri = isTauri();
  const suppressed = useWebSuppressed(instanceId);
  const suppressedRef = useRef(suppressed);

  // Close the child webview when this panel unmounts (removed / moved / kind change).
  useEffect(() => {
    if (!tauri) return;
    return () => void webClose(instanceId).catch(console.error);
  }, [tauri, instanceId]);

  // Create-or-navigate when url changes (web_upsert is idempotent: first call
  // creates, later calls navigate in place).
  useEffect(() => {
    if (!tauri || !url) return;
    const el = slotRef.current;
    if (!el) return;
    void webUpsert(instanceId, url, measureRect(el)).catch(console.error);
  }, [tauri, instanceId, url]);

  // Follow the cell: hide on any size change, snap to final rect + show once
  // quiescent. Splitter drags and window resizes both flow through here.
  useEffect(() => {
    if (!tauri || !url) return;
    const el = slotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    let hidden = false;
    const hide = () => {
      if (!hidden) {
        hidden = true;
        void webSetVisible(instanceId, false).catch(console.error);
      }
    };
    const settle = () => {
      if (suppressedRef.current) return;
      void webSetBounds(instanceId, measureRect(el)).catch(console.error);
      if (hidden) {
        hidden = false;
        void webSetVisible(instanceId, true).catch(console.error);
      }
    };
    const ro = new ResizeObserver(() => {
      hide();
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(settle, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [tauri, instanceId, url]);

  // Overlay-aware visibility: hide behind modals/menus/select-mode, restore after.
  useEffect(() => {
    suppressedRef.current = suppressed;
    if (!tauri || !url) return;
    if (suppressed) {
      void webSetVisible(instanceId, false).catch(console.error);
    } else {
      const el = slotRef.current;
      if (el) {
        void webSetBounds(instanceId, measureRect(el)).catch(console.error);
        void webSetVisible(instanceId, true).catch(console.error);
      }
    }
  }, [tauri, instanceId, url, suppressed]);

  return (
    <WebChrome instanceId={instanceId} url={url} slotRef={slotRef}>
      {!tauri && (
        <iframe
          src={url}
          title={url}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </WebChrome>
  );
}

/** Config form: a single URL text field. */
export function WebConfigForm({ config, onChange }: ConfigFormProps) {
  const url = (config as unknown as WebConfig).url ?? "";
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      URL
      <input
        type="url"
        value={url}
        placeholder="https://…"
        autoFocus
        onChange={(e) => onChange({ ...config, url: e.target.value })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
