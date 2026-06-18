import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelPicker } from "./PanelPicker";
import { __clearRegistry, registerPanel } from "./registry";
import type { PanelTypeDef } from "./types";
import type { SessionInfo } from "./terminal/types";

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

  it("does not render the detached-terminals section when orphans is empty", () => {
    render(<PanelPicker onPick={() => {}} orphans={[]} />);
    expect(screen.queryByText(/Detached terminals/i)).not.toBeInTheDocument();
    // existing panel-type buttons still render
    expect(screen.getByRole("button", { name: /WEB/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SYSMON/ })).toBeInTheDocument();
  });

  it("renders detached terminals and wires reattach/kill", async () => {
    const orphans: SessionInfo[] = [
      { instanceId: "id-1", shell: "/bin/bash", cwd: "/home/finn/proj", alive: true, attached: false },
      { instanceId: "id-2", shell: "/usr/bin/zsh", cwd: null, alive: false, attached: false },
    ];
    const onReattach = vi.fn();
    const onKill = vi.fn();
    render(
      <PanelPicker
        onPick={() => {}}
        orphans={orphans}
        onReattach={onReattach}
        onKill={onKill}
      />,
    );

    expect(screen.getByText(/Detached terminals/i)).toBeInTheDocument();
    expect(screen.getByText(/bash/)).toBeInTheDocument();
    expect(screen.getByText(/zsh/)).toBeInTheDocument();

    const reattachButtons = screen.getAllByRole("button", { name: /Reattach/ });
    await userEvent.click(reattachButtons[0]);
    expect(onReattach).toHaveBeenCalledWith(orphans[0]);

    const killButtons = screen.getAllByRole("button", { name: /Kill session/ });
    await userEvent.click(killButtons[1]);
    expect(onKill).toHaveBeenCalledWith("id-2");
  });

  it("shows an exited orphan with a dim 'exited' indicator and keeps its row usable", async () => {
    // An exited session (alive: false) must still appear so the user can view
    // its final scrollback or kill it. Its status dot is marked "exited".
    const orphans: SessionInfo[] = [
      { instanceId: "id-x", shell: "/bin/bash", cwd: "/tmp/done", alive: false, attached: false },
    ];
    const onReattach = vi.fn();
    const onKill = vi.fn();
    render(
      <PanelPicker
        onPick={() => {}}
        orphans={orphans}
        onReattach={onReattach}
        onKill={onKill}
      />,
    );

    // Row renders, with the exited (not alive) status indicator.
    expect(screen.getByText(/bash/)).toBeInTheDocument();
    expect(screen.getByTitle("exited")).toBeInTheDocument();

    // Reattach (to view final scrollback) still fires.
    await userEvent.click(screen.getByRole("button", { name: /Reattach/ }));
    expect(onReattach).toHaveBeenCalledWith(orphans[0]);

    // Kill still fires.
    await userEvent.click(screen.getByRole("button", { name: /Kill session/ }));
    expect(onKill).toHaveBeenCalledWith("id-x");
  });
});
