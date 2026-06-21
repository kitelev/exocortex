import type { App } from "obsidian";
import type { ILogger, INotificationService } from "@kitelev/exocortex-core";

import { AssetSpaceManager } from "./AssetSpaceManager";
import {
  GitHubRestClient,
  type GitHubRestClientOptions,
} from "./GitHubRestClient";
import type { IAssetSpacePusher } from "./ProfileCommands";

/**
 * Lookup-only helper from {@link AssetSpaceLookupHelper.lookupAssetSpaceUidByFolder}.
 * Used by the PAT-absent and ctor-failure branches as the `lookupAssetSpaceForPath`
 * implementation while `pushAssetSpace` is unavailable.
 */
export type AssetSpaceLookupFn = (folderName: string) => string | null;

/**
 * Optional GitHubRestClient factory — tests inject a function that throws
 * to exercise the ctor-failure branch без monkey-patching the module. Default
 * constructs the real client.
 */
export type GitHubRestClientFactory = (
  opts: GitHubRestClientOptions,
) => GitHubRestClient;

export interface CreateAssetSpacePusherOptions {
  app: App;
  /** Resolved GitHub PAT, or `null`/empty when none configured. */
  pat: string | null;
  notifier: INotificationService;
  logger: ILogger;
  /** Vault-scan lookup used by lookup-only branches. */
  lookupOnly: AssetSpaceLookupFn;
  /** Optional client factory for tests. */
  clientFactory?: GitHubRestClientFactory;
}

/**
 * Factory for `IAssetSpacePusher`. Extracted from `ExocortexPlugin.buildAssetSpacePusher`
 * for testability (Issue #3327 Item #1).
 *
 * Branches:
 *   - `pat == null || pat.length === 0` → lookup-only stub, push rejects with
 *     a «Configure GitHub PAT» message.
 *   - `pat` valid → constructs `AssetSpaceManager`; lookup and push both
 *     delegate to it.
 *   - client ctor throws (PAT invalid shape, network init crash, allowlist
 *     fail) → lookup-only stub, push rejects with the original error message;
 *     logger.error records the failure.
 */
export function createAssetSpacePusher(
  options: CreateAssetSpacePusherOptions,
): IAssetSpacePusher {
  const { app, pat, notifier, logger, lookupOnly } = options;
  const clientFactory =
    options.clientFactory ?? ((opts) => new GitHubRestClient(opts));

  if (pat === null || pat.length === 0) {
    return {
      lookupAssetSpaceForPath: lookupOnly,
      pushAssetSpace: () =>
        Promise.reject(
          new Error(
            "GitHub PAT not configured — set it в Settings → Exocortex → GitHub PAT",
          ),
        ),
    };
  }

  try {
    const client = clientFactory({ pat, app });
    const manager = new AssetSpaceManager({
      app,
      client,
      notifications: notifier,
    });
    return {
      lookupAssetSpaceForPath: (folderName) =>
        manager.lookupAssetSpaceForPath(folderName),
      pushAssetSpace: async (asUid) => {
        const sha = await manager.pushAssetSpace(asUid);
        // `AssetSpaceManager.pushAssetSpace` returns `Promise<string | null>`
        // (`null` = no dirty files, no-op success). Coerce `null` → `""` to
        // match `IAssetSpacePusher` contract, which treats empty string as
        // «no-op».
        return sha ?? "";
      },
    };
  } catch (error) {
    logger.error(
      "[AssetSpacePusherFactory] AssetSpaceManager construction failed — push command will fail-clean",
      error instanceof Error ? error : new Error(String(error)),
    );
    return {
      lookupAssetSpaceForPath: lookupOnly,
      pushAssetSpace: () =>
        Promise.reject(
          new Error(
            `Could not initialise AssetSpaceManager: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        ),
    };
  }
}
