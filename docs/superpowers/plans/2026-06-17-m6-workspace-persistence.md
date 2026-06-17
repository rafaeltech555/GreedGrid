# M6 Workspace Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the current grid layout under a name as JSON, then list / load / delete saved workspaces — via a toolbar Workspace menu backed by custom Rust file commands.

**Architecture:** The frontend `JSON.stringify`s its `GridLayout` and the backend stores it as an opaque JSON string at `workspaces_dir/<name>.json` (schema stays frontend-only; backend just validates it parses). Stateless `std::fs` commands (built on the M0 `paths.rs` helpers + `atomic_write`) handle save/load/list/delete; a `loadLayout` store action replaces the layout (firing `onDestroy` for dropped panels); a `WorkspaceMenu` toolbar component drives it.

**Tech Stack:** Rust (`std::fs`, `serde_json`, `paths.rs` atomic write, Tauri v2 commands), TypeScript/React, Zustand store, reused IPC / ConfirmDialog conventions.

**Spec:** `docs/superpowers/specs/2026-06-17-m6-workspace-persistence-design.md`.

---

## File Structure

**Rust (`src-tauri/`):**
- `src/commands/workspace.rs` — **new**: `validate_ws_name`, pure `save_to`/`load_from`/`list_in`/`delete_in`, `ws_*` command wrappers, Rust tests (temp-dir).
- `src/commands/mod.rs` — `pub mod workspace;`.
- `src/lib.rs` — register the 4 handlers.
- `src/paths.rs` — remove `#![allow(dead_code)]` (now used).

**Frontend (`src/`):**
- `src/store/layoutStore.ts` — `loadLayout` action.
- `src/store/layoutStore.test.ts` — `loadLayout` + JSON round-trip tests.
- `src/components/ConfirmDialog.tsx` + `.test.tsx` — **moved** from `src/panels/file/`.
- `src/panels/file/FileView.tsx` — update ConfirmDialog import.
- `src/lib/ipc.ts` — `wsSave`/`wsLoad`/`wsList`/`wsDelete`.
- `src/components/WorkspaceMenu.tsx` — **new**: Save/Load/Delete UI.
- `src/components/Toolbar.tsx` — mount `WorkspaceMenu`.

---

## Task 1: Backend pure workspace functions

**Files:**
- Create: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/commands/mod.rs`, add `pub mod workspace;` alongside the existing `pub mod fs;` / `pub mod pty;` / `pub mod sysmon;`:
```rust
pub mod fs;
pub mod pty;
pub mod sysmon;
pub mod workspace;
```

- [ ] **Step 2: Create `workspace.rs` with the pure functions + tests**

Create `src-tauri/src/commands/workspace.rs`:
```rust
//! Workspace persistence: save/load/list/delete named grid layouts as JSON files
//! under the app config's `workspaces/` dir. The layout is stored as an opaque
//! JSON string (its schema lives in the frontend `GridLayout`); we only validate
//! that it parses. File logic is isolated in dir-taking helpers so it is
//! unit-testable without a Tauri AppHandle.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::paths::atomic_write;

fn validate_ws_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err(AppError::Other(format!("invalid workspace name: {name:?}")));
    }
    Ok(())
}

fn save_to(dir: &Path, name: &str, layout: &str) -> AppResult<()> {
    validate_ws_name(name)?;
    // Reject garbage before persisting; the frontend always sends valid JSON.
    serde_json::from_str::<serde_json::Value>(layout)
        .map_err(|e| AppError::Other(format!("invalid layout json: {e}")))?;
    atomic_write(&dir.join(format!("{name}.json")), layout.as_bytes())?;
    Ok(())
}

fn load_from(dir: &Path, name: &str) -> AppResult<String> {
    validate_ws_name(name)?;
    let contents = fs::read_to_string(dir.join(format!("{name}.json")))?;
    Ok(contents)
}

