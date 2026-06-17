import { describe, expect, it } from "vitest";
import { termReady } from "./types";

describe("termReady", () => {
  it("is always true — a terminal opens with defaults", () => {
    expect(termReady({})).toBe(true);
    expect(termReady({ shell: "/bin/zsh" })).toBe(true);
    expect(termReady({ shell: "", cwd: "/tmp" })).toBe(true);
  });
});
