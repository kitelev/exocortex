import { readFile } from "fs/promises";
import { relative, join } from "path";
import * as glob from "glob";
import * as yaml from "js-yaml";

/**
 * One indexed markdown asset: its root-relative path and parsed frontmatter.
 *
 * Structural mirror of `IndexedAsset` in the CLI's `CachingNodeFsAdapter` — the
 * shape `loadRequirements` consumed before this tool was extracted out of
 * `@kitelev/exocortex-cli` (RFC 7c7859d1 W-req). Only the two fields the audit
 * actually reads are kept; the adapter's UID/basename indexes served
 * `findReferencedFile`, which the audit never calls.
 */
export interface MarkdownAsset {
  path: string;
  metadata: Record<string, unknown>;
}

/**
 * Tolerantly parse a YAML frontmatter block.
 *
 * ⚠ **Deliberate copy** of `parseYamlFrontmatterTolerant`
 * (`packages/core/src/utilities/parseYamlFrontmatter.ts`, #3800). Duplicated
 * rather than imported so this tool stays self-contained: the
 * `requirements-trace` CI job runs it directly (no core/services/CLI build),
 * which is the whole point of the extraction. The behaviour is pinned by the
 * duplicate-key test in `tests/unit/assets.test.ts` — if the core helper ever
 * changes, that test documents what this copy guarantees.
 *
 * A bare `yaml.load` throws on a **duplicated mapping key**, which would make
 * the whole asset collapse to `{}` at read time (a requirement would silently
 * vanish from the audit). The strict parse is kept for the common (well-formed)
 * case — byte-for-byte unaffected — and only a throw retries with
 * `{ json: true }` (js-yaml's JSON-compatibility mode: duplicate keys resolve
 * last-wins instead of throwing).
 */
export function parseYamlFrontmatterTolerant(
  yamlBlock: string,
  context?: string,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlBlock);
  } catch (strictError) {
    try {
      parsed = yaml.load(yamlBlock, { json: true });
    } catch {
      // Not a mere duplicate-key issue — genuinely malformed. Preserve the
      // historical throw→null/`{}` fallback rather than crash the caller.
      return null;
    }
    const detail =
      strictError instanceof Error
        ? strictError.message.split("\n")[0]
        : String(strictError);
    console.warn(
      `[frontmatter] tolerant-parsed malformed YAML${
        context ? ` (${context})` : ""
      } — resolving last-wins: ${detail}`,
    );
  }
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Extract the `---`-fenced frontmatter mapping from a markdown document. */
export function extractFrontmatter(
  content: string,
  context?: string,
): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return parseYamlFrontmatterTolerant(match[1], context) ?? {};
}

/**
 * Walk a directory tree and return every markdown file with its parsed
 * frontmatter — one disk pass, root-relative paths.
 *
 * Mirrors `NodeFsAdapter.getMarkdownFiles` + `extractFrontmatter` (the pair
 * behind `CachingNodeFsAdapter.indexedAssets()`): the same recursive markdown
 * glob with `nodir`, so dot-directories (`.git/`) are excluded by glob's default
 * `dot: false`, and vendored trees are filtered by the caller
 * (`loadRequirements` skips `node_modules` / `.git` path segments).
 *
 * Two DELIBERATE divergences from the adapter, both verdict-neutral:
 *
 *  1. The result is **sorted**. The adapter returned raw glob order, so findings
 *     came out in an unspecified order; sorting makes the report stable
 *     run-to-run (`scanTestTags` already sorts its file list for the same
 *     reason). Set-equality with the adapter's output is unaffected — only the
 *     order within `orphans` / `floorViolations` / … changes.
 *  2. A file that cannot be read is **skipped**; the adapter pushed it with `{}`
 *     metadata. Verdict-equivalent: the sole consumer (`loadRequirements`)
 *     drops any asset whose `req__Requirement_status` is undefined, which a `{}`
 *     asset always is — so neither variant can make a requirement vanish.
 */
export async function loadMarkdownAssets(
  rootPath: string,
): Promise<MarkdownAsset[]> {
  const files = await glob.glob(join(rootPath, "**/*.md"), { nodir: true });
  files.sort();

  const assets: MarkdownAsset[] = [];
  for (const abs of files) {
    const rel = relative(rootPath, abs);
    let metadata: Record<string, unknown> = {};
    try {
      metadata = extractFrontmatter(await readFile(abs, "utf-8"), rel);
    } catch {
      continue;
    }
    assets.push({ path: rel, metadata });
  }
  return assets;
}
