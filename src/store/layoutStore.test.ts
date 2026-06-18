import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  selectionMergeable,
  selectionSplittable,
  useLayoutStore,
} from "./layoutStore";
import { cellId } from "../grid/cellId";
import { makePreset } from "../grid/presets";
import { __clearRegistry, registerPanel } from "../panels/registry";
import type { PanelTypeDef } from "../panels/types";

// Reset the store to a known state before each test.
beforeEach(() => {
  useLayoutStore.setState({ layout: makePreset(9), selectedIds: [], selectMode: false });
});

const s = () => useLayoutStore.getState();

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

const makeIdGen = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("layoutStore", () => {
  it("toggleSelect adds then removes an id", () => {
    s().toggleSelect(cellId(1, 1));
    expect(s().selectedIds).toEqual([cellId(1, 1)]);
    s().toggleSelect(cellId(1, 1));
    expect(s().selectedIds).toEqual([]);
  });

  it("merges a rectangular selection and exposes split afterwards", () => {
    [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)].forEach((id) =>
      s().toggleSelect(id),
    );
    expect(selectionMergeable(s())).toBe(true);
    s().mergeSelected();
    expect(s().layout.cells).toHaveLength(6);
    expect(s().selectedIds).toEqual([]);

    // select the merged cell -> splittable
    s().toggleSelect(cellId(1, 1));
    expect(selectionSplittable(s())).toBe(true);
    s().splitSelected();
    expect(s().layout.cells).toHaveLength(9);
  });

  it("toggleSelectMode flips selectMode; turning off clears selection", () => {
    s().toggleSelect(cellId(1, 1));
    expect(s().selectMode).toBe(false);
    s().toggleSelectMode();
    expect(s().selectMode).toBe(true);
    expect(s().selectedIds).toEqual([cellId(1, 1)]);
    s().toggleSelectMode();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("setSelectMode(false) clears selection", () => {
    s().setSelectMode(true);
    s().toggleSelect(cellId(1, 1));
    s().setSelectMode(false);
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("mergeSelected exits select mode on success", () => {
    s().setSelectMode(true);
    [cellId(1, 1), cellId(2, 1)].forEach((id) => s().toggleSelect(id));
    s().mergeSelected();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("splitSelected exits select mode on success", () => {
    [cellId(1, 1), cellId(2, 1)].forEach((id) => s().toggleSelect(id));
    s().mergeSelected();
    s().setSelectMode(true);
    s().toggleSelect(cellId(1, 1));
    s().splitSelected();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("mergeSelected on an invalid selection does not exit select mode", () => {
    s().setSelectMode(true);
    s().toggleSelect(cellId(1, 1)); // 只選 1 格 → 不可 merge
    s().mergeSelected();
    expect(s().selectMode).toBe(true);
    expect(s().selectedIds).toEqual([cellId(1, 1)]);
  });

  it("does not merge a non-rectangular selection", () => {
    [cellId(1, 1), cellId(2, 1), cellId(1, 2)].forEach((id) =>
      s().toggleSelect(id),
    );
    expect(selectionMergeable(s())).toBe(false);
    s().mergeSelected();
    expect(s().layout.cells).toHaveLength(9); // unchanged
  });

  it("setCols replaces the column ratios", () => {
    s().loadLayout(makePreset(4));
    s().setCols([2, 1]);
    expect(s().layout.grid.cols).toEqual([2, 1]);
  });

  it("the layout document survives a JSON round-trip (pure data)", () => {
    s().loadLayout(makePreset(4));
    const layout = s().layout;
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
});

describe("panel actions", () => {
  beforeEach(() => {
    destroyed.length = 0;
    __clearRegistry();
    registerPanel(webDef);
    useLayoutStore.setState({ layout: makePreset(4), selectedIds: [] });
  });
  afterEach(() => __clearRegistry());

  it("setPanel places a panel with a generated instanceId and default config", () => {
    s().setPanel(cellId(1, 1), "web", undefined, makeIdGen());
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel).toEqual({
      instanceId: "id-1",
      kind: "web",
      config: { url: "" },
    });
  });

  it("setPanel honors an explicit initial config", () => {
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, makeIdGen());
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.config).toEqual({ url: "https://a" });
  });

  it("updatePanelConfig replaces config but keeps instanceId", () => {
    s().setPanel(cellId(1, 1), "web", undefined, makeIdGen());
    s().updatePanelConfig(cellId(1, 1), { url: "https://b" });
    const cell = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    expect(cell.panel?.instanceId).toBe("id-1");
    expect(cell.panel?.config).toEqual({ url: "https://b" });
    expect(destroyed).toEqual([]);
  });

  it("clearPanel removes the panel and fires onDestroy", () => {
    s().setPanel(cellId(1, 1), "web", undefined, makeIdGen());
    s().clearPanel(cellId(1, 1));
    expect(s().layout.cells.find((c) => c.id === cellId(1, 1))?.panel).toBeNull();
    expect(destroyed).toEqual(["id-1"]);
  });

  it("setPanel over an existing panel fires onDestroy for the old one", () => {
    s().setPanel(cellId(1, 1), "web", undefined, makeIdGen());
    s().setPanel(cellId(1, 1), "web", { url: "https://c" }, () => "id-2");
    expect(destroyed).toEqual(["id-1"]);
  });

  it("mergeSelected fires onDestroy for panels in absorbed cells", () => {
    // place panels in two adjacent cells, then merge them
    s().setPanel(cellId(1, 1), "web", undefined, () => "id-keep");
    s().setPanel(cellId(2, 1), "web", undefined, () => "id-absorbed");
    destroyed.length = 0; // ignore any destroys from placement
    [cellId(1, 1), cellId(2, 1), cellId(1, 2), cellId(2, 2)].forEach((id) =>
      s().toggleSelect(id),
    );
    s().mergeSelected();
    // top-left panel (id-keep) survives in the merged cell; id-absorbed is destroyed
    expect(destroyed).toContain("id-absorbed");
    expect(destroyed).not.toContain("id-keep");
  });

  it("loadLayout replaces the layout, clears selection, and destroys dropped panels", () => {
    s().setPanel(cellId(1, 1), "web", undefined, () => "id-old");
    s().toggleSelect(cellId(2, 1));
    destroyed.length = 0; // ignore placement destroys
    s().loadLayout(makePreset(6)); // fresh layout has no panels → id-old is dropped
    expect(s().layout.cells).toHaveLength(6);
    expect(s().selectedIds).toEqual([]);
    expect(destroyed).toEqual(["id-old"]);
  });

  it("movePanel to an empty target moves the panel and leaves source null", () => {
    s().setPanel(cellId(1, 1), "web", undefined, () => "id-A");
    destroyed.length = 0;
    s().movePanel(cellId(1, 1), cellId(2, 1));
    const src = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    const dst = s().layout.cells.find((c) => c.id === cellId(2, 1))!;
    expect(dst.panel?.instanceId).toBe("id-A");
    expect(src.panel).toBeNull();
    expect(destroyed).toEqual([]);
  });

  it("movePanel preserves the config of the moved panel", () => {
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, () => "id-A");
    const srcConfigBefore = s().layout.cells.find((c) => c.id === cellId(1, 1))!.panel!.config;
    destroyed.length = 0;
    s().movePanel(cellId(1, 1), cellId(2, 1));
    const dst = s().layout.cells.find((c) => c.id === cellId(2, 1))!;
    expect(dst.panel?.instanceId).toBe("id-A");
    expect(dst.panel?.config).toEqual(srcConfigBefore);
    expect(dst.panel?.config).toEqual({ url: "https://a" });
  });

  it("movePanel swaps panels when both cells are populated", () => {
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, () => "id-A");
    s().setPanel(cellId(2, 1), "web", { url: "https://b" }, () => "id-B");
    destroyed.length = 0;
    s().movePanel(cellId(1, 1), cellId(2, 1));
    const src = s().layout.cells.find((c) => c.id === cellId(1, 1))!;
    const dst = s().layout.cells.find((c) => c.id === cellId(2, 1))!;
    expect(src.panel?.instanceId).toBe("id-B");
    expect(src.panel?.config).toEqual({ url: "https://b" });
    expect(dst.panel?.instanceId).toBe("id-A");
    expect(dst.panel?.config).toEqual({ url: "https://a" });
    expect(destroyed).toEqual([]);
  });

  it("movePanel is a no-op when fromId === toId", () => {
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, () => "id-A");
    destroyed.length = 0;
    const layoutBefore = s().layout;
    s().movePanel(cellId(1, 1), cellId(1, 1));
    expect(s().layout).toBe(layoutBefore);
    expect(destroyed).toEqual([]);
  });

  it("movePanel is a no-op when source cell is empty", () => {
    // cellId(2,1) is empty; cellId(1,1) also starts empty after beforeEach reset
    s().setPanel(cellId(1, 1), "web", { url: "https://a" }, () => "id-A");
    destroyed.length = 0;
    const layoutBefore = s().layout;
    // cellId(2,1) has no panel — should be a no-op
    s().movePanel(cellId(2, 1), cellId(1, 1));
    expect(s().layout).toBe(layoutBefore);
    expect(destroyed).toEqual([]);
  });
});
