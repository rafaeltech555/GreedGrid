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
