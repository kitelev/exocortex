/**
 * desktopOnlyCommandGate — shared scanner for the MOBILE-004 ADR rule
 * (no desktop-only-gated `addCommand`) and its jest revert-verify test.
 *
 * Single source of truth so the archgate rule (the real CI gate, in
 * `../adrs/MOBILE-004-no-desktop-only-gated-addcommand.rules.ts`) and the
 * jest unit test (`packages/obsidian-plugin/tests/unit/desktopOnlyCommandGate.test.ts`)
 * exercise the EXACT same detection logic — no drift between the gate and
 * its test. Lives under `.archgate/lint/` (archgate's designated home for
 * governance helpers) and is dependency-free so both consumers can import it
 * by relative path without pulling in path aliases or the `obsidian` runtime.
 *
 * ## What it enforces (Desktop↔Mobile Command Parity invariant)
 *
 * Every plugin command must register on BOTH desktop and mobile. A command
 * whose `addCommand(...)` is reachable only when NOT on mobile (a desktop-only
 * gate) is a parity violation — mobile/iPhone users can never invoke it. The
 * canonical anti-patterns:
 *
 *   if (!Platform.isMobile) { this.addCommand({...}); }   // block guard
 *   if (Platform.isDesktopApp) plugin.addCommand({...});  // single-statement
 *   if (!Platform.isMobile) this.addCommand({...});        // single-statement
 *
 * The PARITY pattern — which registers on both platforms — is explicitly NOT
 * flagged, because its condition admits a positive (non-negated) mobile branch:
 *
 *   if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
 *     this.addCommand({...});   // registers on desktop (applyDeps) OR mobile (restMount)
 *   }
 *
 * ## Heuristic limitations (line/brace based — same trade-off as MOBILE-001/002/003)
 *
 *  - Brace depth is counted from `{`/`}` occurrences; braces inside string or
 *    regex literals can desync the depth. The impact is bounded: a guard frame
 *    is only ever opened by an `if (...)` whose condition is desktop-only, which
 *    is rare, so a stray string brace elsewhere cannot conjure a false guard.
 *  - A `//` sequence inside a string literal truncates the scanned line.
 *  - Data-flow gating (e.g. `const deps = Platform.isMobile ? null : build();`
 *    then `if (deps !== null) addCommand(...)`) is NOT tracked — only a
 *    lexically-enclosing desktop-only `if` guard is. The likeliest regression
 *    (literally wrapping `addCommand` in `if (!Platform.isMobile)`) IS caught.
 */

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
 * dependency-free so the archgate rule and its jest revert-verify test share
 * it verbatim.
 */
export function findDesktopOnlyGatedAddCommands(
  content: string,
): DesktopOnlyGateHit[] {
  const lines = content.split("\n");
  const hits: DesktopOnlyGateHit[] = [];
  // Brace depths at which an active desktop-only guard block was opened.
  const guardStartDepths: number[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
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

    if (!isComment) {
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
        // Detect a desktop-only block guard opening on this line:
        //   if (<desktop-only-cond>) {
        if (code.includes("{")) {
          const cond = extractIfCondition(code);
          if (cond !== null && isDesktopOnlyCondition(cond)) {
            guardStartDepths.push(depth);
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
