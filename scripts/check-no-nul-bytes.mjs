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
 * The byte gets into source when a literal escape is written into a string:
 * `\0` in the source text IS the byte. Build it at runtime instead —
 * `String.fromCharCode(0)` for a separator, `Buffer.from([0])` for fixture
 * content — and the key value is unchanged while the source stays text.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Extensions whose content is legitimately binary; everything else tracked is
// treated as text. ⛔ Deliberately an ALLOW-list of binary types rather than a
// deny-list of text ones: an unknown NEW extension must default to "checked",
// so the guard cannot be bypassed by a file type nobody thought of.
const BINARY_EXT =
  /\.(png|jpe?g|gif|ico|webp|svgz|woff2?|ttf|otf|eot|gz|zip|tar|pdf|mp4|webm|wasm|node|jar|class|so|dylib|dll)$/i;

function tracked() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
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
      "   file SILENTLY. It almost always comes from a literal escape in a string.\n" +
      "   Build the byte at runtime instead — the value is identical:\n" +
      "     const KEY_SEP = String.fromCharCode(0);   // separators, sentinels\n" +
      "     Buffer.from([0, 0])                       // binary fixture content\n" +
      "   See issue #4071.",
  );
  process.exit(1);
}

console.log(`✅ no NUL bytes in tracked source (${checked} files examined)`);
