import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";

interface BootstrapOptions {
  vault: string;
  exo?: string;
  exocmd?: string;
  ref?: string;
  json?: boolean;
}

/**
 * `exocortex bootstrap`
 *
 * Phase 6.2 CLI Bootstrap per RFC 13da049f.
 *
 * Initializes an empty vault с TS-floor AssetSpaces (`exo` + `exocmd`) via
 * GitHub REST tarball pull. Writes `.gitmodules` entries so future `git
 * submodule update` calls work cleanly.
 *
 * Refuses к overwrite vaults that already have TS-floor materialized — this
 * is intentional safety. Existing vaults use `exocortex assetspace add`.
 *
 * Per Architect M_R1 trade-off: TS-floor URL defaults NOT pre-filled with
 * `kitelev/exoas-*` (those don't work для other users). User must provide
 * URLs explicitly; CLI shows kitelev examples в --help text.
 */
export function bootstrapCommand(): Command {
  return new Command("bootstrap")
    .description(
      "Phase 6.2: bootstrap empty vault с TS-floor AssetSpaces (exo + exocmd). Pulls tarballs from public GitHub repos, extracts к assetspaces/, writes .gitmodules. Example URLs: https://github.com/kitelev/exoas-exo, https://github.com/kitelev/exoas-exocmd.",
    )
    .requiredOption("--vault <path>", "Path к target vault")
    .requiredOption(
      "--exo <url>",
      "Public GitHub URL для exo TBox AssetSpace (e.g. https://github.com/kitelev/exoas-exo)",
    )
    .requiredOption(
      "--exocmd <url>",
      "Public GitHub URL для exocmd TBox AssetSpace (e.g. https://github.com/kitelev/exoas-exocmd)",
    )
    .option("--ref <branch>", "Branch ref к pull from", "main")
    .option("--json", "Emit result as JSON", false)
    .action(async (options: BootstrapOptions) => {
      try {
        if (!options.vault) {
          throw new InvalidArgumentsError("--vault is required");
        }
        const vaultPath = resolve(options.vault);
        mkdirSync(vaultPath, { recursive: true });

        // Refuse к bootstrap if vault already has .gitmodules entries or AS folders.
        const gitmodulesPath = join(vaultPath, ".gitmodules");
        const assetspacesPath = join(vaultPath, "assetspaces");
        if (existsSync(gitmodulesPath)) {
          throw new InvalidArgumentsError(
            `Vault ${vaultPath} already has .gitmodules — refusing к re-bootstrap. Use \`assetspace add\` для individual AS.`,
          );
        }
        if (existsSync(assetspacesPath) && readdirSync(assetspacesPath).length > 0) {
          throw new InvalidArgumentsError(
            `Vault ${vaultPath}/assetspaces/ already has content — refusing к re-bootstrap.`,
          );
        }

        const svc = new BootstrapAssetSpaceService();
        const ref = options.ref ?? "main";

        const results: Array<{ folder: string; url: string; sha: string; fileCount: number }> = [];

        // Pull exo → assetspaces/exo
        const exoFolder = "exo";
        const exoTarget = join(vaultPath, "assetspaces", exoFolder);
        process.stderr.write(`[bootstrap] Pulling ${options.exo}@${ref} → assetspaces/${exoFolder}/...\n`);
        const exoResult = await svc.pullAssetSpace(options.exo!, ref, exoTarget);
        svc.ensureGitmodulesEntry(vaultPath, `assetspaces/${exoFolder}`, options.exo!);
        results.push({
          folder: `assetspaces/${exoFolder}`,
          url: options.exo!,
          sha: exoResult.sha,
          fileCount: exoResult.fileCount,
        });

        // Pull exocmd → assetspaces/exocmd
        const exocmdFolder = "exocmd";
        const exocmdTarget = join(vaultPath, "assetspaces", exocmdFolder);
        process.stderr.write(`[bootstrap] Pulling ${options.exocmd}@${ref} → assetspaces/${exocmdFolder}/...\n`);
        const exocmdResult = await svc.pullAssetSpace(options.exocmd!, ref, exocmdTarget);
        svc.ensureGitmodulesEntry(vaultPath, `assetspaces/${exocmdFolder}`, options.exocmd!);
        results.push({
          folder: `assetspaces/${exocmdFolder}`,
          url: options.exocmd!,
          sha: exocmdResult.sha,
          fileCount: exocmdResult.fileCount,
        });

        if (options.json) {
          process.stdout.write(JSON.stringify({ vault: vaultPath, materialized: results }, null, 2) + "\n");
        } else {
          process.stdout.write(`\n✓ Bootstrap complete\n`);
          process.stdout.write(`  Vault: ${vaultPath}\n`);
          for (const r of results) {
            process.stdout.write(`  ${r.folder} ← ${r.url}@${r.sha} (${r.fileCount} files)\n`);
          }
          process.stdout.write(`\nNext steps:\n`);
          process.stdout.write(`  1. cd ${vaultPath} && git init (if not initialized)\n`);
          process.stdout.write(`  2. git add . && git commit -m "feat: bootstrap vault"\n`);
          process.stdout.write(`  3. Add additional AssetSpaces via \`exocortex assetspace add --vault ${vaultPath} --url <github-url>\`\n`);
        }
        process.exit(0);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}
