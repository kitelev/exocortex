/// <reference path="../rules.d.ts" />

// MOBILE-004 — ban desktop-only-gated `addCommand` registration.
//
// Desktop↔Mobile Command Parity invariant (Developer/CLAUDE.md): EVERY plugin
// command must work on both desktop AND iPhone/mobile. A command whose
// `addCommand(...)` is reachable only when NOT on mobile — a desktop-only gate —
// is a parity VIOLATION: mobile users can never invoke it. On mobile there is no
// Node `fs`/git binary, so the correct shape routes the command through the
// cross-platform `vault.adapter` / REST path and registers UNCONDITIONALLY (or
// on a condition that ALSO admits a positive mobile branch).
//
// Canonical anti-patterns flagged:
//   if (!Platform.isMobile) { this.addCommand({...}); }   // block guard
//   if (Platform.isDesktopApp) plugin.addCommand({...});  // single-statement
//
// The PARITY pattern is NOT flagged — its condition admits a positive mobile
// branch (registers on desktop OR mobile):
//   if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
//     this.addCommand({...});
//   }
//
// ⚠️ DETECTION LOGIC IS INLINED BELOW (was imported from `../lint/desktopOnlyCommandGate.ts`).
// archgate v0.50.0's rule-file security scanner forbids rule files from importing
// any local module (only node:path/url/util/crypto allowed) — so the shared gate
// helper can no longer be `import`ed here. The pure scanner functions now live in
// THIS file as named exports and are the SINGLE SOURCE OF TRUTH; the jest
// revert-verify test (`packages/obsidian-plugin/tests/unit/desktopOnlyCommandGate.test.ts`)
// imports them FROM HERE — no drift between the gate and its test.
//
// Line/brace based, same documented heuristic trade-offs as the MOBILE-001/002/003
// sibling rules. Scope: packages/obsidian-plugin/src — the only place Obsidian's
// `Plugin.addCommand` is callable.

export interface DesktopOnlyGateHit {
  /** 1-based line number of the offending `addCommand(` call. */
  line: number;
  /** Why it was flagged (block guard vs same-line gate). */
  reason: string;
  /** Trimmed source snippet (≤120 chars) for the violation message. */
  snippet: string;
}

/**
 * Desktop-only trigger tokens: a negated mobile check, or an explicit desktop
 * check. `Platform.isDesktop\b` does not match `Platform.isDesktopApp` (the
 * `\b` fails before `App`), so both are listed.
 */
const DESKTOP_TRIGGER =
  /!\s*Platform\s*\.\s*isMobile|Platform\s*\.\s*isDesktopApp\b|Platform\s*\.\s*isDesktop\b/;

/** `addCommand(` not preceded by an identifier char (so `myAddCommand(` is ignored). */
const ADDCOMMAND = /(?<![\w$])addCommand\s*\(/;

/**
 * True when an `if` condition gates code DESKTOP-ONLY — it triggers on a
 * desktop token AND does not also admit a positive (non-negated) mobile branch.
 * Stripping every `!Platform.isMobile` occurrence and re-checking for a
 * remaining `Platform.isMobile` is how the parity pattern (which keeps a
 * positive `Platform.isMobile && restMount` disjunct) escapes the gate.
 */
export function isDesktopOnlyCondition(condition: string): boolean {
  if (!DESKTOP_TRIGGER.test(condition)) return false;
  const withoutNegated = condition.replace(/!\s*Platform\s*\.\s*isMobile/g, "");
  // A surviving positive `Platform.isMobile` means the condition adds a mobile
  // path → parity-correct, not desktop-only.
  if (/Platform\s*\.\s*isMobile/.test(withoutNegated)) return false;
  return true;
}

/**
 * Extract the condition of the FIRST top-level `if (...)` on a line, balancing
 * nested parens so `if (a || (b && c))` yields `a || (b && c)`, not `a || (b && c`.
 * Returns null when the line has no `if (` or the parens never close on it.
 */
function extractIfCondition(code: string): string | null {
  const m = code.match(/\bif\s*\(/);
  if (m === null || m.index === undefined) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return code.slice(start, i);
    }
  }
  return null;
}

/**
 * Find every `addCommand(` registration that is gated desktop-only. Pure +
 * dependency-free so the archgate rule (below) and its jest revert-verify test
 * share it verbatim.
 */
