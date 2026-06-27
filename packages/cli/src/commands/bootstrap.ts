import { Command } from "commander";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { derivePath } from "@kitelev/exocortex-core";
import { BootstrapAssetSpaceService } from "../services/BootstrapAssetSpaceService.js";
import { nodeMountBaseStore } from "./exosync-sync.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { InvalidArgumentsError } from "../utils/errors/index.js";

interface BootstrapOptions {
  vault: string;
  exo?: string;
  ref?: string;
  json?: boolean;
  token?: string;
}

/**
 * `exocortex bootstrap`
 *
 * Phase 6.2 CLI Bootstrap per RFC 13da049f.
 *
 * Initializes a vault with the SDK/engine floor AssetSpace (`exo`) via GitHub
 * REST tarball pull. Writes `.gitmodules` entries so future `git submodule
 * update` calls work cleanly.
 *
 * RFC 01a83de8 §3.4 / alt-G rejection (issue #3426) + req e0e5ad0f (Andrey
 * interview 2026-06-27): `exocmd` is an OPTIONAL UI-command library, NOT part of
 * the SDK floor — and NOT a bootstrap concern. Bootstrap installs only the SDK
 * platform (`exo`, the TS-floor). exocmd is an ordinary AssetSpace, added via
 * `exocortex assetspace add` (or by applying a profile), never bundled into the
 * platform-install step. The previous `--exocmd` opt-in flag was removed to keep
 * bootstrap strictly about the SDK floor.
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
      "Bootstrap a vault with the SDK floor AssetSpace (exo). Pulls a tarball from a public GitHub repo, extracts к assetspaces/, writes .gitmodules. Only --exo is required — bootstrap installs only the SDK platform. exocmd (the optional UI-command library) and any other AssetSpace are added afterwards via `exocortex assetspace add`. Example URL: https://github.com/kitelev/exoas-exo.",
    )
    .requiredOption("--vault <path>", "Path к target vault")
    .requiredOption(
      "--exo <url>",
      "Public GitHub URL для exo TBox AssetSpace (e.g. https://github.com/kitelev/exoas-exo)",
    )
    .option("--ref <branch>", "Branch ref к pull from", "main")
    .option(
      "--token <pat>",
      "GitHub PAT for private repos (or env GITHUB_TOKEN / GH_TOKEN). Optional — anonymous for public repos.",
    )
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

        // Token precedence: --token flag > GITHUB_TOKEN env > GH_TOKEN env.
        // `||` (not `??`) so an empty-string env var (`GITHUB_TOKEN=""`) falls
        // through to the next source instead of pinning anonymous mode.
        // All-empty → undefined → anonymous mode (public repos), unchanged.
        const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
        // #3590 — record each mounted commit SHA as the first-sync 3-way merge
        // base (same device-local file `exosync sync` reads).
        const svc = new BootstrapAssetSpaceService({
          token,
          mountBaseStore: nodeMountBaseStore(vaultPath),
        });
        const ref = options.ref ?? "main";

        const results: Array<{ folder: string; url: string; sha: string; fileCount: number }> = [];

        // Pull exo → Maven mount path `assetspaces/<owner>/<repo>` (RFC 5aa2a73a
        // B4). MUST match `derivePath`, which is what `apply-profile` derives —
        // otherwise a later `apply-profile` re-materializes exo at the Maven path
        // alongside the flat one (double mount of the same AssetSpace UID).
        // Fallback to flat `assetspaces/exo` only if the URL is un-derivable.
        const exoRel = derivePath(options.exo!) ?? "assetspaces/exo";
        const exoTarget = join(vaultPath, exoRel);
        process.stderr.write(`[bootstrap] Pulling ${options.exo}@${ref} → ${exoRel}/...\n`);
        const exoResult = await svc.pullAssetSpace(options.exo!, ref, exoTarget);
        svc.ensureGitmodulesEntry(vaultPath, exoRel, options.exo!);
        results.push({
          folder: exoRel,
          url: options.exo!,
          sha: exoResult.sha,
          fileCount: exoResult.fileCount,
        });

        // exocmd and all other AssetSpaces are NOT bootstrap concerns (req
        // e0e5ad0f, Andrey interview 2026-06-27): bootstrap installs only the
        // SDK floor (exo). Add exocmd later via `exocortex assetspace add`.

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
          process.stdout.write(`  3. (optional) Add the exocmd UI-command library: \`exocortex assetspace add --vault ${vaultPath} --url https://github.com/kitelev/exoas-exocmd\`\n`);
          process.stdout.write(`  4. Add additional AssetSpaces via \`exocortex assetspace add --vault ${vaultPath} --url <github-url>\`\n`);
        }
        process.exit(0);
      } catch (e) {
        ErrorHandler.handle(e as Error);
      }
    });
}
