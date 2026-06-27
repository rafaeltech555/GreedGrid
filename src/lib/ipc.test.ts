import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import { pickFiles, webUpsert, webSetBounds, webSetVisible, webReload, webClose } from "./ipc";

const openMock = vi.mocked(open);

describe("web panel ipc", () => {
  beforeEach(() => invoke.mockClear());

  it("webUpsert flattens rect into the payload", () => {
    webUpsert("id1", "https://example.com", { x: 1, y: 2, width: 3, height: 4 });
    expect(invoke).toHaveBeenCalledWith("web_upsert", {
      instanceId: "id1",
      url: "https://example.com",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it("webSetBounds flattens rect", () => {
    webSetBounds("id1", { x: 5, y: 6, width: 7, height: 8 });
    expect(invoke).toHaveBeenCalledWith("web_set_bounds", {
      instanceId: "id1",
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
  });

  it("webSetVisible passes the boolean", () => {
    webSetVisible("id1", false);
    expect(invoke).toHaveBeenCalledWith("web_set_visible", {
      instanceId: "id1",
      visible: false,
    });
  });

  it("webReload / webClose pass instanceId", () => {
    webReload("id1");
    webClose("id1");
    expect(invoke).toHaveBeenCalledWith("web_reload", { instanceId: "id1" });
    expect(invoke).toHaveBeenCalledWith("web_close", { instanceId: "id1" });
  });
});

describe("pickFiles", () => {
  beforeEach(() => openMock.mockReset());

  it("returns [] when not running inside Tauri", async () => {
    // jsdom's window lacks __TAURI_INTERNALS__, so isTauri() is false here.
    await expect(pickFiles()).resolves.toEqual([]);
    expect(openMock).not.toHaveBeenCalled();
  });

  describe("inside Tauri", () => {
    beforeEach(() => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    });
    afterEach(() => {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    it("wraps a single string result into a one-element array", async () => {
      openMock.mockResolvedValueOnce("/home/u/a.png");
      await expect(pickFiles()).resolves.toEqual(["/home/u/a.png"]);
      expect(openMock).toHaveBeenCalledWith({ directory: false, multiple: true });
    });

    it("returns an array result unchanged", async () => {
      openMock.mockResolvedValueOnce(["/home/u/a.png", "/home/u/b.jpg"]);
      await expect(pickFiles()).resolves.toEqual(["/home/u/a.png", "/home/u/b.jpg"]);
    });

    it("returns [] when the user cancels (null)", async () => {
      openMock.mockResolvedValueOnce(null);
      await expect(pickFiles()).resolves.toEqual([]);
    });
  });
});
