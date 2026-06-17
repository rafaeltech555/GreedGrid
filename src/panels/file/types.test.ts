import { describe, expect, it } from "vitest";
import { fileReady } from "./types";

describe("fileReady", () => {
  it("is always true — the browser opens at a default directory", () => {
    expect(fileReady({})).toBe(true);
    expect(fileReady({ path: "/tmp" })).toBe(true);
  });
});
