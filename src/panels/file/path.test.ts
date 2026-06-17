import { describe, expect, it } from "vitest";
import { formatSize, isValidName, joinPath, parentPath } from "./path";

describe("parentPath", () => {
  it("walks up one level and bottoms out at root", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/a/b/")).toBe("/a"); // trailing slash tolerated
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("joinPath", () => {
  it("joins without doubling slashes", () => {
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
    expect(joinPath("/a/", "c")).toBe("/a/c");
    expect(joinPath("/", "c")).toBe("/c");
  });
});

describe("formatSize", () => {
  it("scales to binary units", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2150)).toBe("2.1K");
    expect(formatSize(Math.round(4.2 * 1024 * 1024))).toBe("4.2M");
  });
});

describe("isValidName", () => {
  it("rejects empty, slash, dot and dotdot names", () => {
    expect(isValidName("ok.txt")).toBe(true);
    expect(isValidName("")).toBe(false);
    expect(isValidName("a/b")).toBe(false);
    expect(isValidName(".")).toBe(false);
    expect(isValidName("..")).toBe(false);
  });
});
