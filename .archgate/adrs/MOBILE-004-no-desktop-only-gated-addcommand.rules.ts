/// <reference path="../rules.d.ts" />

import { findDesktopOnlyGatedAddCommands } from "../lint/desktopOnlyCommandGate";

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
// Detection lives in `../lint/desktopOnlyCommandGate.ts` (shared verbatim with
// the jest revert-verify test
// `packages/obsidian-plugin/tests/unit/desktopOnlyCommandGate.test.ts` — no
// drift between gate and test). Line/brace based, same documented heuristic
// trade-offs as the MOBILE-001/002/003 sibling rules.
//
// Scope: packages/obsidian-plugin/src — the only place Obsidian's
// `Plugin.addCommand` is callable (a `Plugin` instance exists only there).
// Core/services `addCommand` mentions are JSDoc prose, not registrations.

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
