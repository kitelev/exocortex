/**
 * @req:af71d01c-8790-4dc5-b01c-f35239bb5c87
 *
 * M4.1 obsplugin__Setting export command registrar (RFC f402002b): stable
 * command id + the callback builds the source from the plugin's live config,
 * drives the generic `exportSettings`, writes the assets, and surfaces a Notice.
 * Pure over injected thunks (no Obsidian runtime). The happy-path asset value is
 * the dot-path-resolved live value (shares the core revert-verify on
 * `resolveConfigPath`).
 */
import { buildPeriodicNotesSource } from "@kitelev/exocortex-core";
import { registerExportObsPluginSettingsCommand } from "@plugin/infrastructure/adapters/registerObsPluginSettingsCommands";
import type { SettingsCommandRegistrar } from "@plugin/infrastructure/adapters/registerSettingsDistributionCommands";

const DATA_JSON = {
  daily: {
    format: "YYYY-MM-DD [Note]",
    template: "09 Templates/periodic-notes/{{Daily Note}}.md",
    folder: "assetspaces/kitelev",
    enabled: true,
  },
};

function fakeRegistrar(): {
  registrar: SettingsCommandRegistrar;
  commands: Map<string, { name: string; callback: () => void }>;
} {
  const commands = new Map<string, { name: string; callback: () => void }>();
  return {
    registrar: {
      addCommand: (c) =>
        commands.set(c.id, { name: c.name, callback: c.callback }),
    },
    commands,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("registerExportObsPluginSettingsCommand (M4.1)", () => {
  it("@req:af71d01c-8790-4dc5-b01c-f35239bb5c87 registers «Export Periodic Notes settings» with a stable id; the callback exports the data.json daily keys into the picked ontology", async () => {
    const { registrar, commands } = fakeRegistrar();
    const writes: { folder: string; fileName: string; content: string }[] = [];
    const notes: string[] = [];

    registerExportObsPluginSettingsCommand(registrar, {
      commandId: "export-periodic-notes-settings",
      commandName: "Export Periodic Notes settings",
      pluginLabel: "Periodic Notes",
      loadSource: async () => buildPeriodicNotesSource(DATA_JSON),
      pickOntology: async () => ({
        uid: "ont-uid",
        label: "My Ontology",
        folder: "onto/dir",
      }),
      writeAsset: async (folder, fileName, content) => {
        writes.push({ folder, fileName, content });
      },
      nowIso: () => "2026-06-28T00:00:00",
      notify: (m) => notes.push(m),
    });

    const cmd = commands.get("export-periodic-notes-settings");
    expect(cmd?.name).toBe("Export Periodic Notes settings");

    cmd!.callback();
    await flush();

    // 4 declared daily keys → 4 assets in the picked ontology folder.
    expect(writes).toHaveLength(4);
    expect(writes.every((w) => w.folder === "onto/dir")).toBe(true);
    const folderAsset = writes.find(
      (w) => w.fileName === "2bb137e5-b2c7-4fc8-b234-60639de674a9.md",
    );
    // dot-path daily.folder → live value (depends on core resolveConfigPath).
    expect(folderAsset?.content).toContain(
      'setting__Setting_value: "assetspaces/kitelev"',
    );
    expect(notes[0]).toContain("wrote 4 setting asset(s) into «My Ontology»");
  });

  it("notifies (no writes) when the target plugin is not installed (loadSource → null)", async () => {
    const { registrar, commands } = fakeRegistrar();
    const writes: unknown[] = [];
    const notes: string[] = [];

    registerExportObsPluginSettingsCommand(registrar, {
      commandId: "export-periodic-notes-settings",
      commandName: "Export Periodic Notes settings",
      pluginLabel: "Periodic Notes",
      loadSource: async () => null,
      pickOntology: async () => ({ uid: "u", label: "L", folder: "f" }),
      writeAsset: async () => {
        writes.push(1);
      },
      nowIso: () => "x",
      notify: (m) => notes.push(m),
    });

    commands.get("export-periodic-notes-settings")!.callback();
    await flush();

    expect(writes).toHaveLength(0);
    expect(notes[0]).toContain("Periodic Notes not found in this vault");
  });

  it("is a no-op when the user cancels the ontology picker (plugin present)", async () => {
    const { registrar, commands } = fakeRegistrar();
    const writes: unknown[] = [];

    registerExportObsPluginSettingsCommand(registrar, {
      commandId: "export-periodic-notes-settings",
      commandName: "Export Periodic Notes settings",
      pluginLabel: "Periodic Notes",
      loadSource: async () => buildPeriodicNotesSource(DATA_JSON),
      pickOntology: async () => null,
      writeAsset: async () => {
        writes.push(1);
      },
      nowIso: () => "x",
      notify: () => undefined,
    });

    commands.get("export-periodic-notes-settings")!.callback();
    await flush();
    expect(writes).toHaveLength(0);
  });
});
