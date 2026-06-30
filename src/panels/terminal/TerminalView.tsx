import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { TermConfig } from "./types";
import { isTauri, pickFiles, termOpen, termResize, termWrite } from "../../lib/ipc";
import { useIdleStore } from "../../store/idleStore";
import { IdleIcon } from "../../components/IdleIcon";

/** POSIX single-quote a path so spaces/specials survive the shell verbatim. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Open a native file picker and paste the chosen path(s), shell-quoted, into
 *  the pty — lets the user feed an image/file to a CLI running in the terminal
 *  (e.g. Claude Code). Shared by the Ctrl+Shift+O keybind and the toolbar button.
 *  Native drag-drop into WebKitGTK webviews is broken upstream, so this dialog
 *  path is the reliable way in on Linux. */
function insertPickedFiles(term: Terminal): void {
  void pickFiles()
    .then((paths) => {
      if (paths.length === 0) return;
      term.paste(paths.map(shellQuote).join(" ") + " ");
      term.focus();
    })
    .catch(() => {});
}

/** Live view: an xterm.js terminal bound to a backend pty via a Tauri Channel.
 *  The pty outlives this component (keyed by instanceId); unmount detaches the
 *  output channel but never calls term_close — that is the panel's onDestroy. */
export function TerminalView({ instanceId, config }: PanelViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const idle = useIdleStore((st) => st.isIdle(instanceId));

  useEffect(() => {
    if (!isTauri()) return; // no backend in a plain browser; see placeholder below
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({ fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term; // expose to the toolbar 📎 button (see JSX below)

    // Clipboard shortcuts. xterm.js has no built-in clipboard keybindings, and a
    // bare Ctrl+C must stay SIGINT, so we wire the GNOME-style Ctrl+Shift+C/V
    // explicitly through the Tauri clipboard plugin. Returning false consumes the
    // event so it is never forwarded to the pty as input.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
      if (e.code === "KeyC") {
        const sel = term.getSelection();
        if (sel) void writeText(sel).catch(() => {});
        return false;
      }
      if (e.code === "KeyV") {
        // Suppress WebKitGTK's own paste-on-Ctrl+Shift+V so we don't double-paste.
        e.preventDefault();
        void readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {});
        return false;
      }
      if (e.code === "KeyO") {
        // Insert OS file path(s) into the pty (see insertPickedFiles). Mirrors the
        // toolbar 📎 button so keyboard and mouse share one code path.
        e.preventDefault();
        insertPickedFiles(term);
        return false;
      }
      return true;
    });

    // Route pty output → xterm. Bytes arrive as a number[] (Rust Vec<u8>).
    const channel = new Channel<Uint8Array>();
    let detached = false;
    channel.onmessage = (msg) => {
      if (!detached) term.write(new Uint8Array(msg));
    };

    const cfg = config as TermConfig;
    void termOpen(instanceId, cfg, term.cols, term.rows, channel);

    const send = (s: string) =>
      termWrite(instanceId, new TextEncoder().encode(s));

    // Keystrokes → pty.
    const dataSub = term.onData((data) => {
      useIdleStore.getState().markViewed(instanceId, Date.now());
      send(data);
    });

    // IME input fix for WebKitGTK + fcitx (Linux). On this webview an IME commit
    // arrives as a keydown(keyCode 229) plus an `input` event of inputType
    // "insertFromComposition", but compositionstart/compositionupdate never fire.
    // xterm's CompositionHelper assumes that sequence, so its compositionPosition
    // offsets go stale and it re-emits duplicated/garbled slices of each commit
    // (typing "claude" produced "cllalaulaude…", and CJK phrases duplicated their
    // tails). We take over composition on the host element — a capture-phase
    // listener here runs before xterm's own textarea listeners, so stopPropagation
    // prevents the event from ever reaching xterm. The committed text is sent once
    // from the `input` event; non-IME keys are untouched and flow through xterm
    // (and onData) as usual. The terminal does not need on-screen IME preedit, so
    // suppressing xterm's composition handling costs nothing here.
    const onHostKeydown = (e: Event) => {
      if ((e as KeyboardEvent).keyCode === 229) e.stopPropagation();
    };
    const swallowComposition = (e: Event) => e.stopPropagation();
    const onHostInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === "insertFromComposition" || ie.isComposing) {
        if (ie.data) send(ie.data);
        e.stopPropagation();
        // Keep xterm's hidden textarea empty so any stray bookkeeping stays sane.
        if (term.textarea) term.textarea.value = "";
      }
    };
    host.addEventListener("keydown", onHostKeydown, true);
    host.addEventListener("compositionstart", swallowComposition, true);
    host.addEventListener("compositionupdate", swallowComposition, true);
    host.addEventListener("compositionend", swallowComposition, true);
    host.addEventListener("input", onHostInput, true);

    // Resize → fit + notify pty.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void termResize(instanceId, term.cols, term.rows);
      } catch {
        // host detached mid-observation; ignore
      }
    });
    observer.observe(host);

    return () => {
      detached = true; // stop writing late channel messages into a disposed term
      observer.disconnect();
      dataSub.dispose();
      host.removeEventListener("keydown", onHostKeydown, true);
      host.removeEventListener("compositionstart", swallowComposition, true);
      host.removeEventListener("compositionupdate", swallowComposition, true);
      host.removeEventListener("compositionend", swallowComposition, true);
      host.removeEventListener("input", onHostInput, true);
      term.dispose();
      termRef.current = null;
      // NOTE: intentionally NOT calling termClose — the pty survives unmount and
      // reconnects (replaying scrollback) when this instanceId remounts.
    };
  }, [instanceId, config]);

  const markViewedNow = () =>
    useIdleStore.getState().markViewed(instanceId, Date.now());

  if (!isTauri()) {
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30 ${idle ? "idle-glow" : ""}`}
      >
        Terminal requires the desktop app (no pty backend in browser).
        <IdleOverlay idle={idle} onView={markViewedNow} />
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-full bg-black ${idle ? "idle-glow" : ""}`}
      // Only clear-on-view matters here; onData keeps lastViewedAt fresh during
      // active typing, so skip the store write (and subscriber fan-out) unless
      // this terminal is actually idle.
      onMouseDown={idle ? markViewedNow : undefined}
      onFocusCapture={idle ? markViewedNow : undefined}
    >
      <div ref={hostRef} className="h-full w-full" />
      <button
        type="button"
        aria-label="插入檔案路徑 (Ctrl+Shift+O)"
        title="插入檔案路徑 (Ctrl+Shift+O)"
        onClick={() => {
          const t = termRef.current;
          if (t) insertPickedFiles(t);
        }}
        className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/40 hover:text-white"
      >
        📎
      </button>
      <IdleOverlay idle={idle} onView={markViewedNow} />
    </div>
  );
}

