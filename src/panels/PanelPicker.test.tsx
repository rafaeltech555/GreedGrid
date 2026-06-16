import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelPicker } from "./PanelPicker";
import { __clearRegistry, registerPanel } from "./registry";
import type { PanelTypeDef } from "./types";

const def = (kind: PanelTypeDef["kind"], ready: boolean): PanelTypeDef => ({
  kind,
  label: kind.toUpperCase(),
  glyph: "x",
  defaultConfig: () => ({}),
  ready: () => ready,
  ConfigForm: () => null,
  View: () => null,
});

beforeEach(() => {
  __clearRegistry();
  registerPanel(def("web", false));
  registerPanel(def("sysmon", true));
});
afterEach(() => __clearRegistry());

describe("PanelPicker", () => {
  it("lists every registered panel type", () => {
    render(<PanelPicker onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /WEB/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SYSMON/ })).toBeInTheDocument();
  });

  it("calls onPick with the chosen kind", async () => {
    const onPick = vi.fn();
    render(<PanelPicker onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /WEB/ }));
    expect(onPick).toHaveBeenCalledWith("web");
  });
});
