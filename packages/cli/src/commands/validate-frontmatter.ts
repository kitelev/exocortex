import { Command } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import {
  NoteToRDFConverter,
  type ExocortexInvariantViolation,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../adapters/FileSystemVaultAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";
import { ResponseBuilder } from "../responses/index.js";

export interface FrontmatterValidationOptions {
  vault: string;
  output?: OutputFormat;
  staged?: boolean;
}

export interface FrontmatterError {
  file: string;
  code:
    | "MISSING_PROPERTY"
    | "EMPTY_PROPERTY"
    | "EMPTY_OPTIONAL_PROPERTY"
    | "INVALID_INSTANCE_CLASS_IRI"
    | "INVALID_PATH_IRI";
  property?: string;
  reason: string;
  hint: string;
}

export interface FrontmatterValidationResult {
  vaultPath: string;
  filesChecked: number;
  errors: FrontmatterError[];
  healthy: boolean;
}

/**
 * Required-property hints by frontmatter key. Provides actionable templates
 * the user can paste directly into a file's frontmatter.
 */
const MISSING_PROPERTY_HINTS: Record<string, string> = {
  exo__Asset_uid: 'add `exo__Asset_uid: <uuid>` to frontmatter',
  exo__Asset_isDefinedBy:
    'add `exo__Asset_isDefinedBy: "[[!kitelev]]"` (or your own ontology marker) to frontmatter',
  exo__Asset_label: 'add `exo__Asset_label: "<short label>"` to frontmatter',
  exo__Instance_class:
    'add `exo__Instance_class: ["[[<ClassName>]]"]` to frontmatter',
};

/**
 * Translate a Phase-2 invariant violation into an actionable per-file
 * frontmatter error. Each branch covers one of RFC 0810aad3 Phase 4
 * acceptance scenarios — a missing required property, an empty literal,
 * an empty optional, or a malformed Instance_class wikilink.
 */
export function violationToError(
  filePath: string,
  v: ExocortexInvariantViolation,
): FrontmatterError {
  switch (v.code) {
    case "MISSING_PROPERTY":
      return {
        file: filePath,
        code: v.code,
        property: v.property,
        reason: v.message,
        hint:
          MISSING_PROPERTY_HINTS[v.property] ??
          `add \`${v.property}: <value>\` to frontmatter`,
      };
    case "EMPTY_PROPERTY":
      return {
        file: filePath,
        code: v.code,
        property: v.property,
        reason: v.message,
        hint: `set a non-empty value for \`${v.property}\` (or remove the asset markers if this file is not an Exocortex asset)`,
      };
    case "EMPTY_OPTIONAL_PROPERTY":
      return {
        file: filePath,
        code: v.code,
        property: v.property,
        reason: v.message,
        hint: `remove \`${v.property}\` from frontmatter or fill it with a non-empty value`,
      };
    case "INVALID_INSTANCE_CLASS_IRI":
      return {
        file: filePath,
        code: v.code,
        property: v.property,
        reason: v.message,
        hint: `fix the \`${v.property}\` wikilink target — namespaced classes (e.g. \`ems__\`, \`exo__\`) cannot contain whitespace or parentheses, otherwise they expand into invalid IRIs`,
      };
  }
}

export function getStagedMdFiles(vaultPath: string): string[] {
  try {
    const stdout = execSync("git diff --cached --name-only", {
      cwd: vaultPath,
      encoding: "utf-8",
    });
    return stdout
      .split("\n")
      .filter((f) => f.endsWith(".md") && f.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Issue #2997 Phase 4: Per-file actionable frontmatter validation.
 *
 * Walks the vault (or just git-staged .md files), parses each file's
 * frontmatter and runs Phase-2 file-level invariants, plus a path → IRI
 * conversion guard. Each violation is turned into an error that contains
 * the file path, the offending property, and a concrete hint describing
 * how to fix it.
 *
 * Exits non-zero when at least one error is reported, so the command
 * can be wired into pre-commit and CI pipelines.
 */
export function validateFrontmatterCommand(): Command {
  return new Command("frontmatter")
    .description(
      "Check vault frontmatter for missing/empty properties and malformed IRIs (Issue #2997 Phase 4)",
    )
    .option("--vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "--output <type>",
      "Response format: text|json (for MCP tools)",
      "text",
    )
    .option(
      "--staged",
      "Only validate git-staged .md files (for pre-commit hooks)",
    )
    .action(async (options: FrontmatterValidationOptions) => {
      const outputFormat = (options.output || "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath)) {
          throw new VaultNotFoundError(vaultPath);
        }

        const adapter = new FileSystemVaultAdapter(vaultPath);
        const converter = new NoteToRDFConverter(adapter);

        let files = adapter.getAllFiles();
        if (options.staged) {
          const staged = new Set(getStagedMdFiles(vaultPath));
          files = files.filter((f) => staged.has(f.path));
        }

        const errors: FrontmatterError[] = [];
        for (const file of files) {
          const fm = adapter.getFrontmatter(file);
          if (fm) {
            const violation = converter.validateExocortexAsset(fm);
            if (violation) {
              errors.push(violationToError(file.path, violation));
            }
          }
          // Guard the path → IRI conversion — captures filenames that cannot
          // be percent-encoded into a valid `obsidian://vault/...` IRI
          // (the loader skips such files with "Invalid IRI format" today).
          try {
            converter.notePathToIRI(file.path);
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            errors.push({
              file: file.path,
              code: "INVALID_PATH_IRI",
              reason: `Invalid IRI format for vault path: ${reason}`,
              hint: `rename the file — its path \`${file.path}\` cannot be encoded into a valid \`obsidian://vault/...\` IRI (avoid raw whitespace, control characters, and angle brackets)`,
            });
          }
        }

        const result: FrontmatterValidationResult = {
          vaultPath,
          filesChecked: files.length,
          errors,
          healthy: errors.length === 0,
        };

        if (outputFormat === "json") {
          console.log(
            JSON.stringify(ResponseBuilder.success(result), null, 2),
          );
        } else if (errors.length === 0) {
          console.log(
            `✅ All ${files.length} file(s) pass frontmatter validation.`,
          );
        } else {
          console.log(
            `⚠️  Found ${errors.length} frontmatter error(s) in ${new Set(errors.map((e) => e.file)).size} file(s):\n`,
          );
          for (const err of errors) {
            console.log(`   ❌ ${err.file}`);
            console.log(`      ${err.reason}`);
            console.log(`      💡 ${err.hint}`);
          }
          console.log(
            "\n📝 These shapes prevented the file from loading into the SPARQL store (Issue #2997 Phase 2). Fix them so the asset can be indexed.",
          );
        }

        if (errors.length > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
