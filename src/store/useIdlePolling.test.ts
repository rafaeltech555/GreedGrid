import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

vi.mock("../lib/ipc", () => ({
  isTauri: () => true,
  termList: vi.fn(),
}));

import { termList } from "../lib/ipc";
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
});
