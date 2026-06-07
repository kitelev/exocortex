/**
 * @jest-environment node
 *
 * Production-shape regression test for Issue #3382 — Bootstrap / Add-AssetSpace
 * pulls must authenticate with the PAT current at COMMAND-EXECUTION time, not
 * the one captured at plugin onload.
 *
 * Exercises the REAL wiring chain — `LocalSecretsStore` (data.local.json) →
 * `GitHubRestClient` → `AssetSpaceManager` (via `buildAssetSpacePuller`) →
 * `BootstrapAssetSpaceCommands` — against an in-memory `vault.adapter` that
 * mirrors the Obsidian contract (per `test-fixture-realism`). The only seam is
 * obsidian's `requestUrl`, spied to capture the outgoing Authorization header.
 * NONE of the PAT-reading / client-building is stubbed — that is exactly the
 * code path the bug lived in.
 *
 * The tarball fetch deliberately returns non-gzip bytes so the pull fails
 * AFTER its REST request (carrying the Authorization header) has fired and
 * the staging dir is released — the test asserts on the captured header, not
 * on a materialised vault, and leaves no temp dirs behind.
 *
 * Discrimination (revert-verify): the lazy provider yields `Bearer <new PAT>`;
 * an eager provider built BEFORE the PAT is stored (the pre-fix onload-capture
 * behaviour) yields NO Authorization header. Both directions are asserted
 * below, so the suite fails if the lazy wiring regresses to eager capture.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import * as obsidian from "obsidian";
import type { App } from "obsidian";
import type { INotificationService } from "exocortex";

import { buildAssetSpacePuller } from "../../../src/infrastructure/adapters/ApplyDepsFactory";
import { LocalSecretsStore } from "../../../src/infrastructure/adapters/LocalSecretsStore";
import { PluginLocalDataStore } from "../../../src/infrastructure/adapters/PluginLocalDataStore";
import { GitHubRestClient } from "../../../src/infrastructure/adapters/GitHubRestClient";
import {
  BootstrapAssetSpaceCommands,
  type BootstrapAssetSpaceCommandsDeps,
  type IAssetSpacePuller,
} from "../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

// Synthetic, never-real classic token shape (ghp_ + 36 chars). Only ever
// appears in the spied request headers — never sent to the network.
const NEW_PAT = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3382";
const PRIVATE_URL = "https://github.com/kitelev/exoas-private";

interface CapturedRequest {
  url: string;
  auth: string | undefined;
}

function makeApp(): { app: App; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const adapter = {
    exists: async (p: string) =>
      Object.prototype.hasOwnProperty.call(files, p),
    read: async (p: string) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p];
    },
    write: async (p: string, data: string) => {
      files[p] = data;
    },
    list: async () => ({ files: [], folders: [] }),
  };
  const app = {
    vault: {
      adapter,
      configDir: ".obsidian",
      getMarkdownFiles: () => [],
    },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
  return { app, files };
}

function makeNotifier(): INotificationService {
  return {
    info: () => undefined,
    success: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    confirm: async () => true,
  };
}

function deriveFolderName(url: string): string {
  const repo = url.split("/").pop() ?? "unknown";
  return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
}

function makeDeps(
  getPuller: () => Promise<IAssetSpacePuller>,
  notices: string[],
): BootstrapAssetSpaceCommandsDeps {
  return {
    getPuller,
    gitOps: {
      renameIntoVault: async () => undefined,
      readGitmodulesEntries: async () => [],
      appendGitmodulesEntry: async () => ({ added: true }),
    },
    localStore: { upsertFileOnlyAssetSpace: async () => undefined },
    vaultExists: async (p: string) => p === ".git",
    listFolder: async () => ({ files: [], folders: [] }),
    isGitVault: async () => true,
    validateUrl: (url: string) => GitHubRestClient.validateRepoURL(url),
    deriveFolderName,
    promptBootstrapUrls: async () => null,
    promptAddAssetSpaceUrl: async () => ({ url: PRIVATE_URL }),
    confirm: async () => true,
    notify: (m: string) => notices.push(m),
  };
}

describe("Bootstrap/Add-AssetSpace PAT freshness (Issue #3382) — production-shape", () => {
  let captured: CapturedRequest[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requestUrlSpy: jest.SpiedFunction<any>;

  beforeEach(() => {
    captured = [];
    requestUrlSpy = jest
      .spyOn(obsidian, "requestUrl")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (req: any) => {
        captured.push({
          url: req.url as string,
          auth: req.headers?.Authorization as string | undefined,
        });
        if (/\/rate_limit$/.test(req.url)) {
          return {
            status: 200,
            json: {
              resources: {
                core: {
                  remaining: 5000,
                  reset: Math.floor(Date.now() / 1000) + 3600,
                },
              },
            },
            text: "",
            arrayBuffer: new ArrayBuffer(0),
            headers: {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any;
        }
        // Tarball endpoint — return non-gzip bytes so extraction fails AFTER
        // this request (and its Authorization header) has been recorded.
        return {
          status: 200,
          json: {},
          text: "",
          arrayBuffer: new Uint8Array([0, 1, 2, 3]).buffer,
          headers: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      });
  });

  afterEach(() => {
    requestUrlSpy.mockRestore();
  });

  it("lazy provider authenticates with the PAT set AFTER onload", async () => {
    const { app } = makeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    const notifier = makeNotifier();
    const notices: string[] = [];

    // Wiring exactly as ExocortexPlugin.registerBootstrapCommands does it:
    // a lazy provider that rebuilds the puller from the CURRENT stored PAT.
    const deps = makeDeps(
      () => buildAssetSpacePuller({ app, localDataStore: store, notifier }),
      notices,
    );
    const cmds = new BootstrapAssetSpaceCommands(deps);

    // Onload already happened (cmds constructed) with NO PAT in the vault.
    // The user now configures a PAT in Settings — WITHOUT reloading.
    await new LocalSecretsStore({ app }).setSecret("pat", NEW_PAT);

    await cmds.invokeAddAssetSpace();

    const tarballCall = captured.find((c) => c.url.includes("/tarball/"));
    expect(tarballCall).toBeDefined();
    expect(tarballCall?.auth).toBe(`Bearer ${NEW_PAT}`);
    // The pre-flight rate-limit gate used the same fresh client.
    const rateCall = captured.find((c) => /\/rate_limit$/.test(c.url));
    expect(rateCall?.auth).toBe(`Bearer ${NEW_PAT}`);
  });

  it("eager onload-captured provider sends NO PAT (the bug the lazy fix avoids)", async () => {
    const { app } = makeApp();
    const store = new PluginLocalDataStore({ app });
    await store.init();
    const notifier = makeNotifier();
    const notices: string[] = [];

    // Pre-fix behaviour: build the puller NOW, while the vault has no PAT
    // (mirrors capturing `applyDeps.assetSpaceManager` at plugin onload).
    const eagerPuller = await buildAssetSpacePuller({
      app,
      localDataStore: store,
      notifier,
    });
    const deps = makeDeps(async () => eagerPuller, notices);
    const cmds = new BootstrapAssetSpaceCommands(deps);

    // User configures the PAT afterwards — the frozen client never sees it.
    await new LocalSecretsStore({ app }).setSecret("pat", NEW_PAT);

    await cmds.invokeAddAssetSpace();

    const tarballCall = captured.find((c) => c.url.includes("/tarball/"));
    expect(tarballCall).toBeDefined();
    // Empty PAT → GitHubRestClient omits the Authorization header entirely.
    expect(tarballCall?.auth).toBeUndefined();
  });
});
