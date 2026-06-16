import { afterEach, describe, expect, it } from "vitest";
import {
  __clearRegistry,
  allPanelTypes,
  getPanelType,
  registerPanel,
} from "./registry";
import type { PanelTypeDef } from "./types";

const fakeDef = (kind: PanelTypeDef["kind"]): PanelTypeDef => ({
  kind,
  label: kind,
  glyph: "?",
  defaultConfig: () => ({}),
  ready: () => true,
  ConfigForm: () => null,
  View: () => null,
});

afterEach(() => __clearRegistry());

describe("panel registry", () => {
  it("registers and looks up by kind", () => {
    registerPanel(fakeDef("web"));
    expect(getPanelType("web")?.kind).toBe("web");
  });

  it("returns undefined for an unregistered kind", () => {
    expect(getPanelType("terminal")).toBeUndefined();
  });

  it("allPanelTypes lists every registered def", () => {
    registerPanel(fakeDef("web"));
    registerPanel(fakeDef("terminal"));
    expect(allPanelTypes().map((d) => d.kind).sort()).toEqual([
      "terminal",
      "web",
    ]);
  });
});
