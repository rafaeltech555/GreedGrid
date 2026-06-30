import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

vi.mock("../lib/ipc", () => ({
  isTauri: () => true,
  termList: vi.fn(),
  setIdleIndicator: vi.fn(),
}));

import { termList } from "../lib/ipc";
import { setIdleIndicator } from "../lib/ipc";
const mockSetIdle = vi.mocked(setIdleIndicator);
import { useIdleStore } from "./idleStore";
import { useLayoutStore } from "./layoutStore";
import { useIdlePolling } from "./useIdlePolling";
import { makePreset } from "../grid/presets";
import type { SessionInfo } from "../panels/terminal/types";

const mockTermList = vi.mocked(termList);

const session = (instanceId: string, foreground: boolean): SessionInfo => ({
  instanceId,
  shell: "/bin/bash",
  cwd: null,
  alive: true,
  attached: true,
  foreground,
});

beforeEach(() => {
  vi.useFakeTimers();
  mockTermList.mockReset();
  mockSetIdle.mockReset();
  mockSetIdle.mockResolvedValue(undefined);
  useIdleStore.setState({ entries: {} });
  const layout = makePreset(4);
  layout.cells[0].panel = { kind: "terminal", instanceId: "term-1", config: {} };
  useLayoutStore.setState({ layout });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useIdlePolling", () => {
  it("feeds foreground readings into the idle store", async () => {
    mockTermList.mockResolvedValue([session("term-1", true)]);
    renderHook(() => useIdlePolling());

    await vi.advanceTimersByTimeAsync(1600);
    expect(useIdleStore.getState().entries["term-1"]).toBeTruthy();
    expect(useIdleStore.getState().entries["term-1"].foreground).toBe(true);
  });

  it("prunes entries for terminals no longer placed", async () => {
    useIdleStore.setState({
      entries: {
        ghost: { wasRunning: true, foreground: false, finishedAt: 1, lastViewedAt: 0 },
      },
    });
    mockTermList.mockResolvedValue([]);
    renderHook(() => useIdlePolling());

    await vi.advanceTimersByTimeAsync(1600);
    expect(useIdleStore.getState().entries.ghost).toBeUndefined();
  });

  it("clears all idle when the window regains focus", async () => {
    mockTermList.mockResolvedValue([]);
    renderHook(() => useIdlePolling());
    // Seed an idle terminal, then fire the window focus event.
    useIdleStore.getState().updateForeground("term-1", true, 10);
    useIdleStore.getState().updateForeground("term-1", false, 20);
    expect(useIdleStore.getState().isIdle("term-1")).toBe(true);

    window.dispatchEvent(new Event("focus"));
    expect(useIdleStore.getState().anyIdle()).toBe(false);
  });

  it("pushes anyIdle changes to the tray", async () => {
    mockTermList.mockResolvedValue([session("term-1", true)]);
    renderHook(() => useIdlePolling());
    await vi.advanceTimersByTimeAsync(1600);

    // Transition to idle: foreground true→false, then check the tray got active=true.
    mockSetIdle.mockClear();
    useIdleStore.getState().updateForeground("term-1", false, Date.now());
    expect(mockSetIdle).toHaveBeenCalled();
    const lastCall = mockSetIdle.mock.calls[mockSetIdle.mock.calls.length - 1];
    expect(lastCall[0]).toBe(true); // active
  });
});
