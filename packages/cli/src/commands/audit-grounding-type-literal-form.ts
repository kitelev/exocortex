import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

const FRONTMATTER_FENCE = /^---\s*$/;
const TYPE_LINE = /^exocmd__Grounding_type:\s*(.+?)\s*$/;
const WIKILINK_FORM = /^"?\[\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\|[^\]]*)?\]\]"?$/i;

const SKIP_DIRS = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  ".trash",
  ".obsidian-mobile",
  ".DS_Store",
]);

export interface AuditGroundingTypeLiteralFormOptions {
  vault: string;
  output?: OutputFormat;
}

export interface LiteralFormViolation {
  path: string;
  line: number;
  value: string;
}

function shouldSkipDir(name: string): boolean {
  if (name.startsWith(".")) return SKIP_DIRS.has(name.toLowerCase()) || name === ".git";
  return SKIP_DIRS.has(name);
}

function* walkMarkdownFiles(rootDir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EPERM" || e.code === "EACCES" || e.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walkMarkdownFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield fullPath;
    }
  }
}

function extractFrontmatter(content: string): { lines: string[]; startLine: number } | null {
  const allLines = content.split(/\r?\n/);
  if (allLines.length < 2 || !FRONTMATTER_FENCE.test(allLines[0])) return null;
  for (let i = 1; i < allLines.length; i++) {
    if (FRONTMATTER_FENCE.test(allLines[i])) {
      return { lines: allLines.slice(1, i), startLine: 2 };
    }
  }
  return null;
}

function isLiteralForm(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return false;
  return !WIKILINK_FORM.test(trimmed);
}

export function scanVaultForLiteralForm(vaultPath: string): LiteralFormViolation[] {
  const violations: LiteralFormViolation[] = [];
  for (const filePath of walkMarkdownFiles(vaultPath)) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const fm = extractFrontmatter(content);
    if (!fm) continue;
    for (let i = 0; i < fm.lines.length; i++) {
      const m = fm.lines[i].match(TYPE_LINE);
      if (!m) continue;
      const value = m[1];
      if (isLiteralForm(value)) {
        violations.push({
          path: relative(vaultPath, filePath),
          line: fm.startLine + i,
          value,
        });
      }
    }
  }
  return violations;
}

/**
 * RFC 9d20c91f Phase 4+1 — regression detector for `exocmd__Grounding_type`
 * literal-string form (bare enum like `"property_set"`) post-cutover. Phase 3
 * migrated all ABox values to wikilink form (`"[[<uid>]]"`). Phase 4 removed
 * the dual-read default; Phase 4+1 removed the env-flag escape hatch entirely.
 * This subcommand walks a vault root, parses frontmatter, and reports any
 * file whose `exocmd__Grounding_type:` value is not wikilink-shaped.
 *
 * Exit 0 = clean; exit 1 = ≥1 violation. Suitable for CI nightly scheduling.
 */
export function auditGroundingTypeLiteralFormCommand(): Command {
  return new Command("grounding-type-literal-form")
    .description(
      "Detect post-Phase-4+1 regressions: any exocmd__Grounding_type literal-string form (not wikilink) in vault frontmatter",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--output <type>", "Response format: text|json", "text")
    .action((options: AuditGroundingTypeLiteralFormOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        const violations = scanVaultForLiteralForm(vaultPath);

        if (outputFormat === "json") {
          console.log(
            JSON.stringify(
              {
                vaultPath,
                violationCount: violations.length,
                violations,
                clean: violations.length === 0,
              },
              null,
              2,
            ),
          );
        } else {
          if (violations.length === 0) {
            console.log(
              `OK ${vaultPath}: 0 exocmd__Grounding_type literal-form violations`,
            );
          } else {
            console.error(
              `FAIL ${vaultPath}: ${violations.length} exocmd__Grounding_type literal-form violation(s):`,
            );
            for (const v of violations) {
              console.error(`  ${v.path}:${v.line} — value: ${v.value}`);
            }
            console.error(
              "\nRFC 9d20c91f Phase 3 migrated all values to wikilink form `[[<uid>]]`. Re-run the Phase 3 migration script or hand-edit offending files.",
            );
          }
        }

        if (violations.length > 0) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
