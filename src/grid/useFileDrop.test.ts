/**
 * useFileDrop — lightweight unit tests.
 *
 * Deep integration with the Tauri drag-drop event stream cannot be verified in
 * jsdom because `getCurrentWindow().onDragDropEvent` is a native Tauri API.
 * These tests focus on:
 *   1. The non-Tauri no-op guard — hook mounts and unmounts without throwing.
 *   2. collectCellRects — pure DOM helper, testable with jsdom.
 *   3. resolveDropFolder — pure async logic, testable with an injected lister.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { collectCellRects, resolveDropFolder, useFileDrop } from "./useFileDrop";

// ---------------------------------------------------------------------------
// collectCellRects
// ---------------------------------------------------------------------------

describe("collectCellRects", () => {
  it("returns an empty array when no cell elements are in the DOM", () => {
    expect(collectCellRects()).toEqual([]);
  });

  it("extracts id and bounding rect from data-grid-cell-id elements", () => {
    const el = document.createElement("div");
    el.setAttribute("data-grid-cell-id", "c1-r1");
    document.body.appendChild(el);

    try {
      const rects = collectCellRects();
      expect(rects.length).toBe(1);
      expect(rects[0].id).toBe("c1-r1");
      expect(rects[0].rect).toMatchObject({
        left: expect.any(Number),
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
      });
    } finally {
      document.body.removeChild(el);
    }
  });

  it("ignores elements without data-grid-cell-id", () => {
    const el = document.createElement("div");
    el.dataset.testid = "toolbar-button";
    document.body.appendChild(el);

    try {
      const rects = collectCellRects().filter((r) => r.id === "toolbar-button");
      expect(rects).toHaveLength(0);
    } finally {
      document.body.removeChild(el);
    }
  });
});

// ---------------------------------------------------------------------------
// useFileDrop — non-Tauri no-op guard
// ---------------------------------------------------------------------------

describe("useFileDrop (non-Tauri env)", () => {
  it("mounts and unmounts without throwing when isTauri() is false", () => {
    // In jsdom, `__TAURI_INTERNALS__` is never set, so isTauri() returns false.
    const onDrop = vi.fn<
      (cellId: string, paths: string[], pos: { x: number; y: number }) => void
    >();
    expect(() => {
      const { unmount } = renderHook(() => useFileDrop(onDrop));
      unmount();
    }).not.toThrow();
  });

  it("does not call onDrop in the non-Tauri path", () => {
    const onDrop = vi.fn<
      (cellId: string, paths: string[], pos: { x: number; y: number }) => void
    >();
    const { unmount } = renderHook(() => useFileDrop(onDrop));
    unmount();
    expect(onDrop).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveDropFolder
// ---------------------------------------------------------------------------

describe("resolveDropFolder", () => {
  it("returns the raw path when lister resolves (path is a directory)", async () => {
    const lister = vi.fn().mockResolvedValue({ path: "/home/u/mydir", entries: [] });
    const result = await resolveDropFolder("/home/u/mydir", lister);
    expect(result).toBe("/home/u/mydir");
    expect(lister).toHaveBeenCalledWith("/home/u/mydir");
  });

  it("returns parentPath when lister rejects (path is a file)", async () => {
    const lister = vi.fn().mockRejectedValue(new Error("not a directory"));
    // parentPath("/home/u/file.txt") → "/home/u"
    const result = await resolveDropFolder("/home/u/file.txt", lister);
    expect(result).toBe("/home/u");
    expect(lister).toHaveBeenCalledWith("/home/u/file.txt");
  });

  it("returns '/' for a file at the root (e.g. /rootfile)", async () => {
    const lister = vi.fn().mockRejectedValue(new Error("not a directory"));
    // parentPath("/rootfile") → "/"
    const result = await resolveDropFolder("/rootfile", lister);
    expect(result).toBe("/");
  });
});
