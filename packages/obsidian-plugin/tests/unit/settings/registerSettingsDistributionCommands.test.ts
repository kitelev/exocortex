/**
 * @req:948f50ab-9950-41e9-86d6-178e92191724
 *
 * M2.1 Settings Distribution palette registrars (RFC f402002b): stable command
 * ids + the callbacks drive exportSettings / importSettings and surface a
 * Notice. Pure over injected thunks (no Obsidian runtime).
 */
import type {
  SettingKeySpec,
  SettingsSource,
  ImportableSettingAsset,
} from "@kitelev/exocortex-core";
import {
  registerExportSettingsCommand,
  registerImportSettingsCommand,
  formatImportResult,
  type SettingsCommandRegistrar,
} from "@plugin/infrastructure/adapters/registerSettingsDistributionCommands";

const KEY: SettingKeySpec = {
  field: "flagA",
  keyUid: "key-a",
  keyLabel: "domain__SettingKeyFlagA",
  datatype: "boolean",
  settingUid: "setting-a",
};

function makeSource(live: Record<string, unknown>): SettingsSource {
  return {
    settingClassUid: "class-uid",
    declaredKeys: () => [KEY],
    readLiveValue: (k) => live[k.field],
    writeLiveValue: async (k, v) => {
      live[k.field] = v;
    },
  };
}

function fakeRegistrar(): {
  registrar: SettingsCommandRegistrar;
  commands: Map<string, { name: string; callback: () => void }>;
} {
  const commands = new Map<string, { name: string; callback: () => void }>();
  return {
    registrar: {
      addCommand: (c) => commands.set(c.id, { name: c.name, callback: c.callback }),
    },
    commands,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("registerSettingsDistributionCommands", () => {
  it("registers «Export settings» with the stable id; the callback exports declared keys and writes them to the picked ontology", async () => {
    const { registrar, commands } = fakeRegistrar();
    const writes: { folder: string; fileName: string; content: string }[] = [];
    const notes: string[] = [];

    registerExportSettingsCommand(registrar, {
      source: makeSource({ flagA: true }),
      pickOntology: async () => ({ uid: "ont-uid", label: "My Ontology", folder: "onto/dir" }),
      writeAsset: async (folder, fileName, content) => {
        writes.push({ folder, fileName, content });
      },
      nowIso: () => "2026-06-28T00:00:00",
      notify: (m) => notes.push(m),
    });

    const cmd = commands.get("export-settings");
    expect(cmd?.name).toBe("Export settings");

    cmd!.callback();
    await flush();

    expect(writes).toHaveLength(1);
    expect(writes[0].fileName).toBe("setting-a.md");
    expect(writes[0].folder).toBe("onto/dir");
    expect(writes[0].content).toContain("setting__Setting_value: true");
    expect(notes[0]).toContain("wrote 1 setting asset(s) into «My Ontology»");
  });

  it("Export callback is a no-op when the user cancels the ontology picker", async () => {
    const { registrar, commands } = fakeRegistrar();
    const writes: unknown[] = [];
    registerExportSettingsCommand(registrar, {
      source: makeSource({ flagA: true }),
      pickOntology: async () => null,
      writeAsset: async () => {
        writes.push(1);
      },
      nowIso: () => "x",
      notify: () => undefined,
    });
    commands.get("export-settings")!.callback();
    await flush();
    expect(writes).toHaveLength(0);
  });

  it("registers «Import settings» with the stable id; the callback applies declared keys and reports allowlist-skips", async () => {
    const { registrar, commands } = fakeRegistrar();
    const live: Record<string, unknown> = { flagA: false };
    const notes: string[] = [];
    const assets: ImportableSettingAsset[] = [
      {
        path: "good.md",
        frontmatter: { "setting__Setting_key": "[[key-a]]", "setting__Setting_value": true },
      },
      {
        path: "rogue.md",
        frontmatter: { "setting__Setting_key": "[[unknown-key]]", "setting__Setting_value": true },
      },
    ];

    registerImportSettingsCommand(registrar, {
      source: makeSource(live),
      readAssets: async () => assets,
      notify: (m) => notes.push(m),
    });

    const cmd = commands.get("import-settings");
    expect(cmd?.name).toBe("Import settings");

    cmd!.callback();
    await flush();

    expect(live.flagA).toBe(true); // declared key applied
    expect(notes[0]).toContain("applied 1 setting(s)");
    expect(notes[0]).toContain("1 unknown-key"); // rogue skipped, reported
  });

  it("formatImportResult summarises applied + skipped counts", () => {
    expect(
      formatImportResult({
        applied: ["a", "b"],
        skipped: [{ path: "x", reason: "uncoercible" }],
      }),
    ).toContain("applied 2 setting(s); skipped 1 (1 uncoercible).");
    expect(formatImportResult({ applied: [], skipped: [] })).toContain(
      "no setting assets found",
    );
  });
});
