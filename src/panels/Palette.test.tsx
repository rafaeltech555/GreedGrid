import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Palette } from "./Palette";
import { __clearRegistry, registerPanel } from "./registry";
import type { PanelTypeDef } from "./types";

const def = (kind: PanelTypeDef["kind"]): PanelTypeDef => ({
  kind,
  label: kind.toUpperCase(),
  glyph: "x",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => null,
});

beforeEach(() => {
  __clearRegistry();
  registerPanel(def("web"));
});
afterEach(() => __clearRegistry());

describe("Palette", () => {
  it("lists each registered type as a draggable item", () => {
    render(<Palette />);
    const item = screen.getByText("WEB").closest("[draggable]");
    expect(item).toHaveAttribute("draggable", "true");
  });
});
