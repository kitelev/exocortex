#!/usr/bin/env -S npx tsx
/**
 * #4264 — the bot chain as THREE SEPARATE PROCESSES, each
 * `--use-cache --write-through`, on the built `dist/index.js`
 * (@req:cb707868-356f-495d-825a-182e66ba8bcd, AC4), plus the delta-only
 * default (`--use-cache` alone) and the refusal of a bare `--write-through`.
 *
 * The jest suite proves the chain with a fresh `CacheManager` per step inside
 * one process (CI axis A4). This harness is the multi-PROCESS form the issue
 * asks for — genuine `spawn` of the CLI, the only shared state being
 * `.exocortex/cache/triples.json` — and it needs the CLI BUILT, which the CLI
 * jest job does not do. So it runs locally (and under the mutant driver, see
 * `use-cache-4264.proc-chain.spec.json`), not in CI.
 *
 *   npx tsx packages/cli/tests/integration/use-cache-4264-proc-chain.harness.ts [--dist <index.js>] [--no-build]
 *
 * Without `--no-build` it rebuilds `packages/cli/dist` from the tree it lives in
 * first (`npm run build -w @kitelev/exocortex-cli`, ~1 s), so a mutated copy of
 * the tree is measured, not a stale bundle. Prints `✅ P<n>` / `❌ P<n>` per
 * axis and `PASS=<n> FAIL=<n>`; exit 1 on any failure.
 *
 * Axes:
 *   P1 `index` on the fixture succeeds and persists an inferred layer
 *   P2 process 1 `apply create-task-instance --use-cache`: load = hit, write-
 *      through persisted (1 file), created file on disk
 *   P3 process 2 `apply move-to-backlog <created> --use-cache`: NO "Precondition
 *      not satisfied", load = HIT (not delta — the write-through pre-paid it)
 *   P4 process 3 `apply start-effort <created> --use-cache`: same
 *   P5 final file == the same three commands WITHOUT the flag on a twin vault,
 *      and the three stdout envelopes are identical
 *   P6 the persisted cache after the chain still carries index's inferred
 *      layer (inferenceEnabled true, inferredCount > 0)
 *   P7 `resolve-buttons <created> --json --use-cache` after the chain: hit,
 *      and its stdout == the no-flag run on the twin vault (no inherited-
 *      property command binds to the created instance, so the inferred layer
 *      changes nothing here)
 *   P8 `create --validate --use-cache --write-through` in a 4th process: load
 *      = hit, write-through persisted; a 5th process is still a hit
 *   P9 default delta-only across processes: `apply … --use-cache` (no
 *      --write-through) leaves the cache file byte-identical and prints no
 *      write-through line; the next `--use-cache` process is a DELTA whose
 *      precondition sees the write (no "Precondition not satisfied")
 *   P10 `--write-through` without `--use-cache`: rc 2, the one stderr line
 *      names the missing flag, the target file is untouched
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  buildVault,
  REL,
  SEED,
  FROZEN,
  CHAIN_LABEL,
  STATUS_DOING,
  TASK_CLASS,
} from "./fixtures/use-cache-4264-vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(cliRoot, "..", "..");

let dist = path.join(cliRoot, "dist", "index.js");
let build = true;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--dist") dist = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--no-build") build = false;
}

let pass = 0;
let fail = 0;
const ok = (id: string, msg: string): void => {
  pass += 1;
  console.log(`✅ ${id} ${msg}`);
};
const bad = (id: string, msg: string): void => {
  fail += 1;
  console.log(`❌ ${id} ${msg}`);
};
const check = (id: string, cond: boolean, msg: string): void => {
  if (cond) ok(id, msg);
  else bad(id, msg);
};

interface Proc {
  stdout: string;
  stderr: string;
  status: number | null;
}
function cli(args: string[]): Proc {
  const r = spawnSync("node", [dist, ...args], {
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (r.error) throw r.error;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}
const loadLine = (p: Proc): string | undefined =>
  p.stderr.split("\n").find((l) => /triple cache: (hit|delta|rebuild)/.test(l));
const wtLine = (p: Proc): string | undefined =>
  p.stderr.split("\n").find((l) => /write-through/.test(l));
const refused = (p: Proc): boolean => /Precondition not satisfied/.test(p.stderr);
const cacheOf = (root: string): { metadata: { inferenceEnabled: boolean; inferredCount: number } } =>
  JSON.parse(fs.readFileSync(path.join(root, REL.cache), "utf-8"));

if (build) {
  const b = spawnSync("npm", ["run", "build", "-w", "@kitelev/exocortex-cli"], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 300_000,
  });
  if (b.status !== 0) {
    console.log(`⛔ BROKEN: dist build failed (rc ${b.status})\n${b.stderr.slice(-2000)}`);
    process.exit(2);
  }
}
if (!fs.existsSync(dist)) {
  console.log(`⛔ BROKEN: no CLI bundle at ${dist}`);
  process.exit(2);
}
console.log(`dist: ${dist}`);

const cached = buildVault();
const plain = buildVault();
const chainArgs = (vault: string, extra: string[]): string[] => [
  "apply",
  "create-task-instance-4264",
  REL.proto,
  "--input",
  JSON.stringify({ label: CHAIN_LABEL }),
  "--seed",
  SEED,
  "--frozen-clock",
  FROZEN,
  "--json",
  "--vault",
  vault,
  ...extra,
];

try {
  // P1 — index (the bot's own warm-up), inferred layer persisted
  const idx = cli(["index", "--vault", cached, "--force"]);
  check("P1", idx.status === 0 && cacheOf(cached).metadata.inferenceEnabled && cacheOf(cached).metadata.inferredCount > 0,
    `index rc=${idx.status}, inferenceEnabled=${cacheOf(cached).metadata.inferenceEnabled}, inferred=${cacheOf(cached).metadata.inferredCount}`);

  // P2 — process 1
  const p1 = cli(chainArgs(cached, ["--use-cache", "--write-through"]));
  const created = (JSON.parse(p1.stdout) as { created: Array<{ path: string }> }).created[0]?.path ?? "";
  check("P2", p1.status === 0 && loadLine(p1) === "⚡ triple cache: hit" &&
    wtLine(p1) === "💾 triple cache: write-through persisted (1 file(s) re-parsed)" &&
    created !== "" && fs.existsSync(path.join(cached, created)),
    `p1 rc=${p1.status} load=[${loadLine(p1)}] wt=[${wtLine(p1)}] created=${created}`);

  // P3 — process 2
  // --frozen-clock on every step: the status flips stamp exo__Asset_updatedAt,
  // and the twin chain below must produce the same bytes across process starts.
  const p2 = cli(["apply", "move-to-backlog-4264", created, "--json", "--frozen-clock", FROZEN, "--vault", cached, "--use-cache", "--write-through"]);
  check("P3", p2.status === 0 && !refused(p2) && loadLine(p2) === "⚡ triple cache: hit",
    `p2 rc=${p2.status} refused=${refused(p2)} load=[${loadLine(p2)}] wt=[${wtLine(p2)}]`);

  // P4 — process 3
  const p3 = cli(["apply", "start-effort-4264", created, "--json", "--frozen-clock", FROZEN, "--vault", cached, "--use-cache", "--write-through"]);
  const finalCached = fs.readFileSync(path.join(cached, created), "utf-8");
  check("P4", p3.status === 0 && !refused(p3) && loadLine(p3) === "⚡ triple cache: hit" && finalCached.includes(`[[${STATUS_DOING}]]`),
    `p3 rc=${p3.status} refused=${refused(p3)} load=[${loadLine(p3)}] doing=${finalCached.includes(`[[${STATUS_DOING}]]`)}`);

  // P5 — the no-flag chain on the twin vault
  const q1 = cli(chainArgs(plain, []));
  const q2 = cli(["apply", "move-to-backlog-4264", created, "--json", "--frozen-clock", FROZEN, "--vault", plain]);
  const q3 = cli(["apply", "start-effort-4264", created, "--json", "--frozen-clock", FROZEN, "--vault", plain]);
  const finalPlain = fs.existsSync(path.join(plain, created)) ? fs.readFileSync(path.join(plain, created), "utf-8") : "<missing>";
  // The executor's own [warn]/[ERROR] lines (StderrLogger) appear with and
  // without the flag alike; what the flag must NOT add to the plain run is a
  // `triple cache:` line.
  const noCacheLine = (p: Proc): boolean => !/triple cache:/.test(p.stderr);
  check("P5", finalPlain === finalCached && q1.stdout === p1.stdout && q2.stdout === p2.stdout && q3.stdout === p3.stdout &&
    noCacheLine(q1) && noCacheLine(q2) && noCacheLine(q3),
    `file identical=${finalPlain === finalCached} stdout identical=${[q1.stdout === p1.stdout, q2.stdout === p2.stdout, q3.stdout === p3.stdout]} plain has no cache line=${[noCacheLine(q1), noCacheLine(q2), noCacheLine(q3)]}`);

  // P6 — index's layer survived three write-throughs
  const meta = cacheOf(cached).metadata;
  check("P6", meta.inferenceEnabled && meta.inferredCount > 0, `inferenceEnabled=${meta.inferenceEnabled} inferred=${meta.inferredCount}`);

  // P7 — resolve-buttons after the chain
  const r1 = cli(["resolve-buttons", created, "--json", "--show-hidden", "--vault", cached, "--use-cache"]);
  const r0 = cli(["resolve-buttons", created, "--json", "--show-hidden", "--vault", plain]);
  check("P7", r1.status === 0 && loadLine(r1) === "⚡ triple cache: hit" && r1.stdout === r0.stdout && !/triple cache:/.test(r0.stderr),
    `rc=${r1.status} load=[${loadLine(r1)}] stdout identical=${r1.stdout === r0.stdout}`);

  // P8 — create --validate in a 4th process, hit in a 5th
  const c1 = cli(["create", "--class", TASK_CLASS, "--label", "proc-chain created", "--validate", "--vault", cached, "--use-cache", "--write-through"]);
  const c2 = cli(["create", "--class", TASK_CLASS, "--label", "proc-chain created 2", "--validate", "--dry-run", "--vault", cached, "--use-cache"]);
  check("P8", c1.status === 0 && loadLine(c1) === "⚡ triple cache: hit" &&
    wtLine(c1) === "💾 triple cache: write-through persisted (1 file(s) re-parsed)" &&
    c2.status === 0 && loadLine(c2) === "⚡ triple cache: hit" && wtLine(c2) === undefined,
    `c1 rc=${c1.status} load=[${loadLine(c1)}] wt=[${wtLine(c1)}]; c2 rc=${c2.status} load=[${loadLine(c2)}] wt=[${wtLine(c2)}]`);

  // P9 — delta-only default across real processes: a second chain instance
  // created WITHOUT --write-through; the cache file must not change under the
  // writer, and the next process pays the delta and still sees the write.
  const cacheBefore = fs.readFileSync(path.join(cached, REL.cache));
  const d1 = cli(["apply", "create-task-instance-4264", REL.proto, "--input", JSON.stringify({ label: `${CHAIN_LABEL} delta-only` }),
    "--json", "--vault", cached, "--use-cache"]);
  const created2 = (JSON.parse(d1.stdout) as { created: Array<{ path: string }> }).created[0]?.path ?? "";
  const cacheUntouched = fs.readFileSync(path.join(cached, REL.cache)).equals(cacheBefore);
  const d2 = cli(["apply", "move-to-backlog-4264", created2, "--json", "--frozen-clock", FROZEN, "--vault", cached, "--use-cache"]);
  check("P9", d1.status === 0 && loadLine(d1) === "⚡ triple cache: hit" && wtLine(d1) === undefined && created2 !== "" && cacheUntouched &&
    d2.status === 0 && !refused(d2) && /triple cache: delta \(1 file\(s\) re-parsed\)/.test(loadLine(d2) ?? ""),
    `d1 rc=${d1.status} load=[${loadLine(d1)}] wt=[${wtLine(d1)}] cache untouched=${cacheUntouched}; d2 rc=${d2.status} refused=${refused(d2)} load=[${loadLine(d2)}]`);

  // P10 — --write-through alone is refused before anything is applied
  const fileBefore = fs.readFileSync(path.join(cached, created2), "utf-8");
  const x = cli(["apply", "start-effort-4264", created2, "--json", "--vault", cached, "--write-through"]);
  const xLines = x.stderr.split("\n").filter((l) => l.length > 0);
  check("P10", x.status === 2 && xLines.length === 1 && /--write-through requires --use-cache/.test(xLines[0]) && x.stdout === "" &&
    fs.readFileSync(path.join(cached, created2), "utf-8") === fileBefore,
    `rc=${x.status} stderr=${JSON.stringify(xLines)} stdout empty=${x.stdout === ""} file untouched=${fs.readFileSync(path.join(cached, created2), "utf-8") === fileBefore}`);
} finally {
  fs.rmSync(cached, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });
}

console.log(`PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