export function findDesktopOnlyGatedAddCommands(
  content: string,
): DesktopOnlyGateHit[] {
  const lines = content.split("\n");
  const hits: DesktopOnlyGateHit[] = [];
  // Brace depths at which an active desktop-only guard block was opened.
  const guardStartDepths: number[] = [];
  // Set after a brace-less desktop-only `if (cond)` line: the guard applies to
  // the next meaningful line (an Allman `{` block, or a single statement).
  let pendingDesktopOnlyIf = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    const isBlank = trimmed.length === 0;
    const isComment =
      trimmed.startsWith("*") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*");
    // Drop trailing line comment so prose can't trip detection.
    const code = raw.replace(/\/\/.*$/, "");

    // 1. Pop guard frames whose block has closed (depth fell back to its start).
    while (
      guardStartDepths.length > 0 &&
      depth <= guardStartDepths[guardStartDepths.length - 1]
    ) {
      guardStartDepths.pop();
    }

    // Blank / comment lines never resolve a pending guard or carry detection,
    // but DO still feed brace counting (a `}` in a comment is rare; consistent
    // with the documented heuristic).
    if (isBlank || isComment) {
      const o = (code.match(/\{/g) || []).length;
      const c = (code.match(/\}/g) || []).length;
      depth += o - c;
      continue;
    }

    let resolvedPending = false;
    if (pendingDesktopOnlyIf) {
      pendingDesktopOnlyIf = false;
      resolvedPending = true;
      if (trimmed.startsWith("{")) {
        // Allman-brace block opened by the previous desktop-only `if`.
        guardStartDepths.push(depth);
      } else if (ADDCOMMAND.test(code)) {
        // Brace-less single statement guarded desktop-only.
        hits.push({
          line: i + 1,
          reason: "addCommand gated desktop-only by a brace-less `if`",
          snippet: trimmed.slice(0, 120),
        });
      }
    }

    if (!resolvedPending) {
      const hasAdd = ADDCOMMAND.test(code);
      if (hasAdd) {
        if (guardStartDepths.length > 0) {
          // Inside an active desktop-only guard block.
          hits.push({
            line: i + 1,
            reason: "addCommand inside a desktop-only guard block",
            snippet: trimmed.slice(0, 120),
          });
        } else {
          // Same-line single-statement gate, e.g.
          //   if (!Platform.isMobile) plugin.addCommand({...});
          const cond = extractIfCondition(code);
          if (cond !== null && isDesktopOnlyCondition(cond)) {
            hits.push({
              line: i + 1,
              reason: "addCommand gated desktop-only on the same line",
              snippet: trimmed.slice(0, 120),
            });
          }
        }
      } else {
        const cond = extractIfCondition(code);
        if (cond !== null && isDesktopOnlyCondition(cond)) {
          if (code.includes("{")) {
            // Same-line braced block guard: `if (<desktop-only-cond>) {`.
            guardStartDepths.push(depth);
          } else {
            // Brace-less desktop-only `if` — the guard applies to the NEXT
            // meaningful line (Allman block or single statement).
            pendingDesktopOnlyIf = true;
          }
        }
      }
    }

    // 2. Update brace depth (best-effort; braces in string literals can desync —
    //    documented, low blast radius since guards are rare).
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    depth += opens - closes;
  }

  return hits;
}

export default {
  rules: {
    "no-desktop-only-gated-addcommand": {
      description:
        "Plugin commands gated desktop-only (e.g. `if (!Platform.isMobile)`) never register on iPhone/mobile — violates the Desktop↔Mobile Command Parity invariant.",
      severity: "error",
      async check(ctx) {
        const files = [
          ...(await ctx.glob("packages/obsidian-plugin/src/**/*.{ts,tsx}")),
        ];
        for (const file of files) {
          // Cheap pre-filter: only files that both register a command AND carry
          // a desktop platform check can possibly violate.
          const addHits = await ctx.grep(file, /\baddCommand\s*\(/);
          if (addHits.length === 0) continue;
          const platformHits = await ctx.grep(
            file,
            /Platform\s*\.\s*(isMobile|isDesktop)/,
          );
          if (platformHits.length === 0) continue;

          const content = await ctx.readFile(file);
          for (const hit of findDesktopOnlyGatedAddCommands(content)) {
            ctx.report.violation({
              message: `Desktop-only-gated \`addCommand\` (${hit.reason}) — this command never registers on iPhone/mobile, violating the Desktop↔Mobile Command Parity invariant (Developer/CLAUDE.md): \`${hit.snippet}\``,
              file,
              line: hit.line,
              fix: "Register the command UNCONDITIONALLY (or gate on a condition that ALSO admits a positive mobile branch, e.g. `applyDeps !== null || (Platform.isMobile && restMount !== null)`), routing the mobile path through the git-free RestAssetSpaceMount / vault.adapter flow.",
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