fn list_in(dir: &Path) -> AppResult<Vec<String>> {
    let mut names: Vec<String> = Vec::new();
    if !dir.exists() {
        return Ok(names);
    }
    for dent in fs::read_dir(dir)? {
        let path = dent?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(names)
}

fn delete_in(dir: &Path, name: &str) -> AppResult<()> {
    validate_ws_name(name)?;
    let path = dir.join(format!("{name}.json"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-ws-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn save_list_load_delete_lifecycle() {
        let dir = temp_dir("life");
        save_to(&dir, "beta", r#"{"grid":{"cols":[1],"rows":[1],"gap":4},"cells":[]}"#).unwrap();
        save_to(&dir, "alpha", r#"{"grid":{},"cells":[]}"#).unwrap();

        assert_eq!(list_in(&dir).unwrap(), vec!["alpha", "beta"]); // sorted, ext stripped

        let loaded = load_from(&dir, "beta").unwrap();
        assert!(loaded.contains("\"cells\""));

        delete_in(&dir, "alpha").unwrap();
        assert_eq!(list_in(&dir).unwrap(), vec!["beta"]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_rejects_bad_name_and_bad_json() {
        let dir = temp_dir("bad");
        assert!(save_to(&dir, "", "{}").is_err());
        assert!(save_to(&dir, "a/b", "{}").is_err());
        assert!(save_to(&dir, "..", "{}").is_err());
        assert!(save_to(&dir, "ok", "not json").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_in_returns_empty_for_missing_dir() {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-ws-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        assert_eq!(list_in(&p).unwrap(), Vec::<String>::new());
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test workspace::tests`
Expected: PASS — 3 tests. The pure fns are only used by tests at this stage, so `dead_code` warnings for `save_to`/`load_from`/`list_in`/`delete_in`/`validate_ws_name` are EXPECTED (the command wrappers in Task 2 consume them) — do NOT add `#[allow(...)]`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/workspace.rs src-tauri/src/commands/mod.rs
git commit -m "$(cat <<'EOF'
M6: workspace persistence pure fns (save/load/list/delete) + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tauri command wrappers + wiring

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/paths.rs`

- [ ] **Step 1: Add the command wrappers**

In `src-tauri/src/commands/workspace.rs`, change the imports at the top — replace:
```rust
use crate::paths::atomic_write;
```
with:
```rust
use tauri::AppHandle;

use crate::paths::{atomic_write, workspaces_dir};
```
Then add the four command wrappers BELOW `delete_in` and ABOVE the `#[cfg(test)]` block:
```rust
#[tauri::command]
pub fn ws_save(name: String, layout: String, app: AppHandle) -> AppResult<()> {
    save_to(&workspaces_dir(&app)?, &name, &layout)
}

#[tauri::command]
pub fn ws_load(name: String, app: AppHandle) -> AppResult<String> {
    load_from(&workspaces_dir(&app)?, &name)
}

#[tauri::command]
pub fn ws_list(app: AppHandle) -> AppResult<Vec<String>> {
    list_in(&workspaces_dir(&app)?)
}

#[tauri::command]
pub fn ws_delete(name: String, app: AppHandle) -> AppResult<()> {
    delete_in(&workspaces_dir(&app)?, &name)
}
```

- [ ] **Step 2: Register handlers in `lib.rs`**

In `src-tauri/src/lib.rs`, add the four workspace commands to the `generate_handler!` list, after the existing `commands::fs::fs_mkdir,` entry:
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
            commands::workspace::ws_save,
            commands::workspace::ws_load,
            commands::workspace::ws_list,
            commands::workspace::ws_delete,
        ])
```
(Leave `mod`/`use`/plugins/`.manage` unchanged.)

- [ ] **Step 3: Remove the dead-code allowance from `paths.rs`**

`workspaces_dir` (and transitively `config_dir`) and `atomic_write` are now all used. In `src-tauri/src/paths.rs`, DELETE this line (line 4):
```rust
#![allow(dead_code)] // wired up in M6 (workspace persistence)
```

- [ ] **Step 4: Verify compile + tests**

Run: `cd src-tauri && cargo test`
Expected: PASS — `workspace::tests` (3) + all prior tests green; crate compiles. The Task-1 dead-code warnings for the workspace pure fns are now GONE (reachable via the commands), and removing `paths.rs`'s allowance produces NO new warnings (its fns are all used). Then `cargo build 2>&1 | grep -E "^(error|warning)"` → no output.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/workspace.rs src-tauri/src/lib.rs src-tauri/src/paths.rs
git commit -m "$(cat <<'EOF'
M6: ws_* Tauri commands + handler registration; drop paths.rs dead_code allow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Store `loadLayout` action

**Files:**
- Modify: `src/store/layoutStore.ts`
- Modify: `src/store/layoutStore.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/store/layoutStore.test.ts`, add a `loadLayout` test inside the existing `describe("panel actions", …)` block (it registers `webDef` with the `destroyed` spy + resets the store in its `beforeEach`):
```ts
  it("loadLayout replaces the layout, clears selection, and destroys dropped panels", () => {
    s().setPanel(cellId(1, 1), "web", undefined, () => "id-old");
    s().toggleSelect(cellId(2, 1));
    destroyed.length = 0; // ignore placement destroys
    s().loadLayout(makePreset(6)); // fresh layout has no panels → id-old is dropped
    expect(s().layout.cells).toHaveLength(6);
    expect(s().selectedIds).toEqual([]);
    expect(destroyed).toEqual(["id-old"]);
  });
```
And add a JSON round-trip test inside the FIRST `describe("layoutStore", …)` block:
```ts
  it("the layout document survives a JSON round-trip (pure data)", () => {
    s().applyPreset(4);
    const layout = s().layout;
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
```

- [ ] **Step 2: Run to confirm the loadLayout test fails**

Run: `pnpm vitest run src/store/layoutStore.test.ts`
Expected: FAIL — `s().loadLayout is not a function`. (The round-trip test already passes — layout is plain data.)

- [ ] **Step 3: Implement `loadLayout`**

In `src/store/layoutStore.ts`, add `loadLayout` to the `LayoutState` interface (next to `applyPreset`):
```ts
  applyPreset: (count: PresetCount) => void;
  loadLayout: (layout: GridLayout) => void;
```
And add the action implementation in the `create<LayoutState>(...)` object, right after the `applyPreset` action:
```ts
  loadLayout: (layout) =>
    set((s) => {
      fireDestroyed(s.layout, layout);
      return { layout, selectedIds: [] };
    }),
```
(`GridLayout` is already imported at the top of `layoutStore.ts`; `fireDestroyed` is already defined in this file and used by `applyPreset`.)

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm vitest run src/store/layoutStore.test.ts`
Expected: PASS — all store tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/store/layoutStore.ts src/store/layoutStore.test.ts
git commit -m "$(cat <<'EOF'
M6: layoutStore.loadLayout (replace layout, destroy dropped panels)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Move ConfirmDialog to shared components

**Files:**
- Create: `src/components/ConfirmDialog.tsx`, `src/components/ConfirmDialog.test.tsx`
- Delete: `src/panels/file/ConfirmDialog.tsx`, `src/panels/file/ConfirmDialog.test.tsx`
- Modify: `src/panels/file/FileView.tsx`

- [ ] **Step 1: Create the component under `components/`**

Create `src/components/ConfirmDialog.tsx` with the SAME content the file currently has (a controlled confirm dialog). Exact content:
```tsx
interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small controlled confirm dialog (mirrors ConfigModal's a11y conventions).
 *  Shared by destructive actions — file delete and workspace delete. The confirm
 *  button is styled as a destructive (red) action. */
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

Create `src/components/ConfirmDialog.test.tsx`:
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

- [ ] **Step 2: Delete the old files**

```bash
git rm src/panels/file/ConfirmDialog.tsx src/panels/file/ConfirmDialog.test.tsx
```

- [ ] **Step 3: Update the FileView import**

In `src/panels/file/FileView.tsx`, change the ConfirmDialog import line:
```ts
import { ConfirmDialog } from "./ConfirmDialog";
```
to:
```ts
import { ConfirmDialog } from "../../components/ConfirmDialog";
```
(No other file imports ConfirmDialog — `FileView` is the only consumer until Task 5.)

- [ ] **Step 4: Verify suite + typecheck (no regressions)**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — the moved ConfirmDialog test runs under its new path; `FileView` resolves the new import; all other tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConfirmDialog.tsx src/components/ConfirmDialog.test.tsx src/panels/file/FileView.tsx
git commit -m "$(cat <<'EOF'
M6: move ConfirmDialog to shared components/ (used by file + workspace delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: IPC wrappers + WorkspaceMenu + Toolbar

**Files:**
- Modify: `src/lib/ipc.ts`
- Create: `src/components/WorkspaceMenu.tsx`
- Modify: `src/components/Toolbar.tsx`

- [ ] **Step 1: Add the IPC wrappers**

Append to `src/lib/ipc.ts` (use the existing `invoke` import; no new type import needed):
```ts
// --- Workspace persistence (M6) ---------------------------------------------
/** Save the current layout JSON under `name` (overwrites an existing one). */
export function wsSave(name: string, layout: string): Promise<void> {
  return invoke<void>("ws_save", { name, layout });
}

/** Load a saved workspace's layout JSON string. */
export function wsLoad(name: string): Promise<string> {
  return invoke<string>("ws_load", { name });
}

/** List saved workspace names (sorted). */
export function wsList(): Promise<string[]> {
  return invoke<string[]>("ws_list");
}

/** Delete a saved workspace. */
export function wsDelete(name: string): Promise<void> {
  return invoke<void>("ws_delete", { name });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Create `WorkspaceMenu.tsx`**

Create `src/components/WorkspaceMenu.tsx` with EXACTLY this content:
```tsx
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
```

- [ ] **Step 4: Mount it in the Toolbar**

In `src/components/Toolbar.tsx`, add the import at the top (after the existing imports):
```ts
import { WorkspaceMenu } from "./WorkspaceMenu";
```
Then add a divider + `WorkspaceMenu` at the END of the toolbar's flex container — insert right before the final closing `</div>` (after the `selectedCount > 0` block):
```tsx
      <div className="mx-1 h-4 w-px bg-white/10" />
      <WorkspaceMenu />
```

- [ ] **Step 5: Verify typecheck + build + full suite**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: PASS — types resolve, vite build succeeds, all unit tests green. (`WorkspaceMenu` is not unit-tested — it needs the Tauri runtime / invoke mocking; its live behavior is verified in Task 6. In jsdom `isTauri()` is false so it renders null inside the Toolbar without error.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/components/WorkspaceMenu.tsx src/components/Toolbar.tsx
git commit -m "$(cat <<'EOF'
M6: ws_* IPC wrappers + WorkspaceMenu (save/load/delete) mounted in Toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual GUI verification

Live save/load/delete need the Tauri runtime; verify with `pnpm tauri dev` using the project's XTest/screenshot recipe (`greedgrid-gui-verify-recipe` memory).

**Files:** none.

- [ ] **Step 1: Launch + arrange**

`DISPLAY=:0 pnpm tauri dev`. Confirm `backend: greedgrid vX.Y.Z`. The toolbar now shows a **Workspace** section (`💾 Save`, `📂 Load ▾`). Place a couple of panels (e.g. a System monitor + a Web panel) and/or pick a non-default preset so the layout is distinctive.

- [ ] **Step 2: Save**

Click `💾 Save`, type `test-ws`, Enter. Verify on disk the file was written:
```bash
ls ~/.config/*greedgrid*/workspaces/ 2>/dev/null || ls ~/.config/com.rafaeltech555.greedgrid/workspaces/
cat ~/.config/*greedgrid*/workspaces/test-ws.json | head -c 200
```
Expected: `test-ws.json` exists and contains the serialized layout (grid + cells).

- [ ] **Step 3: Change the layout, then Load it back**

Switch to a different preset (e.g. `4`) or remove the panels — the layout now differs. Click `📂 Load ▾` → the dropdown lists `test-ws` → click it.
Expected: the saved layout is restored (the panels/preset reappear exactly as saved). Note: a restored Terminal panel spawns a fresh shell (its old pty is gone) — that's expected.

- [ ] **Step 4: Delete (confirm)**

Click `📂 Load ▾` → hover `test-ws` → `✕` → the ConfirmDialog shows "刪除 workspace「test-ws」？" → click 刪除.
Expected: `test-ws` disappears from the dropdown; the file is gone:
```bash
ls ~/.config/*greedgrid*/workspaces/
```

- [ ] **Step 5: Capture + report**

Use the `verify` skill report format. Capture a screenshot of the toolbar Workspace menu (dropdown open with a saved workspace) and the `ls`/`cat` evidence that the JSON file was written then removed. Clean up any leftover test workspace files.

---

## Self-Review

**Spec coverage (§1–§6):**
- One JSON file per workspace under `workspaces_dir`, opaque string → Task 1 (`save_to`/`load_from`) + Task 2 (commands). ✅
- `paths.rs` reuse (`workspaces_dir` + `atomic_write`) + remove `allow(dead_code)` → Tasks 1–2. ✅
- `validate_ws_name` (empty/`/`/`.`/`..`) + JSON-parse validation → Task 1. ✅
- `ws_save`/`ws_load`/`ws_list`/`ws_delete` commands + registration → Task 2. ✅
- `loadLayout` store action (fireDestroyed for dropped panels, clear selection) → Task 3. ✅
- IPC wrappers → Task 5. ✅
- ConfirmDialog moved to `components/` + FileView import updated → Task 4. ✅
- `WorkspaceMenu` (Save inline input, Load dropdown, Delete via ConfirmDialog, isTauri null, overwrite-silently, load-validates) mounted in Toolbar → Task 5. ✅
- Rust temp-dir tests (lifecycle, bad name/json, missing dir) + frontend tests (loadLayout, JSON round-trip) → Tasks 1, 3. ✅
- Manual GUI (save → change → load → delete + on-disk check) → Task 6. ✅

**Type consistency:** `loadLayout(layout: GridLayout)` defined in `layoutStore` (Task 3) is called in `WorkspaceMenu` (Task 5) with the `JSON.parse`d + validated `GridLayout`. IPC `wsSave(name, layout)`/`wsLoad(name)`/`wsList()`/`wsDelete(name)` (Task 5) ↔ Rust `ws_save(name, layout)`/`ws_load(name)`/`ws_list()`/`ws_delete(name)` (Task 2), Tauri camel↔snake auto-mapping. Pure fns `save_to`/`load_from`/`list_in`/`delete_in`/`validate_ws_name` (Task 1) called by the command wrappers (Task 2). `ConfirmDialog` props (`message`/`confirmLabel`/`onConfirm`/`onCancel`) unchanged across the move (Task 4) and used by both `FileView` and `WorkspaceMenu`.

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" — every code step carries full code. Task 6 is manual verification, correctly code-free.
