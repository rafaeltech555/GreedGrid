import { beforeEach, describe, expect, it } from "vitest";
import { useIdleStore, entryIsIdle, type IdleEntry } from "./idleStore";

const s = () => useIdleStore.getState();

beforeEach(() => useIdleStore.setState({ entries: {} }));

const entry = (e: Partial<IdleEntry>): IdleEntry => ({
  wasRunning: false,
  foreground: false,
  finishedAt: null,
  lastViewedAt: 0,
  ...e,
});

describe("entryIsIdle", () => {
  it("is false when the terminal never ran a command", () => {
    expect(entryIsIdle(entry({ wasRunning: false }))).toBe(false);
  });

  it("is false while a foreground command is still running", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: true, finishedAt: 5, lastViewedAt: 0 })),
    ).toBe(false);
  });

  it("is false when finished but already viewed since", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: 5, lastViewedAt: 10 })),
    ).toBe(false);
  });

  it("is true: ran, back at prompt, finished after last view", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: 10, lastViewedAt: 5 })),
    ).toBe(true);
  });

  it("is false when never finished (finishedAt null)", () => {
    expect(
      entryIsIdle(entry({ wasRunning: true, foreground: false, finishedAt: null })),
    ).toBe(false);
  });
});

describe("idleStore actions", () => {
  it("updateForeground initializes an entry", () => {
    s().updateForeground("a", true, 100);
    expect(s().entries.a).toEqual({
      wasRunning: true,
      foreground: true,
      finishedAt: null,
      lastViewedAt: 100,
    });
  });

  it("records finishedAt on a true→false transition and becomes idle", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    expect(s().entries.a.finishedAt).toBe(200);
    expect(s().isIdle("a")).toBe(true);
    expect(s().anyIdle()).toBe(true);
  });

  it("does not move finishedAt while staying at prompt", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    s().updateForeground("a", false, 300);
    expect(s().entries.a.finishedAt).toBe(200);
  });

  it("markViewed clears idle", () => {
    s().updateForeground("a", true, 100);
    s().updateForeground("a", false, 200);
    s().markViewed("a", 250);
    expect(s().isIdle("a")).toBe(false);
  });

  it("clearAll clears every idle terminal", () => {
    s().updateForeground("a", true, 10);
    s().updateForeground("a", false, 20);
    s().updateForeground("b", true, 10);
    s().updateForeground("b", false, 20);
    s().clearAll(30);
    expect(s().anyIdle()).toBe(false);
  });

  it("prune drops entries not in the active set", () => {
    s().updateForeground("a", false, 10);
    s().updateForeground("b", false, 10);
    s().prune(["a"]);
    expect(Object.keys(s().entries)).toEqual(["a"]);
  });
});
