#!/usr/bin/env node
/**
 * Guard: no tracked text file may contain a NUL byte.
 *
 * ⛔ Why this needs a machine guard rather than review discipline: the failure
 * mode is SILENT BY CONSTRUCTION. `file(1)` classifies a file containing a NUL
 * as `data`, and plain `grep` then skips it without printing anything (exit
 * status != 0, no message), while `git grep` and `rg` still match. So a search
 * across the repo quietly excludes the file, and silence reads as "no matches"
 * — never as "file skipped".
 *
 * That already cost a false code-review finding (issue #4071): a reviewer
 * grepped `audit-ontology-imports.ts` for a comment, got nothing, and reported
 * the citation as unlocatable. And it was not one file — a sweep found SIX,
 * accumulated over time, in the CLI, core, ExoSync merge engine and the plugin.
 * Five recurrences, none noticed. That is the signature of a defect that review
 * cannot catch and only a guard can.
 *
 * ⛤ HOW THE BYTE GETS IN — and the answer is NOT "someone typed an escape".
 * Measured: a source file containing the two-character escape `\0` is `ASCII
 * text`, holds zero NUL bytes, greps fine, and `"\0" === String.fromCharCode(0)`
 * is true. Hand-writing the escape is SAFE. The byte arrives when an escape is
 * written through a tool that NORMALIZES escape sequences into codepoints —
 * Claude Code's Edit/Write does exactly this, so the escape never survives as
 * text and a raw 0x00 lands in the file (documented since 2026-07-04 in
 * `edit-tool-unicode-escape-becomes-codepoint`). This distinction is load-
 * bearing for whoever trips this guard: searching your diff for `\0` will find
 * NOTHING, because the tool already ate it. Search for the BYTE.
 *
 * The fix is to construct the byte at runtime, where there is no escape for a
 * tool to normalize, and the value is identical:
 *   const KEY_SEP = String.fromCharCode(0);   // separators, sentinels
 *   Buffer.from([0, 0])                       // binary fixture content
 *
 * An earlier version of this very file asserted the opposite mechanism ("a
 * literal `\0` in the source becomes a raw NUL byte") in seven places. Review
 * refuted it by measurement. Left recorded here because a guard that explains
 * itself wrongly sends the next reader looking for the wrong thing — which is
 * the same failure this guard exists to end.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Extensions whose content is legitimately binary; everything else tracked is
// treated as text. ⛔ Deliberately an ALLOW-list of binary types rather than a
// deny-list of text ones: an unknown NEW extension must default to "checked",
// so the guard cannot be bypassed by a file type nobody thought of.
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svgz|woff2?|ttf|otf|eot|gz|zip|tar|pdf|mp4|webm|wasm|node|jar|class|so|dylib|dll)$/i;

function runGit() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error(
      `❌ check-no-nul-bytes: git ls-files failed — the guard did not run: ${String(err)}`,
    );
    process.exit(2);
  }
}

function tracked() {
  const out = runGit();
  // ⛤ `git ls-files -z` separates paths with NUL, so this guard must split on
  // the very byte it bans. Writing that literal here would make the guard itself
  // `data` and it would flag its own source. Built at runtime instead — which is
  // exactly the fix the error message below recommends. Dogfooded, and not
  // theoretically: the first draft of THIS FILE was written with the literal, and
  // `file(1)` reported it as `binary data` — the class recurred in the very tool
  // that catches it, while its author was actively fixing five other instances.
  return out
    .toString("utf8")
    .split(String.fromCharCode(0))
    .filter((p) => p.length > 0);
}

const offenders = [];
let checked = 0;

for (const file of tracked()) {
  if (BINARY_EXT.test(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted between ls-files and read; not our problem
  }
  checked += 1;
  const at = buf.indexOf(0);
  if (at !== -1) {
    const line = buf.subarray(0, at).toString("utf8").split("\n").length;
    offenders.push({ file, line, at });
  }
}

// ⛔ Report the INPUT SIZE next to the finding count. "0 offenders" is
// indistinguishable from "0 files examined" (a broken `git ls-files`, a wrong
// cwd) unless the denominator is printed — and a guard that cannot tell those
// apart is not a guard.
if (checked === 0) {
  console.error(
    "❌ check-no-nul-bytes: examined 0 files — the guard did not run (wrong cwd, or git ls-files failed)",
  );
  process.exit(2);
}

if (offenders.length > 0) {
  console.error(
    `❌ NUL byte in tracked source (${offenders.length} file(s), ${checked} examined):\n`,
  );
  for (const o of offenders) {
    console.error(`   ${o.file}:${o.line} (byte offset ${o.at})`);
  }
  console.error(
    "\n   A NUL in source makes file(1) report `data`, so plain `grep` skips the\n" +
      "   file SILENTLY — which is why nobody noticed the previous six.\n" +
      "   ⛔ Do NOT go looking for a literal \\0 in your diff: a hand-written escape\n" +
      "   is harmless (it stays text). The byte gets in when an escape is written\n" +
      "   through a tool that normalizes escapes into codepoints — Claude's\n" +
      "   Edit/Write does. Search for the BYTE, not the escape.\n" +
      "   Build it at runtime instead; the value is identical:\n" +
      "     const KEY_SEP = String.fromCharCode(0);   // separators, sentinels\n" +
      "     Buffer.from([0, 0])                       // binary fixture content\n" +
      "   See issue #4071.",
  );
  process.exit(1);
}

console.log(`✅ no NUL bytes in tracked source (${checked} files examined)`);
