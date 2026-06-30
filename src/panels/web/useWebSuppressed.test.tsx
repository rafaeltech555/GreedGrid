import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWebSuppressed } from "./useWebSuppressed";
import { usePanelUiStore } from "../panelUiStore";
import { useLayoutStore } from "../../store/layoutStore";

describe("useWebSuppressed", () => {
  beforeEach(() => {
    usePanelUiStore.setState({ modal: null, dropMenu: null, workspaceMenuOpen: false, maximizedCellId: null });
    useLayoutStore.setState({ selectMode: false });
  });

  it("is false when no overlay is active", () => {
    const { result } = renderHook(() => useWebSuppressed("w1"));
    expect(result.current).toBe(false);
  });

  it("is true when a config modal is open", () => {
    usePanelUiStore.setState({ modal: { cellId: "c1", kind: "web", mode: "edit" } });
    const { result } = renderHook(() => useWebSuppressed("w1"));
    expect(result.current).toBe(true);
  });

  it("is true in select mode", () => {
    useLayoutStore.setState({ selectMode: true });
    const { result } = renderHook(() => useWebSuppressed("w1"));
    expect(result.current).toBe(true);
  });

  it("is true when the workspace menu is open", () => {
    usePanelUiStore.setState({ workspaceMenuOpen: true });
    const { result } = renderHook(() => useWebSuppressed("w1"));
    expect(result.current).toBe(true);
  });
});
