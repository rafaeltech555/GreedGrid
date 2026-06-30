# Panel Maximize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user temporarily blow one grid cell up to fill the whole grid (others hidden but kept alive in the background), then restore — driven by a per-cell `⛶` button and Esc.

**Architecture:** Maximize is pure-frontend, ephemeral UI state. A single `maximizedCellId` lives in `usePanelUiStore` (never persisted to `GridLayout`). `GridCell` renders the maximized cell as `position:absolute; inset:0` over the grid host and `display:none`s the rest (components stay mounted, so terminals/webviews keep running). `GridHost` hides splitters while maximized and auto-restores when the target cell vanishes or select-mode is entered. Native web panels float above the DOM, so `useWebSuppressed` becomes per-instance: hide every web panel except the maximized one; the maximized web panel's DOM slot physically grows, so its existing ResizeObserver re-bounds it automatically.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest + @testing-library/react, Tailwind. (No backend / Rust changes in Stage A.)

This plan implements **Stage A** of `docs/superpowers/specs/2026-06-29-panel-maximize-and-idle-reminder-design.md`. Stage B (IDLE) is a separate plan.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/panels/panelUiStore.ts` | Holds ephemeral `maximizedCellId` + `maximizeCell`/`restoreCell`/`toggleMaximize`. | Modify |
| `src/panels/panelUiStore.test.ts` | Unit tests for the new state/actions. | Modify |
| `src/grid/maximize.ts` | Pure helper `shouldRestoreMaximize(cells, maximizedCellId, selectMode)`. | Create |
| `src/grid/maximize.test.ts` | Unit tests for the helper. | Create |
| `src/grid/MaximizeButton.tsx` | Reusable `⛶`/`⧉` toggle button (reads store, calls `toggleMaximize`). | Create |
| `src/grid/MaximizeButton.test.tsx` | Component tests for the button. | Create |
| `src/grid/GridCell.tsx` | Absolute/hidden render special-case + mount `MaximizeButton` in the three chrome spots. | Modify |
| `src/grid/GridCell.test.tsx` | Render tests for maximized/hidden cells. | Modify |
| `src/grid/GridHost.tsx` | Hide splitters while maximized; auto-restore effect; Esc-to-restore. | Modify |
| `src/grid/GridHost.test.tsx` | Tests for splitter hiding, auto-restore, Esc. | Create |
| `src/panels/web/useWebSuppressed.ts` | Per-instance suppression (extract pure `isWebSuppressed`, add maximize). | Modify |
| `src/panels/web/useWebSuppressed.test.ts` | Unit tests for `isWebSuppressed`. | Create |
| `src/panels/web/WebPanel.tsx` | Pass `instanceId` to `useWebSuppressed`; add `MaximizeButton` to `WebChrome`. | Modify |

---

## Task 1: Maximize state in `panelUiStore`

**Files:**
- Modify: `src/panels/panelUiStore.ts`
- Test: `src/panels/panelUiStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/panels/panelUiStore.test.ts` (inside the top-level `describe("panelUiStore", …)` block, after the existing `dropMenu` describe):

```ts
  describe("maximize", () => {
    it("defaults maximizedCellId to null", () => {
      expect(u().maximizedCellId).toBeNull();
    });

    it("maximizeCell sets the id, restoreCell clears it", () => {
      u().maximizeCell("c1-r1");
      expect(u().maximizedCellId).toBe("c1-r1");
      u().restoreCell();
      expect(u().maximizedCellId).toBeNull();
    });

    it("toggleMaximize sets when different, clears when same", () => {
      u().toggleMaximize("c1-r1");
      expect(u().maximizedCellId).toBe("c1-r1");
      u().toggleMaximize("c1-r1");
      expect(u().maximizedCellId).toBeNull();
    });

    it("toggleMaximize switches target when another cell is maximized", () => {
      u().maximizeCell("c1-r1");
      u().toggleMaximize("c2-r1");
      expect(u().maximizedCellId).toBe("c2-r1");
    });
  });
