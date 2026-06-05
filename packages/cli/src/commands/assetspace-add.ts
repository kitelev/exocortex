import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
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
        // Undefined → anonymous mode (public repos only), unchanged behaviour.
        const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
        const svc = new BootstrapAssetSpaceService({ token });
        const ref = options.ref ?? "main";
        const folder = options.folder ?? BootstrapAssetSpaceService.deriveFolderName(options.url);
        const targetDir = join(vaultPath, "assetspaces", folder);

        process.stderr.write(`[assetspace-add] Pulling ${options.url}@${ref} → assetspaces/${folder}/...\n`);
        const result = await svc.pullAssetSpace(options.url, ref, targetDir);
        const gitmodulesResult = svc.ensureGitmodulesEntry(
          vaultPath,
          `assetspaces/${folder}`,
          options.url,
        );

        if (options.json) {
          process.stdout.write(
            JSON.stringify(
              {
                vault: vaultPath,
                folder: `assetspaces/${folder}`,
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
          process.stdout.write(`  Folder: assetspaces/${folder}\n`);
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