/** Amber idle affordance: a clickable "此面板閒置" badge that appears only when
 *  idle (clicking it marks the terminal viewed). Idle is otherwise conveyed by
 *  the cell's amber glow and the toolbar chip — there is intentionally no
 *  always-present status icon over the terminal output, which would obscure the
 *  first row of text. */
function IdleOverlay({ idle, onView }: { idle: boolean; onView: () => void }) {
  if (!idle) return null;
  return (
    <button
      type="button"
      aria-label="此面板閒置 — 點擊清除"
      onClick={onView}
      className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-400/25"
    >
      <IdleIcon idle size={14} />
      此面板閒置
    </button>
  );
}

/** Config form: optional shell + working directory overrides. */
export function TerminalConfigForm({ config, onChange }: ConfigFormProps) {
  const cfg = config as TermConfig;
  return (
    <div className="flex flex-col gap-2 text-xs text-white/70">
      <label className="flex flex-col gap-1">
        Shell (blank = $SHELL)
        <input
          type="text"
          value={cfg.shell ?? ""}
          placeholder="/bin/bash"
          onChange={(e) => onChange({ ...config, shell: e.target.value })}
          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
        />
      </label>
      <label className="flex flex-col gap-1">
        Working directory (blank = $HOME)
        <input
          type="text"
          value={cfg.cwd ?? ""}
          placeholder="/home/you"
          onChange={(e) => onChange({ ...config, cwd: e.target.value })}
          className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
        />
      </label>
    </div>
  );
}
