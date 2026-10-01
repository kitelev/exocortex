import {
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";
import * as yaml from "js-yaml";
import {
  matchFrontmatterBlock,
  parseYamlFrontmatterTolerant,
} from "@kitelev/exocortex-core";

export type AtomicUpdateFailureReason =
  | "verify-mismatch"
  | "parse-error"
  | "no-frontmatter"
  | "fs-error";

export interface AtomicUpdateOptions {
  /**
   * If set, after rename re-read the file and assert that
   * `frontmatter[verifyKey] === verifyValue`. If the assertion fails the
   * caller MUST treat the claim as lost (e.g. revert status to Backlog).
   *
   * Designed for AI-task worker claim protocol per RFC
   * 2a7144fa-b522-4375-bda0-a2d442b0b53a §B (Obsidian Sync race protection).
   */
  verifyKey?: string;
  verifyValue?: string;
}

export interface AtomicUpdateResult {
  success: boolean;
  /** True iff verifyKey/verifyValue matched (or verify was not requested). */
  verified: boolean;
  reason?: AtomicUpdateFailureReason;
  /** Raw error from underlying I/O if any. */
  error?: string;
}

/**
 * Trailing spaces/tabs on the CLOSING fence plus the ONE line ending that
 * separates it from the body — `matchFrontmatterBlock` ends the block at the
 * closing `---` itself, so this is what the body starts after.
 *
 * ⛤ Only ONE line ending is consumed (#4469). The regex this replaced ended in
 * `---\s*(?:\r?\n(…))?$`, whose greedy `\s*` swallows EVERY blank line between
 * the fence and the first body text — so `---\n\n\nbody` came back as `body` and
 * the two blank lines were gone from the rewritten file. Nothing depended on
 * that loss; keeping it would be copying a defect forward.
 */
const BODY_LEAD = /^[^\S\r\n]*(?:\r\n|\r|\n)/;

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
  /** A leading U+FEFF to put back — exactly one, whatever the run's length. */
  bom: string;
}

/**
 * ⛤ The block is recognised by `matchFrontmatterBlock` — core's ONE predicate
 * (#4469). The local `FRONTMATTER_RE` this replaced was LF/CRLF-only and
 * defeated by a leading BOM, so `claim` / `spawn` answered `no-frontmatter` on a
 * valid lone-CR or BOM-prefixed asset: fail-CLOSED rather than the data loss the
 * text path had, but still a channel that disagreed with the read path about
 * what a frontmatter block IS.
 *
 * ⛔ ONE deliberate narrowing: the old regex also accepted trailing whitespace on
 * the OPENING fence (`--- \n`), which the shared predicate does not. Measured
 * 2026-09-29 across the three canonical vaults (54 818 assets): **0** carriers of
 * that shape — and since the READ path (`NoteToRDFConverter`, the adapters)
 * already uses the shared predicate, such a file is not in the graph at all, so
 * accepting it here only let a write reach an asset nothing else could see.
 */
function parseFile(content: string): ParsedFile | null {
  const block = matchFrontmatterBlock(content);
  if (!block) return null;
  const fm = block.body;
  const body = content.slice(block.blockEnd).replace(BODY_LEAD, "");
  const bom = block.blockStart > 0 ? "\uFEFF" : "";
  // Read-modify-WRITE path — try the strict parse first (empty & non-dup files
  // stay byte-identical). A duplicated YAML key makes `yaml.load` THROW; recover
  // it last-wins via the tolerant parser (#3901 / #3800) so an atomic update
  // self-heals a dup-key file instead of aborting. But a GENUINELY malformed
  // block must still fail-loud (→ parse-error → NO write) so we never overwrite a
  // broken file with empty frontmatter — the tolerant parser returns null for
  // BOTH empty and malformed, but only a throw reaches this branch, so a null
  // here means malformed → re-throw.
  let parsed: unknown;
  try {
    parsed = yaml.load(fm, { schema: yaml.YAML11_SCHEMA });
  } catch {
    parsed = parseYamlFrontmatterTolerant(fm, "AtomicFrontmatterService");
    if (parsed === null) {
      throw new Error("frontmatter is not a YAML mapping");
    }
  }
  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body, bom };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter is not a YAML mapping");
  }
  return { frontmatter: parsed as Record<string, unknown>, body, bom };
}

