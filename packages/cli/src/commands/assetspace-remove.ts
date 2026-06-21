import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { derivePath, isTsFloorAssetSpace, isTsFloorMountPath } from "@kitelev/exocortex-core";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import {
  CliApplyProfileService,
  type AssetSpaceInfo,
} from "../services/CliApplyProfileService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError, VaultNotFoundError } from "../utils/errors/index.js";
import { ExitCodes } from "../utils/ExitCodes.js";

interface AssetSpaceRemoveOptions {
  vault: string;
  folder?: string;
  url?: string;
  json?: boolean;
}

/**
 * Resolve the vault-relative mount path to unmount — the inverse of
 * {@link resolveAddAssetSpacePath} (#e6b8827c).
 *
 * Two ways to name the target (at least one required):
 *   - `--folder <path>` — an explicit vault-relative mount path. Accepts both a
 *     full `assetspaces/<owner>/<repo>` (Maven) AND a bare segment (`pmbok`,
 *     `kitelev/exoas-exo`); a value not already rooted at `assetspaces/` is
 *     prefixed. Takes precedence over `--url`.
 *   - `--url <url>` — derive the canonical Maven path `assetspaces/<owner>/<repo>`
 *     via `derivePath` (the SAME deriver `assetspace-add` / `bootstrap` /
 *     `apply-profile` use), so removing by URL targets exactly what adding by
 *     URL mounted. Falls back to the flat `deriveFolderName` only when the URL
 *     is un-derivable.
 *
 * @returns A vault-relative path rooted at `assetspaces/` (never absolute).
 * @throws {InvalidArgumentsError} when neither `--folder` nor `--url` is given.
 */
export function resolveRemoveAssetSpacePath(
  opts: { folder?: string; url?: string },
): string {
  if (opts.folder !== undefined && opts.folder.length > 0) {
    return opts.folder.startsWith("assetspaces/")
      ? opts.folder
      : `assetspaces/${opts.folder}`;
  }
  if (opts.url !== undefined && opts.url.length > 0) {
    return (
      derivePath(opts.url) ??
      `assetspaces/${BootstrapAssetSpaceService.deriveFolderName(opts.url)}`
    );
  }
  throw new InvalidArgumentsError(
    "either --folder or --url is required",
    "exocortex assetspace-remove --vault <path> (--folder <mount-path> | --url <url>)",
  );
}

/** Test seams + stdout/stderr capture for {@link runAssetSpaceRemove}. */
export interface AssetSpaceRemoveDeps {
  /**
   * Override the AssetSpace descriptor scan (floor identity source). Production
   * omits and the run scans the vault via {@link CliApplyProfileService.scanVault}.
   */
  scanInfos?: (vaultPath: string) => AssetSpaceInfo[];
  /**
   * Override the unmount mechanics (test seam). Production omits and the run
   * calls {@link BootstrapAssetSpaceService.unmountAssetSpace}.
   */
  unmount?: (vaultPath: string, submodulePath: string) => void;
  /** Override stdout sink (defaults to `process.stdout`). */
  out?: (msg: string) => void;
  /** Override stderr sink (defaults to `process.stderr`). */
  err?: (msg: string) => void;
}

export interface AssetSpaceRemoveResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
  /** True when the unmount ran (was NOT refused by the TS-floor guard). */
  removed: boolean;
  /** Vault-relative mount path that was targeted. */
  folder: string;
}

/**
 * `exocortex assetspace-remove` — unmount a single AssetSpace (#e6b8827c). The
 * inverse of `assetspace-add`: strips the `.gitmodules` stanza and deletes the
 * mount folder via the already-shipped, path-safe
 * {@link BootstrapAssetSpaceService.unmountAssetSpace}.
 *
 * ## TS-floor refuse (floor-policy A — «refuse, не rescue»)
 *
 * A TS-floor AssetSpace (`{exo}` per RFC 5aa2a73a / #3440 — matched by legacy
 * UID OR `exo__AssetSpace_namespace` via {@link isTsFloorAssetSpace}) is REFUSED
 * with a clear message + non-zero exit, BEFORE any mutation — exactly as
 * `apply-profile`'s R24 guard refuses a profile that would strip the floor.
 * Tearing the floor down would brick the runtime (no class defs). The floor
 * descriptor is resolved by matching the target mount path against the
 * AssetSpace descriptor scan; an un-described mount is non-floor.
 *
 * @returns A struct with the exit code + informational messages so tests can
 *   assert outcomes without spying on process streams (mirrors `apply-profile`).
 */
