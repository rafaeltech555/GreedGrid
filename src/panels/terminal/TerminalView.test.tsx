import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { TerminalView } from "./TerminalView";
import { useIdleStore } from "../../store/idleStore";

// Outside Tauri, TerminalView renders its placeholder branch; the idle overlay
// is rendered in BOTH branches so we can drive it via the store.
beforeEach(() => useIdleStore.setState({ entries: {} }));
afterEach(cleanup);

function makeIdle(id: string) {
  useIdleStore.getState().updateForeground(id, true, 10);
  useIdleStore.getState().updateForeground(id, false, 20); // finished → idle
}

describe("TerminalView idle overlay", () => {
  it("shows the idle badge when this terminal is idle and clears on click", () => {
    makeIdle("t1");
    render(<TerminalView instanceId="t1" config={{}} />);
    const badge = screen.getByRole("button", { name: /閒置/ });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);
    expect(useIdleStore.getState().isIdle("t1")).toBe(false);
  });

  it("hides the idle badge when not idle", () => {
    render(<TerminalView instanceId="t2" config={{}} />);
    expect(screen.queryByRole("button", { name: /閒置/ })).toBeNull();
  });
});
