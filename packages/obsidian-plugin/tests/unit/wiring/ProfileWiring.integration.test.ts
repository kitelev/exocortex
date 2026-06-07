/**
 * Integration tests для RFC 0a0791c1 Profile wiring (Issue #3327 Item #1).
 *
 * Covers the wiring surfaces extracted from `ExocortexPlugin`:
 *   (a) `createAssetSpacePusher` with empty PAT → lookup-only stub
 *   (b) `createAssetSpacePusher` with valid PAT → real AssetSpaceManager
 *   (c) `createAssetSpacePusher` when GitHub client ctor throws → fallback stub
 *   (d) `lookupAssetSpaceUidByFolder` finds matching folder / returns null
 *   (e) `ProfileApplyManager.recoverIfNeeded` fires when
 *       `_switchInProgress=true` and last journal entry is incomplete
 *
 * Per `~/dotfiles/.claude/rules/test-fixture-realism.md` — fakes mirror
 * real Obsidian semantics (metadataCache returns null for unseeded files,
 * vault.adapter.exists/read/write/remove honour their seed set).
 */

import { describe, it, expect } from "@jest/globals";
import type { App, TFile } from "obsidian";
import type { ILogger, INotificationService } from "exocortex";

import {
  createAssetSpacePusher,
  type GitHubRestClientFactory,
} from "../../../src/infrastructure/adapters/AssetSpacePusherFactory";
import { lookupAssetSpaceUidByFolder } from "../../../src/infrastructure/adapters/AssetSpaceLookupHelper";
import { ASSET_SPACE_CLASS_UID } from "../../../src/infrastructure/adapters/AssetSpaceManager";
import {
  ProfileApplyManager,
} from "../../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../../src/infrastructure/adapters/PluginLockManager";
import type {
  IProfileResolver,
  ISettingsStore,
  IRdfIndexer,
  ProfileResolution,
  SwitchSettings,
} from "../../../src/infrastructure/adapters/ProfileApplyManager";

// ─── Real-shape fake App / vault / metadataCache ─────────────────────────

interface SeedFile {
  path: string;
  frontmatter?: Record<string, unknown>;
  content?: string;
}

interface FakeAppHarness {
  app: App;
  files: Map<string, SeedFile>;
}

function makeFakeApp(seeds: SeedFile[]): FakeAppHarness {
  const files = new Map<string, SeedFile>();
  for (const s of seeds) files.set(s.path, s);
  const tfile = (path: string): TFile => ({ path }) as unknown as TFile;

  const app = {
    vault: {
      getMarkdownFiles: () =>
        Array.from(files.keys())
          .filter((p) => p.endsWith(".md"))
          .map(tfile),
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          const f = files.get(p);
          if (!f) throw new Error(`ENOENT: ${p}`);
          if (typeof f.content !== "string") {
            throw new Error(`No content seeded: ${p}`);
          }
          return f.content;
        },
        write: async (p: string, data: string) => {
          files.set(p, {
            path: p,
            content: data,
            frontmatter: files.get(p)?.frontmatter,
          });
        },
        remove: async (p: string) => {
          files.delete(p);
        },
      },
      configDir: ".obsidian",
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const seed = files.get(file.path);
        if (!seed || !seed.frontmatter) return null;
        return { frontmatter: seed.frontmatter };
      },
    },
  } as unknown as App;

  return { app, files };
}

function makeFakeLogger(): { logger: ILogger; errors: string[]; warns: string[] } {
  const errors: string[] = [];
  const warns: string[] = [];
  const logger: ILogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: (msg: string) => {
      errors.push(msg);
    },
  } as unknown as ILogger;
  return { logger, errors, warns };
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

// RFC 01a83de8 Phase 1b T3 — discovery resolves the AssetSpace folder from
// `derivePath(source)`, so `repo` must match the queried folder's <repo>
// segment. Defaults to "test" for the createAssetSpacePusher branches.
function asFrontmatter(uid: string, repo: string = "test"): Record<string, unknown> {
  return {
    "exo__Asset_uid": uid,
    "exo__Instance_class": [`[[${ASSET_SPACE_CLASS_UID}]]`],
    "exo__AssetSpace_source": `https://github.com/kitelev/exoas-${repo}`,
    "exo__AssetSpace_namespace": repo,
  };
}

// ─── (a) empty PAT branch ─────────────────────────────────────────────────

