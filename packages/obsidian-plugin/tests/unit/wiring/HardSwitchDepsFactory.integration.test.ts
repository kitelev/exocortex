/**
 * Production-shape regression test for `buildHardSwitchDeps`
 * (Issue: hard-switch deps wiring exception hides Bootstrap/knowledge palette commands).
 *
 * This exercises the REAL constructor chain — LocalSecretsStore → getSecret →
 * GitHubRestClient → StagingDirTracker → AssetSpaceManager → GitSubmoduleOps →
 * UncommittedChangesGuard → ModalConfirmGate → SwitchCacheLayer — with fakes
 * that mirror the real Obsidian `vault.adapter` contract (per
 * `~/dotfiles/.claude/rules/test-fixture-realism.md`). NONE of the wiring is
 * mocked — that is exactly why the bug slipped through: the prior tests stubbed
 * the wiring, so the empty-PAT ctor throw was never exercised.
 *
 * Revert-verify (documented in PR): reverting the GitHubRestClient ctor change
 * (restore `if (!opts.pat) throw`) makes the «no PAT → deps wire» case FAIL
 * (returns null); restoring the fix makes it PASS.
 */

import { describe, it, expect, jest } from "@jest/globals";
import type { App } from "obsidian";
import type { INotificationService } from "exocortex";

import type { ILogger } from "../../../src/adapters/logging/ILogger";

import {
  buildHardSwitchDeps,
  type BuildHardSwitchDepsOptions,
} from "../../../src/infrastructure/adapters/HardSwitchDepsFactory";
import { PluginLocalDataStore } from "../../../src/infrastructure/adapters/PluginLocalDataStore";

// ─── Real-shape fake App / vault.adapter ─────────────────────────────────

interface FakeAppOptions {
  basePath?: string;
  /** Seeded file contents keyed by vault-relative path (data.local.json etc). */
  files?: Record<string, string>;
}

function makeFakeApp(opts: FakeAppOptions = {}): App {
  const files = opts.files ?? {};
  const adapter: Record<string, unknown> = {
    // Mirrors Obsidian desktop FileSystemAdapter — `basePath` is the absolute
    // vault root used by GitSubmoduleOps. Absent on mobile (CapacitorAdapter).
    exists: async (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    read: async (p: string) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p];
    },
    write: async (p: string, data: string) => {
      files[p] = data;
    },
  };
  if (opts.basePath !== undefined) {
    adapter.basePath = opts.basePath;
  }
  return {
    vault: {
      adapter,
      configDir: ".obsidian",
    },
  } as unknown as App;
}

function makeFakeLogger(): { logger: ILogger; warns: string[] } {
  const warns: string[] = [];
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: () => undefined,
  } as unknown as ILogger;
  return { logger, warns };
}

function makeFakeNotifier(): INotificationService {
  return {
    info: () => undefined,
    success: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    confirm: async () => true,
  };
}

function makeOptions(
  app: App,
  overrides: Partial<BuildHardSwitchDepsOptions> = {},
): BuildHardSwitchDepsOptions {
  return {
    app,
    localDataStore: new PluginLocalDataStore({ app }),
    notifier: makeFakeNotifier(),
    logger: makeFakeLogger().logger,
    ...overrides,
  };
}

const DATA_LOCAL_PATH = ".obsidian/plugins/exocortex/data.local.json";

describe("buildHardSwitchDeps — production-shape wiring", () => {
  it("wires all deps on a valid desktop vault WITHOUT a stored PAT (regression)", async () => {
    // No data.local.json → getSecret('pat') === null → ctor receives "".
    // Pre-fix this threw «PAT is required» → deps null → palette commands hidden.
    const app = makeFakeApp({ basePath: "/Users/test/vault-2025" });
    const deps = await buildHardSwitchDeps(makeOptions(app));

    expect(deps).not.toBeNull();
    expect(deps?.vaultRootPath).toBe("/Users/test/vault-2025");
    // Every dep the gated commands depend on is present.
    expect(deps?.assetSpaceManager).toBeDefined();
    expect(deps?.gitOps).toBeDefined();
    expect(deps?.uncommittedGuard).toBeDefined();
    expect(deps?.confirmGate).toBeDefined();
    expect(deps?.cacheLayer).toBeDefined();
  });

  it("wires all deps when a PAT IS stored", async () => {
    const app = makeFakeApp({
      basePath: "/Users/test/vault-2025",
      files: {
        [DATA_LOCAL_PATH]: JSON.stringify({
          pat: "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
      },
    });
    const deps = await buildHardSwitchDeps(makeOptions(app));

    expect(deps).not.toBeNull();
    expect(deps?.vaultRootPath).toBe("/Users/test/vault-2025");
    expect(deps?.assetSpaceManager).toBeDefined();
  });

  it("returns null and warns when vault.adapter.basePath is unavailable", async () => {
    // Empty basePath (e.g. an adapter without a filesystem root) → git ops
    // impossible → wiring intentionally returns null.
    const app = makeFakeApp({ basePath: "" });
    const { logger, warns } = makeFakeLogger();
    const deps = await buildHardSwitchDeps(makeOptions(app, { logger }));

    expect(deps).toBeNull();
    expect(warns.some((w) => w.includes("basePath unavailable"))).toBe(true);
  });

  it("returns null AND logs a visible console.error when a ctor throws", async () => {
    // Force the catch branch: a null localDataStore makes StagingDirTracker's
    // ctor throw. The visible console.error diagnostic must fire (logger.warn
    // alone is invisible in the DevTools console).
    const app = makeFakeApp({ basePath: "/Users/test/vault-2025" });
    const { logger, warns } = makeFakeLogger();
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const deps = await buildHardSwitchDeps(
        makeOptions(app, {
          logger,
          localDataStore: null as unknown as PluginLocalDataStore,
        }),
      );

      expect(deps).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Exocortex] hard-switch wiring failed:",
        expect.any(Error),
      );
      expect(warns.some((w) => w.includes("failed to wire hard-switch deps"))).toBe(
        true,
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