```

Also extend the top-level `beforeEach` reset so each test starts clean:

```ts
beforeEach(() =>
  usePanelUiStore.setState({
    pickerCellId: null,
    modal: null,
    dropMenu: null,
    maximizedCellId: null,
  }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/panels/panelUiStore.test.ts`
Expected: FAIL — `maximizedCellId`/`maximizeCell`/`restoreCell`/`toggleMaximize` do not exist on the store type/object.

- [ ] **Step 3: Implement the state and actions**

In `src/panels/panelUiStore.ts`, add to the `PanelUiState` interface (after `workspaceMenuOpen`):

```ts
  /** Cell currently blown up to fill the whole grid, if any (never persisted). */
  maximizedCellId: string | null;
```

And to the actions section of the interface (after `setWorkspaceMenuOpen`):

```ts
  maximizeCell: (cellId: string) => void;
  restoreCell: () => void;
  toggleMaximize: (cellId: string) => void;
```

In the `create<PanelUiState>` body, add the initial value (after `workspaceMenuOpen: false,`):

```ts
  maximizedCellId: null,
```

And the actions (after `setWorkspaceMenuOpen`):

```ts
  maximizeCell: (cellId) => set({ maximizedCellId: cellId }),
  restoreCell: () => set({ maximizedCellId: null }),
  toggleMaximize: (cellId) =>
    set((s) => ({
      maximizedCellId: s.maximizedCellId === cellId ? null : cellId,
    })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/panels/panelUiStore.test.ts`
Expected: PASS (all, including the existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/panelUiStore.ts src/panels/panelUiStore.test.ts
git commit -m "feat(panel): add ephemeral maximizedCellId state to panelUiStore"
```

---

## Task 2: Pure auto-restore guard (`maximize.ts`)

The maximized cell must auto-restore when it disappears (merge/split/preset switch/workspace load) or when select-mode is entered (spec A.5). Extract that decision as a pure function so it is trivially unit-testable; `GridHost` will call it from an effect in Task 5.

**Files:**
- Create: `src/grid/maximize.ts`
- Test: `src/grid/maximize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/grid/maximize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldRestoreMaximize } from "./maximize";
import type { Cell } from "../lib/types";

const cell = (id: string): Cell => ({
  id,
  col: 1,
  row: 1,
  colSpan: 1,
  rowSpan: 1,
  panel: null,
});

describe("shouldRestoreMaximize", () => {
  it("returns false when nothing is maximized", () => {
    expect(shouldRestoreMaximize([cell("a")], null, false)).toBe(false);
  });

  it("returns false when the maximized cell still exists and not selecting", () => {
    expect(shouldRestoreMaximize([cell("a"), cell("b")], "a", false)).toBe(
      false,
    );
  });

  it("returns true when the maximized cell no longer exists", () => {
    expect(shouldRestoreMaximize([cell("b")], "a", false)).toBe(true);
  });

  it("returns true when select mode is entered while maximized", () => {
    expect(shouldRestoreMaximize([cell("a")], "a", true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/grid/maximize.test.ts`
Expected: FAIL — `Cannot find module './maximize'`.

- [ ] **Step 3: Implement the helper**

Create `src/grid/maximize.ts`:

```ts
import type { Cell } from "../lib/types";

/**
 * Whether a currently-maximized cell must be restored. True when nothing keeps
 * the maximize valid: the target cell vanished (merge/split/preset/workspace
 * load) or the user entered select mode (maximize and selection must not
 * coexist — spec A.5). False when nothing is maximized.
 */
export function shouldRestoreMaximize(
  cells: Cell[],
  maximizedCellId: string | null,
  selectMode: boolean,
): boolean {
  if (maximizedCellId === null) return false;
  if (selectMode) return true;
  return !cells.some((c) => c.id === maximizedCellId);
}
```

> Note: confirm the `Cell` import path/shape against `src/lib/types.ts`; the test's `cell()` factory must match the real `Cell` fields (adjust if `Cell` has more required fields).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/grid/maximize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grid/maximize.ts src/grid/maximize.test.ts
git commit -m "feat(grid): add shouldRestoreMaximize guard helper"
```

---

## Task 3: `MaximizeButton` component

One reusable button used in all three chrome spots (populated non-web chrome, empty cell, web chrome). Shows `⛶` to maximize and `⧉` to restore; click toggles.

**Files:**
- Create: `src/grid/MaximizeButton.tsx`
- Test: `src/grid/MaximizeButton.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/grid/MaximizeButton.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MaximizeButton } from "./MaximizeButton";
import { usePanelUiStore } from "../panels/panelUiStore";

beforeEach(() => usePanelUiStore.setState({ maximizedCellId: null }));
afterEach(cleanup);

describe("MaximizeButton", () => {
  it("shows the maximize affordance when not maximized and maximizes on click", () => {
    render(<MaximizeButton cellId="c1-r1" />);
    const btn = screen.getByRole("button", { name: "Maximize panel" });
    fireEvent.click(btn);
    expect(usePanelUiStore.getState().maximizedCellId).toBe("c1-r1");
  });

  it("shows the restore affordance when this cell is maximized and restores on click", () => {
    usePanelUiStore.setState({ maximizedCellId: "c1-r1" });
    render(<MaximizeButton cellId="c1-r1" />);
    const btn = screen.getByRole("button", { name: "Restore panel" });
    fireEvent.click(btn);
    expect(usePanelUiStore.getState().maximizedCellId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/grid/MaximizeButton.test.tsx`
Expected: FAIL — `Cannot find module './MaximizeButton'`.

- [ ] **Step 3: Implement the component**

Create `src/grid/MaximizeButton.tsx`:

```tsx
import { usePanelUiStore } from "../panels/panelUiStore";

interface MaximizeButtonProps {
  cellId: string;
  /** Extra classes so callers can match their chrome's button styling. */
  className?: string;
}

/**
 * Toggle a cell between maximized (fills the grid) and normal. Shared by the
 * populated-panel chrome, the empty-cell chrome, and the web panel's own bar.
 */
export function MaximizeButton({ cellId, className = "" }: MaximizeButtonProps) {
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const toggleMaximize = usePanelUiStore((s) => s.toggleMaximize);
  const isMaximized = maximizedCellId === cellId;

  return (
    <button
      type="button"
      aria-label={isMaximized ? "Restore panel" : "Maximize panel"}
      title={isMaximized ? "Restore (Esc)" : "Maximize"}
      onClick={(e) => {
        e.stopPropagation();
        toggleMaximize(cellId);
      }}
      className={className}
    >
      {isMaximized ? "⧉" : "⛶"}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/grid/MaximizeButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grid/MaximizeButton.tsx src/grid/MaximizeButton.test.tsx
git commit -m "feat(grid): add reusable MaximizeButton toggle"
```

---

## Task 4: `GridCell` maximize rendering + buttons

Make the maximized cell fill the grid host, hide the others (kept mounted), and wire `MaximizeButton` into the populated-panel chrome and the empty-cell affordance. (The web panel chrome gets its button in Task 6.)

**Files:**
- Modify: `src/grid/GridCell.tsx`
- Test: `src/grid/GridCell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/grid/GridCell.test.tsx` a new describe (after the existing tests; reuse the file's existing `beforeEach` which sets a 4-cell preset). It renders two cells and checks the maximized one is absolute while the other is hidden:

```tsx
import { GridHost } from "./GridHost"; // add to existing imports at top of file

describe("GridCell maximize rendering", () => {
  it("maximized cell is absolute/inset and others are display:none but still mounted", () => {
    const ids = useLayoutStore.getState().layout.cells.map((c) => c.id);
    usePanelUiStore.setState({ maximizedCellId: ids[0] });
    render(<GridHost />);

    const max = screen.getByTestId(`cell-${ids[0]}`);
    const other = screen.getByTestId(`cell-${ids[1]}`);

    expect(max.style.position).toBe("absolute");
    expect(other.style.display).toBe("none");
    // Hidden cell is still in the DOM (component kept alive).
    expect(other).toBeTruthy();
  });

  it("renders a Maximize button in populated-panel chrome", () => {
    const id = useLayoutStore.getState().layout.cells[0].id;
    useLayoutStore.getState().setPanel(id, "terminal");
    render(<GridCell cell={useLayoutStore.getState().layout.cells[0]} />);
    expect(
      screen.getByRole("button", { name: "Maximize panel" }),
    ).toBeTruthy();
  });
});
```

> Note: `terminalDef` registered in this file's `beforeEach` has `selfChrome` unset (falsy), so it uses the host hover chrome — correct for asserting the Maximize button shows there. Confirm `setPanel(id, "terminal")` is the real layoutStore signature (it is, per `GridCell.tsx`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/grid/GridCell.test.tsx`
Expected: FAIL — no `Maximize panel` button; maximized cell has no `position:absolute`.

- [ ] **Step 3: Implement the rendering changes**

In `src/grid/GridCell.tsx`:

Add imports near the top:

```tsx
import { MaximizeButton } from "./MaximizeButton";
```

Read maximize state alongside the other store reads (after the existing `usePanelUiStore` selectors, e.g. after `openEditModal`):

```tsx
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const isMaximized = maximizedCellId === cell.id;
  const hiddenByMaximize = maximizedCellId !== null && !isMaximized;
```

Replace the outer `<div>`'s `style` prop. Current:

```tsx
      style={{
        gridColumn: `${cell.col} / span ${cell.colSpan}`,
        gridRow: `${cell.row} / span ${cell.rowSpan}`,
      }}
```

with a computed style that lifts the maximized cell out of the grid flow and hides the others:

```tsx
      style={
        isMaximized
          ? { position: "absolute", inset: 0, zIndex: 30 }
          : hiddenByMaximize
            ? { display: "none" }
            : {
                gridColumn: `${cell.col} / span ${cell.colSpan}`,
                gridRow: `${cell.row} / span ${cell.rowSpan}`,
              }
      }
```

Add `MaximizeButton` to the populated-panel chrome row. Find the chrome `<div>` inside the `{!panelDef.selfChrome && (…)}` block and insert the button as the **first** child (before the `⠿` move button), styled like its siblings:

```tsx
              <MaximizeButton
                cellId={cell.id}
                className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
              />
```

Add a hover Maximize affordance to the **empty cell** branch. Replace the empty-cell `else` branch:

```tsx
      ) : (
        <button
          onClick={() => openPicker(cell.id)}
          className="flex h-full w-full items-center justify-center text-2xl text-white/20 hover:text-emerald-300"
        >
          +
        </button>
      )}
```

with one that also carries a corner Maximize button:

```tsx
      ) : (
        <>
          <button
            onClick={() => openPicker(cell.id)}
            className="flex h-full w-full items-center justify-center text-2xl text-white/20 hover:text-emerald-300"
          >
            +
          </button>
          <div className="absolute right-1 top-1 hidden group-hover:flex">
            <MaximizeButton
              cellId={cell.id}
              className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
            />
          </div>
        </>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/grid/GridCell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridCell.tsx src/grid/GridCell.test.tsx
git commit -m "feat(grid): maximize cell fills grid; others hidden but mounted"
```

---

## Task 5: `GridHost` — hide splitters, auto-restore, Esc

While maximized, splitters must not render, and the maximize must auto-restore when the target cell vanishes or select-mode is entered (Task 2 helper). Esc restores.

**Files:**
- Modify: `src/grid/GridHost.tsx`
- Test: `src/grid/GridHost.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/grid/GridHost.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, cleanup } from "@testing-library/react";
import { GridHost } from "./GridHost";
import { useLayoutStore } from "../store/layoutStore";
import { usePanelUiStore } from "../panels/panelUiStore";
import { makePreset } from "./presets";

beforeEach(() => {
  useLayoutStore.setState({
    layout: makePreset(4),
    selectedIds: [],
    selectMode: false,
  });
  usePanelUiStore.setState({ maximizedCellId: null });
});
afterEach(cleanup);

describe("GridHost maximize integration", () => {
  it("renders no splitters while a cell is maximized", () => {
    const { container, rerender } = render(<GridHost />);
    // Splitters are role="separator" (see Splitter.tsx); baseline has some.
    const before = container.querySelectorAll('[role="separator"]').length;
    expect(before).toBeGreaterThan(0);

    const id = useLayoutStore.getState().layout.cells[0].id;
    usePanelUiStore.setState({ maximizedCellId: id });
    rerender(<GridHost />);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  it("auto-restores when the maximized cell disappears", () => {
    const id = useLayoutStore.getState().layout.cells[0].id;
    usePanelUiStore.setState({ maximizedCellId: id });
    render(<GridHost />);
    // Swap to a preset where that id no longer exists.
    useLayoutStore.getState().loadLayout(makePreset(2));
    expect(usePanelUiStore.getState().maximizedCellId).toBeNull();
  });

  it("auto-restores when select mode is entered", () => {
    const id = useLayoutStore.getState().layout.cells[0].id;
    usePanelUiStore.setState({ maximizedCellId: id });
    render(<GridHost />);
    useLayoutStore.getState().setSelectMode(true);
    expect(usePanelUiStore.getState().maximizedCellId).toBeNull();
  });

  it("restores on Escape", () => {
    const id = useLayoutStore.getState().layout.cells[0].id;
    usePanelUiStore.setState({ maximizedCellId: id });
    render(<GridHost />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(usePanelUiStore.getState().maximizedCellId).toBeNull();
  });
});
```

> Note: confirm `Splitter.tsx` renders `role="separator"`. If it does not, change both `querySelectorAll` selectors to whatever the splitter's stable attribute is (e.g. a `data-testid` or class). Read `src/grid/Splitter.tsx` before writing the assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/grid/GridHost.test.tsx`
Expected: FAIL — splitters still render while maximized; no auto-restore; Esc does nothing.

- [ ] **Step 3: Implement the GridHost changes**

In `src/grid/GridHost.tsx`:

Add imports / store reads. Add to the top imports:

```tsx
import { useEffect } from "react";
import { shouldRestoreMaximize } from "./maximize";
```

(Merge `useEffect` into the existing `import { useCallback, useRef } from "react";` line.)

Inside `GridHost()`, after the existing `const layout = …` / `setCols` / `setRows` reads, add:

```tsx
  const selectMode = useLayoutStore((s) => s.selectMode);
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const restoreCell = usePanelUiStore((s) => s.restoreCell);

  // Restore the maximize when its target cell vanishes (merge/split/preset/
  // workspace load) or when select mode is entered (spec A.5).
  useEffect(() => {
    if (shouldRestoreMaximize(layout.cells, maximizedCellId, selectMode)) {
      restoreCell();
    }
  }, [layout.cells, maximizedCellId, selectMode, restoreCell]);

  // Esc restores. Independent of Toolbar's select-mode Esc: the two states are
  // mutually exclusive (entering select restores maximize, above), so they
  // never both consume the same Escape.
  useEffect(() => {
    if (maximizedCellId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") restoreCell();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [maximizedCellId, restoreCell]);
```

Wrap **both** splitter blocks so they render nothing while maximized. Change the column splitters block opener from:

```tsx
      {colCenters.flatMap((pos, i) =>
```

to:

```tsx
      {maximizedCellId === null && colCenters.flatMap((pos, i) =>
```

and likewise the row splitters block from:

```tsx
      {rowCenters.flatMap((pos, i) =>
```

to:

```tsx
      {maximizedCellId === null && rowCenters.flatMap((pos, i) =>
```

(Each block already ends with `)}` — the `&&` short-circuits to `false`, which React renders as nothing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/grid/GridHost.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridHost.tsx src/grid/GridHost.test.tsx
git commit -m "feat(grid): hide splitters + auto-restore + Esc for maximize"
```

---

## Task 6: Web panel webview sync (per-instance suppression)

Native webviews float above the DOM, so `display:none` cannot hide them — they must be hidden via `webSetVisible`. Maximize becomes a new per-instance suppression source: hide every web panel except the maximized one. The maximized web panel's DOM slot physically grows (its cell is now `absolute inset:0`), so its existing ResizeObserver re-bounds it to the enlarged rect automatically — no bounds math needed here.

**Files:**
- Modify: `src/panels/web/useWebSuppressed.ts`
- Create: `src/panels/web/useWebSuppressed.test.ts`
- Modify: `src/panels/web/WebPanel.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/panels/web/useWebSuppressed.test.ts` (tests the pure helper introduced below):

```ts
import { describe, expect, it } from "vitest";
import { isWebSuppressed } from "./useWebSuppressed";

const base = {
  modalOpen: false,
  dropMenuOpen: false,
  workspaceMenuOpen: false,
  selectMode: false,
  maximizedCellId: null as string | null,
  myCellId: "c1-r1" as string | undefined,
};

describe("isWebSuppressed", () => {
  it("is false in the idle baseline", () => {
    expect(isWebSuppressed(base)).toBe(false);
  });

  it("is true when a modal / dropMenu / workspace menu / select mode is active", () => {
    expect(isWebSuppressed({ ...base, modalOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, dropMenuOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, workspaceMenuOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, selectMode: true })).toBe(true);
  });

  it("is false for the web panel that IS maximized", () => {
    expect(
      isWebSuppressed({ ...base, maximizedCellId: "c1-r1", myCellId: "c1-r1" }),
    ).toBe(false);
  });

  it("is true for a web panel that is NOT the maximized cell", () => {
    expect(
      isWebSuppressed({ ...base, maximizedCellId: "c2-r1", myCellId: "c1-r1" }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/panels/web/useWebSuppressed.test.ts`
Expected: FAIL — `isWebSuppressed` is not exported.

- [ ] **Step 3: Implement per-instance suppression**

Replace the entire body of `src/panels/web/useWebSuppressed.ts`:

```ts
import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

interface SuppressionFlags {
  modalOpen: boolean;
  dropMenuOpen: boolean;
  workspaceMenuOpen: boolean;
  selectMode: boolean;
  maximizedCellId: string | null;
  myCellId: string | undefined;
}

/** Pure suppression decision for one web panel. Hidden by any screen-level
 *  overlay/select-mode, OR when another cell is maximized (this one is covered).
 *  Visible when it is itself the maximized cell. */
export function isWebSuppressed(f: SuppressionFlags): boolean {
  const hiddenByMaximize =
    f.maximizedCellId !== null && f.maximizedCellId !== f.myCellId;
  return (
    f.modalOpen ||
    f.dropMenuOpen ||
    f.workspaceMenuOpen ||
    f.selectMode ||
    hiddenByMaximize
  );
}

/**
 * Whether this web panel's native webview should be hidden right now. Native
 * webviews float above the DOM, so any screen-level overlay (config modal,
 * folder-drop menu, workspace dropdown), select-mode, or a maximize of a
 * different cell must hide it.
 */
export function useWebSuppressed(instanceId: string): boolean {
  const modal = usePanelUiStore((s) => s.modal);
  const dropMenu = usePanelUiStore((s) => s.dropMenu);
  const workspaceMenuOpen = usePanelUiStore((s) => s.workspaceMenuOpen);
  const maximizedCellId = usePanelUiStore((s) => s.maximizedCellId);
  const selectMode = useLayoutStore((s) => s.selectMode);
  const myCellId = useLayoutStore(
    (s) => s.layout.cells.find((c) => c.panel?.instanceId === instanceId)?.id,
  );
  return isWebSuppressed({
    modalOpen: modal !== null,
    dropMenuOpen: dropMenu !== null,
    workspaceMenuOpen,
    selectMode,
    maximizedCellId,
    myCellId,
  });
}
```

- [ ] **Step 4: Update the caller + add the web chrome button**

In `src/panels/web/WebPanel.tsx`:

Change the suppression call inside `WebView` from:

```tsx
  const suppressed = useWebSuppressed();
```

to:

```tsx
  const suppressed = useWebSuppressed(instanceId);
```

Add the `MaximizeButton` to `WebChrome`. Add the import at the top:

```tsx
import { MaximizeButton } from "../../grid/MaximizeButton";
```

Inside `WebChrome`, insert the button into the controls row (before the `↻` reload button), guarded by `cellId` (already derived in `WebChrome`):

```tsx
        {cellId && <MaximizeButton cellId={cellId} className={btn} />}
```

- [ ] **Step 5: Run the full web/grid suites to verify nothing regressed**

Run: `npx vitest run src/panels/web/useWebSuppressed.test.ts src/grid/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/panels/web/useWebSuppressed.ts src/panels/web/useWebSuppressed.test.ts src/panels/web/WebPanel.tsx
git commit -m "feat(web): per-instance suppression so maximize hides/grows webviews"
```

---

## Task 7: Full suite + lint, then native GUI verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend test suite**

Run: `npx vitest run`
Expected: PASS (no regressions across all suites).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build` (or the project's tsc/eslint scripts — check `package.json` `scripts`).
Expected: no type errors, no lint errors.

- [ ] **Step 3: Native GUI verification (spec A.6)**

Use the `verify-tauri-gui` skill / `greedgrid-gui-verify-recipe` to launch the real Tauri window and confirm:

1. Place panels in ≥2 cells (include one **web** panel and one terminal). Click a terminal cell's `⛶` → it fills the grid; the others vanish; the terminal keeps running (scrollback intact). Press **Esc** → original layout returns.
2. Maximize the **web** panel → its native webview grows to fill the grid (bounds correct, not stuck at the old cell rect).
3. With a different cell maximized, confirm the web panel's webview is **not** still floating over the screen (it must be hidden via `webSetVisible(false)`).
4. While maximized, open the config modal (⚙ on the maximized panel) → modal still overlays the maximized cell (z-order correct). Close it.
5. Switch a layout preset while maximized → maximize auto-restores (no crash, no orphaned absolute cell).

Record screenshots per the recipe.

- [ ] **Step 4: Update memory**

Update `maximize-and-idle-reminder-spec.md` (or add a new memory) noting Stage A (Maximize) is implemented + GUI-verified, and Stage B is the remaining plan. Follow the memory conventions in the project instructions.

---

## Self-Review (spec coverage)

- A.1 state (`maximizedCellId`, `maximizeCell`/`restoreCell`/`toggleMaximize`, not persisted) → Task 1. Auto-restore on preset/merge/split/load/cell-gone → Task 2 + Task 5.
- A.2 render (maximized absolute/inset; others `display:none` but mounted; splitters hidden) → Task 4 + Task 5.
- A.3 trigger (`⛶` button per cell; toggle; Esc) → Task 3 (button), Task 4 (wiring), Task 5 (Esc).
- A.4 web webview sync (maximized web re-bounds; others `webSetVisible(false)`; OR-integrated with existing suppression) → Task 6.
- A.5 edges (maximize empty cell; restore-first on select/merge/split; switch target) → empty-cell button (Task 4), select-mode auto-restore (Task 2/5), `toggleMaximize` switch (Task 1).
- A.6 tests (unit/component/native GUI) → Tasks 1–7.

**Pre-verified facts (checked against the code at plan time):** `Splitter.tsx` renders `role="separator"` (used by the Task 5 selector) and sits at `z-10`, below the maximized cell's `z-30`. `Cell` in `src/lib/types.ts` is exactly `{ id, col, row, colSpan, rowSpan, panel }` — the Task 2 test factory matches it.