describe("createAssetSpacePusher — branch (a) empty PAT → lookup-only stub", () => {
  it("returns lookup-only stub when PAT is null", async () => {
    const { app } = makeFakeApp([
      {
        path: "assetspaces/test/uid-test.md",
        frontmatter: asFrontmatter("uid-test"),
      },
    ]);
    const { logger, errors } = makeFakeLogger();
    const pusher = createAssetSpacePusher({
      app,
      pat: null,
      notifier: makeFakeNotifier(),
      logger,
      lookupOnly: (folder) => lookupAssetSpaceUidByFolder(app, folder),
    });

    expect(pusher.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-test")).toBe("uid-test");
    await expect(pusher.pushAssetSpace("uid-test")).rejects.toThrow(
      /GitHub PAT not configured/,
    );
    // No error log on the legitimate «no PAT» branch
    expect(errors).toHaveLength(0);
  });

  it("returns lookup-only stub when PAT is empty string", async () => {
    const { app } = makeFakeApp([]);
    const pusher = createAssetSpacePusher({
      app,
      pat: "",
      notifier: makeFakeNotifier(),
      logger: makeFakeLogger().logger,
      lookupOnly: () => null,
    });
    await expect(pusher.pushAssetSpace("any")).rejects.toThrow(
      /GitHub PAT not configured/,
    );
  });
});

// ─── (b) valid PAT branch ─────────────────────────────────────────────────

describe("createAssetSpacePusher — branch (b) valid PAT → AssetSpaceManager", () => {
  it("delegates lookup to AssetSpaceManager when PAT is valid", async () => {
    const { app } = makeFakeApp([
      {
        path: "assetspaces/test/uid-test.md",
        frontmatter: asFrontmatter("uid-test"),
      },
    ]);
    // Fake client factory that records construction calls.
    const constructionCalls: Array<{ pat: string }> = [];
    const clientFactory: GitHubRestClientFactory = (opts) => {
      constructionCalls.push({ pat: opts.pat });
      // Return a minimal client surface — the test only exercises lookup,
      // which doesn't touch the client.
      return {
        ensureRateLimit: async () => undefined,
        createCommit: async () => "a".repeat(40),
      } as never;
    };

    const pusher = createAssetSpacePusher({
      app,
      pat: "ghp_validpat",
      notifier: makeFakeNotifier(),
      logger: makeFakeLogger().logger,
      lookupOnly: () => null, // not used on this branch
      clientFactory,
    });

    expect(constructionCalls).toHaveLength(1);
    expect(constructionCalls[0].pat).toBe("ghp_validpat");
    // Lookup goes through AssetSpaceManager.lookupAssetSpaceForPath, which
    // calls into the shared helper — same result as branch (a).
    expect(pusher.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-test")).toBe("uid-test");
  });
});

// ─── (c) GitHub client ctor throws ────────────────────────────────────────

describe("createAssetSpacePusher — branch (c) ctor throws → fallback stub", () => {
  it("returns lookup-only stub with descriptive error when client ctor throws", async () => {
    const { app } = makeFakeApp([
      {
        path: "assetspaces/test/uid-test.md",
        frontmatter: asFrontmatter("uid-test"),
      },
    ]);
    const { logger, errors } = makeFakeLogger();
    const clientFactory: GitHubRestClientFactory = () => {
      throw new Error("PAT malformed — does not start with ghp_");
    };

    const pusher = createAssetSpacePusher({
      app,
      pat: "invalid-pat",
      notifier: makeFakeNotifier(),
      logger,
      lookupOnly: (folder) => lookupAssetSpaceUidByFolder(app, folder),
      clientFactory,
    });

    // Lookup still works (fallback path uses lookupOnly).
    expect(pusher.lookupAssetSpaceForPath("assetspaces/kitelev/exoas-test")).toBe("uid-test");

    // Push rejects с the wrapped original error message.
    await expect(pusher.pushAssetSpace("uid-test")).rejects.toThrow(
      /Could not initialise AssetSpaceManager.*PAT malformed/,
    );

    // The ctor failure was logged as error (not silent swallow).
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AssetSpaceManager construction failed");
  });
});

// ─── (d) folder lookup integration ────────────────────────────────────────

describe("lookupAssetSpaceUidByFolder — branch (d) integration", () => {
  it("finds matching folder when AS asset is present", () => {
    const { app } = makeFakeApp([
      {
        path: "assetspaces/ems/uid-ems.md",
        frontmatter: asFrontmatter("uid-ems", "ems"),
      },
      {
        path: "assetspaces/exo/uid-exo.md",
        frontmatter: asFrontmatter("uid-exo", "exo"),
      },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/kitelev/exoas-ems")).toBe("uid-ems");
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/kitelev/exoas-exo")).toBe("uid-exo");
  });

  it("returns null when folder has no AS asset", () => {
    const { app } = makeFakeApp([
      {
        path: "assetspaces/ems/uid-ems.md",
        frontmatter: asFrontmatter("uid-ems", "ems"),
      },
    ]);
    expect(lookupAssetSpaceUidByFolder(app, "assetspaces/missing")).toBeNull();
  });
});

// ─── (e) recoverIfNeeded triggered when _switchInProgress=true ────────────

describe("ProfileApplyManager.recoverIfNeeded — branch (e) onload trigger", () => {
  // Minimal fakes mirroring the existing harness in
  // tests/unit/ProfileApplyManager.test.ts but focused on the
  // onload recovery scenario.

  class FakeProfileResolver implements IProfileResolver {
    constructor(private readonly profiles: Map<string, ProfileResolution>) {}
    async resolve(uid: string): Promise<ProfileResolution | null> {
      return this.profiles.get(uid) ?? null;
    }
    async discoverSharedOntologies(): Promise<string[]> {
      return [];
    }
  }

  class FakeRdfIndexer implements IRdfIndexer {
    refreshCount = 0;
    async refresh(): Promise<void> {
      this.refreshCount++;
    }
  }

  class FakeSettingsStore implements ISettingsStore {
    state: SwitchSettings = { activeProfileUid: null, _switchInProgress: false };
    async load(): Promise<SwitchSettings> {
      return { ...this.state };
    }
    async save(s: SwitchSettings): Promise<void> {
      this.state = { ...s };
    }
  }

  function makeMgr(opts: { initialSettings: SwitchSettings; journal?: string }) {
    const { app } = makeFakeApp([]);
    const profile: ProfileResolution = {
      uid: "uid-base",
      includes: [],
      extends: null,
    };
    const resolver = new FakeProfileResolver(
      new Map([["uid-base", profile]]),
    );
    const rdf = new FakeRdfIndexer();
    const settings = new FakeSettingsStore();
    settings.state = opts.initialSettings;
    const lockMgr = new PluginLockManager({
      app,
      pid: "test-pid",
      now: () => new Date("2026-06-02T00:00:00.000Z"),
    });
    const notifyCalls: string[] = [];
    const mgr = new ProfileApplyManager({
      app,
      lockMgr,
      resolver,
      rdfIndexer: rdf,
      settingsStore: settings,
      now: () => new Date("2026-06-02T00:00:00.000Z"),
      notify: (m) => notifyCalls.push(m),
    });
    // Seed journal entry если задан
    return { app, rdf, settings, mgr, notifyCalls };
  }

  it("fires recovery when _switchInProgress=true AND last entry incomplete", async () => {
    const { app, rdf, settings, mgr } = makeMgr({
      initialSettings: { activeProfileUid: "uid-base", _switchInProgress: true },
    });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({
        phase: "starting",
        targetUid: "uid-base",
        ts: "2026-06-01T23:59:00.000Z",
      }) + "\n",
    );

    const result = await mgr.recoverIfNeeded();

    expect(result.recovered).toBe(true);
    expect(result.targetUid).toBe("uid-base");
    expect(rdf.refreshCount).toBe(1);
    expect(settings.state._switchInProgress).toBe(false);
  });

  it("does NOT fire recovery when _switchInProgress=false (clean state)", async () => {
    const { rdf, mgr } = makeMgr({
      initialSettings: {
        activeProfileUid: "uid-base",
        _switchInProgress: false,
      },
    });

    const result = await mgr.recoverIfNeeded();

    expect(result.recovered).toBe(false);
    expect(rdf.refreshCount).toBe(0);
  });

  it("does NOT fire recovery when journal is absent (fresh install)", async () => {
    const { rdf, mgr } = makeMgr({
      initialSettings: { activeProfileUid: null, _switchInProgress: true },
    });

    const result = await mgr.recoverIfNeeded();

    expect(result.recovered).toBe(false);
    expect(rdf.refreshCount).toBe(0);
  });
});
