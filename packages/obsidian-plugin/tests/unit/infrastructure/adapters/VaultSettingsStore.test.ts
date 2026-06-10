import type { App, TFile } from "obsidian";

import { DEFAULT_SETTINGS } from "../../../../src/domain/settings/ExocortexSettings";
import {
  DEFAULT_SETTINGS_FOLDER,
  SETTING_CLASS_UID,
  VAULT_SETTINGS_REGISTRY,
  descriptorByField,
} from "../../../../src/domain/settings/VaultSettingsRegistry";
import { VaultSettingsStore } from "../../../../src/infrastructure/adapters/VaultSettingsStore";

// ─── Fake App (real-shape per test-fixture-realism rule) ──────────────
//
// Mirrors the real Obsidian contracts the store depends on:
//  - getFileCache returns null for files metadataCache does not know;
//  - vault.create THROWS "file already exists" on duplicate paths;
//  - processFrontMatter mutates the stored frontmatter in place;
//  - getAbstractFileByPath returns null for missing paths.

interface FakeFile {
  path: string;
  frontmatter: Record<string, unknown> | null; // null = unparseable YAML
  body: string;
}

class FakeApp {
  files = new Map<string, FakeFile>();
  folders = new Set<string>();
  createCalls: string[] = [];
  processCalls: string[] = [];

  private tfile(path: string): TFile {
    return { path } as unknown as TFile;
  }

  asApp(): App {
    const self = this;
    return {
      vault: {
        getMarkdownFiles: () =>
          Array.from(self.files.keys()).map((p) => self.tfile(p)),
        getAbstractFileByPath: (p: string) =>
          self.files.has(p)
            ? self.tfile(p)
            : self.folders.has(p)
              ? { path: p, children: [] }
              : null,
        create: async (p: string, content: string) => {
          if (self.files.has(p)) {
            throw new Error(`File already exists: ${p}`);
          }
          self.createCalls.push(p);
          self.files.set(p, {
            path: p,
            frontmatter: parseFrontmatter(content),
            body: content,
          });
          return self.tfile(p);
        },
        createFolder: async (p: string) => {
          if (self.folders.has(p)) {
            throw new Error(`Folder already exists: ${p}`);
          }
          self.folders.add(p);
        },
      },
      metadataCache: {
        getFileCache: (file: TFile) => {
          const f = self.files.get(file.path);
          if (!f) return null;
          if (f.frontmatter === null) return {}; // parsed, no frontmatter
          return { frontmatter: f.frontmatter };
        },
      },
      fileManager: {
        processFrontMatter: async (
          file: TFile,
          fn: (fm: Record<string, unknown>) => void,
        ) => {
          const f = self.files.get(file.path);
          if (!f) throw new Error(`File not found: ${file.path}`);
          const fm = f.frontmatter ?? {};
          fn(fm);
          f.frontmatter = fm;
          self.processCalls.push(file.path);
        },
      },
    } as unknown as App;
  }

