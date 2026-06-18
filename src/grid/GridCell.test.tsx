import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCell } from "./GridCell";
import { useLayoutStore } from "../store/layoutStore";
import { usePanelUiStore } from "../panels/panelUiStore";
import { __clearRegistry, registerPanel } from "../panels/registry";
import { makePreset } from "./presets";
import { cellId } from "./cellId";
import type { PanelTypeDef } from "../panels/types";
import { PANEL_KIND_DND, PANEL_MOVE_DND } from "../panels/dnd";

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
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [], selectMode: false });
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

  it("dropping a palette kind on an empty cell starts placement", () => {
    render(<GridCell cell={cellOf(cellId(1, 1))} />);
    const cellEl = screen.getByTestId(`cell-${cellId(1, 1)}`);
    const dataTransfer = {
      getData: (type: string) => (type === PANEL_KIND_DND ? "web" : ""),
    };
    fireEvent.drop(cellEl, { dataTransfer });
    // web is not ready by default (empty url) -> placement opens the create modal
    expect(usePanelUiStore.getState().modal).toEqual({
      cellId: cellId(1, 1),
      kind: "web",
      mode: "create",
    });
  });

  describe("selection", () => {
    it("no ◉ handle button is rendered (handle removed)", () => {
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("Ctrl+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).not.toContain(id);
    });

    it("Meta(Cmd)+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { metaKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("Ctrl+click does NOT open the picker", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { ctrlKey: true });
      expect(usePanelUiStore.getState().pickerCellId).toBeNull();
    });

    it("select mode: overlay click toggles selectedIds (even on a panel cell)", async () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      useLayoutStore.setState({ selectMode: true });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: "Select cell" }));
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("select mode overlay is absent when selectMode is false", () => {
      useLayoutStore.setState({ selectMode: false });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("selected cell outer div has ring-2 ring-emerald-400 class", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      expect(cellEl.className).not.toMatch(/ring-2/);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(cellEl.className).toMatch(/ring-2/);
      expect(cellEl.className).toMatch(/ring-inset/);
      expect(cellEl.className).toMatch(/ring-emerald-400/);
    });
  });

  describe("drag-move grip", () => {
    it("grip exists and is draggable when cell has a panel", () => {
      useLayoutStore.getState().setPanel(cellId(1, 1), "web", { url: "https://x" });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      const grip = screen.getByRole("button", { name: "Move panel" });
      expect(grip).toBeTruthy();
      expect(grip).toHaveAttribute("draggable", "true");
    });

    it("grip is absent when cell has no panel", () => {
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Move panel" })).toBeNull();
    });

    it("dragStart sets PANEL_MOVE_DND key to source cellId", () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      render(<GridCell cell={cellOf(id)} />);
      const grip = screen.getByRole("button", { name: "Move panel" });
      const fakeTransfer = { setData: vi.fn(), effectAllowed: "" as string };
      fireEvent.dragStart(grip, { dataTransfer: fakeTransfer });
      expect(fakeTransfer.setData).toHaveBeenCalledWith(PANEL_MOVE_DND, id);
    });

    it("drop with PANEL_MOVE_DND calls movePanel and swaps panels", () => {
      const fromId = cellId(1, 1);
      const toId = cellId(1, 2);
      useLayoutStore.getState().setPanel(fromId, "web", { url: "https://from" });
      // toId is empty initially
      render(<GridCell cell={cellOf(toId)} />);
      const toEl = screen.getByTestId(`cell-${toId}`);
      const fakeTransfer = {
        getData: (type: string) => (type === PANEL_MOVE_DND ? fromId : ""),
      };
      fireEvent.drop(toEl, { dataTransfer: fakeTransfer });
      // source cell should now be null (was swapped with empty target)
      expect(cellOf(fromId).panel).toBeNull();
      // target cell should now have the panel
      expect(cellOf(toId).panel?.config).toEqual({ url: "https://from" });
    });

    it("drop with PANEL_MOVE_DND to same cell is a no-op", () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      const fakeTransfer = {
        getData: (type: string) => (type === PANEL_MOVE_DND ? id : ""),
      };
      fireEvent.drop(cellEl, { dataTransfer: fakeTransfer });
      // panel should remain unchanged
      expect(cellOf(id).panel?.config).toEqual({ url: "https://x" });
    });

  });
});
