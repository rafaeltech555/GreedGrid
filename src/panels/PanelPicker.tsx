import type { PanelKind } from "../lib/types";
import type { SessionInfo } from "./terminal/types";
import { allPanelTypes } from "./registry";

interface PanelPickerProps {
  onPick: (kind: PanelKind) => void;
  /** Detached pty sessions available for reattach (empty/undefined → hidden). */
  orphans?: SessionInfo[];
  /** Rebind a fresh terminal panel to an existing session. */
  onReattach?: (info: SessionInfo) => void;
  /** Explicitly kill a detached session. */
  onKill?: (instanceId: string) => void;
}

/** Last path segment, e.g. "/bin/bash" → "bash". */
function basename(p: string): string {
  const segs = p.split(/[\\/]/).filter(Boolean);
  return segs[segs.length - 1] || p;
}

/** Short, truncated label for a detached session: shell name (+ cwd basename). */
function orphanLabel(info: SessionInfo): string {
  const shell = basename(info.shell) || "shell";
  return info.cwd ? `${shell} · ${basename(info.cwd)}` : shell;
}

/** A compact list of every registered panel type for an empty cell, plus an
 *  optional "Detached terminals" section to reattach orphaned pty sessions. */
export function PanelPicker({ onPick, orphans, onReattach, onKill }: PanelPickerProps) {
  return (
    <div className="flex flex-col items-stretch gap-2 p-2">
      <div className="flex flex-wrap items-center justify-center gap-1">
        {allPanelTypes().map((def) => (
          <button
            key={def.kind}
            onClick={() => onPick(def.kind)}
            className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
          >
            <span aria-hidden>{def.glyph}</span>
            {def.label}
          </button>
        ))}
      </div>

      {orphans && orphans.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-center text-[10px] uppercase tracking-wide text-white/40">
            Detached terminals
          </div>
          {orphans.map((info) => (
            <div
              key={info.instanceId}
              className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70"
            >
              <span
                aria-hidden
                title={info.alive ? "alive" : "exited"}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  info.alive ? "bg-emerald-400/80" : "bg-white/20"
                }`}
              />
              <span className="min-w-0 flex-1 truncate" title={orphanLabel(info)}>
                {orphanLabel(info)}
              </span>
              <button
                onClick={() => onReattach?.(info)}
                className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
              >
                Reattach
              </button>
              <button
                aria-label="Kill session"
                title="Kill session"
                onClick={() => onKill?.(info.instanceId)}
                className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/70 hover:border-red-400/50 hover:text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
