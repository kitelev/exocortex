import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import {
  isNodeModulesPath,
  isTemplatesPath,
} from "../utils/vaultPathFilters.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * The canonical namespace host whose ontologies MUST carry a trailing `#`
 * separator. Foreign vocabularies (any other host) define their own form and
 * are skipped — `/` and `#` are both valid for them.
 */
export const EXOCORTEX_MY_HOST = "exocortex.my";

/**
 * Reasons an ontology-url asset is fail-open SKIPPED (not a violation, but also
 * not proven canonical). Reported explicitly so "0 violations" never masks
 * "every exocortex.my ontology checked".
 * - `foreign-vocab`: the URL parsed but its host is not {@link EXOCORTEX_MY_HOST};
 *   the vocabulary author defines the form ('/' or '#' both valid).
 * - `unparseable-url`: `exo__Ontology_url` is present but not a parseable URL, so
 *   it cannot be classified as exocortex.my — not this check's concern.
 */
export type OntologyUrlSkipReason = "foreign-vocab" | "unparseable-url";

export interface OntologyUrlViolation {
  path: string;
  /** The current (hash-less) `exo__Ontology_url` value. */
  url: string;
  /** The expected canonical form: trailing slashes stripped + a single `#`. */
  expected: string;
}

export interface OntologyUrlResult {
  vaultPath: string;
  totalFiles: number;
  /** Assets carrying a non-empty `exo__Ontology_url` (the audit scope). */
  ontologiesFound: number;
  /** exocortex.my ontologies actually checked for the trailing `#`. */
  checked: number;
  violations: OntologyUrlViolation[];
  skips: Record<OntologyUrlSkipReason, number>;
  /** Up to a few example paths per skip reason, for human triage. */
  skipExamples: Record<OntologyUrlSkipReason, string[]>;
}

const MAX_SKIP_EXAMPLES = 5;

/** First string value of a frontmatter field (arrays → first string element). */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === "string");
    return (s as string) ?? null;
  }
  return typeof value === "string" ? value : null;
}

/** Host of a URL string, or null if it does not parse as a URL. */
function urlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Canonical form for a hash-less exocortex.my URL: strip trailing slashes, then
 * append a single `#`. `.../ems` → `.../ems#`; `.../ems/` → `.../ems#`. Only
 * called for URLs that do NOT already end with `#` (i.e. real violations), so
 * the result always ends with exactly one `#`.
 */
export function expectedCanonicalForm(url: string): string {
  return `${url.replace(/\/+$/, "")}#`;
}

/**
 * Audit a single vault for the `exo__Ontology_url` trailing-separator invariant:
 * every asset whose `exo__Ontology_url` is an `exocortex.my` namespace URL must
 * end with a `#` separator (term-IRI = `Ontology_url + localName`, so
 * `https://exocortex.my/ontology/ems#` + `Task` = `ems#Task`; a hash-less
 * `.../ems` concatenates to `emsTask` and a hash-less SPARQL PREFIX expands
 * `ems:Task` wrongly, silently returning 0 rows).
 *
 * Scope = any asset carrying a non-empty `exo__Ontology_url` (the property is
 * the discriminator — only ontologies carry it, form-agnostic to the
 * `exo__Instance_class` UID-vs-label representation).
 *
 * Fail-open: FOREIGN vocabularies (host ≠ exocortex.my) and unparseable URLs are
 * skipped and counted by reason — never reported as violations. Sub-ontologies
 * with a hierarchical path (`.../kitelev-period/quarters#`) pass: the path is
 * preserved, only the trailing `#` is required.
 */
