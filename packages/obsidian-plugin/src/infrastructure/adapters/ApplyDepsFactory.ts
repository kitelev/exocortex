import type { App } from "obsidian";
import {
  FileMountBaseStore,
  MOUNT_BASE_STORE_FILENAME,
  type INotificationService,
} from "exocortex";
import { vaultWatermarkFileIO } from "./SyncDepsFactory";

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
 * Desktop-only apply dependency bundle consumed by
 * `ProfileApplyManager` + the gated palette commands (hard
 * «Switch knowledge profile», «Bootstrap vault», «Add AssetSpace by URL»).
 *
 * When this is `null` the gated commands are NOT registered — so a wiring
 * exception here silently removes user-facing commands from the palette.
 */
export interface ApplyDeps {
  assetSpaceManager: AssetSpaceManager;
  gitOps: GitSubmoduleOps;
  uncommittedGuard: UncommittedChangesGuard;
  confirmGate: ModalConfirmGate;
  cacheLayer: SwitchCacheLayer;
  vaultRootPath: string;
}

export interface BuildApplyDepsOptions {
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
 * Bootstrap / Add-AssetSpace commands and the apply materialize path)
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
 * a reload to take effect — the same onload-capture tradeoff as the apply
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
  // #3590 — the mount records the first-sync 3-way merge base into the same
  // device-local file (`exosync-mountbase.local.json`) the sync engine reads
  // (built identically in `SyncDepsFactory`).
  const mountBasePath = `${app.vault.configDir}/plugins/exocortex/${MOUNT_BASE_STORE_FILENAME}`;
  const mountBaseStore = new FileMountBaseStore(
    vaultWatermarkFileIO(app.vault.adapter, mountBasePath),
  );
  return new RestAssetSpaceMount({ app, client, mountBaseStore });
}

/**
 * Wire the desktop apply dependencies. Extracted from
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
 * `applyDeps === null` and the gated commands silently vanished.
 */
export async function buildApplyDeps(
  opts: BuildApplyDepsOptions,
): Promise<ApplyDeps | null> {
  const { app, localDataStore, notifier, logger } = opts;
  try {
    // NOTE: this AssetSpaceManager is captured for the lifetime of the plugin
    // (used by the apply materialize + push paths). The Bootstrap /
    // Add-AssetSpace commands deliberately do NOT reuse it — they rebuild a
    // fresh one per invocation via {@link buildAssetSpacePuller} so a PAT set
    // after onload is honoured (Issue #3382). Apply / push keep onload
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
        "[buildApplyDeps] vault.adapter.basePath unavailable — apply palette will be hidden",
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
    console.error("[Exocortex] apply wiring failed:", err);
    logger.warn(
      "[buildApplyDeps] failed to wire apply deps; reindex only",
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }
}
