import { useState } from "react";
import { isTauri, wsDelete, wsList, wsLoad, wsSave } from "../lib/ipc";
import { useLayoutStore } from "../store/layoutStore";
import type { GridLayout } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";

/** Toolbar workspace menu: save the current layout under a name, load a saved
 *  one (replacing the layout), and delete saved workspaces. Desktop-only — the
 *  backend ws_* commands need the Tauri runtime, so it renders nothing in a
 *  plain browser. */
export function WorkspaceMenu() {
  const loadLayout = useLayoutStore((s) => s.loadLayout);
  const [names, setNames] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isTauri()) return null;

  const refresh = () => {
    wsList()
      .then(setNames)
      .catch((e) => setError(String(e)));
  };

  const toggleMenu = () => {
    if (!menuOpen) refresh(); // refresh on open
    setMenuOpen((o) => !o);
  };

  const doSave = () => {
    const name = saveName.trim();
    if (!name || name.includes("/")) return;
    wsSave(name, JSON.stringify(useLayoutStore.getState().layout))
      .then(() => {
        setSaving(false);
        setSaveName("");
        setError(null);
        refresh();
      })
      .catch((e) => setError(String(e)));
  };

  const doLoad = (name: string) => {
    wsLoad(name)
      .then((json) => {
        const parsed = JSON.parse(json) as GridLayout;
        if (!parsed || !parsed.grid || !Array.isArray(parsed.cells)) {
          throw new Error("malformed workspace");
        }
        loadLayout(parsed);
        setMenuOpen(false);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  };

  const doDelete = (name: string) => {
    wsDelete(name)
      .then(() => {
        setPendingDelete(null);
        refresh();
      })
      .catch((e) => {
        setPendingDelete(null);
        setError(String(e));
      });
  };

  return (
    <div className="relative flex items-center gap-1">
      <span className="text-xs font-medium text-white/40">Workspace</span>

      {saving ? (
        <input
          autoFocus
          value={saveName}
          placeholder="名稱"
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doSave();
            if (e.key === "Escape") {
              setSaving(false);
              setSaveName("");
            }
          }}
          className="w-28 rounded border border-white/15 bg-black/30 px-1.5 py-1 text-xs text-white outline-none focus:border-emerald-400/60"
        />
      ) : (
        <button
          onClick={() => {
            setSaving(true);
            setError(null);
          }}
          className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
        >
          💾 Save
        </button>
      )}

      <button
        onClick={toggleMenu}
        className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 hover:text-white"
      >
        📂 Load ▾
      </button>

      {menuOpen && (
        <div className="absolute left-0 top-full z-40 mt-1 w-48 rounded border border-white/10 bg-neutral-900 p-1 shadow-xl">
          {names.length === 0 ? (
            <div className="px-2 py-1 text-xs text-white/40">（無已存的 workspace）</div>
          ) : (
            names.map((name) => (
              <div
                key={name}
                className="group flex items-center gap-1 rounded px-2 py-1 hover:bg-white/5"
              >
                <button
                  onClick={() => doLoad(name)}
                  className="flex-1 truncate text-left text-xs text-white/80"
                  title={name}
                >
                  {name}
                </button>
                <button
                  aria-label="Delete workspace"
                  onClick={() => setPendingDelete(name)}
                  className="hidden text-xs text-white/50 hover:text-red-300 group-hover:block"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {error && <span className="max-w-40 truncate text-xs text-red-300" title={error}>{error}</span>}

      {pendingDelete && (
        <ConfirmDialog
          message={`刪除 workspace「${pendingDelete}」？`}
          confirmLabel="刪除"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
