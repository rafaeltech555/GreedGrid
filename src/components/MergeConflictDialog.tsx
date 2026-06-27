import type { PanelConfig } from "../lib/types";
import { getPanelType } from "../panels/registry";

interface MergeConflictDialogProps {
  candidates: PanelConfig[];
  onKeep: (instanceId: string) => void;
  onCancel: () => void;
}

/** A short, human-readable detail pulled from a panel's config (cwd/url/path),
 *  used to tell otherwise-identical panels apart in the picker. */
function panelDetail(panel: PanelConfig): string | undefined {
  const c = panel.config;
  const pick = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  const detail =
    panel.kind === "web"
      ? pick("url")
      : panel.kind === "terminal"
        ? pick("cwd")
        : panel.kind === "file"
          ? pick("path")
          : "";
  return detail.trim().length > 0 ? detail : undefined;
}

/** Label like "⌨ Terminal — ~/proj"; falls back to glyph + label (then kind). */
function panelLabel(panel: PanelConfig): string {
  const def = getPanelType(panel.kind);
  const head = `${def?.glyph ?? ""} ${def?.label ?? panel.kind}`.trim();
  const detail = panelDetail(panel);
  return detail ? `${head} — ${detail}` : head;
}

/**
 * Merge-conflict picker: when 2+ selected cells host live panels, the merge
 * can't guess which to keep, so it asks. Picking a panel keeps it (the rest are
 * destroyed); cancel abandons the merge. Mirrors ConfirmDialog's overlay/a11y.
 */
export function MergeConflictDialog({
  candidates,
  onKeep,
  onCancel,
}: MergeConflictDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-80 rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={true}
      >
        <p className="mb-3 text-sm text-white/80">
          合併區域有多個面板，選擇要保留哪一個（其餘會被關閉）：
        </p>
        <div className="mb-4 flex flex-col gap-1">
          {candidates.map((panel) => (
            <button
              key={panel.instanceId}
              onClick={() => onKeep(panel.instanceId)}
              className="rounded border border-white/10 px-3 py-2 text-left text-xs text-white/80 hover:border-emerald-400/50 hover:text-white"
            >
              {panelLabel(panel)}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
