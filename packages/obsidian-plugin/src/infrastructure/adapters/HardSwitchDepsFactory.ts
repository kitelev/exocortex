import type { App } from "obsidian";
import type { INotificationService } from "exocortex";

import type { ILogger } from "../../adapters/logging/ILogger";

import { LocalSecretsStore } from "./LocalSecretsStore";
import { GitHubRestClient } from "./GitHubRestClient";
import { StagingDirTracker } from "./StagingDirTracker";
import { AssetSpaceManager } from "./AssetSpaceManager";
import { GitSubmoduleOps } from "./GitSubmoduleOps";
import { RestAssetSpaceMount } from "./RestAssetSpaceMount";
import { UncommittedChangesGuard } from "./UncommittedChangesGuard";
import { ModalConfirmGate } from "./ModalConfirmGate";
import { SwitchCacheLayer } from "./SwitchCacheLayer";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";

/**
 * Desktop-only hard-switch dependency bundle consumed by
 * `ProfileApplyManager` + the gated palette commands (hard
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

export interface BuildAssetSpacePullerOptions {
  app: App;
  localDataStore: PluginLocalDataStore;
  notifier: INotificationService;
}

/**
 * Build a fresh {@link AssetSpaceManager} (the REST tarball puller used by the
 * Bootstrap / Add-AssetSpace commands and the hard-switch materialize path)
 * from the CURRENTLY stored GitHub PAT.
 *
 * Reads `LocalSecretsStore.getSecret("pat")` at call time. Invoking this
 * per command-execution — rather than caching the value captured at plugin
 * onload — picks up a PAT the user configured AFTER load without a reload.
 * This is the fix for Issue #3382: the onload-captured manager held a stale
 * empty-PAT (unauthenticated) client, so a Bootstrap / Add-AssetSpace pull of
 * a PRIVATE repo failed with 401/404 even though the user had since entered a
 * valid PAT in Settings.
 *
 * An absent PAT (`getSecret` → null) yields an unauthenticated client (empty
 * string) — `GitHubRestClient` accepts that for public-repo reads.
 */
export async function buildAssetSpacePuller(
  opts: BuildAssetSpacePullerOptions,
): Promise<AssetSpaceManager> {
  const { app, localDataStore, notifier } = opts;
  const secretsStore = new LocalSecretsStore({ app });
  const pat = await secretsStore.getSecret("pat");
  const githubClient = new GitHubRestClient({ app, pat: pat ?? "" });
  const stagingTracker = new StagingDirTracker({ localDataStore });
  return new AssetSpaceManager({
    app,
    client: githubClient,
    notifications: notifier,
    stagingTracker,
  });
}

/**
 * Build a {@link RestAssetSpaceMount} (RFC 01a83de8 Phase 3 T1) from the
 * currently-stored GitHub PAT. Cross-platform — uses `requestUrl` + tarball +
 * `vault.adapter`, so it works on mobile (unlike {@link GitSubmoduleOps}).
 *
 * The PAT is captured at call time. The plugin wires this once at onload (the
 * mobile profile-switch path consumes it); a PAT configured AFTER onload needs
 * a reload to take effect — the same onload-capture tradeoff as the hard-switch
 * `assetSpaceManager`. An absent PAT yields an unauthenticated client
 * (public-repo reads only).
 */
export async function buildRestAssetSpaceMount(opts: {
  app: App;
}): Promise<RestAssetSpaceMount> {
  const { app } = opts;
  const secretsStore = new LocalSecretsStore({ app });
  const pat = await secretsStore.getSecret("pat");
  const client = new GitHubRestClient({ app, pat: pat ?? "" });
  return new RestAssetSpaceMount({ app, client });
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
    // NOTE: this AssetSpaceManager is captured for the lifetime of the plugin
    // (used by the hard-switch materialize + push paths). The Bootstrap /
    // Add-AssetSpace commands deliberately do NOT reuse it — they rebuild a
    // fresh one per invocation via {@link buildAssetSpacePuller} so a PAT set
    // after onload is honoured (Issue #3382). Hard-switch / push keep onload
    // capture (they surface a «Reload to activate» hint instead).
    const assetSpaceManager = await buildAssetSpacePuller({
      app,
      localDataStore,
      notifier,
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
