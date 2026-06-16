# M2 — Pluggable Panels (Frontend Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GreedGrid's pluggable panel-type interface, panel placement UX (empty-cell click + side palette drag), a unified config dialog, and the Web/URL panel (iframe), entirely on the frontend with no Rust changes.

**Architecture:** A frontend panel registry maps each `PanelKind` to a `PanelTypeDef` (label, glyph, defaultConfig, ready, ConfigForm, View, onDestroy). The Zustand `layoutStore` gains `setPanel`/`updatePanelConfig`/`clearPanel`; every layout mutation runs a pure `panelsRemoved` diff and fires `onDestroy` for vanished panels. Ephemeral UI state (which cell's picker/modal is open) lives in a separate `panelUiStore`. The Web panel renders a URL in an iframe; the native-webview fallback and the Terminal panel are deferred to their own plans.

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind v4, Vitest 3 + @testing-library/react 16 + @testing-library/user-event 14.

**Spec:** `docs/superpowers/specs/2026-06-16-m2-m3-panels-design.md` (§1, §2, §3 iframe path).

---

## File Structure

**Create:**
- `src/panels/types.ts` — `PanelTypeDef` interface + prop types.
- `src/panels/lifecycle.ts` — pure `panelsRemoved(before, after)` diff.
- `src/panels/registry.ts` — register/lookup of panel types.
- `src/panels/dnd.ts` — pure `resolveDropTarget` helper for palette drag.
- `src/panels/panelUiStore.ts` — ephemeral picker/modal UI state.
- `src/panels/ConfigModal.tsx` — shared config modal shell.
- `src/panels/PanelPicker.tsx` — panel-type chooser popover for an empty cell.
- `src/panels/Palette.tsx` — left-column draggable list of panel types.
- `src/panels/web/types.ts` — `WebConfig` + `webReady`.
- `src/panels/web/WebPanel.tsx` — iframe View + ConfigForm.
- `src/panels/web/index.ts` — the web `PanelTypeDef`.
- `src/panels/index.ts` — registers all panels (import once at app start).

**Modify:**
- `src/store/layoutStore.ts` — add panel actions + fire `onDestroy` on every mutation.
- `src/grid/GridCell.tsx` — render panel View, empty-cell `+`, gear/✕ controls, drop target.
- `src/App.tsx` — register panels, mount `Palette` + `ConfigModal`.

---

## Task 1: `panelsRemoved` lifecycle diff

**Files:**
- Create: `src/panels/lifecycle.ts`
- Test: `src/panels/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { panelsRemoved } from "./lifecycle";
import type { GridLayout, PanelConfig } from "../lib/types";

const panel = (instanceId: string): PanelConfig => ({
  instanceId,
  kind: "web",
  config: { url: "https://x" },
});

const layout = (panels: (PanelConfig | null)[]): GridLayout => ({
  grid: { cols: [1], rows: [1], gap: 4 },
  cells: panels.map((p, i) => ({
    id: `c${i}`,
    col: i + 1,
    row: 1,
    colSpan: 1,
    rowSpan: 1,
    panel: p,
  })),
});

describe("panelsRemoved", () => {
  it("returns panels present before but gone after", () => {
    const before = layout([panel("a"), panel("b")]);
    const after = layout([panel("a"), null]);
    expect(panelsRemoved(before, after).map((p) => p.instanceId)).toEqual(["b"]);
  });

  it("returns nothing when all instanceIds survive", () => {
    const before = layout([panel("a")]);
    const after = layout([panel("a")]);
    expect(panelsRemoved(before, after)).toEqual([]);
  });

  it("treats a replaced instanceId in the same cell as removed", () => {
    const before = layout([panel("a")]);
    const after = layout([panel("z")]);
    expect(panelsRemoved(before, after).map((p) => p.instanceId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/lifecycle.test.ts`
Expected: FAIL — cannot resolve `./lifecycle`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { GridLayout, PanelConfig } from "../lib/types";

/** Panels present in `before` whose `instanceId` is absent from `after`. */
export function panelsRemoved(
  before: GridLayout,
  after: GridLayout,
): PanelConfig[] {
  const liveIds = new Set(
    after.cells
      .filter((c) => c.panel)
      .map((c) => (c.panel as PanelConfig).instanceId),
  );
  return before.cells
    .filter((c) => c.panel && !liveIds.has((c.panel as PanelConfig).instanceId))
    .map((c) => c.panel as PanelConfig);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/lifecycle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/lifecycle.ts src/panels/lifecycle.test.ts
git commit -m "M2: panelsRemoved lifecycle diff"
```

---

## Task 2: Panel registry + types

**Files:**
- Create: `src/panels/types.ts`
- Create: `src/panels/registry.ts`
- Test: `src/panels/registry.test.ts`

- [ ] **Step 1: Write `src/panels/types.ts`** (no test — pure types)

```ts
import type { ReactNode } from "react";
import type { PanelKind } from "../lib/types";

/** Props the host passes to a panel's live content view. */
export interface PanelViewProps {
  instanceId: string;
  config: Record<string, unknown>;
}

/** Props the host passes to a panel's config form (inside the modal). */
export interface ConfigFormProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

/**
 * One pluggable panel type. The host only knows this interface; adding a new
 * panel never touches grid/host code. `config` is the opaque-to-host record
 * stored in `PanelConfig.config`; each panel casts it to its own typed shape.
 */
export interface PanelTypeDef {
  kind: PanelKind;
  label: string;
  glyph: string;
  defaultConfig: () => Record<string, unknown>;
  ready: (config: Record<string, unknown>) => boolean;
  ConfigForm: (props: ConfigFormProps) => ReactNode;
  View: (props: PanelViewProps) => ReactNode;
  onDestroy?: (instanceId: string, config: Record<string, unknown>) => void;
}
```

- [ ] **Step 2: Write the failing test for the registry**

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  __clearRegistry,
  allPanelTypes,
  getPanelType,
  registerPanel,
} from "./registry";
import type { PanelTypeDef } from "./types";

const fakeDef = (kind: PanelTypeDef["kind"]): PanelTypeDef => ({
  kind,
  label: kind,
  glyph: "?",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => null,
});

afterEach(() => __clearRegistry());

describe("panel registry", () => {
  it("registers and looks up by kind", () => {
    registerPanel(fakeDef("web"));
    expect(getPanelType("web")?.kind).toBe("web");
  });

  it("returns undefined for an unregistered kind", () => {
    expect(getPanelType("terminal")).toBeUndefined();
  });

  it("allPanelTypes lists every registered def", () => {
    registerPanel(fakeDef("web"));
    registerPanel(fakeDef("terminal"));
    expect(allPanelTypes().map((d) => d.kind).sort()).toEqual([
      "terminal",
      "web",
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/panels/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 4: Write `src/panels/registry.ts`**

```ts
import type { PanelKind } from "../lib/types";
import type { PanelTypeDef } from "./types";

const registry: Partial<Record<PanelKind, PanelTypeDef>> = {};

/** Register a panel type. Called once per panel module at app start. */
export function registerPanel(def: PanelTypeDef): void {
  registry[def.kind] = def;
}

/** Look up a registered panel type, or undefined if not implemented yet. */
export function getPanelType(kind: PanelKind): PanelTypeDef | undefined {
  return registry[kind];
}

/** All currently-registered panel types (for the palette / picker). */
export function allPanelTypes(): PanelTypeDef[] {
  return Object.values(registry) as PanelTypeDef[];
}

/** Test-only: wipe the registry between tests. */
export function __clearRegistry(): void {
  for (const k of Object.keys(registry) as PanelKind[]) {
    delete registry[k];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/panels/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/panels/types.ts src/panels/registry.ts src/panels/registry.test.ts
git commit -m "M2: panel type interface + registry"
```

---

## Task 3: Store panel actions (`setPanel` / `updatePanelConfig` / `clearPanel`) + onDestroy wiring

**Files:**
- Modify: `src/store/layoutStore.ts`
- Test: `src/store/layoutStore.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests** (append to the existing `describe("layoutStore", ...)` block)

```ts
import { afterEach } from "vitest";
import { __clearRegistry, registerPanel } from "../panels/registry";
import type { PanelTypeDef } from "../panels/types";

// helper at top of file, after existing imports:
const destroyed: string[] = [];
const webDef: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
  ConfigForm: () => null,
  View: () => null,
  onDestroy: (instanceId) => destroyed.push(instanceId),
};

// inside describe, with its own beforeEach/afterEach:
describe("panel actions", () => {
  beforeEach(() => {
    destroyed.length = 0;
    __clearRegistry();
    registerPanel(webDef);
    useLayoutStore.setState({ layout: makePreset(4), selectedIds: [] });
  });
  afterEach(() => __clearRegistry());

  const idGen = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it("setPanel places a panel with a generated instanceId and default config", () => {
    s().setPanel(cellId(1, 1), "web", undefined, idGen());
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel).toEqual({
      instanceId: "id-1",
      kind: "web",
      config: { url: "" },
    });
  });

  it("setPanel honors an explicit initial config", () => {
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, idGen());
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.config).toEqual({ url: "https://a" });
  });

  it("updatePanelConfig replaces config but keeps instanceId", () => {
    s().setPanel(cellId(1, 1), "web", undefined, idGen());
    s().updatePanelConfig(cellId(1, 1), { url: "https://b" });
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.instanceId).toBe("id-1");
    expect(cell.panel?.config).toEqual({ url: "https://b" });
    expect(destroyed).toEqual([]);
  });

  it("clearPanel removes the panel and fires onDestroy", () => {
    s().setPanel(cellId(1, 1), "web", undefined, idGen());
    s().clearPanel(cellId(1, 1));
    expect(s().layout.cells.find((c) => c.id === cellId(1, 1))?.panel).toBeNull();
    expect(destroyed).toEqual(["id-1"]);
  });

  it("setPanel over an existing panel fires onDestroy for the old one", () => {
    s().setPanel(cellId(1, 1), "web", undefined, idGen());
    s().setPanel(cellId(1, 1), "web", { url: "https://c" }, () => "id-2");
    expect(destroyed).toEqual(["id-1"]);
  });

  it("applyPreset fires onDestroy for every existing panel", () => {
    s().setPanel(cellId(1, 1), "web", undefined, idGen());
    s().applyPreset(6);
    expect(destroyed).toEqual(["id-1"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/store/layoutStore.test.ts`
Expected: FAIL — `setPanel`/`updatePanelConfig`/`clearPanel` are not functions.

- [ ] **Step 3: Modify `src/store/layoutStore.ts`**

Add imports at the top:

```ts
import type { GridLayout, PanelKind } from "../lib/types";
import { getPanelType } from "../panels/registry";
import { panelsRemoved } from "../panels/lifecycle";
```

Add to the `LayoutState` interface:

```ts
  setPanel: (
    cellId: string,
    kind: PanelKind,
    initialConfig?: Record<string, unknown>,
    idGen?: () => string,
  ) => void;
  updatePanelConfig: (cellId: string, config: Record<string, unknown>) => void;
  clearPanel: (cellId: string) => void;
```

Add this helper above `useLayoutStore`:

```ts
/** Fire onDestroy for every panel that exists in `before` but not `after`. */
function fireDestroyed(before: GridLayout, after: GridLayout): void {
  for (const panel of panelsRemoved(before, after)) {
    getPanelType(panel.kind)?.onDestroy?.(panel.instanceId, panel.config);
  }
}
```

Replace the `applyPreset` action with one that fires onDestroy:

```ts
  applyPreset: (count) =>
    set((s) => {
      const after = makePreset(count);
      fireDestroyed(s.layout, after);
      return { layout: after, selectedIds: [] };
    }),
```

Replace the `mergeSelected` action body to fire onDestroy for absorbed panels:

```ts
  mergeSelected: () =>
    set((s) => {
      if (!canMerge(s.layout, s.selectedIds)) return s;
      const after = mergeCells(s.layout, s.selectedIds);
      fireDestroyed(s.layout, after);
      return { layout: after, selectedIds: [] };
    }),
```

Add the three new actions inside the store object:

```ts
  setPanel: (cellId, kind, initialConfig, idGen = () => crypto.randomUUID()) =>
    set((s) => {
      const def = getPanelType(kind);
      if (!def) return s;
      const after: GridLayout = {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId
            ? {
                ...c,
                panel: {
                  instanceId: idGen(),
                  kind,
                  config: initialConfig ?? def.defaultConfig(),
                },
              }
            : c,
        ),
      };
      fireDestroyed(s.layout, after);
      return { layout: after };
    }),

  updatePanelConfig: (cellId, config) =>
    set((s) => ({
      layout: {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId && c.panel
            ? { ...c, panel: { ...c.panel, config } }
            : c,
        ),
      },
    })),

  clearPanel: (cellId) =>
    set((s) => {
      const after: GridLayout = {
        ...s.layout,
        cells: s.layout.cells.map((c) =>
          c.id === cellId ? { ...c, panel: null } : c,
        ),
      };
      fireDestroyed(s.layout, after);
      return { layout: after };
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/store/layoutStore.test.ts`
Expected: PASS (existing tests + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/store/layoutStore.ts src/store/layoutStore.test.ts
git commit -m "M2: store panel actions with onDestroy lifecycle"
```

---

## Task 4: `resolveDropTarget` for palette drag

**Files:**
- Create: `src/panels/dnd.ts`
- Test: `src/panels/dnd.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveDropTarget } from "./dnd";
import type { Cell } from "../lib/types";

const cell = (id: string): Cell => ({
  id,
  col: 1,
  row: 1,
  colSpan: 1,
  rowSpan: 1,
  panel: null,
});

describe("resolveDropTarget", () => {
  it("returns the cell matching the drop id", () => {
    const cells = [cell("a"), cell("b")];
    expect(resolveDropTarget(cells, "b")?.id).toBe("b");
  });

  it("returns null when no cell matches", () => {
    expect(resolveDropTarget([cell("a")], "zzz")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/dnd.test.ts`
Expected: FAIL — cannot resolve `./dnd`.

- [ ] **Step 3: Write `src/panels/dnd.ts`**

```ts
import type { Cell } from "../lib/types";

/** MIME-ish key used to carry the dragged panel kind in a DnD transfer. */
export const PANEL_KIND_DND = "application/x-greedgrid-panel-kind";

/** The cell that should receive a drop on `dropCellId`, or null if unknown. */
export function resolveDropTarget(
  cells: Cell[],
  dropCellId: string,
): Cell | null {
  return cells.find((c) => c.id === dropCellId) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/dnd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/dnd.ts src/panels/dnd.test.ts
git commit -m "M2: resolveDropTarget + DnD transfer key"
```

---

## Task 5: Web panel (config type, View, ConfigForm, def)

**Files:**
- Create: `src/panels/web/types.ts`
- Create: `src/panels/web/WebPanel.tsx`
- Create: `src/panels/web/index.ts`
- Test: `src/panels/web/types.test.ts`

- [ ] **Step 1: Write the failing test for `webReady`**

```ts
import { describe, expect, it } from "vitest";
import { webReady } from "./types";

describe("webReady", () => {
  it("is false for empty or whitespace url", () => {
    expect(webReady({ url: "" })).toBe(false);
    expect(webReady({ url: "   " })).toBe(false);
    expect(webReady({})).toBe(false);
  });

  it("is true for a non-empty url", () => {
    expect(webReady({ url: "https://example.com" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/web/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write `src/panels/web/types.ts`**

```ts
/** Config for the Web/URL panel. */
export interface WebConfig {
  url: string;
}

/** A web panel is ready once it has a non-empty url. */
export function webReady(config: Record<string, unknown>): boolean {
  return typeof config.url === "string" && config.url.trim().length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/web/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `src/panels/web/WebPanel.tsx`**

```tsx
import type { ConfigFormProps, PanelViewProps } from "../types";
import type { WebConfig } from "./types";

/** Live view: render the configured URL in an iframe. */
export function WebView({ config }: PanelViewProps) {
  const url = (config as unknown as WebConfig).url;
  return (
    <iframe
      src={url}
      title={url}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
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
```

- [ ] **Step 6: Write `src/panels/web/index.ts`**

```ts
import type { PanelTypeDef } from "../types";
import { webReady } from "./types";
import { WebConfigForm, WebView } from "./WebPanel";

export const webPanel: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: webReady,
  ConfigForm: WebConfigForm,
  View: WebView,
};
```

- [ ] **Step 7: Commit**

```bash
git add src/panels/web
git commit -m "M2: web panel (iframe view + url config form)"
```

---

## Task 6: Panel registration entry point

**Files:**
- Create: `src/panels/index.ts`
- Test: `src/panels/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { __clearRegistry, getPanelType } from "./registry";
import { registerAllPanels } from "./index";

afterEach(() => __clearRegistry());

describe("registerAllPanels", () => {
  it("registers the web panel", () => {
    registerAllPanels();
    expect(getPanelType("web")?.label).toBe("Web");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/index.test.ts`
Expected: FAIL — `registerAllPanels` is not exported.

- [ ] **Step 3: Write `src/panels/index.ts`**

```ts
import { registerPanel } from "./registry";
import { webPanel } from "./web";

let registered = false;

/** Register every built-in panel type. Idempotent; call once at app start. */
export function registerAllPanels(): void {
  if (registered) return;
  registered = true;
  registerPanel(webPanel);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/index.test.ts`
Expected: PASS. (If the idempotent guard makes the test order-dependent, the `afterEach(__clearRegistry)` plus a fresh module per test file keeps it green; this single test passes on its own.)

- [ ] **Step 5: Commit**

```bash
git add src/panels/index.ts src/panels/index.test.ts
git commit -m "M2: panel registration entry point"
```

---

## Task 7: `panelUiStore` (ephemeral picker/modal state)

**Files:**
- Create: `src/panels/panelUiStore.ts`
- Test: `src/panels/panelUiStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePanelUiStore } from "./panelUiStore";

const u = () => usePanelUiStore.getState();

beforeEach(() =>
  usePanelUiStore.setState({ pickerCellId: null, modal: null }),
);

describe("panelUiStore", () => {
  it("opens and closes the picker", () => {
    u().openPicker("c1-r1");
    expect(u().pickerCellId).toBe("c1-r1");
    u().closePicker();
    expect(u().pickerCellId).toBeNull();
  });

  it("opens a create modal and a edit modal", () => {
    u().openCreateModal("c1-r1", "web");
    expect(u().modal).toEqual({ cellId: "c1-r1", kind: "web", mode: "create" });
    u().openEditModal("c2-r1", "web");
    expect(u().modal).toEqual({ cellId: "c2-r1", kind: "web", mode: "edit" });
    u().closeModal();
    expect(u().modal).toBeNull();
  });

  it("opening the picker closes any open modal", () => {
    u().openCreateModal("c1-r1", "web");
    u().openPicker("c2-r1");
    expect(u().modal).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/panelUiStore.test.ts`
Expected: FAIL — cannot resolve `./panelUiStore`.

- [ ] **Step 3: Write `src/panels/panelUiStore.ts`**

```ts
import { create } from "zustand";
import type { PanelKind } from "../lib/types";

/** Which cell + kind a config modal is editing, and whether it's a new place. */
export interface ModalState {
  cellId: string;
  kind: PanelKind;
  mode: "create" | "edit";
}

interface PanelUiState {
  /** Cell whose empty-cell type picker is open, if any. */
  pickerCellId: string | null;
  /** Open config modal, if any. */
  modal: ModalState | null;

  openPicker: (cellId: string) => void;
  closePicker: () => void;
  openCreateModal: (cellId: string, kind: PanelKind) => void;
  openEditModal: (cellId: string, kind: PanelKind) => void;
  closeModal: () => void;
}

export const usePanelUiStore = create<PanelUiState>((set) => ({
  pickerCellId: null,
  modal: null,

  openPicker: (cellId) => set({ pickerCellId: cellId, modal: null }),
  closePicker: () => set({ pickerCellId: null }),
  openCreateModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "create" }, pickerCellId: null }),
  openEditModal: (cellId, kind) =>
    set({ modal: { cellId, kind, mode: "edit" }, pickerCellId: null }),
  closeModal: () => set({ modal: null }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/panelUiStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/panelUiStore.ts src/panels/panelUiStore.test.ts
git commit -m "M2: ephemeral panel UI store (picker/modal)"
```

---

## Task 8: `PanelPicker` popover

**Files:**
- Create: `src/panels/PanelPicker.tsx`
- Test: `src/panels/PanelPicker.test.tsx`

The picker shows all registered panel types. Choosing one decides placement: if the type's `ready(defaultConfig())` is true it places immediately via `setPanel`; otherwise it opens a create modal.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelPicker } from "./PanelPicker";
import { __clearRegistry, registerPanel } from "./registry";
import type { PanelTypeDef } from "./types";

const def = (kind: PanelTypeDef["kind"], ready: boolean): PanelTypeDef => ({
  kind,
  label: kind.toUpperCase(),
  glyph: "x",
  defaultConfig: () => ({}),
  ready: () => ready,
  ConfigForm: () => null,
  View: () => null,
});

beforeEach(() => {
  __clearRegistry();
  registerPanel(def("web", false));
  registerPanel(def("sysmon", true));
});
afterEach(() => __clearRegistry());

describe("PanelPicker", () => {
  it("lists every registered panel type", () => {
    render(<PanelPicker onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /WEB/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SYSMON/ })).toBeInTheDocument();
  });

  it("calls onPick with the chosen kind", async () => {
    const onPick = vi.fn();
    render(<PanelPicker onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /WEB/ }));
    expect(onPick).toHaveBeenCalledWith("web");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/PanelPicker.test.tsx`
Expected: FAIL — cannot resolve `./PanelPicker`.

- [ ] **Step 3: Write `src/panels/PanelPicker.tsx`**

```tsx
import type { PanelKind } from "../lib/types";
import { allPanelTypes } from "./registry";

interface PanelPickerProps {
  onPick: (kind: PanelKind) => void;
}

/** A compact list of every registered panel type for an empty cell. */
export function PanelPicker({ onPick }: PanelPickerProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 p-2">
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
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/PanelPicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/PanelPicker.tsx src/panels/PanelPicker.test.tsx
git commit -m "M2: PanelPicker popover"
```

---

## Task 9: `ConfigModal` shell

**Files:**
- Create: `src/panels/ConfigModal.tsx`
- Test: `src/panels/ConfigModal.test.tsx`

The modal reads `usePanelUiStore().modal`. In `create` mode it seeds a draft from the type's `defaultConfig()`; in `edit` mode from the cell's current panel config. OK commits; Cancel discards.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigModal } from "./ConfigModal";
import { usePanelUiStore } from "./panelUiStore";
import { useLayoutStore } from "../store/layoutStore";
import { __clearRegistry, registerPanel } from "./registry";
import { makePreset } from "../grid/presets";
import { cellId } from "../grid/cellId";
import type { PanelTypeDef } from "./types";

const webDef: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
  ConfigForm: ({ config, onChange }) => (
    <input
      aria-label="url"
      value={(config.url as string) ?? ""}
      onChange={(e) => onChange({ ...config, url: e.target.value })}
    />
  ),
  View: () => null,
};

beforeEach(() => {
  __clearRegistry();
  registerPanel(webDef);
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [] });
  usePanelUiStore.setState({ pickerCellId: null, modal: null });
});
afterEach(() => __clearRegistry());

describe("ConfigModal", () => {
  it("renders nothing when no modal is open", () => {
    const { container } = render(<ConfigModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("create mode: OK places the panel with the edited config", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    await userEvent.type(screen.getByLabelText("url"), "https://a.com");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    const cell = useLayoutStore
      .getState()
      .layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.kind).toBe("web");
    expect(cell.panel?.config).toEqual({ url: "https://a.com" });
    expect(usePanelUiStore.getState().modal).toBeNull();
  });

  it("Cancel closes without placing", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const cell = useLayoutStore
      .getState()
      .layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel).toBeNull();
    expect(usePanelUiStore.getState().modal).toBeNull();
  });

  it("OK is disabled until ready()", async () => {
    usePanelUiStore.getState().openCreateModal(cellId(1, 1), "web");
    render(<ConfigModal />);
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("url"), "https://a.com");
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/ConfigModal.test.tsx`
Expected: FAIL — cannot resolve `./ConfigModal`.

- [ ] **Step 3: Write `src/panels/ConfigModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useLayoutStore } from "../store/layoutStore";
import { getPanelType } from "./registry";
import { usePanelUiStore } from "./panelUiStore";

/** Shared modal that hosts a panel type's ConfigForm for create/edit. */
export function ConfigModal() {
  const modal = usePanelUiStore((s) => s.modal);
  const closeModal = usePanelUiStore((s) => s.closeModal);
  const setPanel = useLayoutStore((s) => s.setPanel);
  const updatePanelConfig = useLayoutStore((s) => s.updatePanelConfig);
  const cells = useLayoutStore((s) => s.layout.cells);

  const def = modal ? getPanelType(modal.kind) : undefined;
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!modal || !def) return;
    if (modal.mode === "edit") {
      const cell = cells.find((c) => c.id === modal.cellId);
      setDraft({ ...(cell?.panel?.config ?? def.defaultConfig()) });
    } else {
      setDraft({ ...def.defaultConfig() });
    }
    // Re-seed only when the modal identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.cellId, modal?.kind, modal?.mode]);

  if (!modal || !def) return null;

  const ready = def.ready(draft);
  const Form = def.ConfigForm;

  const commit = () => {
    if (!ready) return;
    if (modal.mode === "create") {
      setPanel(modal.cellId, modal.kind, draft);
    } else {
      updatePanelConfig(modal.cellId, draft);
    }
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeModal}
    >
      <div
        className="w-80 rounded-lg border border-white/10 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium text-white/80">
          {def.label} settings
        </h2>
        <Form config={draft} onChange={setDraft} />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={closeModal}
            className="rounded border border-white/10 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={!ready}
            className="rounded border border-emerald-400/50 px-3 py-1 text-xs text-emerald-200 enabled:hover:bg-emerald-400/10 disabled:opacity-30"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/ConfigModal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/ConfigModal.tsx src/panels/ConfigModal.test.tsx
git commit -m "M2: shared ConfigModal shell"
```

---

## Task 10: `GridCell` rework — render panels, picker, controls, drop target

**Files:**
- Modify: `src/grid/GridCell.tsx`
- Test: `src/grid/GridCell.test.tsx`

`GridCell` now: when `cell.panel` is set, renders the type's `View` plus a hover overlay (gear → edit modal, ✕ → clearPanel); when empty, renders a `+` that opens the picker, and inline `PanelPicker` when this cell's picker is open. It is a drop target for palette drags.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCell } from "./GridCell";
import { useLayoutStore } from "../store/layoutStore";
import { usePanelUiStore } from "../panels/panelUiStore";
import { __clearRegistry, registerPanel } from "../panels/registry";
import { makePreset } from "./presets";
import { cellId } from "./cellId";
import type { PanelTypeDef } from "../panels/types";

const webDef: PanelTypeDef = {
  kind: "web",
  label: "Web",
  glyph: "🌐",
  defaultConfig: () => ({ url: "" }),
  ready: (c) => typeof c.url === "string" && c.url.trim().length > 0,
  ConfigForm: () => null,
  View: ({ config }) => <div data-testid="web-view">{config.url as string}</div>,
};

beforeEach(() => {
  __clearRegistry();
  registerPanel(webDef);
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [] });
  usePanelUiStore.setState({ pickerCellId: null, modal: null });
});
afterEach(() => __clearRegistry());

const cellOf = (id: string) =>
  useLayoutStore.getState().layout.cells.find((c) => c.id === id)!;

describe("GridCell", () => {
  it("empty cell: + opens the picker", async () => {
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "+" }));
    expect(usePanelUiStore.getState().pickerCellId).toBe(cellId(1, 1));
  });

  it("renders the panel View when the cell hosts a panel", () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    expect(screen.getByTestId("web-view")).toHaveTextContent("https://x");
  });

  it("✕ clears the panel", async () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove panel" }));
    expect(cellOf(cellId(1, 1)).panel).toBeNull();
  });

  it("gear opens the edit modal", async () => {
    useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    await userEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(usePanelUiStore.getState().modal).toEqual({
      cellId: cellId(1, 1),
      kind: "web",
      mode: "edit",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/grid/GridCell.test.tsx`
Expected: FAIL — current `GridCell` requires `selected`/`onToggleSelect` props and has no picker/controls.

- [ ] **Step 3: Rewrite `src/grid/GridCell.tsx`**

```tsx
import type { Cell, PanelKind } from "../lib/types";
import { useLayoutStore } from "../store/layoutStore";
import { getPanelType } from "../panels/registry";
import { usePanelUiStore } from "../panels/panelUiStore";
import { PanelPicker } from "../panels/PanelPicker";
import { PANEL_KIND_DND, resolveDropTarget } from "../panels/dnd";

interface GridCellProps {
  cell: Cell;
}

/**
 * One placed grid cell. Hosts a panel View when populated (with gear/✕ controls
 * on hover); otherwise shows a `+` that opens the type picker. Accepts palette
 * drops to place a panel.
 */
export function GridCell({ cell }: GridCellProps) {
  const setPanel = useLayoutStore((s) => s.setPanel);
  const clearPanel = useLayoutStore((s) => s.clearPanel);
  const cells = useLayoutStore((s) => s.layout.cells);
  const pickerCellId = usePanelUiStore((s) => s.pickerCellId);
  const openPicker = usePanelUiStore((s) => s.openPicker);
  const closePicker = usePanelUiStore((s) => s.closePicker);
  const openCreateModal = usePanelUiStore((s) => s.openCreateModal);
  const openEditModal = usePanelUiStore((s) => s.openEditModal);

  const placeKind = (kind: PanelKind) => {
    const def = getPanelType(kind);
    if (!def) return;
    closePicker();
    if (def.ready(def.defaultConfig())) {
      setPanel(cell.id, kind);
    } else {
      openCreateModal(cell.id, kind);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(PANEL_KIND_DND) as PanelKind;
    if (!kind) return;
    const target = resolveDropTarget(cells, cell.id);
    if (target) placeKind(kind);
  };

  const panelDef = cell.panel ? getPanelType(cell.panel.kind) : undefined;

  return (
    <div
      style={{
        gridColumn: `${cell.col} / span ${cell.colSpan}`,
        gridRow: `${cell.row} / span ${cell.rowSpan}`,
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="group relative overflow-hidden rounded-md border border-white/10 bg-white/[0.03]"
      data-testid={`cell-${cell.id}`}
    >
      {cell.panel && panelDef ? (
        <>
          <panelDef.View instanceId={cell.panel.instanceId} config={cell.panel.config} />
          <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
            <button
              aria-label="Panel settings"
              onClick={() => openEditModal(cell.id, cell.panel!.kind)}
              className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
            >
              ⚙
            </button>
            <button
              aria-label="Remove panel"
              onClick={() => clearPanel(cell.id)}
              className="rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white"
            >
              ✕
            </button>
          </div>
        </>
      ) : pickerCellId === cell.id ? (
        <PanelPicker onPick={placeKind} />
      ) : (
        <button
          onClick={() => openPicker(cell.id)}
          className="flex h-full w-full items-center justify-center text-2xl text-white/20 hover:text-emerald-300"
        >
          +
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/grid/GridCell.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridCell.tsx src/grid/GridCell.test.tsx
git commit -m "M2: GridCell renders panels + picker + controls + drop target"
```

---

## Task 11: Update `GridHost` for the new `GridCell` API

`GridCell` no longer takes `selected`/`onToggleSelect`. Merge/split selection moves to a dedicated click affordance is out of scope here; for M2 we keep selection working by making the empty-cell background click toggle selection is removed. Instead, selection for merge/split now happens via the existing Toolbar workflow against `selectedIds`, which we preserve by leaving `toggleSelect` in the store and re-introducing selection on the cell border. To keep this task small, we only fix the prop mismatch.

**Files:**
- Modify: `src/grid/GridHost.tsx:57-64`

- [ ] **Step 1: Update the cell render in `GridHost.tsx`**

Replace the `{layout.cells.map(...)}` block:

```tsx
        {layout.cells.map((cell) => (
          <GridCell key={cell.id} cell={cell} />
        ))}
```

Remove the now-unused `selectedIds`, `toggleSelect`, and `selected` lines from `GridHost`:

```tsx
  const layout = useLayoutStore((s) => s.layout);
  const setCols = useLayoutStore((s) => s.setCols);
  const setRows = useLayoutStore((s) => s.setRows);
```

(Delete the `const selectedIds = ...`, `const toggleSelect = ...`, and `const selected = new Set(selectedIds);` lines.)

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: The existing `App.test.tsx` assertion `getAllByText("empty")` now FAILS because empty cells render `+` instead of `empty`.

- [ ] **Step 3: Fix `App.test.tsx`**

Replace the first App test body:

```tsx
  it("renders the brand and the default 4-cell grid", () => {
    render(<App />);
    expect(screen.getByText("Greed")).toBeInTheDocument();
    // default preset is 4 -> four empty cells, each offering a + to add a panel
    expect(screen.getAllByRole("button", { name: "+" })).toHaveLength(4);
  });
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridHost.tsx src/App.test.tsx
git commit -m "M2: wire GridHost to new GridCell API"
```

> **Note on merge/split selection:** M1's click-to-select-then-merge flow is temporarily inert because clicking a cell now opens the picker rather than selecting. Restoring a dedicated selection affordance (e.g. a corner checkbox or a modifier-click) is tracked as a follow-up in the M2 wrap-up task; the merge/split store logic and Toolbar buttons are unchanged and still unit-tested.

---

## Task 12: App wiring — register panels + mount palette & modal

**Files:**
- Create: `src/panels/Palette.tsx`
- Test: `src/panels/Palette.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test for `Palette`**

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Palette } from "./Palette";
import { __clearRegistry, registerPanel } from "./registry";
import type { PanelTypeDef } from "./types";

const def = (kind: PanelTypeDef["kind"]): PanelTypeDef => ({
  kind,
  label: kind.toUpperCase(),
  glyph: "x",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => null,
});

beforeEach(() => {
  __clearRegistry();
  registerPanel(def("web"));
});
afterEach(() => __clearRegistry());

describe("Palette", () => {
  it("lists each registered type as a draggable item", () => {
    render(<Palette />);
    const item = screen.getByText("WEB").closest("[draggable]");
    expect(item).toHaveAttribute("draggable", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/panels/Palette.test.tsx`
Expected: FAIL — cannot resolve `./Palette`.

- [ ] **Step 3: Write `src/panels/Palette.tsx`**

```tsx
import { allPanelTypes } from "./registry";
import { PANEL_KIND_DND } from "./dnd";

/** Left column listing panel types; each item is an HTML5 drag source. */
export function Palette() {
  return (
    <aside className="flex w-28 shrink-0 flex-col gap-1 border-r border-white/10 p-2">
      <span className="px-1 text-xs font-medium text-white/40">Panels</span>
      {allPanelTypes().map((def) => (
        <div
          key={def.kind}
          draggable="true"
          onDragStart={(e) => e.dataTransfer.setData(PANEL_KIND_DND, def.kind)}
          className="flex cursor-grab items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-emerald-400/50 active:cursor-grabbing"
        >
          <span aria-hidden>{def.glyph}</span>
          {def.label}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/panels/Palette.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Modify `src/App.tsx`**

Add imports:

```tsx
import { registerAllPanels } from "./panels";
import { Palette } from "./panels/Palette";
import { ConfigModal } from "./panels/ConfigModal";
```

Call `registerAllPanels()` once at module load (above the `App` function):

```tsx
registerAllPanels();
```

Replace the `<main>` block so the palette sits beside the grid and the modal mounts at the root:

```tsx
      <div className="flex flex-1 overflow-hidden">
        <Palette />
        <main className="flex-1 p-1">
          <GridHost />
        </main>
      </div>
      <ConfigModal />
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`
Expected: PASS (all suites).

- [ ] **Step 7: Manual verification**

Run: `pnpm tauri dev`
Verify:
1. Left palette lists "Web".
2. Clicking a cell's `+` opens the picker; choosing "Web" opens the config modal (web is not ready by default).
3. Entering a URL + OK renders the page in an iframe.
4. Dragging "Web" from the palette onto a cell opens the same flow.
5. Hovering a placed panel shows ⚙ (reopens modal, edits URL live) and ✕ (removes the panel).

- [ ] **Step 8: Commit**

```bash
git add src/panels/Palette.tsx src/panels/Palette.test.tsx src/App.tsx
git commit -m "M2: mount palette + config modal, register panels"
```

---

## Out of scope (separate plans)

- **Web panel native-webview fallback** (`src-tauri` web.rs commands, bounds sync, z-order, blocked-frame detection UI): its own plan — it's the first Rust work and depends on the Tauri `unstable` multi-webview feature.
- **M3 Terminal panel** (portable-pty + xterm.js + Channel + bounded reconnect): its own plan.
- **Merge/split selection affordance** restoration after the GridCell click semantics changed (see Task 11 note).

## Self-Review Notes

- **Spec coverage:** §1 registry/types (Tasks 2, 6), data-model actions + onDestroy (Tasks 1, 3); §2 placement both methods (Tasks 8, 10, 12), config modal create+edit (Task 9); §3 Web iframe panel + ready() (Task 5). Native-webview path of §3 explicitly deferred above.
- **Type consistency:** `PanelTypeDef`, `setPanel(cellId, kind, initialConfig?, idGen?)`, `updatePanelConfig`, `clearPanel`, `PANEL_KIND_DND`, `usePanelUiStore` (`openPicker`/`closePicker`/`openCreateModal`/`openEditModal`/`closeModal`, `modal`, `pickerCellId`) are used identically across tasks.
- **Known regression:** click-to-select merge/split is inert after Task 11 (documented); store logic intact.
