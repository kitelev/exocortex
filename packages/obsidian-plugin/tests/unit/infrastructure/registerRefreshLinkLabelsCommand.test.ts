/**
 * Palette registration for «Exocortex: Refresh link labels» (Веха 1 / MVP,
 * WBS 844ced36). The command id MUST stay byte-exact (Obsidian persists
 * hotkeys by command id). Obsidian renders palette labels as
 * "<plugin name>: <command name>", so name "Refresh link labels" surfaces as
 * «Exocortex: Refresh link labels».
 *
 * Registered UNCONDITIONALLY (no Platform gate) — verified here by the absence
 * of any platform branch: the registrar always adds exactly one command.
 */

import {
  registerRefreshLinkLabelsCommand,
  type RefreshLinkLabelsCommandRegistrar,
} from "@plugin/infrastructure/adapters/registerRefreshLinkLabelsCommand";
import { LinkLabelRefreshService } from "@plugin/application/services/LinkLabelRefreshService";

interface RegisteredCommand {
  id: string;
  name: string;
  callback: () => void;
}

function makeRegistrar(): {
  plugin: RefreshLinkLabelsCommandRegistrar;
  added: RegisteredCommand[];
} {
  const added: RegisteredCommand[] = [];
  const plugin: RefreshLinkLabelsCommandRegistrar = {
    addCommand: (command) => {
      added.push(command);
      return command;
    },
  };
  return { plugin, added };
}

function makeService(): {
  service: LinkLabelRefreshService;
  refreshSpy: jest.Mock;
} {
  const refreshSpy = jest.fn(async () => undefined);
  const service = new LinkLabelRefreshService({
    ensureIndexFresh: refreshSpy,
    rebuildEditorViews: () => undefined,
    rerenderLayouts: () => undefined,
  });
  return { service, refreshSpy };
}

describe("registerRefreshLinkLabelsCommand (Веха 1 / MVP)", () => {
  it("registers exactly one command with the stable id/name", () => {
    const { plugin, added } = makeRegistrar();
    const { service } = makeService();

    registerRefreshLinkLabelsCommand(plugin, service);

    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("refresh-link-labels");
    expect(added[0].name).toBe("Refresh link labels");
  });

  it("wires the palette callback to LinkLabelRefreshService.refresh()", () => {
    const { plugin, added } = makeRegistrar();
    const { service } = makeService();
    const refreshSpy = jest
      .spyOn(service, "refresh")
      .mockResolvedValue(undefined);

    registerRefreshLinkLabelsCommand(plugin, service);
    // Invoking the palette callback must trigger the re-resolve.
    added[0].callback();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("callback does not throw even when a re-resolve step fails (graceful, fire-and-forget)", async () => {
    const { plugin, added } = makeRegistrar();
    // Real service whose index-refresh step throws — refresh() is graceful and
    // RESOLVES (never rejects), so `void service.refresh()` produces no
    // unhandled rejection. (Mocking refresh() to reject would test an
    // impossible contract; the service swallows step failures by design.)
    const ensureIndexFresh = jest.fn(async () => {
      throw new Error("index rebuild boom");
    });
    const rebuildEditorViews = jest.fn();
    const service = new LinkLabelRefreshService({
      ensureIndexFresh,
      rebuildEditorViews,
      rerenderLayouts: () => undefined,
    });

    registerRefreshLinkLabelsCommand(plugin, service);

    expect(() => added[0].callback()).not.toThrow();
    // Let the fire-and-forget promise settle; the later step still ran.
    await Promise.resolve();
    await Promise.resolve();
    expect(rebuildEditorViews).toHaveBeenCalledTimes(1);
  });
});
