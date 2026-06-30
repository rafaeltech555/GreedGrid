import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, cleanup } from "@testing-library/react";
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
    // Replace the layout with one that does NOT include the maximized cell —
    // makePreset always includes c1-r1 so we filter it out directly.
    act(() => {
      const current = useLayoutStore.getState().layout;
      useLayoutStore.setState({
        layout: {
          ...current,
          cells: current.cells.filter((c) => c.id !== id),
        },
      });
    });
    expect(usePanelUiStore.getState().maximizedCellId).toBeNull();
  });

  it("auto-restores when select mode is entered", () => {
    const id = useLayoutStore.getState().layout.cells[0].id;
    usePanelUiStore.setState({ maximizedCellId: id });
    render(<GridHost />);
    act(() => {
      useLayoutStore.getState().setSelectMode(true);
    });
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
