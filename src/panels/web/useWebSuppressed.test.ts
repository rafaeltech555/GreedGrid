import { describe, expect, it } from "vitest";
import { isWebSuppressed } from "./useWebSuppressed";

const base = {
  modalOpen: false,
  dropMenuOpen: false,
  workspaceMenuOpen: false,
  selectMode: false,
  maximizedCellId: null as string | null,
  myCellId: "c1-r1" as string | undefined,
};

describe("isWebSuppressed", () => {
  it("is false in the idle baseline", () => {
    expect(isWebSuppressed(base)).toBe(false);
  });

  it("is true when a modal / dropMenu / workspace menu / select mode is active", () => {
    expect(isWebSuppressed({ ...base, modalOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, dropMenuOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, workspaceMenuOpen: true })).toBe(true);
    expect(isWebSuppressed({ ...base, selectMode: true })).toBe(true);
  });

  it("is false for the web panel that IS maximized", () => {
    expect(
      isWebSuppressed({ ...base, maximizedCellId: "c1-r1", myCellId: "c1-r1" }),
    ).toBe(false);
  });

  it("is true for a web panel that is NOT the maximized cell", () => {
    expect(
      isWebSuppressed({ ...base, maximizedCellId: "c2-r1", myCellId: "c1-r1" }),
    ).toBe(true);
  });
});
