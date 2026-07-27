/**
 * Issue #3539 — behavioural test for the `initVaultSettings` master-switch
 * gate (settings-homoiconization, default OFF).
 *
 * Exercises the real private `initVaultSettings` method against the real
 * `VaultSettingsStore` class (its public pipeline methods are spied so the
 * test never touches a real vault). The plugin instance is built with
 * `Object.create(prototype)` and the exact `this.*` fields `initVaultSettings`
 * reads — avoiding the heavy DI/onload setup, which is irrelevant to the gate.
 *
 * Contract under test:
 *  - OFF (default): no scanAll / applyScan / migrateMissing, no metadataCache
 *    watcher registered, `vaultSettingsStore` stays null (saveSettings
 *    write-back becomes a no-op → data.json-only, pre-D2 behaviour).
 *  - ON: the full pipeline runs and the store + watchers are wired.
 *
 * Revert→fail / restore→pass: deleting the early-return in
 * `initVaultSettings` makes the OFF test fail (scanAll IS called,
 * vaultSettingsStore IS set) — empirically verified, see PR body.
 */
import ExocortexPlugin from "../../src/ExocortexPlugin";
import { VaultSettingsStore } from "../../src/infrastructure/adapters/VaultSettingsStore";

type AnyPlugin = Record<string, unknown> & {
  initVaultSettings: () => Promise<void>;
  vaultSettingsStore: VaultSettingsStore | null;
};

function makePlugin(
  settingsHomoiconizationEnabled: boolean,
): {
  plugin: AnyPlugin;
  registerEvent: jest.Mock;
  metadataOn: jest.Mock;
  vaultOn: jest.Mock;
  notifierInfo: jest.Mock;
  loggerInfo: jest.Mock;
} {
  const metadataOn = jest.fn().mockReturnValue({});
  const vaultOn = jest.fn().mockReturnValue({});
  const registerEvent = jest.fn();
  const notifierInfo = jest.fn();
  const loggerInfo = jest.fn();

  const plugin = Object.create(ExocortexPlugin.prototype) as AnyPlugin;
  Object.assign(plugin, {
    settings: {
      settingsHomoiconizationEnabled,
    } as Record<string, unknown>,
    settingsBaseline: {},
    vaultSettingsStore: null,
    localDataStore: null,
    logger: {
      info: loggerInfo,
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    notifier: { info: notifierInfo, warn: jest.fn() },
    app: {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([]),
        on: vaultOn,
      },
      metadataCache: { on: metadataOn },
    },
    registerEvent,
    saveData: jest.fn().mockResolvedValue(undefined),
  });

  return { plugin, registerEvent, metadataOn, vaultOn, notifierInfo, loggerInfo };
}

describe("ExocortexPlugin.initVaultSettings — #3539 master-switch gate", () => {
  let scanAll: jest.SpyInstance;
  let applyScan: jest.SpyInstance;
  let migrateMissing: jest.SpyInstance;

  beforeEach(() => {
    scanAll = jest
      .spyOn(VaultSettingsStore.prototype, "scanAll")
      .mockReturnValue({ overlay: [], missing: [] } as never);
    applyScan = jest
      .spyOn(VaultSettingsStore.prototype, "applyScan")
      .mockResolvedValue([]);
    migrateMissing = jest
      .spyOn(VaultSettingsStore.prototype, "migrateMissing")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("OFF (default)", () => {
    it("skips the entire D2 pipeline — no scan/overlay/migrate", async () => {
      const { plugin } = makePlugin(false);

      await plugin.initVaultSettings();

      expect(scanAll).not.toHaveBeenCalled();
      expect(applyScan).not.toHaveBeenCalled();
      expect(migrateMissing).not.toHaveBeenCalled();
    });

    it("installs no watcher and leaves vaultSettingsStore null", async () => {
      const { plugin, registerEvent, metadataOn } = makePlugin(false);

      await plugin.initVaultSettings();

      // No settings watcher registered (nothing wired through registerEvent).
      expect(registerEvent).not.toHaveBeenCalled();
      expect(metadataOn).not.toHaveBeenCalledWith("changed", expect.any(Function));
      // Store never published → saveSettings() write-back is a no-op.
      expect(plugin.vaultSettingsStore).toBeNull();
    });

    it("creates no exocortex-settings/ assets (no migration Notice)", async () => {
      const { plugin, notifierInfo } = makePlugin(false);

      await plugin.initVaultSettings();

      expect(notifierInfo).not.toHaveBeenCalled();
    });
  });

  describe("ON", () => {
    it("runs the full D2 pipeline (scan + overlay + migrate)", async () => {
      const { plugin } = makePlugin(true);

      await plugin.initVaultSettings();

      expect(scanAll).toHaveBeenCalledTimes(1);
      expect(applyScan).toHaveBeenCalledTimes(1);
      expect(migrateMissing).toHaveBeenCalledTimes(1);
    });

    it("publishes the store and registers the cross-device watchers", async () => {
      const { plugin, registerEvent, metadataOn, vaultOn } = makePlugin(true);

      await plugin.initVaultSettings();

      expect(plugin.vaultSettingsStore).toBeInstanceOf(VaultSettingsStore);
      // metadataCache "changed" watcher + vault "delete"/"rename" watchers.
      expect(metadataOn).toHaveBeenCalledWith("changed", expect.any(Function));
      expect(vaultOn).toHaveBeenCalledWith("delete", expect.any(Function));
      expect(vaultOn).toHaveBeenCalledWith("rename", expect.any(Function));
      expect(registerEvent).toHaveBeenCalledTimes(3);
    });

    it("@req:4425f655-e034-44b8-9258-db1650dd8b12 constructs the store with the bidirectional live-mirror outbound write ENABLED (UI→asset auto-write active, not read-only)", async () => {
      // req 4425f655 — when settings-homoiconization is on, initVaultSettings
      // must wire the store with outboundWriteEnabled:true so a UI change is
      // auto-mirrored into its exo__Setting vault asset (two-way sync). Revert:
      // removing `outboundWriteEnabled: true` from initVaultSettings → this
      // assertion goes RED (the store falls back to the read-only default).
      const { plugin } = makePlugin(true);

      await plugin.initVaultSettings();

      const store = plugin.vaultSettingsStore as unknown as {
        outboundWriteEnabled: boolean;
      } | null;
      expect(store).not.toBeNull();
      expect(store!.outboundWriteEnabled).toBe(true);
    });
  });
});
