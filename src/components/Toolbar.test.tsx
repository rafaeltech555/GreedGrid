import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "./Toolbar";
import { useLayoutStore } from "../store/layoutStore";
import { makePreset } from "../grid/presets";

// Mock remapToPreset so we can control dropped panels in each test.
vi.mock("../grid/remap", () => ({
  remapToPreset: vi.fn(),
}));

// Import the mock AFTER vi.mock so we get the mocked version.
import { remapToPreset } from "../grid/remap";
const mockRemap = vi.mocked(remapToPreset);

// Grab a stable reference to loadLayout mock before each test.
let mockLoadLayout: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockLoadLayout = vi.fn();
  const layout4 = makePreset(4);
  useLayoutStore.setState({
    layout: layout4,
    selectedIds: [],
    selectMode: false,
    loadLayout: mockLoadLayout,
  });
  vi.clearAllMocks();
});

describe("Toolbar — preset switch confirmation flow", () => {
  it("no-drop path: no dialog, loadLayout called immediately", () => {
    const next = makePreset(4);
    mockRemap.mockReturnValue({ layout: next, dropped: [] });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "4" }));

    // Dialog should NOT be visible
    expect(screen.queryByText(/切換到/)).toBeNull();
    // loadLayout should have been called with the remapped layout
    expect(mockLoadLayout).toHaveBeenCalledOnce();
    expect(mockLoadLayout).toHaveBeenCalledWith(next);
  });

  it("drop path — dialog appears with correct message", () => {
    const next = makePreset(4);
    mockRemap.mockReturnValue({
      layout: next,
      dropped: [
        { instanceId: "a", kind: "web", config: {} },
        { instanceId: "b", kind: "web", config: {} },
      ],
    });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "4" }));

    // Dialog message mentions "切換到", the count (4), and the dropped count (2)
    expect(screen.getByText(/切換到/)).toBeInTheDocument();
    expect(screen.getByText(/4 格會移除 2 個/)).toBeInTheDocument();
    // loadLayout should NOT be called yet
    expect(mockLoadLayout).not.toHaveBeenCalled();
  });

  it("drop path — cancel: dialog closes, loadLayout NOT called", async () => {
    const next = makePreset(4);
    mockRemap.mockReturnValue({
      layout: next,
      dropped: [{ instanceId: "a", kind: "web", config: {} }],
    });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "4" }));

    // Dialog is up
    expect(screen.getByText(/切換到/)).toBeInTheDocument();

    // Click cancel
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    // Dialog gone
    expect(screen.queryByText(/切換到/)).toBeNull();
    // loadLayout must NOT have been called
    expect(mockLoadLayout).not.toHaveBeenCalled();
  });

  it("drop path — confirm: loadLayout called with fresh remap, dialog closes", async () => {
    const layout4 = makePreset(4);
    const next6 = makePreset(6);
    // First call (on click): returns dropped panels to trigger the dialog
    mockRemap.mockReturnValueOnce({
      layout: next6,
      dropped: [{ instanceId: "a", kind: "web", config: {} }],
    });
    // Second call (on confirm): re-derives from the live store value; dropped is ignored by Toolbar
    mockRemap.mockReturnValueOnce({ layout: next6, dropped: [] });

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "6" }));

    // Dialog is up
    expect(screen.getByText(/切換到/)).toBeInTheDocument();

    // Ensure the store's live layout is layout4 at confirm time (matches what was set in beforeEach)
    act(() => { useLayoutStore.setState({ layout: layout4 }); });

    // Click the confirm button (切換)
    await userEvent.click(screen.getByRole("button", { name: "切換" }));

    // Dialog gone
    expect(screen.queryByText(/切換到/)).toBeNull();
    // loadLayout should have been called with the freshly remapped layout
    expect(mockLoadLayout).toHaveBeenCalledOnce();
    expect(mockLoadLayout).toHaveBeenCalledWith(next6);

    // remapToPreset should have been called twice total: click + confirm
    expect(mockRemap).toHaveBeenCalledTimes(2);
    // First call used the render-time layout snapshot; second call reads live store value (layout4)
    expect(mockRemap).toHaveBeenNthCalledWith(1, layout4, 6);
    expect(mockRemap).toHaveBeenNthCalledWith(2, layout4, 6);
  });
});

describe("Toolbar — select mode", () => {
  it("Select button toggles selectMode and reflects aria-pressed", () => {
    render(<Toolbar />);
    const btn = screen.getByRole("button", { name: "Select" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(useLayoutStore.getState().selectMode).toBe(true);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(useLayoutStore.getState().selectMode).toBe(false);
  });

  it("Escape exits select mode", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(useLayoutStore.getState().selectMode).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useLayoutStore.getState().selectMode).toBe(false);
  });
});
