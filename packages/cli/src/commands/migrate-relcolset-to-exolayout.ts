import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { NodeFsAdapter } from "../adapters/NodeFsAdapter.js";
import { ErrorHandler } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import {
  RelColSetToExoLayoutMigratorService,
  extractRelColSetConfig,
  isRelColSetFrontmatter,
  type GeneratedLayoutPair,
  type MigrationResult,
} from "../services/RelColSetToExoLayoutMigratorService.js";

interface MigrateOptions {
  vault: string;
  outDir: string;
  apply?: boolean;
  json?: boolean;
}

/**
 * Creates the `migrate-relcolset-to-exolayout` subcommand.
 *
 * Scans a vault for `ui__RelationColumnSet` configs and generates an
 * equivalent `exo__Layout` + `exo__BacklinksTableBlock` asset pair for each.
 * Dry-run by default — prints YAML previews and warnings to stderr. Pass
 * `--apply` to write two files per pair into `--out-dir`.
 *
 * Part B of RFC exo__Layout Phase 4 (task 07ceb846). See
 * `docs/RELATION_COLUMN_SET.md` for deprecation context and the
 * additive-vs-replacing semantic gap this command cannot bridge automatically.
 */
export function migrateRelColSetToExoLayoutCommand(): Command {
  return new Command("migrate-relcolset-to-exolayout")
    .description(
      "Generate exo__Layout + exo__BacklinksTableBlock pairs from existing ui__RelationColumnSet configs (dry-run by default; --apply to write)",
    )
    .requiredOption("--vault <path>", "Path to the source vault")
    .option(
      "--out-dir <path>",
      "Vault-relative folder where generated Layout+Block files land on --apply",
      "exo-layout-migrated",
    )
    .option(
      "--apply",
      "Write generated files to the vault (default: dry-run, prints to stderr)",
      false,
    )
    .option("--json", "Emit the migration report as JSON to stdout", false)
    .action(async (options: MigrateOptions) => {
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const fsAdapter = new NodeFsAdapter(vaultPath);
        const service = new RelColSetToExoLayoutMigratorService();

        const allFiles = await fsAdapter.getMarkdownFiles();
        const configs = [];
        for (const file of allFiles) {
          try {
            const fm = await fsAdapter.getFileMetadata(file);
            if (!isRelColSetFrontmatter(fm)) continue;
            const cfg = extractRelColSetConfig(file, fm);
            if (cfg !== null) configs.push(cfg);
          } catch {
            // Files without frontmatter are ignored.
          }
        }

        const result = service.migrate(configs);

        if (options.apply) {
          await writePairs(fsAdapter, result, options.outDir);
        } else {
          printDryRunReport(result);
        }

        if (options.json) {
          process.stdout.write(JSON.stringify(summariseResult(result, options), null, 2) + "\n");
        } else {
          process.stderr.write(formatSummary(result, options));
        }

        process.exit(0);
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}

async function writePairs(
  fs: NodeFsAdapter,
  result: MigrationResult,
  outDirRelative: string,
): Promise<void> {
  for (const pair of result.pairs) {
    const layoutPath = `${outDirRelative}/${pair.layout.filename}`;
    const blockPath = `${outDirRelative}/${pair.block.filename}`;
    await fs.writeFile(layoutPath, pair.layout.content);
    await fs.writeFile(blockPath, pair.block.content);
  }
}

function printDryRunReport(result: MigrationResult): void {
  process.stderr.write("--- DRY RUN PREVIEW ---\n");
  for (const pair of result.pairs) {
    process.stderr.write(`\n# from ${pair.sourcePath}\n`);
    process.stderr.write(`## Layout (${pair.layout.filename})\n`);
    process.stderr.write(pair.layout.content);
    process.stderr.write(`\n## Block (${pair.block.filename})\n`);
    process.stderr.write(pair.block.content);
    if (pair.warnings.length > 0) {
      process.stderr.write("\n## Warnings\n");
      for (const w of pair.warnings) {
        process.stderr.write(`- ${w}\n`);
      }
    }
  }
  process.stderr.write("\n--- END PREVIEW ---\n");
}

function formatSummary(
  result: MigrationResult,
  options: MigrateOptions,
): string {
  const mode = options.apply ? "APPLY" : "DRY RUN";
  const lines: string[] = [
    `--- MIGRATION ${mode} ---`,
    `Migrated pairs: ${result.pairs.length}`,
    `Skipped configs: ${result.skipped.length}`,
  ];
  if (options.apply) {
    lines.push(`Files written to: ${options.outDir}/ (relative to vault root)`);
    lines.push(
      `Total files written: ${result.pairs.length * 2} (${result.pairs.length} Layout + ${result.pairs.length} Block)`,
    );
  }
  for (const skip of result.skipped) {
    lines.push(`  SKIPPED: ${skip.sourcePath} — ${skip.reason}`);
  }
  lines.push("--- END SUMMARY ---\n");
  return lines.join("\n");
}

function summariseResult(
  result: MigrationResult,
  options: MigrateOptions,
): {
  mode: "apply" | "dry-run";
  outDir: string;
  pairsCount: number;
  skippedCount: number;
  pairs: ReadonlyArray<{
    sourceUid: string;
    sourcePath: string;
    layoutUid: string;
    blockUid: string;
    warnings: readonly string[];
  }>;
  skipped: ReadonlyArray<{ sourcePath: string; reason: string }>;
} {
  return {
    mode: options.apply ? "apply" : "dry-run",
    outDir: options.outDir,
    pairsCount: result.pairs.length,
    skippedCount: result.skipped.length,
    pairs: result.pairs.map((p: GeneratedLayoutPair) => ({
      sourceUid: p.sourceUid,
      sourcePath: p.sourcePath,
      layoutUid: p.layout.uid,
      blockUid: p.block.uid,
      warnings: p.warnings,
    })),
    skipped: result.skipped,
  };
}
