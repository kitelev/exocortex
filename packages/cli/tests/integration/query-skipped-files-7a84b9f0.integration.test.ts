/**
 * Integration test for ticket 7a84b9f0 — `query` names the files the loader
 * skipped instead of silently reporting an empty vault.
 *
 * Before this change `NoteToRDFConverter.convertVault()` returned
 * `result.triples` and dropped `skippedFiles` on the floor, so a vault whose
 * asset violates the #2997 Phase-2 invariant (declares `exo__Instance_class`
 * without `exo__Asset_uid`) answered `count: 0` with no hint whatsoever — the
 * user could not tell "empty vault" from "the file you asked about was
 * rejected by the loader".
 *
 * Every axis here drives the REAL `sparqlQueryCommand()` action in-process
 * (real FileSystemVaultAdapter, real NoteToRDFConverter, real CacheManager)
 * against a real temp vault and asserts what the command ACTUALLY PRINTS —
 * stdout for `--output json`, stderr for the text mode. Asserting the
 * `loadVaultTriples` result object instead would be vacuous: the field can be
 * populated correctly and never reach the user.
 *
 * In-process (not spawn/dist) so it runs in the `test-coverage-cli` CI job,
 * which sets CI=true and does NOT build the CLI dist.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import os from "os";

const { sparqlQueryCommand } =
  await import("../../src/commands/sparql-query.js");

const QUERY = "SELECT ?s ?l WHERE { ?s exo:Asset_label ?l }";

/** Declares `exo__Instance_class` but no `exo__Asset_uid` → the #2997 invariant
 *  rejects it, the file contributes zero triples, and before this ticket that
 *  was invisible. This is the same shape as the live carrier found in
 *  `sparql-exo003` (`createLegacyFile` writes only the properties passed). */
const ORPHAN = `---\nexo__Asset_label: "Orphan Asset"\nexo__Instance_class: "[[ems__Task]]"\n---\n`;

/** A well-formed asset so the vault is not trivially empty and the query has
 *  something to return on both paths. */
const GOOD = `---\nexo__Asset_uid: 11111111-2222-3333-4444-555555555555\nexo__Asset_label: "Good Asset"\nexo__Instance_class: "[[ems__Task]]"\n---\n`;

interface CliResponse {
  success: boolean;
  data?: { count?: number; bindings?: unknown[] };
  meta?: {
    skippedCount?: number;
    skippedFiles?: Array<{ path: string; reason: string }>;
    [k: string]: unknown;
  };
}

