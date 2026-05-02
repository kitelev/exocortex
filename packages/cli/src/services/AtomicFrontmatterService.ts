import {
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";
import yaml from "js-yaml";

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

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/;

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFile(content: string): ParsedFile | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const [, fm, body = ""] = match;
  const parsed = yaml.load(fm);
  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter is not a YAML mapping");
  }
  return { frontmatter: parsed as Record<string, unknown>, body };
}

function serializeFile(fm: Record<string, unknown>, body: string): string {
  const dumped = yaml.dump(fm, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  });
  const trailing = body.length > 0 ? body : "";
  return `---\n${dumped}---\n${trailing}`;
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
    const newContent = serializeFile(merged, parsed.body);

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
