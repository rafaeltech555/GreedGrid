import { useEffect, useState } from "react";
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { FileConfig, FileEntry } from "./types";
import {
  fsDelete,
  fsList,
  fsMkdir,
  fsRename,
  isTauri,
  openInDefaultApp,
} from "../../lib/ipc";
import { formatSize, isValidName, joinPath, parentPath } from "./path";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/** File Browser view: navigates the filesystem, opens files in the OS default
 *  app, and supports new-folder / rename / permanent-delete. Stateless backend
 *  (re-lists after each mutation); no teardown on unmount. */
export function FileView({ config }: PanelViewProps) {
  const cfg = config as FileConfig;
  const [path, setPath] = useState<string | undefined>(cfg.path);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);

  // List `target` and commit it only on success: a failed listing (e.g. a
  // permission-denied directory) leaves the current path + entries intact and
  // just surfaces the error, instead of stranding the view on a broken path with
  // the previous directory's stale entries. Used for the initial load, every
  // navigation, and the post-mutation refresh.
  const openDir = (target?: string) => {
    fsList(target)
      .then((res) => {
        setPath(res.path); // adopt the canonical path
        setEntries(res.entries);
        setError(null);
        // entering a directory cancels any in-progress inline edit so it can't
        // target a same-named entry in the destination
        setRenaming(null);
        setCreating(false);
        setNewName("");
      })
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    if (!isTauri()) return;
    openDir(cfg.path);
    // Mount-only: list the initial directory. Navigation and the post-mutation
    // refresh call openDir directly, so this effect must not re-run on state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isTauri()) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30">
        File browser requires the desktop app.
      </div>
    );
  }

  const here = path ?? "";

  const doMkdir = () => {
    if (!path || !isValidName(newName)) return;
    fsMkdir(here, newName)
      .then(() => {
        setCreating(false);
        setNewName("");
        openDir(here);
      })
      .catch((e) => setError(String(e)));
  };

  const doRename = (entry: FileEntry) => {
    if (!isValidName(renameVal)) return;
    fsRename(joinPath(here, entry.name), renameVal)
      .then(() => {
        setRenaming(null);
        openDir(here);
      })
      .catch((e) => setError(String(e)));
  };

  const doDelete = (entry: FileEntry) => {
    fsDelete(joinPath(here, entry.name))
      .then(() => {
        setPendingDelete(null);
        openDir(here);
      })
      .catch((e) => {
        setPendingDelete(null);
        setError(String(e));
      });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden text-xs text-white/80">
      {/* read-only path bar + new-folder action */}
      <div className="flex items-center gap-2 border-b border-white/10 px-2 py-1">
        <span className="truncate text-white/50" title={here}>
          {here}
        </span>
        <button
          onClick={() => setCreating(true)}
          disabled={!path}
          className="ml-auto shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-white/60 hover:text-white disabled:opacity-40"
        >
          + 新資料夾
        </button>
      </div>

      {error && <div className="px-2 py-1 text-red-300">{error}</div>}

      <div className="flex-1 overflow-auto">
        {creating && (
          <div className="flex items-center gap-1 px-2 py-1">
            <span aria-hidden>📁</span>
            <input
              autoFocus
              value={newName}
              placeholder="資料夾名稱"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doMkdir();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              className="flex-1 rounded border border-white/15 bg-black/30 px-1 text-white outline-none focus:border-emerald-400/60"
            />
          </div>
        )}

        <button
          onClick={() => openDir(parentPath(here))}
          className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-white/5"
        >
          <span aria-hidden>📁</span> ..
        </button>

        {entries.map((entry) => (
          <div
            key={entry.name}
            className="group flex items-center gap-1 px-2 py-0.5 hover:bg-white/5"
          >
            <span aria-hidden>{entry.isDir ? "📁" : "📄"}</span>
            {renaming === entry.name ? (
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doRename(entry);
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="flex-1 rounded border border-white/15 bg-black/30 px-1 text-white outline-none focus:border-emerald-400/60"
              />
            ) : (
              <button
                onClick={() =>
                  entry.isDir
                    ? openDir(joinPath(here, entry.name))
                    : openInDefaultApp(joinPath(here, entry.name)).catch((e) =>
                        setError(String(e)),
                      )
                }
                className="flex-1 truncate text-left"
                title={entry.name}
              >
                {entry.name}
              </button>
            )}
            {!entry.isDir && renaming !== entry.name && (
              <span className="tabular-nums text-white/40">{formatSize(entry.size)}</span>
            )}
            {renaming !== entry.name && (
              <div className="hidden gap-1 group-hover:flex">
                <button
                  aria-label="Rename"
                  onClick={() => {
                    setRenaming(entry.name);
                    setRenameVal(entry.name);
                  }}
                  className="text-white/50 hover:text-white"
                >
                  ✏
                </button>
                <button
                  aria-label="Delete"
                  onClick={() => setPendingDelete(entry)}
                  className="text-white/50 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message={`永久刪除「${pendingDelete.name}」？不可復原。`}
          confirmLabel="永久刪除"
          onConfirm={() => doDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/** Config form: the starting directory (empty → $HOME). */
export function FileConfigForm({ config, onChange }: ConfigFormProps) {
  const cfg = config as FileConfig;
  return (
    <label className="flex flex-col gap-1 text-xs text-white/70">
      起始目錄（空 = $HOME）
      <input
        type="text"
        value={cfg.path ?? ""}
        placeholder="/home/you"
        onChange={(e) => onChange({ ...config, path: e.target.value })}
        className="rounded border border-white/15 bg-black/30 px-2 py-1 text-white outline-none focus:border-emerald-400/60"
      />
    </label>
  );
}
