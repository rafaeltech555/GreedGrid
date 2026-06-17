# M5 File Browser Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a File Browser panel (`PanelKind` `"file"`) that navigates the filesystem, opens files in the OS default app, and supports new-folder / rename / permanent-delete (delete gated by an explicit confirm dialog).

**Architecture:** Stateless custom Rust `std::fs` commands (`fs_list`/`fs_delete`/`fs_rename`/`fs_mkdir`) return data per call; the frontend `FileView` holds the current path in React state and re-lists after every navigation or mutation. Opening a file uses `tauri-plugin-opener`. No per-instance backend state, no Channel, no `onDestroy`.

**Tech Stack:** Rust (`std::fs`, Tauri v2 commands), TypeScript/React, `@tauri-apps/plugin-opener`, reused panel registry / IPC / a11y-dialog conventions.

**Spec:** `docs/superpowers/specs/2026-06-17-m5-file-browser-design.md`.

---

## File Structure

**Rust (`src-tauri/`):**
- `src/commands/fs.rs` — **new**: `FileEntry`, `ListResult`, `collect_entries` (sort helper), `fs_list`/`fs_delete`/`fs_rename`/`fs_mkdir`, `validate_name`, Rust tests (temp-dir only).
- `src/commands/mod.rs` — `pub mod fs;`.
- `src/lib.rs` — register the 4 handlers.
- `capabilities/default.json` — ensure `opener:allow-open-path`.

**Frontend (`src/`):**
- `src/lib/ipc.ts` — `fsList`/`fsDelete`/`fsRename`/`fsMkdir`/`openInDefaultApp`.
- `src/panels/file/types.ts` — `FileEntry`, `ListResult`, `FileConfig`, `fileReady`. **new**
- `src/panels/file/path.ts` — `parentPath`/`joinPath`/`formatSize`/`isValidName`. **new**
- `src/panels/file/ConfirmDialog.tsx` — controlled confirm dialog. **new**
- `src/panels/file/FileView.tsx` — View + ConfigForm. **new**
- `src/panels/file/index.ts` — `filePanel: PanelTypeDef`. **new**
- `src/panels/index.ts` — register it.
- `src/panels/index.test.ts` — extend (3 → 4 panels).
- `package.json` — `@tauri-apps/plugin-opener`.
- `+ *.test.ts(x)` for types/path/ConfirmDialog.

---

## Task 1: Rust `fs_list` + entry collection

**Files:**
- Create: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/commands/mod.rs`, add `pub mod fs;` next to the existing `pub mod pty;` / `pub mod sysmon;`:
```rust
pub mod fs;
pub mod pty;
pub mod sysmon;
```

- [ ] **Step 2: Write `fs.rs` with `fs_list` + the failing test**

Create `src-tauri/src/commands/fs.rs`:
```rust
//! Custom filesystem commands for the File Browser panel. Stateless `std::fs`
//! operations; the frontend holds the current path and re-lists after each one.
//! Kept testable by isolating directory listing in `collect_entries`.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64, // bytes; 0 for directories
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub path: String, // the canonical absolute path actually listed
    pub entries: Vec<FileEntry>,
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