describe("query surfaces loader-skipped files (ticket 7a84b9f0)", () => {
  let vaultDir: string;
  let homeDir: string;
  let logged: string[];
  let errored: string[];
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-7a84b9f0-vault-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-7a84b9f0-home-"));
    jest.spyOn(os, "homedir").mockReturnValue(homeDir);

    logged = [];
    errored = [];
    jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    });
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errored.push(args.map((a) => String(a)).join(" "));
    });
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code}) called unexpectedly`);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function seedDirtyVault(): void {
    fs.writeFileSync(path.join(vaultDir, "orphan.md"), ORPHAN);
    fs.writeFileSync(path.join(vaultDir, "good.md"), GOOD);
  }

  function seedManyOrphans(n: number): void {
    fs.writeFileSync(path.join(vaultDir, "good.md"), GOOD);
    for (let i = 1; i <= n; i += 1) {
      fs.writeFileSync(
        path.join(vaultDir, `orphan-${String(i).padStart(2, "0")}.md`),
        `---\nexo__Asset_label: "Orphan ${i}"\nexo__Instance_class: "[[ems__Task]]"\n---\n`,
      );
    }
  }

  function seedCleanVault(): void {
    fs.writeFileSync(path.join(vaultDir, "good.md"), GOOD);
  }

  async function runQuery(
    extra: string[] = [],
  ): Promise<{ response?: CliResponse; stderr: string; stdout: string }> {
    logged.length = 0;
    errored.length = 0;
    const cmd = sparqlQueryCommand();
    await cmd.parseAsync([
      "node",
      "query",
      QUERY,
      "--vault",
      vaultDir,
      ...extra,
    ]);
    const jsonLine = [...logged].reverse().find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" && "success" in parsed;
      } catch {
        return false;
      }
    });
    return {
      response: jsonLine
        ? (JSON.parse(jsonLine) as CliResponse)
        : undefined,
      stderr: errored.join("\n"),
      stdout: logged.join("\n"),
    };
  }

  it("S1 names the skipped file and its reason in --output json meta (default full-parse path) @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    const { response } = await runQuery(["--output", "json"]);

    expect(response?.success).toBe(true);
    expect(response?.meta?.skippedCount).toBe(1);
    const skipped = response?.meta?.skippedFiles;
    expect(Array.isArray(skipped)).toBe(true);
    expect(skipped).toHaveLength(1);
    expect(skipped?.[0]?.path).toBe("orphan.md");
    // The reason must name the property the loader missed — "a file was
    // skipped" without saying why is the same muteness one level up.
    expect(skipped?.[0]?.reason).toContain("exo__Asset_uid");

    // The well-formed sibling still answers, so the skip is diagnostics and
    // not a refusal.
    expect(response?.data?.count).toBe(1);
    expect(processExitSpy).not.toHaveBeenCalled();
  }, 60000);

  it("S2 prints the skipped file on STDERR in text mode, keeping stdout the result document @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    const { stderr, stdout } = await runQuery();

    expect(stderr).toContain("orphan.md");
    expect(stderr).toContain("exo__Asset_uid");
    // Same shape `index` has printed since #2205: a heading, then the path,
    // then the reason — parity by citation, not by analogy.
    expect(stderr).toContain("skipped");
    // stdout carries results, not the diagnostic block.
    expect(stdout).not.toContain("exo__Asset_uid");
    expect(processExitSpy).not.toHaveBeenCalled();
  }, 60000);

  it("S3 stays silent — no meta fields, no stderr — when every asset is well-formed @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedCleanVault();
    const { response, stderr } = await runQuery(["--output", "json"]);

    expect(response?.success).toBe(true);
    expect(response?.meta).toBeDefined();
    expect("skippedFiles" in (response?.meta ?? {})).toBe(false);
    expect("skippedCount" in (response?.meta ?? {})).toBe(false);
    expect(stderr).toBe("");
    // Canary: the clean vault really did produce a result, so the silence is
    // about there being nothing to report — not about the query going nowhere.
    expect(response?.data?.count).toBe(1);
  }, 60000);

  it("S4 on --use-cache reports the COUNT of files that produced no triples and claims no per-file list @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    const { response, stderr } = await runQuery([
      "--use-cache",
      "--output",
      "json",
    ]);

    expect(response?.success).toBe(true);
    // The cache format cannot distinguish a skipped file from a genuinely
    // empty one, so the machine-readable list must be ABSENT rather than empty.
    expect("skippedFiles" in (response?.meta ?? {})).toBe(false);
    expect("skippedCount" in (response?.meta ?? {})).toBe(false);

    const loaderLines = stderr
      .split("\n")
      .filter((l) => l.includes("contributed no triples"));
    expect(loaderLines).toHaveLength(1);
    expect(loaderLines[0]).toContain("1 file(s)");
  }, 60000);

  it("S5 the cache-path line names NO cause at all — only that the cache does not record why @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    const { stderr } = await runQuery(["--use-cache"]);

    const line = stderr
      .split("\n")
      .find((l) => l.includes("contributed no triples"));
    expect(line).toBeDefined();
    expect(line).toContain("does not record WHY");
    // ⛔ No cause may be enumerated. `zeroTriplePaths` also holds
    // folder-excluded and FileSpace-excluded files, which are neither skipped
    // by the invariant nor genuinely empty — so any list of causes presented
    // as the set would be a false claim, and adding members does not fix it.
    expect(line).not.toContain("genuinely empty");
    expect(line).not.toContain("skipped by");
  }, 60000);

  it("S6 the cache-path line carries a ROUTE to the per-file reasons, not just a number @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    const { stderr } = await runQuery(["--use-cache"]);

    const line = stderr
      .split("\n")
      .find((l) => l.includes("contributed no triples"));
    expect(line).toBeDefined();
    expect(line).toContain("--use-cache");
    expect(line).toContain("index");
  }, 60000);

  it("S7 the full-parse block names every skipped file, not just the first @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    fs.writeFileSync(
      path.join(vaultDir, "orphan-2.md"),
      `---\nexo__Asset_label: "Second Orphan"\nexo__Instance_class: "[[ems__Task]]"\n---\n`,
    );
    const { response, stderr } = await runQuery(["--output", "json"]);

    expect(response?.meta?.skippedCount).toBe(2);
    const paths = (response?.meta?.skippedFiles ?? []).map((f) => f.path).sort();
    expect(paths).toEqual(["orphan-2.md", "orphan.md"]);
    // The printed block must not truncate either — both files, both reasons.
    expect(stderr).toContain("orphan.md");
    expect(stderr).toContain("orphan-2.md");
    expect(stderr.match(/exo__Asset_uid/g) ?? []).toHaveLength(2);
  }, 60000);

  it("S9 the printed block is CAPPED at ten files, while the JSON meta stays complete @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedManyOrphans(12);
    const { response, stderr } = await runQuery(["--output", "json"]);

    // The block runs before EVERY query, unlike `index`'s terminal report, so
    // a dirty vault must not drown the output: ten paths, no more.
    const pathLines = stderr.split("\n").filter((l) => l.startsWith("   - "));
    expect(pathLines).toHaveLength(10);

    // The machine-readable surface is NOT capped — a consumer that asked for
    // JSON asked for the whole answer.
    expect(response?.meta?.skippedCount).toBe(12);
    expect(response?.meta?.skippedFiles).toHaveLength(12);
  }, 60000);

  it("S10 the capped block says how many it withheld and where to see them @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedManyOrphans(12);
    const { stderr } = await runQuery();

    const remainder = stderr
      .split("\n")
      .find((l) => l.includes("more — run"));
    expect(remainder).toBeDefined();
    // The count of what was withheld, and the same route the cache line uses —
    // capping must not make anything unreachable, only quieter.
    expect(remainder).toContain("2 more");
    expect(remainder).toContain("index");
  }, 60000);

  it("S8 a query served from the RESULT cache claims nothing about skipped files — it never read the vault @req:81cd5d1f-6466-47c9-99cd-8fe9f9b500a3", async () => {
    seedDirtyVault();
    // Run #1 populates the query-result cache (on by default; `--no-cache`
    // disables it) AND reports the skip, because it did load the vault.
    const first = await runQuery(["--output", "json"]);
    expect(first.response?.meta?.skippedCount).toBe(1);
    expect(first.stderr).toContain("orphan.md");

    // Run #2 is answered from the result cache BEFORE any vault load
    // (sparql-query.ts: the `useQueryResultCache` branch returns early), so the
    // command has measured nothing. It must therefore claim nothing: no list,
    // and — the part that matters — no `skippedCount: 0`, which would read as
    // "nothing was dropped" on a vault where something was.
    const second = await runQuery(["--output", "json"]);
    expect(second.response?.meta?.queryResultCacheHit).toBe(true);
    expect("skippedFiles" in (second.response?.meta ?? {})).toBe(false);
    expect("skippedCount" in (second.response?.meta ?? {})).toBe(false);
    expect(second.stderr).toBe("");
  }, 60000);
});
