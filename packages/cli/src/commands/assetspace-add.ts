import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { derivePath } from "exocortex";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import { nodeMountBaseStore } from "./exosync-sync.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError, VaultNotFoundError } from "../utils/errors/index.js";

interface AssetSpaceAddOptions {
  vault: string;
  url: string;
  folder?: string;
  ref?: string;
  json?: boolean;
  token?: string;
}

/**
 * Resolve the vault-relative mount path for `assetspace-add` (#3538).
 *
 * Defaults to the canonical Maven path `assetspaces/<owner>/<repo>` — the SAME
 * path `bootstrap` (`bootstrap.ts`) and `apply-profile`
 * (`CliApplyProfileService`) derive via `derivePath`. Aligning here closes the
 * latent double-mount gap: a flat `assetspaces/<name>` folder is not recognised
 * as materialised by `apply-profile` (which checks the canonical `derivePath`),
 * so the same AssetSpace UID would re-mount at the Maven path.
 *
 * An explicit `--folder` override still maps to the flat `assetspaces/<folder>`
 * (the documented manual escape hatch). Falls back to the flat
 * `deriveFolderName` only when the URL is un-derivable (`derivePath` → null),
 * mirroring `bootstrap.ts`'s `?? "assetspaces/exo"` fallback.
 *
 * @returns A vault-relative path rooted at `assetspaces/` (never absolute).
 */
export function resolveAddAssetSpacePath(
  url: string,
  folderOverride?: string,
): string {
  if (folderOverride !== undefined && folderOverride.length > 0) {
    return `assetspaces/${folderOverride}`;
  }
  return (
    derivePath(url) ??
    `assetspaces/${BootstrapAssetSpaceService.deriveFolderName(url)}`
  );
}

/**
 * `exocortex assetspace-add`
 *
 * Phase 6.3 CLI Add AssetSpace per RFC 13da049f.
 *
 * Adds a single AssetSpace к existing vault by GitHub URL. Pulls tarball,
 * extracts к `assetspaces/<folder>/`, updates `.gitmodules`. Idempotent on
 * `.gitmodules` — re-running с same URL is no-op for the registry entry.
 *
 * Default folder name derived from URL: `exoas-pmbok` → `pmbok` (strips
 * `exoas-` prefix). Override с `--folder`.
 */
export function assetSpaceAddCommand(): Command {
  return new Command("assetspace-add")
    .description(
      "Phase 6.3: add single AssetSpace к existing vault by public GitHub URL. Pulls tarball, extracts к assetspaces/<folder>/, updates .gitmodules.",
    )
    .requiredOption("--vault <path>", "Path к target vault")
    .requiredOption(
      "--url <url>",
      "Public GitHub URL для the AssetSpace (e.g. https://github.com/kitelev/exoas-pmbok-ontology)",
    )
    .option(
      "--folder <name>",
      "Local folder name под assetspaces/. Defaults к URL-derived (strips exoas- prefix)",
    )
    .option("--ref <branch>", "Branch ref к pull from", "main")
    .option(
      "--token <pat>",
      "GitHub PAT for private repos (or env GITHUB_TOKEN / GH_TOKEN). Optional — anonymous for public repos.",
    )
    .option("--json", "Emit result as JSON", false)
    .action(async (options: AssetSpaceAddOptions) => {
      try {
        if (!options.vault) {
          throw new InvalidArgumentsError("--vault is required");
        }
        if (!options.url) {
          throw new InvalidArgumentsError("--url is required");
        }
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Token precedence: --token flag > GITHUB_TOKEN env > GH_TOKEN env.
        // `||` (not `??`) so an empty-string env var (`GITHUB_TOKEN=""`) falls
        // through to the next source instead of pinning anonymous mode.
        // All-empty → undefined → anonymous mode (public repos), unchanged.
        const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
        // #3590 — record the mounted commit SHA as the first-sync 3-way merge
        // base (same device-local file `exosync sync` reads).
        const svc = new BootstrapAssetSpaceService({
          token,
          mountBaseStore: nodeMountBaseStore(vaultPath),
        });
        const ref = options.ref ?? "main";
        // #3538: default to the canonical Maven path `assetspaces/<owner>/<repo>`
        // (parity with bootstrap + apply-profile). `--folder` still overrides to
        // a flat `assetspaces/<folder>`.
        const assetspaceRel = resolveAddAssetSpacePath(options.url, options.folder);
        const targetDir = join(vaultPath, assetspaceRel);

        process.stderr.write(`[assetspace-add] Pulling ${options.url}@${ref} → ${assetspaceRel}/...\n`);
        const result = await svc.pullAssetSpace(options.url, ref, targetDir);
        const gitmodulesResult = svc.ensureGitmodulesEntry(
          vaultPath,
          assetspaceRel,
          options.url,
        );

        if (options.json) {
          process.stdout.write(
            JSON.stringify(
              {
                vault: vaultPath,
                folder: assetspaceRel,
                url: options.url,
                sha: result.sha,
                fileCount: result.fileCount,
                gitmodulesEntryAdded: gitmodulesResult.added,
              },
              null,
              2,
            ) + "\n",
          );
        } else {
          process.stdout.write(`\n✓ AssetSpace added\n`);
          process.stdout.write(`  Folder: ${assetspaceRel}\n`);
          process.stdout.write(`  URL: ${options.url}\n`);
          process.stdout.write(`  SHA: ${result.sha} (${result.fileCount} files)\n`);
          process.stdout.write(`  .gitmodules: ${gitmodulesResult.added ? "entry added" : "entry already present"}\n`);
        }
        process.exit(0);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}