function serializeFile(
  fm: Record<string, unknown>,
  body: string,
  bom: string,
): string {
  // `quoteStyle: "double"` is the js-yaml 5 option (this package resolves
  // 5.3.0; `quotingType` is the js-yaml 4 spelling, ignored here): scalars
  // js-yaml must quote come out double-quoted — the vault convention. Locked
  // by an axis (req 27fbe40b), not just by this comment.
  const dumped = yaml.dump(fm, {
    lineWidth: -1,
    quoteStyle: "double",
    forceQuotes: false,
    noRefs: true,
  });
  const trailing = body.length > 0 ? body : "";
  // ⛤ The BOM survives the rewrite, collapsed to exactly ONE (#4469) — the
  // same policy `FileSystemVaultAdapter.replaceFrontmatter` applies on the
  // adapter path (req `74419202`). Dropping it would silently re-encode a
  // file the user deliberately marked; keeping the run would preserve an
  // artifact that defeats every `^`-anchored reader.
  return `${bom}---\n${dumped}---\n${trailing}`;
}

/**
 * Atomically update YAML frontmatter of a markdown file.
 *
 * Algorithm (POSIX-atomic on same filesystem):
 *   1. Read original file.
 *   2. Parse frontmatter, shallow-merge `updates`.
 *   3. Write new content to a unique sibling tmp file.
 *   4. `fs.renameSync(tmp, original)` — atomic on same filesystem (rename(2)).
 *   5. Re-read the renamed file. If `verifyKey`/`verifyValue` are provided,
 *      assert that `frontmatter[verifyKey] === verifyValue`. On mismatch the
 *      caller has lost the claim (concurrent write merged) and should abort.
 *
 * Tmp file is placed in the same directory as the target so that rename is
 * atomic (POSIX guarantees rename within a single filesystem only). Tmp
 * file is best-effort cleaned up on error.
 */
export function atomicUpdateFrontmatter(
  filePath: string,
  updates: Record<string, unknown>,
  options: AtomicUpdateOptions = {},
): AtomicUpdateResult {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`,
  );

  try {
    const original = readFileSync(filePath, "utf8");

    let parsed: ParsedFile | null;
    try {
      parsed = parseFile(original);
    } catch (e) {
      return {
        success: false,
        verified: false,
        reason: "parse-error",
        error: (e as Error).message,
      };
    }

    if (!parsed) {
      return {
        success: false,
        verified: false,
        reason: "no-frontmatter",
      };
    }

    const merged = { ...parsed.frontmatter, ...updates };
    const newContent = serializeFile(merged, parsed.body, parsed.bom);

    writeFileSync(tmpPath, newContent, "utf8");
    renameSync(tmpPath, filePath);

    if (options.verifyKey !== undefined) {
      const after = readFileSync(filePath, "utf8");
      let afterParsed: ParsedFile | null;
      try {
        afterParsed = parseFile(after);
      } catch (e) {
        return {
          success: false,
          verified: false,
          reason: "parse-error",
          error: (e as Error).message,
        };
      }
      if (!afterParsed) {
        return { success: false, verified: false, reason: "no-frontmatter" };
      }
      const actual = afterParsed.frontmatter[options.verifyKey];
      if (actual !== options.verifyValue) {
        return {
          success: false,
          verified: false,
          reason: "verify-mismatch",
          error: `expected ${options.verifyKey}=${String(options.verifyValue)}, got ${String(actual)}`,
        };
      }
      return { success: true, verified: true };
    }

    return { success: true, verified: true };
  } catch (e) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // best-effort
      }
    }
    return {
      success: false,
      verified: false,
      reason: "fs-error",
      error: (e as Error).message,
    };
  }
}
