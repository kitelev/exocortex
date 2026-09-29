import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  registerOrderSpecLoader,
  frontmatterBlockBody,
  type FrontmatterOrderSpec,
} from "@kitelev/exocortex-core";

/**
 * Scan vault for `exo__FrontmatterOrderSpec` assets (class UID
 * `15270ad1-d29d-4677-bd52-23078983cae8`) and register a loader that returns
 * the one with `exo__FrontmatterOrderSpec_default: true`.
 *
 * Called by mutating CLI commands (apply, create, etc.) so that asset
 * creation honors the canonical ordering defined in the vault.
 *
 * RFC 27a7a877.
 */
export function registerOrderSpecFromVault(vaultRoot: string): void {
  registerOrderSpecLoader(() => {
    const candidates = collectCandidateDirs(vaultRoot);
    for (const dir of candidates) {
      const spec = scanDirForDefault(dir);
      if (spec) return spec;
    }
    return null;
  });
}

function collectCandidateDirs(vaultRoot: string): string[] {
  return [
    join(vaultRoot, "assetspaces", "exo"),
  ];
}

function scanDirForDefault(dir: string): FrontmatterOrderSpec | null {
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const full = join(dir, f);
    let content: string;
    try {
      content = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const fm = extractFrontmatter(content);
    if (!fm) continue;
    if (!/^exo__FrontmatterOrderSpec_default:\s*true\b/m.test(fm)) continue;
    return {
      head: extractList(fm, "exo__FrontmatterOrderSpec_head"),
      tail: extractList(fm, "exo__FrontmatterOrderSpec_tail"),
      middleStrategy: extractScalar(fm, "exo__FrontmatterOrderSpec_middleStrategy") ?? "alphabetical",
    };
  }
  return null;
}

// ⛤ core's predicate (#4461 ratchet): the LF-only literal that used to sit
// here made a CRLF-fenced or BOM-led order-spec asset invisible, so the vault's
// canonical frontmatter ordering was silently not applied to any asset `create`
// or `apply` wrote. Same predicate, same mechanism as #4459/#4460 — no work
// item of its own, surfaced by the LF-only-fence census of `packages/cli/src`
// (the ratchet axis asserts that census is now empty, so this comment must not
// spell the literal out — it would satisfy the grep it exists to keep at zero).
function extractFrontmatter(content: string): string | null {
  return frontmatterBlockBody(content);
}

function extractScalar(fm: string, key: string): string | null {
  const re = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m");
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

// ⛔ `\r?\n?`, not `\n?` — and this is load-bearing, not tidiness. `.` never
// matches a line terminator, so on a CRLF list item `.*` stops before the `\r`;
// a bare `\n?` then consumes NOTHING (the next char is `\r`), the `\r` is left
// where the next `  -` repetition has to start, and the group terminates after
// exactly ONE item — silently, for a list of any length. Found by the review of
// PR #4463: this file became reachable with CRLF content the moment
// `extractFrontmatter` started returning core's VERBATIM body, so the fix that
// makes a CRLF order-spec VISIBLE would otherwise have made it silently WRONG.
// ⛤ Only the CONTINUATION token changes: the HEADER's `\s*` already absorbs a
// CRLF break (`\s` matches `\r`), so widening it too would be an extra claim for
// nothing. And `extractScalar` needs no change either: JS multiline `$` DOES
// match immediately before a bare `\r` (measured, not assumed) and `.trim()`
// strips it from the captured value — which is why `middleStrategy` and the
// `_default: true` flag parsed correctly all along and masked this from a read.
function extractList(fm: string, key: string): string[] {
  const re = new RegExp(`^${escapeRegex(key)}:\\s*\\n((?:  -.*\\r?\\n?)+)`, "m");
  const m = fm.match(re);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
