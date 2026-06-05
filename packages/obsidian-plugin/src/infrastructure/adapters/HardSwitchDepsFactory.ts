import type { App } from "obsidian";
import type { INotificationService } from "exocortex";

import type { ILogger } from "../../adapters/logging/ILogger";

import { LocalSecretsStore } from "./LocalSecretsStore";
import { GitHubRestClient } from "./GitHubRestClient";
import { StagingDirTracker } from "./StagingDirTracker";
import { AssetSpaceManager } from "./AssetSpaceManager";
import { GitSubmoduleOps } from "./GitSubmoduleOps";
import { UncommittedChangesGuard } from "./UncommittedChangesGuard";
import { ModalConfirmGate } from "./ModalConfirmGate";
import { SwitchCacheLayer } from "./SwitchCacheLayer";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";

/**
 * Desktop-only hard-switch dependency bundle consumed by
 * `FocusProfileSwitchManager` + the gated palette commands (hard
 * «Switch knowledge profile», «Bootstrap vault», «Add AssetSpace by URL»).
 *
 * When this is `null` the gated commands are NOT registered — so a wiring
 * exception here silently removes user-facing commands from the palette.
 */
export interface HardSwitchDeps {
  assetSpaceManager: AssetSpaceManager;
  gitOps: GitSubmoduleOps;
  uncommittedGuard: UncommittedChangesGuard;
  confirmGate: ModalConfirmGate;
  cacheLayer: SwitchCacheLayer;
  vaultRootPath: string;
}

export interface BuildHardSwitchDepsOptions {
  app: App;
  localDataStore: PluginLocalDataStore;
  notifier: INotificationService;
  logger: ILogger;
}

/**
 * Wire the desktop hard-switch dependencies. Extracted from
 * `ExocortexPlugin.onload` for testability (mirrors the
 * {@link ./AssetSpacePusherFactory.createAssetSpacePusher} extraction).
 *
 * Callers MUST guard with `!Platform.isMobile` before invoking — mobile
 * Obsidian has no Node `fs`/`child_process`, so StagingDirTracker /
 * GitSubmoduleOps cannot run there.
 *
 * Returns `null` (and logs) when:
 *   - `vault.adapter.basePath` is unavailable (no filesystem root → git ops
 *     impossible), or
 *   - any constructor in the chain throws.
 *
 * Crucially this tolerates an ABSENT GitHub PAT: `getSecret("pat")` returns
 * `null` on a vault that has never configured one (the common case), and
 * `GitHubRestClient` now accepts an empty PAT (unauthenticated mode) so the
 * deps still wire. Before that fix, the empty-PAT ctor throw left
 * `hardSwitchDeps === null` and the gated commands silently vanished.
 */
export async function buildHardSwitchDeps(
  opts: BuildHardSwitchDepsOptions,
): Promise<HardSwitchDeps | null> {
  const { app, localDataStore, notifier, logger } = opts;
  try {
    const secretsStore = new LocalSecretsStore({ app });
    const pat = await secretsStore.getSecret("pat");
    const githubClient = new GitHubRestClient({ app, pat: pat ?? "" });
    const stagingTracker = new StagingDirTracker({ localDataStore });
    const assetSpaceManager = new AssetSpaceManager({
      app,
      client: githubClient,
      notifications: notifier,
      stagingTracker,
    });
    const vaultRootPath =
      (app.vault.adapter as unknown as { basePath?: string }).basePath ?? "";
    if (vaultRootPath.length === 0) {
      logger.warn(
        "[buildHardSwitchDeps] vault.adapter.basePath unavailable — hard switch palette will be hidden",
      );
      return null;
    }
    const gitOps = new GitSubmoduleOps({ vaultRootPath });
    const uncommittedGuard = new UncommittedChangesGuard({ gitOps });
    const confirmGate = new ModalConfirmGate(app);
    const cacheLayer = new SwitchCacheLayer();
    return {
      assetSpaceManager,
      gitOps,
      uncommittedGuard,
      confirmGate,
      cacheLayer,
      vaultRootPath,
    };
  } catch (err) {
    // Visible diagnostics — `logger.warn` routes through a custom logger that
    // is NOT printed to the DevTools console, so this exception was invisible
    // in production for months. `console.error` makes it observable.
    console.error("[Exocortex] hard-switch wiring failed:", err);
    logger.warn(
      "[buildHardSwitchDeps] failed to wire hard-switch deps; soft switch only",
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}