export async function runAssetSpaceRemove(
  opts: AssetSpaceRemoveOptions,
  deps: AssetSpaceRemoveDeps = {},
): Promise<AssetSpaceRemoveResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = (msg: string) => {
    stdout.push(msg);
    (deps.out ?? ((m: string) => process.stdout.write(`${m}\n`)))(msg);
  };
  const err = (msg: string) => {
    stderr.push(msg);
    (deps.err ?? ((m: string) => process.stderr.write(`${m}\n`)))(msg);
  };

  if (!opts.vault) {
    throw new InvalidArgumentsError("--vault is required");
  }
  const vaultPath = resolve(opts.vault);
  if (!existsSync(vaultPath)) {
    throw new VaultNotFoundError(vaultPath);
  }

  const folder = resolveRemoveAssetSpacePath(opts);

  // TS-floor guard (BEFORE any mutation). Match the target mount path against
  // the AssetSpace descriptor scan to recover its uid + namespace, AND apply the
  // path-based guard so a floor mounted flat / with an un-derivable descriptor
  // (whose `folderName` join misses) is still refused.
  const infos =
    deps.scanInfos?.(vaultPath) ??
    new CliApplyProfileService({ vaultPath }).scanVault().infos;
  const match = infos.find((i) => i.folderName === folder);
  const floorByDescriptor =
    match !== undefined && isTsFloorAssetSpace(match.uid, match.namespace);
  if (floorByDescriptor || isTsFloorMountPath(folder)) {
    const ident = match?.label ?? folder;
    const detail = match
      ? `${match.namespace || match.uid}`
      : "path resolves to a floor namespace";
    err(
      `[assetspace-remove] Refused: «${ident}» ` +
        `(${detail}) is a TS-floor AssetSpace — ` +
        `unmounting it would self-brick the runtime (R24). Aborted, no changes made.`,
    );
    return {
      exitCode: ExitCodes.OPERATION_FAILED,
      stdout,
      stderr,
      removed: false,
      folder,
    };
  }

  const existedBefore = existsSync(join(vaultPath, folder));
  const unmount =
    deps.unmount ??
    ((v: string, s: string) =>
      new BootstrapAssetSpaceService().unmountAssetSpace(v, s));
  try {
    unmount(vaultPath, folder);
  } catch (e) {
    err(
      `[assetspace-remove] Unmount failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return {
      exitCode: ExitCodes.OPERATION_FAILED,
      stdout,
      stderr,
      removed: false,
      folder,
    };
  }

  if (opts.json) {
    out(
      JSON.stringify(
        {
          vault: vaultPath,
          folder,
          existedBefore,
          unmounted: true,
        },
        null,
        2,
      ),
    );
  } else if (existedBefore) {
    out(`\n✓ AssetSpace unmounted`);
    out(`  Folder: ${folder} (removed from vault + .gitmodules)`);
  } else {
    out(`\n✓ AssetSpace already absent — .gitmodules stanza stripped (no-op)`);
    out(`  Folder: ${folder}`);
  }

  return {
    exitCode: ExitCodes.SUCCESS,
    stdout,
    stderr,
    removed: true,
    folder,
  };
}

export function assetSpaceRemoveCommand(): Command {
  return new Command("assetspace-remove")
    .description(
      "Unmount a single AssetSpace (inverse of assetspace-add). Strips its .gitmodules stanza and deletes the mount folder. TS-floor AssetSpaces ({exo}) are refused.",
    )
    .requiredOption("--vault <path>", "Path to target vault")
    .option(
      "--folder <path>",
      "Vault-relative mount path to unmount (e.g. assetspaces/kitelev/exoas-pmbok-ontology). Takes precedence over --url.",
    )
    .option(
      "--url <url>",
      "Public GitHub URL of the AssetSpace — derives the canonical mount path (parity with assetspace-add).",
    )
    .option("--json", "Emit result as JSON", false)
    .action(async (options: AssetSpaceRemoveOptions) => {
      try {
        const result = await runAssetSpaceRemove(options);
        process.exit(result.exitCode);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}