/// Read a directory into sorted entries (dirs first, then case-insensitive name,
/// hidden files included). A per-entry metadata failure degrades that entry to
/// size 0 rather than failing the whole listing.
fn collect_entries(dir: &Path) -> std::io::Result<Vec<FileEntry>> {
    let mut entries: Vec<FileEntry> = Vec::new();
    for dent in fs::read_dir(dir)? {
        let dent = dent?;
        let name = dent.file_name().to_string_lossy().to_string();
        let (is_dir, size) = match dent.metadata() {
            Ok(m) => (m.is_dir(), if m.is_dir() { 0 } else { m.len() }),
            Err(_) => (false, 0),
        };
        entries.push(FileEntry { name, is_dir, size });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir) // dirs (true) before files (false)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn fs_list(path: Option<String>) -> AppResult<ListResult> {
    let raw = path.filter(|s| !s.is_empty()).unwrap_or_else(home_dir);
    let canon = fs::canonicalize(&raw)?;
    let entries = collect_entries(&canon)?;
    Ok(ListResult {
        path: canon.to_string_lossy().to_string(),
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_subdir(tag: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-fs-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn fs_list_sorts_dirs_first_and_reports_sizes() {
        let dir = temp_subdir("list");
        fs::create_dir(dir.join("subdir")).unwrap();
        fs::write(dir.join("b.txt"), b"hello").unwrap(); // 5 bytes
        fs::write(dir.join("a.txt"), b"hi").unwrap(); // 2 bytes

        let res = fs_list(Some(dir.to_string_lossy().to_string())).unwrap();
        assert_eq!(
            res.path,
            fs::canonicalize(&dir).unwrap().to_string_lossy().to_string()
        );
        assert_eq!(res.entries.len(), 3);
        assert!(res.entries[0].is_dir);
        assert_eq!(res.entries[0].name, "subdir");
        assert_eq!(res.entries[1].name, "a.txt");
        assert_eq!(res.entries[1].size, 2);
        assert_eq!(res.entries[2].name, "b.txt");
        assert_eq!(res.entries[2].size, 5);

        fs::remove_dir_all(&dir).unwrap();
    }
}
```
(`AppError` is imported now but only used by the delete/rename/mkdir commands in Task 2 — that's fine, it's `use`d by the module; if the compiler warns "unused import `AppError`" at this step, that's acceptable and Task 2 resolves it. To avoid the warning entirely you may write `use crate::error::AppResult;` here and add `AppError` in Task 2 — either is fine.)

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `cd src-tauri && cargo test fs::tests`
Expected: compiles and PASS (1 test). (The command is registered later; dead-code/unused warnings are fine — do NOT add `#[allow(...)]`.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/commands/mod.rs
git commit -m "$(cat <<'EOF'
M5: fs_list command + sorted directory listing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rust delete / rename / mkdir + wiring

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the failing tests**

Append these tests inside the existing `#[cfg(test)] mod tests { … }` block in `src-tauri/src/commands/fs.rs` (after `fs_list_sorts_dirs_first_and_reports_sizes`):
```rust
    #[test]
    fn fs_mkdir_rename_delete_lifecycle() {
        let dir = temp_subdir("life");
        let base = dir.to_string_lossy().to_string();

        fs_mkdir(base.clone(), "foo".into()).unwrap();
        assert!(dir.join("foo").is_dir());

        fs_rename(dir.join("foo").to_string_lossy().to_string(), "bar".into()).unwrap();
        assert!(dir.join("bar").is_dir());
        assert!(!dir.join("foo").exists());

        // non-empty directory deletes recursively
        fs::write(dir.join("bar").join("x.txt"), b"x").unwrap();
        fs_delete(dir.join("bar").to_string_lossy().to_string()).unwrap();
        assert!(!dir.join("bar").exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rename_and_mkdir_reject_bad_names() {
        let dir = temp_subdir("bad");
        let base = dir.to_string_lossy().to_string();

        assert!(fs_mkdir(base.clone(), "".into()).is_err());
        assert!(fs_mkdir(base.clone(), "a/b".into()).is_err());

        fs_mkdir(base.clone(), "ok".into()).unwrap();
        assert!(fs_rename(dir.join("ok").to_string_lossy().to_string(), "a/b".into()).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }
```

- [ ] **Step 2: Run to confirm they fail (compile error)**

Run: `cd src-tauri && cargo test fs::tests 2>&1 | head -20`
Expected: COMPILE error — `fs_delete`/`fs_rename`/`fs_mkdir` not defined.

- [ ] **Step 3: Implement the commands**

In `src-tauri/src/commands/fs.rs`, add these BELOW `fs_list` (and above the `#[cfg(test)]` block):
```rust
fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.contains('/') {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    Ok(())
}

#[tauri::command]
pub fn fs_delete(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    // symlink_metadata: don't follow links — deleting a symlink removes the link,
    // not its target.
    let meta = fs::symlink_metadata(p)?;
    if meta.file_type().is_dir() {
        fs::remove_dir_all(p)?; // permanent, recursive
    } else {
        fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_rename(path: String, new_name: String) -> AppResult<()> {
    validate_name(&new_name)?;
    let p = Path::new(&path);
    let parent = p
        .parent()
        .ok_or_else(|| AppError::Other("path has no parent".into()))?;
    fs::rename(p, parent.join(&new_name))?;
    Ok(())
}

#[tauri::command]
pub fn fs_mkdir(parent: String, name: String) -> AppResult<()> {
    validate_name(&name)?;
    fs::create_dir(Path::new(&parent).join(&name))?;
    Ok(())
}
```

- [ ] **Step 4: Register handlers in `lib.rs`**

In `src-tauri/src/lib.rs`, add the four fs commands to the `generate_handler!` list (after the sysmon entry). The handler list becomes:
```rust
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::pty::term_open,
            commands::pty::term_write,
            commands::pty::term_resize,
            commands::pty::term_close,
            commands::sysmon::sysmon_sample,
            commands::fs::fs_list,
            commands::fs::fs_delete,
            commands::fs::fs_rename,
            commands::fs::fs_mkdir,
        ])
```
(Leave the `mod` lines, `use` lines, plugins, and `.manage(...)` calls unchanged.)

- [ ] **Step 5: Allow opener to open paths**

In `src-tauri/capabilities/default.json`, add `"opener:allow-open-path"` to the `permissions` array (needed so the frontend `openPath` works):
```json
  "permissions": [
    "core:default",
    "opener:default",
    "opener:allow-open-path",
    "dialog:default"
  ]
```

- [ ] **Step 6: Verify compile + tests**

Run: `cd src-tauri && cargo test fs::tests`
Expected: PASS — 3 fs tests. Then `cargo build 2>&1 | grep -E "^error"` → no output. (The fs commands are now registered, so their dead-code warnings disappear.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "$(cat <<'EOF'
M5: fs_delete/fs_rename/fs_mkdir commands + handler registration + opener path permission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Frontend types + path helpers

**Files:**
- Create: `src/panels/file/types.ts`, `src/panels/file/types.test.ts`
- Create: `src/panels/file/path.ts`, `src/panels/file/path.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/panels/file/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fileReady } from "./types";

describe("fileReady", () => {
  it("is always true — the browser opens at a default directory", () => {
    expect(fileReady({})).toBe(true);
    expect(fileReady({ path: "/tmp" })).toBe(true);
  });
});
```

Create `src/panels/file/path.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatSize, isValidName, joinPath, parentPath } from "./path";

describe("parentPath", () => {
  it("walks up one level and bottoms out at root", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/a/b/")).toBe("/a"); // trailing slash tolerated
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("joinPath", () => {
  it("joins without doubling slashes", () => {
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
    expect(joinPath("/a/", "c")).toBe("/a/c");
    expect(joinPath("/", "c")).toBe("/c");
  });
});

describe("formatSize", () => {
  it("scales to binary units", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2150)).toBe("2.1K");
    expect(formatSize(Math.round(4.2 * 1024 * 1024))).toBe("4.2M");
  });
});

describe("isValidName", () => {
  it("rejects empty and slash-containing names", () => {
    expect(isValidName("ok.txt")).toBe(true);
    expect(isValidName("")).toBe(false);
    expect(isValidName("a/b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm vitest run src/panels/file/types.test.ts src/panels/file/path.test.ts`
Expected: FAIL — `./types` / `./path` don't resolve.

- [ ] **Step 3: Implement types**

Create `src/panels/file/types.ts`:
```ts
/** One directory entry from the backend `fs_list` (camelCase from serde). */
export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
}

/** Result of `fs_list`: the canonical path actually listed + its entries. */
export interface ListResult {
  path: string;
  entries: FileEntry[];
}

/** Per-instance config: the starting directory (empty → backend uses $HOME). */
export interface FileConfig {
  path?: string;
}

/** Always ready — opens at a default directory, so placement never opens the
 *  config modal (the gear edits the starting directory later). */
export function fileReady(_config: Record<string, unknown>): boolean {
  return true;
}
```

- [ ] **Step 4: Implement path helpers**

Create `src/panels/file/path.ts`:
```ts
/** Parent directory of an absolute path; root's parent is root. */
export function parentPath(p: string): string {
  const trimmed = p.replace(/\/+$/, ""); // drop trailing slashes
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** Join a directory and a child name without doubling the separator. */
export function joinPath(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, "");
  return base === "" ? `/${name}` : `${base}/${name}`;
}

/** Compact binary-unit file size, e.g. "4.2M", "2.1K", "512B". */
export function formatSize(n: number): string {
  const G = 1024 ** 3;
  const M = 1024 ** 2;
  const K = 1024;
  if (n >= G) return `${(n / G).toFixed(1)}G`;
  if (n >= M) return `${(n / M).toFixed(1)}M`;
  if (n >= K) return `${(n / K).toFixed(1)}K`;
  return `${n}B`;
}

/** A new/renamed entry name must be non-empty and contain no path separator. */
export function isValidName(name: string): boolean {
  return name.length > 0 && !name.includes("/");
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm vitest run src/panels/file/types.test.ts src/panels/file/path.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/panels/file/types.ts src/panels/file/types.test.ts src/panels/file/path.ts src/panels/file/path.test.ts
git commit -m "$(cat <<'EOF'
M5: file panel types (fileReady) + path helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ConfirmDialog component

**Files:**
- Create: `src/panels/file/ConfirmDialog.tsx`, `src/panels/file/ConfirmDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/file/ConfirmDialog.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("shows the message and routes the buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        message="永久刪除 notes.md？不可復原"
        confirmLabel="永久刪除"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("永久刪除 notes.md？不可復原")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "永久刪除" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm vitest run src/panels/file/ConfirmDialog.test.tsx`
Expected: FAIL — `./ConfirmDialog` doesn't resolve.

- [ ] **Step 3: Implement**

Create `src/panels/file/ConfirmDialog.tsx`:
```tsx
interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small controlled confirm dialog (mirrors ConfigModal's a11y conventions).
 *  Used for the irreversible permanent-delete confirmation; the confirm button
 *  is styled as a destructive (red) action. */
export function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-72 rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={true}
      >
        <p className="mb-4 text-sm text-white/80">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded border border-red-400/50 px-3 py-1 text-xs text-red-200 hover:bg-red-400/10"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm vitest run src/panels/file/ConfirmDialog.test.tsx`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/panels/file/ConfirmDialog.tsx src/panels/file/ConfirmDialog.test.tsx
git commit -m "$(cat <<'EOF'
M5: ConfirmDialog for destructive delete confirmation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: IPC wrappers + FileView

**Files:**
- Modify: `package.json` (dep), `src/lib/ipc.ts`
- Create: `src/panels/file/FileView.tsx`

- [ ] **Step 1: Install the opener plugin JS package**

Run:
```bash
pnpm add @tauri-apps/plugin-opener
```
Expected: `package.json` gains `@tauri-apps/plugin-opener` under `dependencies`.

- [ ] **Step 2: Add the IPC wrappers**

In `src/lib/ipc.ts`, add near the other `import type` lines:
```ts
import { openPath } from "@tauri-apps/plugin-opener";
import type { ListResult } from "../panels/file/types";
```
and append at the END of the file:
```ts
// --- File Browser (M5) ------------------------------------------------------
/** List a directory (empty path → backend uses $HOME); returns the canonical
 *  path actually listed plus its entries. */
export function fsList(path?: string): Promise<ListResult> {
  return invoke<ListResult>("fs_list", { path });
}

/** Permanently delete a file (or recursively, a directory). */
export function fsDelete(path: string): Promise<void> {
  return invoke<void>("fs_delete", { path });
}

/** Rename an entry in place to `newName` (no path separators allowed). */
export function fsRename(path: string, newName: string): Promise<void> {
  return invoke<void>("fs_rename", { path, newName });
}

/** Create a new directory `name` under `parent`. */
export function fsMkdir(parent: string, name: string): Promise<void> {
  return invoke<void>("fs_mkdir", { parent, name });
}

/** Open a file/directory in the OS default application (tauri-plugin-opener). */
export function openInDefaultApp(path: string): Promise<void> {
  return openPath(path);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — `ListResult` and `openPath` resolve.

- [ ] **Step 4: Create `FileView.tsx`**

Create `src/panels/file/FileView.tsx` with EXACTLY this content:
```tsx
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
import { ConfirmDialog } from "./ConfirmDialog";

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

  const reload = (target?: string) => {
    fsList(target)
      .then((res) => {
        setPath(res.path); // adopt the canonical path
        setEntries(res.entries);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    if (!isTauri()) return;
    reload(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!isTauri()) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/30">
        File browser requires the desktop app.
      </div>
    );
  }

  const here = path ?? "";

  const doMkdir = () => {
    if (!isValidName(newName)) return;
    fsMkdir(here, newName)
      .then(() => {
        setCreating(false);
        setNewName("");
        reload(here);
      })
      .catch((e) => setError(String(e)));
  };

  const doRename = (entry: FileEntry) => {
    if (!isValidName(renameVal)) return;
    fsRename(joinPath(here, entry.name), renameVal)
      .then(() => {
        setRenaming(null);
        reload(here);
      })
      .catch((e) => setError(String(e)));
  };

  const doDelete = (entry: FileEntry) => {
    fsDelete(joinPath(here, entry.name))
      .then(() => {
        setPendingDelete(null);
        reload(here);
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
          className="ml-auto shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-white/60 hover:text-white"
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
          onClick={() => setPath(parentPath(here))}
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
                    ? setPath(joinPath(here, entry.name))
                    : openInDefaultApp(joinPath(here, entry.name))
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
```

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — types resolve, vite build succeeds. (`FileView` is not unit-tested; live fs I/O is verified manually in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/ipc.ts src/panels/file/FileView.tsx
git commit -m "$(cat <<'EOF'
M5: fs IPC wrappers + opener + FileView (navigate/open/mkdir/rename/delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register the file panel

**Files:**
- Create: `src/panels/file/index.ts`
- Modify: `src/panels/index.ts`, `src/panels/index.test.ts`

- [ ] **Step 1: Update the registration tests**

Edit `src/panels/index.test.ts`. Inside the `describe("registerAllPanels", …)` block, add:
```ts
  it("registers the file panel", () => {
    registerAllPanels();
    expect(getPanelType("file")?.label).toBe("Files");
  });
```
And update the count test (currently expects 3) to 4 — find:
```ts
  it("registers all built-in panels exactly once", () => {
    registerAllPanels();
    registerAllPanels(); // idempotent
    expect(allPanelTypes()).toHaveLength(3);
  });
```
change `toHaveLength(3)` to `toHaveLength(4)`.

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: FAIL — `getPanelType("file")` undefined; count is 3, not 4.

- [ ] **Step 3: Create the panel definition**

Create `src/panels/file/index.ts`:
```ts
import type { PanelTypeDef } from "../types";
import { fileReady } from "./types";
import { FileConfigForm, FileView } from "./FileView";

/** The File Browser panel: navigate, open, new-folder, rename, permanent-delete.
 *  `ready` is always true (opens at a default dir); no `onDestroy` — the fs
 *  commands are stateless, nothing per-instance to release. */
export const filePanel: PanelTypeDef = {
  kind: "file",
  label: "Files",
  glyph: "📁",
  defaultConfig: () => ({}),
  ready: fileReady,
  ConfigForm: FileConfigForm,
  View: FileView,
};
```

- [ ] **Step 4: Register it in `panels/index.ts`**

Replace the contents of `src/panels/index.ts` with:
```ts
import { getPanelType, registerPanel } from "./registry";
import { webPanel } from "./web";
import { terminalPanel } from "./terminal";
import { sysmonPanel } from "./sysmon";
import { filePanel } from "./file";

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (!getPanelType("web")) registerPanel(webPanel);
  if (!getPanelType("terminal")) registerPanel(terminalPanel);
  if (!getPanelType("sysmon")) registerPanel(sysmonPanel);
  if (!getPanelType("file")) registerPanel(filePanel);
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm vitest run src/panels/index.test.ts`
Expected: PASS — file registers (label "Files"), count 4, idempotent.

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: ALL pass; typecheck clean. (Importing `panels/index` transitively imports `FileView` → `@tauri-apps/plugin-opener`; that plugin only calls Tauri lazily inside functions, so the import must not crash jsdom. If a test fails purely from that import, report BLOCKED with the exact error.)

- [ ] **Step 7: Commit**

```bash
git add src/panels/file/index.ts src/panels/index.ts src/panels/index.test.ts
git commit -m "$(cat <<'EOF'
M5: register File Browser panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Manual GUI verification

Live fs I/O + `openPath` need the Tauri runtime; verify with `pnpm tauri dev` using the project's XTest/screenshot recipe (`greedgrid-gui-verify-recipe` memory). **All mutations must happen inside a disposable test directory — never real user files.**

**Files:** none.

- [ ] **Step 1: Prepare a disposable test tree**

Run (in a normal shell, not via the app):
```bash
rm -rf /tmp/m5-test && mkdir -p /tmp/m5-test/sub && printf 'hello\n' > /tmp/m5-test/notes.txt && printf 'x' > /tmp/m5-test/data.bin
```

- [ ] **Step 2: Launch + place a Files panel**

`DISPLAY=:0 pnpm tauri dev`. Confirm `backend: greedgrid vX.Y.Z`. Place a **📁 Files** panel (it now appears in the picker/palette). It opens at `$HOME` by default.

- [ ] **Step 3: Navigate into the test tree**

Use the gear (⚙) to set the starting directory to `/tmp/m5-test`, OK (or navigate there). Confirm the list shows `sub` (folder, first), then `data.bin` and `notes.txt` with sizes; `..` is present.

- [ ] **Step 4: Open a file**

Click `notes.txt`.
Expected: it opens in the OS default app (e.g. a text editor). If nothing opens, capture any error shown in the panel (this exercises the `opener:allow-open-path` permission).

- [ ] **Step 5: New folder**

Click `+ 新資料夾`, type `made-by-test`, Enter.
Expected: the folder appears in the list. Verify on disk: `ls /tmp/m5-test`.

- [ ] **Step 6: Rename**

Hover `data.bin` → ✏ → change to `renamed.bin`, Enter.
Expected: the list updates; `ls /tmp/m5-test` shows `renamed.bin`, no `data.bin`.

- [ ] **Step 7: Delete (confirm dialog)**

Hover `renamed.bin` → ✕ → the ConfirmDialog appears showing "永久刪除「renamed.bin」？不可復原。" → click 永久刪除.
Expected: the file disappears from the list and from disk. Repeat on the `sub` folder to confirm recursive directory delete works.

- [ ] **Step 8: Capture + report**

Use the `verify` skill report format. Capture a screenshot of the populated browser and note the open/rename/delete observations + the `ls` confirmations. Then clean up: `rm -rf /tmp/m5-test`.

---

## Self-Review

**Spec coverage (§1–§5):**
- `FileEntry` / `ListResult` (Rust camelCase serde + TS) → Task 1 + Task 3. ✅
- `FileConfig` + `fileReady` → Task 3. ✅
- `fs_list` (home default, canonicalize, dirs-first sort, hidden included, best-effort metadata) → Task 1. ✅
- `fs_delete` (symlink_metadata, recursive dir, permanent), `fs_rename`/`fs_mkdir` (name validation) → Task 2. ✅
- Handler registration + `opener:allow-open-path` capability → Task 2. ✅
- IPC wrappers + `openInDefaultApp` via `@tauri-apps/plugin-opener` → Task 5. ✅
- `parentPath`/`joinPath`/`formatSize`/`isValidName` → Task 3. ✅
- `ConfirmDialog` (a11y, destructive styling) → Task 4. ✅
- `FileView` (read-only path bar, `..`, open file, hover ✏/✕, inline rename, inline new-folder, delete via confirm, isTauri placeholder, re-list after mutation) + `FileConfigForm` → Task 5. ✅
- Register `filePanel` (no `onDestroy`) → Task 6. ✅
- Rust temp-dir tests + frontend unit tests (fileReady/path/ConfirmDialog/registration) → Tasks 1,2,3,4,6. ✅
- Manual GUI in a disposable test tree → Task 7. ✅

**Type consistency:** `FileEntry` fields (`name`, `isDir`, `size`) and `ListResult` (`path`, `entries`) are defined once (Task 3) and consumed in `ipc.ts` (Task 5) and `FileView` (Task 5); the Rust structs use snake_case + `rename_all="camelCase"` (Task 1) so the wire shape matches. Command params: `fsList(path?)`, `fsDelete(path)`, `fsRename(path,newName)`, `fsMkdir(parent,name)` (Task 5) ↔ Rust `fs_list(path)`, `fs_delete(path)`, `fs_rename(path,new_name)`, `fs_mkdir(parent,name)` (Tasks 1–2), with Tauri's camel↔snake mapping (`newName`→`new_name`). `fileReady` (Task 3) used in `filePanel` (Task 6). `parentPath`/`joinPath`/`formatSize`/`isValidName` (Task 3) and `ConfirmDialog` (Task 4) used in `FileView` (Task 5).

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" — every code step carries full code. Task 7 is manual verification, correctly code-free.
