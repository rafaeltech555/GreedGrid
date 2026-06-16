import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCell } from "./GridCell";
import { useLayoutStore } from "../store/layoutStore";
import { usePanelUiStore } from "../panels/panelUiStore";
import { __clearRegistry, registerPanel } from "../panels/registry";
import { makePreset } from "./presets";
import { cellId } from "./cellId";
import type { PanelTypeDef } from "../panels/types";
import { PANEL_KIND_DND } from "../panels/dnd";

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
});