  seedSettingAsset(
    field: string,
    value: unknown,
    opts: { path?: string; keyRef?: string } = {},
  ): string {
    const d = descriptorByField(field);
    if (!d) throw new Error(`unknown field ${field}`);
    const path = opts.path ?? `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
    this.files.set(path, {
      path,
      frontmatter: {
        exo__Asset_uid: d.settingUid,
        exo__Instance_class: [`[[${SETTING_CLASS_UID}]]`],
        exo__Setting_key: opts.keyRef ?? `[[${d.keyUid}]]`,
        exo__Setting_value: value,
      },
      body: "",
    });
    return path;
  }
}

// Minimal frontmatter parser for vault.create output — handles exactly
// the shapes renderAssetContent emits (scalars, quoted strings, block
// lists). Good enough for asserting created content.
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return null;
  const fm: Record<string, unknown> = {};
  let currentList: string | null = null;
  for (const line of m[1].split("\n")) {
    const listItem = /^ {2}- (.*)$/.exec(line);
    if (listItem && currentList) {
      const arr = (fm[currentList] as unknown[]) ?? [];
      let v = listItem[1];
      if (v.startsWith('"')) v = JSON.parse(v);
      arr.push(v);
      fm[currentList] = arr;
      continue;
    }
    const kv = /^([A-Za-z_][^:]*):(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2].trim();
    if (raw === "") {
      fm[key] = [];
      currentList = key;
      continue;
    }
    currentList = null;
    if (raw === "true") fm[key] = true;
    else if (raw === "false") fm[key] = false;
    else if (raw === "[]") fm[key] = [];
    else if (raw.startsWith('"')) fm[key] = JSON.parse(raw);
    else fm[key] = raw;
  }
  return fm;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as never;

function makeStore(
  fake: FakeApp,
  settings: Record<string, unknown>,
  overrides: {
    baseline?: Record<string, unknown>;
    applyRemote?: jest.Mock;
  } = {},
) {
  const applyRemote =
    overrides.applyRemote ??
    jest.fn(async (field: string, value: unknown) => {
      settings[field] = value;
    });
  const store = new VaultSettingsStore({
    app: fake.asApp(),
    logger: noopLogger,
    getSettings: () => settings,
    baseline: overrides.baseline ?? snapshot(settings),
    applyRemote,
    writeDebounceMs: 0,
  });
  return { store, applyRemote };
}

function snapshot(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of VAULT_SETTINGS_REGISTRY) {
    const v = settings[d.field];
    out[d.field] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

function freshSettings(): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    s[k] = Array.isArray(v) ? [...v] : v;
  }
  return s;
}

describe("VaultSettingsStore", () => {
  describe("scan + overlay", () => {
    it("applies a vault boolean over the data.json baseline", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("showArchivedAssets", true); // default false
      const settings = freshSettings();
      const { store, applyRemote } = makeStore(fake, settings);

      const overlaid = await store.applyScan(store.scanAll());

      expect(overlaid).toEqual(["showArchivedAssets"]);
      expect(applyRemote).toHaveBeenCalledWith("showArchivedAssets", true);
      expect(settings.showArchivedAssets).toBe(true);
    });

    it("falls back to data.json when no asset exists (AC#1 fallback)", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      settings.showArchivedAssets = true; // user's data.json value
      const { store, applyRemote } = makeStore(fake, settings);

      const result = store.scanAll();
      const overlaid = await store.applyScan(result);

      expect(overlaid).toEqual([]);
      expect(applyRemote).not.toHaveBeenCalled();
      expect(settings.showArchivedAssets).toBe(true);
      expect(result.missing.map((d) => d.field)).toContain(
        "showArchivedAssets",
      );
    });

    it("finds assets ANYWHERE in the vault (location-independent — AssetSpace mounts sync via ExoSync)", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("layoutVisible", false, {
        path: "assetspaces/kitelev/exoas-kitelev/settings/some-name.md",
      });
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      await store.applyScan(store.scanAll());

      expect(settings.layoutVisible).toBe(false);
    });

    it("does NOT overlay dirty fields (user toggled before scan) and pushes them to the vault instead", async () => {
      const fake = new FakeApp();
      const path = fake.seedSettingAsset("showArchivedAssets", false);
      const settings = freshSettings();
      const baseline = snapshot(settings); // baseline: false
      settings.showArchivedAssets = true; // user toggled pre-scan
      const { store, applyRemote } = makeStore(fake, settings, { baseline });

      await store.applyScan(store.scanAll());
      await store.flushWrites();

      expect(applyRemote).not.toHaveBeenCalled();
      expect(settings.showArchivedAssets).toBe(true);
      expect(fake.files.get(path)!.frontmatter!.exo__Setting_value).toBe(true);
    });

    it("keeps data.json value and never rewrites the asset when the value is uncoercible", async () => {
      const fake = new FakeApp();
      const path = fake.seedSettingAsset("showArchivedAssets", {
        nested: "object",
      });
      const settings = freshSettings();
      const { store, applyRemote } = makeStore(fake, settings);

      await store.applyScan(store.scanAll());
      await store.flushWrites();

      expect(applyRemote).not.toHaveBeenCalled();
      expect(fake.processCalls).toEqual([]);
      expect(
        fake.files.get(path)!.frontmatter!.exo__Setting_value,
      ).toEqual({ nested: "object" });
    });

    it("dedups duplicate assets deterministically (lexicographically smallest path wins)", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("showArchivedAssets", true, { path: "b/dup.md" });
      fake.seedSettingAsset("showArchivedAssets", false, { path: "a/dup.md" });
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      await store.applyScan(store.scanAll());

      // a/dup.md (false) wins; default is false → no overlay applied.
      expect(settings.showArchivedAssets).toBe(false);
    });

    it("warns and ignores assets referencing unknown SettingKeys (R3 forward-compat)", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("showArchivedAssets", true, {
        keyRef: "[[deadbeef-0000-4000-8000-000000000000]]",
      });
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      const result = store.scanAll();

      expect(result.entries.size).toBe(0);
      expect((noopLogger as { warn: jest.Mock }).warn).toHaveBeenCalled();
    });
  });

  describe("coercion matrix (F9)", () => {
    it.each([
      ["boolean", true, true],
      ["boolean", "true", true],
      ["boolean", "False", false],
      ["boolean", 1, undefined],
    ])("boolean: %p → %p", async (_dt, raw, expected) => {
      const fake = new FakeApp();
      fake.seedSettingAsset("showArchivedAssets", raw);
      const settings = freshSettings();
      settings.showArchivedAssets = "SENTINEL";
      const { store } = makeStore(fake, settings);
      await store.applyScan(store.scanAll());
      if (expected === undefined) {
        expect(settings.showArchivedAssets).toBe("SENTINEL");
      } else {
        expect(settings.showArchivedAssets).toBe(expected);
      }
    });

    it("string: number coerces, object does not", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("displayNameTemplate", 42);
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);
      await store.applyScan(store.scanAll());
      expect(settings.displayNameTemplate).toBe("42");
    });

    it("stringList: scalar string becomes a 1-element list; non-string entries are dropped", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("excludedFolders", "09 Templates");
      const settings = freshSettings();
      settings.excludedFolders = [];
      const { store } = makeStore(fake, settings);
      await store.applyScan(store.scanAll());
      // normaliseExcludedFolders appends the trailing slash.
      expect(settings.excludedFolders).toEqual(["09 Templates/"]);
    });
  });

  describe("lazyBootstrapFolders merge policy (F8 / anti-#3279)", () => {
    it("applies union(defaults, asset) and does NOT write the union back", async () => {
      const fake = new FakeApp();
      const path = fake.seedSettingAsset("lazyBootstrapFolders", [
        "assetspaces/kitelev",
      ]);
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      await store.applyScan(store.scanAll());
      await store.flushWrites();

      expect(settings.lazyBootstrapFolders).toEqual([
        ...DEFAULT_SETTINGS.lazyBootstrapFolders,
        "assetspaces/kitelev/",
      ]);
      // No write-back: asset keeps the user's short list.
      expect(fake.processCalls).toEqual([]);
      expect(
        fake.files.get(path)!.frontmatter!.exo__Setting_value,
      ).toEqual(["assetspaces/kitelev"]);
    });

    it("a stale asset cannot shadow newly-added defaults", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("lazyBootstrapFolders", ["assetspaces/exo/"]);
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      await store.applyScan(store.scanAll());

      for (const def of DEFAULT_SETTINGS.lazyBootstrapFolders) {
        expect(settings.lazyBootstrapFolders).toContain(def);
      }
    });
  });

  describe("migration (one-shot, idempotent, 0-leakage)", () => {
    it("creates assets for all missing registry fields with current data.json values", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      settings.showArchivedAssets = true;
      const { store } = makeStore(fake, settings);

      store.scanAll();
      const created = await store.migrateMissing();

      expect(created).toHaveLength(VAULT_SETTINGS_REGISTRY.length);
      const d = descriptorByField("showArchivedAssets")!;
      const file = fake.files.get(
        `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`,
      )!;
      expect(file.frontmatter!.exo__Setting_value).toBe(true);
      expect(file.frontmatter!.exo__Asset_uid).toBe(d.settingUid);
      expect(file.frontmatter!.exo__Setting_key).toBe(`[[${d.keyUid}]]`);
      expect(file.frontmatter!.exo__Instance_class).toEqual([
        `[[${SETTING_CLASS_UID}]]`,
      ]);
    });

    it("is idempotent: second run creates nothing (per-key skip-existing)", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      store.scanAll();
      const first = await store.migrateMissing();
      expect(first).toHaveLength(VAULT_SETTINGS_REGISTRY.length);

      // Re-scan (as a fresh session would) and migrate again.
      const { store: store2 } = makeStore(fake, settings);
      store2.scanAll();
      const second = await store2.migrateMissing();
      expect(second).toHaveLength(0);
      expect(fake.createCalls).toHaveLength(VAULT_SETTINGS_REGISTRY.length);
    });

    it("skips fields that already have an asset (partial migration)", async () => {
      const fake = new FakeApp();
      fake.seedSettingAsset("showArchivedAssets", true);
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      store.scanAll();
      const created = await store.migrateMissing();

      expect(created).toHaveLength(VAULT_SETTINGS_REGISTRY.length - 1);
      expect(created).not.toContain("showArchivedAssets");
    });

    it("0-leakage: never creates assets for denylisted/per-device/unknown data.json keys", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      // Simulate a legacy/hostile data.json with per-device + secret keys.
      settings.activeProfileUid = "some-uid";
      settings._switchInProgress = true;
      settings.pat = "ghp_SECRET";
      settings.randomGarbageKey = "x";
      const { store } = makeStore(fake, settings);

      store.scanAll();
      await store.migrateMissing();

      expect(fake.createCalls).toHaveLength(VAULT_SETTINGS_REGISTRY.length);
      const allBodies = Array.from(fake.files.values())
        .map((f) => f.body)
        .join("\n");
      expect(allBodies).not.toContain("ghp_SECRET");
      expect(allBodies).not.toContain("some-uid");
      expect(allBodies).not.toContain("activeProfileUid");
      expect(allBodies).not.toContain("_switchInProgress");
    });

    it("adopts a file that exists at the canonical path but was not classified (Sync race)", async () => {
      const fake = new FakeApp();
      const d = descriptorByField("showArchivedAssets")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
      // File exists but with null frontmatter (e.g. cache not refreshed).
      fake.files.set(path, { path, frontmatter: null, body: "" });
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);

      store.scanAll();
      const created = await store.migrateMissing();

      expect(created).not.toContain("showArchivedAssets");
      expect(fake.createCalls).not.toContain(path);
    });

    it("throws when called before scanAll (F5 guard)", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);
      await expect(store.migrateMissing()).rejects.toThrow(/scanAll/);
    });
  });

  describe("UI → vault push (write-through)", () => {
    async function setupMigrated() {
      const fake = new FakeApp();
      const settings = freshSettings();
      const { store, applyRemote } = makeStore(fake, settings);
      store.scanAll();
      await store.migrateMissing();
      return { fake, settings, store, applyRemote };
    }

    it("pushChangedFields writes the changed field to the asset", async () => {
      const { fake, settings, store } = await setupMigrated();
      const d = descriptorByField("enableShaclValidation")!;

      settings.enableShaclValidation = true;
      store.pushChangedFields();
      await store.flushWrites();

      const file = fake.files.get(
        `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`,
      )!;
      expect(file.frontmatter!.exo__Setting_value).toBe(true);
      expect(file.frontmatter!.exo__Asset_updatedAt).toBeDefined();
    });

    it("no-ops when nothing changed", async () => {
      const { fake, store } = await setupMigrated();
      const callsBefore = fake.processCalls.length;

      store.pushChangedFields();
      await store.flushWrites();

      expect(fake.processCalls.length).toBe(callsBefore);
    });

    it("never creates a missing asset on push (F2 — no duplicate factory)", async () => {
      const fake = new FakeApp();
      const settings = freshSettings();
      const { store } = makeStore(fake, settings);
      store.scanAll(); // no assets at all, no migration

      settings.showArchivedAssets = true;
      store.pushChangedFields();
      await store.flushWrites();

      expect(fake.createCalls).toHaveLength(0);
    });

    it("skips the write when the asset transiently disappeared (ExoSync atomic-write window)", async () => {
      const { fake, settings, store } = await setupMigrated();
      const d = descriptorByField("enableShaclValidation")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
      fake.files.delete(path); // transient disappearance

      settings.enableShaclValidation = true;
      store.pushChangedFields();
      await store.flushWrites();

      expect(fake.createCalls.filter((p) => p === path)).toHaveLength(1); // only the original migrate
      expect(fake.files.has(path)).toBe(false);
    });
  });

  describe("watcher (remote changes + echo suppression)", () => {
    async function setupMigrated() {
      const fake = new FakeApp();
      const settings = freshSettings();
      const { store, applyRemote } = makeStore(fake, settings);
      store.scanAll();
      await store.migrateMissing();
      return { fake, settings, store, applyRemote };
    }

    function tfileOf(path: string): TFile {
      return { path } as unknown as TFile;
    }

    it("applies a remote change arriving via sync", async () => {
      const { fake, settings, store, applyRemote } = await setupMigrated();
      const d = descriptorByField("showArchivedAssets")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
      fake.files.get(path)!.frontmatter!.exo__Setting_value = true;

      await store.onMetadataChanged(tfileOf(path));

      expect(applyRemote).toHaveBeenCalledWith("showArchivedAssets", true);
      expect(settings.showArchivedAssets).toBe(true);
    });

    it("swallows the echo of its own write (F1)", async () => {
      const { fake, settings, store, applyRemote } = await setupMigrated();
      const d = descriptorByField("enableShaclValidation")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;

      settings.enableShaclValidation = true;
      store.pushChangedFields();
      await store.flushWrites();
      applyRemote.mockClear();

      // The processFrontMatter write triggers metadataCache.changed.
      await store.onMetadataChanged(tfileOf(path));

      expect(applyRemote).not.toHaveBeenCalled();
      expect(settings.enableShaclValidation).toBe(true);
    });

    it("ignores a stale intermediate state while a newer write is in flight (F1 double-toggle)", async () => {
      const { fake, settings, store, applyRemote } = await setupMigrated();
      const d = descriptorByField("enableShaclValidation")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;

      // First write lands (true)…
      settings.enableShaclValidation = true;
      store.pushChangedFields();
      await store.flushWrites();
      // …user immediately toggles back (false); write queued (pending=false).
      settings.enableShaclValidation = false;
      store.pushChangedFields();
      await store.flushWrites();
      applyRemote.mockClear();

      // A stale changed-event replays the OLD on-disk state (true) — must
      // NOT roll the user's newer action back. (Simulate by flipping the
      // file back to true without going through the store.)
      fake.files.get(path)!.frontmatter!.exo__Setting_value = true;
      // Re-arm pending as if the second write were still in flight:
      settings.enableShaclValidation = true;
      store.pushChangedFields(); // pending=true queued
      settings.enableShaclValidation = false;
      fake.files.get(path)!.frontmatter!.exo__Setting_value = false;
      await store.flushWrites();
      fake.files.get(path)!.frontmatter!.exo__Setting_value = true; // stale echo state

      await store.onMetadataChanged(tfileOf(path));
      // pending was false→…; stale "true" ≠ pending → swallowed, no rollback
      expect(settings.enableShaclValidation).toBe(false);
      expect(applyRemote).not.toHaveBeenCalled();
    });

    it("adopts a setting asset file that appears mid-session (Sync delivery)", async () => {
      const { fake, settings, store, applyRemote } = await setupMigrated();
      const d = descriptorByField("layoutVisible")!;
      // Remove the migrated asset and deliver a relocated one.
      fake.files.delete(`${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`);
      store.onFileDeleted(`${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`);
      const newPath = fake.seedSettingAsset("layoutVisible", false, {
        path: "assetspaces/kitelev/exoas-kitelev/settings/relocated.md",
      });

      await store.onMetadataChanged(tfileOf(newPath));

      expect(applyRemote).toHaveBeenCalledWith("layoutVisible", false);
      expect(settings.layoutVisible).toBe(false);
    });

    it("keeps tracking across rename (user moves asset into an AssetSpace)", async () => {
      const { fake, settings, store } = await setupMigrated();
      const d = descriptorByField("enableShaclValidation")!;
      const oldPath = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
      const newPath = `assetspaces/kitelev/exoas-kitelev/${d.settingUid}.md`;
      const f = fake.files.get(oldPath)!;
      fake.files.delete(oldPath);
      fake.files.set(newPath, { ...f, path: newPath });

      store.onFileRenamed(tfileOf(newPath), oldPath);
      settings.enableShaclValidation = true;
      store.pushChangedFields();
      await store.flushWrites();

      expect(fake.files.get(newPath)!.frontmatter!.exo__Setting_value).toBe(
        true,
      );
    });

    it("a broken-YAML change event does not unregister or reset the setting (F11)", async () => {
      const { fake, settings, store, applyRemote } = await setupMigrated();
      const d = descriptorByField("showArchivedAssets")!;
      const path = `${DEFAULT_SETTINGS_FOLDER}/${d.settingUid}.md`;
      settings.showArchivedAssets = true;
      fake.files.get(path)!.frontmatter = null; // YAML broke under hand-edit

      await store.onMetadataChanged(tfileOf(path));

      expect(applyRemote).not.toHaveBeenCalled();
      expect(settings.showArchivedAssets).toBe(true);
    });
  });
});
