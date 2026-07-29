/**
 * Integration test for Issue #3979 — SPARQL result-cache read-key ≠ write-key.
 *
 * Bug: `query` computed the result-cache lookup key from the RAW query string
 * (READ, before shorthand/PREFIX injection) but the store key from the
 * PREFIX-INJECTED query string (WRITE, after `injectExocortexPrefixes`
 * prepends the missing PREFIX lines). Since the cache key is
 * `sha256(normalize(query))`, and almost every query omits explicit PREFIX
 * (that's why auto-injection exists), READ and WRITE hashed different strings
 * → permanent cache miss + a fresh file written on every run (write-only).
 *
 * This test drives the REAL `sparqlQueryCommand()` action in-process (real
 * core engine via jest moduleNameMapper → core/src, real FileSystemVaultAdapter,
 * real NoteToRDFConverter, real prefix injection, real QueryResultCache) twice
 * against a real temp vault, keying the internal default QueryResultCache to a
 * hermetic temp dir via HOME override. It asserts the AUTHORITATIVE
 * `meta.queryResultCacheHit` flag (not timing): the second identical run must
 * be a cache HIT.
 *
 * Revert-verify: with the fix (single raw-query cache key for both get+set)
 * run #2 is a HIT (GREEN). Revert the fix (key from `queryString` for both) →
 * run #2 misses because the write went under the prefix-injected key → RED.
 *
 * In-process (not spawn/dist) so it actually RUNS in the `test-coverage-cli`
 * CI job (that job sets CI=true and does NOT build the CLI dist).
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
// Default import (mutable CJS exports) so jest.spyOn(os, "homedir") works —
// `import * as os` yields a frozen ESM namespace whose props are read-only.
import os from "os";

const { sparqlQueryCommand } =
  await import("../../src/commands/sparql-query.js");

/** A query with NO explicit PREFIX and no shorthand → injectExocortexPrefixes
 *  prepends the standard PREFIX block, so raw !== prefix-injected. This is the
 *  exact shape that triggers the read-key ≠ write-key bug. */
const QUERY = "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1";

interface CliResponse {
  success: boolean;
  data?: { type?: string; count?: number; bindings?: unknown[] };
  meta?: { queryResultCacheHit?: boolean; [k: string]: unknown };
}

describe("SPARQL result-cache key (Issue #3979)", () => {
  let vaultDir: string;
  let homeDir: string;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let logged: string[];

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3979-vault-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3979-home-"));

    // A couple of real legacy-format assets so the query has triples to scan.
    fs.writeFileSync(
      path.join(vaultDir, "asset-1.md"),
      `---\nexo__Asset_label: "Asset One"\nexo__Instance_class: "[[ems__Task]]"\n---\n`,
    );
    fs.writeFileSync(
      path.join(vaultDir, "asset-2.md"),
      `---\nexo__Asset_label: "Asset Two"\nexo__Instance_class: "[[ems__Task]]"\n---\n`,
    );

    // Redirect the default QueryResultCache dir (~/.exocortex/cache/query-results)
    // to a hermetic temp home. NOTE: os.homedir() is memoized under jest (a
    // process.env.HOME override does NOT take effect), so we spy on os.homedir
    // directly — restored by jest.restoreAllMocks() in afterEach.
    jest.spyOn(os, "homedir").mockReturnValue(homeDir);

    logged = [];
    consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => String(a)).join(" "));
      });
    // Surface any unexpected error path (handleSparqlError → process.exit)
    // as a thrown error rather than silently exiting the jest process.
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

  /** Run the real `query` command in-process and return the parsed JSON response. */
  async function runQuery(): Promise<CliResponse> {
    logged.length = 0;
    const cmd = sparqlQueryCommand();
    await cmd.parseAsync([
      "node",
      "query",
      QUERY,
      "--vault",
      vaultDir,
      "--output",
      "json",
    ]);

    // In --output json mode the command emits exactly one JSON response line.
    const jsonLine = [...logged].reverse().find((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" && "success" in parsed;
      } catch {
        return false;
      }
    });
    expect(jsonLine).toBeDefined();
    return JSON.parse(jsonLine as string) as CliResponse;
  }

  it("keys the result cache on the RAW query so an identical repeat query is a cache HIT", async () => {
    // Run #1: cold cache → MISS (writes the result under the raw-query key).
    const first = await runQuery();
    expect(first.success).toBe(true);
    expect(first.meta?.queryResultCacheHit).toBe(false);

    // Run #2: identical query → must be a cache HIT. This is the sole reliable
    // discriminator (file count is 1 either way; timing is non-deterministic).
    // With the #3979 fix: HIT (raw-query key read finds the raw-query key write).
    // Reverting the fix (queryString for both get+set): MISS, because the write
    // went under the prefix-injected key → RED.
    const second = await runQuery();
    expect(second.success).toBe(true);
    expect(second.meta?.queryResultCacheHit).toBe(true);

    // Sanity: a cache file was actually written under the hermetic home.
    const cacheDir = path.join(homeDir, ".exocortex", "cache", "query-results");
    const files = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(files.length).toBeGreaterThanOrEqual(1);

    expect(processExitSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalled();
  }, 60000);
});
