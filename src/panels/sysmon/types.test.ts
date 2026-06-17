import { describe, expect, it } from "vitest";
import { sysmonReady } from "./types";

describe("sysmonReady", () => {
  it("is always true — sysmon opens with defaults", () => {
    expect(sysmonReady({})).toBe(true);
    expect(sysmonReady({ refreshSecs: 5 })).toBe(true);
  });
});