export async function scanVaultForOntologyUrl(
  vaultPath: string,
): Promise<OntologyUrlResult> {
  const adapter = new CachingNodeFsAdapter(vaultPath);
  const assets = await adapter.indexedAssets();

  const violations: OntologyUrlViolation[] = [];
  const skips: Record<OntologyUrlSkipReason, number> = {
    "foreign-vocab": 0,
    "unparseable-url": 0,
  };
  const skipExamples: Record<OntologyUrlSkipReason, string[]> = {
    "foreign-vocab": [],
    "unparseable-url": [],
  };
  let ontologiesFound = 0;
  let checked = 0;

  const addExample = (reason: OntologyUrlSkipReason, filePath: string): void => {
    if (skipExamples[reason].length < MAX_SKIP_EXAMPLES) {
      skipExamples[reason].push(filePath);
    }
  };

  for (const { path: relPath, metadata } of assets) {
    // Not vault content: node_modules (glob keeps them) + Templater templates
    // (intentional placeholder syntax; never migrated).
    if (isNodeModulesPath(relPath) || isTemplatesPath(relPath)) continue;

    const url = firstString(metadata["exo__Ontology_url"]);
    if (!url) continue; // not an ontology-url-bearing asset — silently ignored

    ontologiesFound++;

    const host = urlHost(url);
    if (host === null) {
      skips["unparseable-url"]++;
      addExample("unparseable-url", relPath);
      continue;
    }
    if (host !== EXOCORTEX_MY_HOST) {
      skips["foreign-vocab"]++;
      addExample("foreign-vocab", relPath);
      continue;
    }

    checked++;
    if (!url.endsWith("#")) {
      violations.push({
        path: relPath,
        url,
        expected: expectedCanonicalForm(url),
      });
    }
  }

  return {
    vaultPath,
    totalFiles: assets.length,
    ontologiesFound,
    checked,
    violations,
    skips,
    skipExamples,
  };
}

export interface AuditOntologyUrlOptions {
  vault: string;
  output?: OutputFormat;
}

/**
 * Issue #3824 (SDD req `df6c979e`) — `exo__Ontology_url` trailing-`#` audit
 * (source of truth, CI). Mirrors `audit co-location` / `audit ontology-imports`.
 *
 * `exocortex audit ontology-url --vault <path>` walks the vault and reports any
 * exocortex.my ontology whose `exo__Ontology_url` lacks a trailing `#`. Exit 0 =
 * 0 violations (foreign/unparseable skips are still reported); exit 1 = ≥1
 * violation. Skips never affect the exit code — fail-open by design.
 */
export function auditOntologyUrlCommand(): Command {
  return new Command("ontology-url")
    .description(
      "Detect exocortex.my ontologies whose exo__Ontology_url lacks the canonical trailing '#' separator (foreign vocabularies skipped, path hierarchy preserved, fail-open + skip-accounted)",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: AuditOntologyUrlOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        const result = await scanVaultForOntologyUrl(vaultPath);
        const skipTotal =
          result.skips["foreign-vocab"] + result.skips["unparseable-url"];

        if (outputFormat === "json") {
          console.log(
            JSON.stringify(
              {
                vaultPath: result.vaultPath,
                totalFiles: result.totalFiles,
                ontologiesFound: result.ontologiesFound,
                checked: result.checked,
                violationCount: result.violations.length,
                violations: result.violations,
                skips: result.skips,
                skipTotal,
                skipExamples: result.skipExamples,
                clean: result.violations.length === 0,
              },
              null,
              2,
            ),
          );
        } else {
          if (result.violations.length === 0) {
            console.log(
              `OK ${vaultPath}: 0 ontology-url violations (${result.checked}/${result.ontologiesFound} exocortex.my ontologies checked)`,
            );
          } else {
            console.error(
              `FAIL ${vaultPath}: ${result.violations.length} ontology-url violation(s) (${result.checked}/${result.ontologiesFound} exocortex.my ontologies checked):`,
            );
            for (const v of result.violations) {
              console.error(
                `  ${v.path}\n      url=${v.url} expected=${v.expected}`,
              );
            }
          }
          // Skip-accounting is always printed — "0 violations" ≠ "every ontology canonical".
          console.error(
            `\nSkipped (fail-open, NOT verified): ${skipTotal} — ` +
              `foreign-vocab=${result.skips["foreign-vocab"]}, ` +
              `unparseable-url=${result.skips["unparseable-url"]}`,
          );
        }

        if (result.violations.length > 0) process.exitCode = 1;
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
