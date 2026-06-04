/**
 * Regression coverage for `--profile` ↔ cache interaction в `sparql query`
 * (RFC 0a0791c1 Issue #3323).
 *
 * Two caches live in the query path:
 *   1. CacheManager — persistent triple cache (gated by --use-cache).
 *   2. QueryResultCache — SPARQL-result cache (default ON, gated by
 *      --no-cache).
 * Both cache keys lack a profile dimension. When `--profile` is active
 * either cache could return stale / wrong-scope rows. The fix bypasses
 * BOTH caches when `--profile` is set; this test locks that contract in.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const mockAddAll = jest.fn();
const mockConvertVault = jest.fn().mockResolvedValue([]);
const mockResultCacheGet = jest.fn().mockResolvedValue(null);
const mockResultCacheSet = jest.fn().mockResolvedValue(undefined);
const mockTripleCacheLoadOrBuild = jest
  .fn()
  .mockResolvedValue({ triples: [], cacheHit: false });

jest.unstable_mockModule("../../../src/formatters/TableFormatter.js", () => ({
  TableFormatter: jest.fn(() => ({ format: jest.fn().mockReturnValue("") })),
}));
jest.unstable_mockModule("../../../src/formatters/JsonFormatter.js", () => ({
  JsonFormatter: jest.fn(() => ({ format: jest.fn().mockReturnValue("{}") })),
}));
jest.unstable_mockModule("../../../src/formatters/CsvFormatter.js", () => ({
  CsvFormatter: jest.fn(() => ({ format: jest.fn().mockReturnValue("") })),
}));
jest.unstable_mockModule("../../../src/formatters/TriplesFormatter.js", () => ({
  TriplesFormatter: jest.fn(() => ({
    formatTable: jest.fn().mockReturnValue(""),
    formatJson: jest.fn().mockReturnValue("[]"),
    formatNTriples: jest.fn().mockReturnValue(""),
  })),
}));

jest.unstable_mockModule("exocortex", () => ({
  InMemoryTripleStore: jest.fn(() => ({ addAll: mockAddAll })),
  ExoQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query", queryType: "SELECT" }),
  })),
  SPARQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query" }),
    setVaultPrefixes: jest.fn(),
  })),
  SPARQLParseError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = "SPARQLParseError";
    }
  },
  ExoQLAlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraOptimizer: jest.fn(() => ({
    optimize: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraSerializer: jest.fn(() => ({
    toString: jest.fn().mockReturnValue("BGP()"),
  })),
  ExoQLQueryExecutor: jest.fn(() => ({
    executeAll: jest.fn().mockResolvedValue([]),
  })),
  QueryExecutor: jest.fn(() => ({
    executeAll: jest.fn().mockResolvedValue([]),
    isConstructQuery: jest.fn().mockReturnValue(false),
    setTimeout: jest.fn(),
  })),
  NoteToRDFConverter: jest.fn(() => ({ convertVault: mockConvertVault })),
  SolutionMapping: class extends Map {},
  UpdateExecutor: jest.fn(() => ({
    execute: jest.fn().mockResolvedValue([]),
  })),
  UpdateExecutorError: class extends Error {},
  IRI: jest.fn(),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
  Triple: jest.fn(),
  // Issue #3286 — sparql-query.ts now imports IRICanonicalizer for the
  // canonicalization step; buildVaultUidIndex transitively imports
  // vaultPathToIRI. Stub both so the test loads even though canonicalization
  // is OFF by default (env flag unset).
  IRICanonicalizer: {
    canonicalize: jest.fn(() => ({
      triples: [],
      remapCount: 0,
      uniqueRemapCount: 0,
    })),
  },
  vaultPathToIRI: jest.fn((p: string) => `obsidian://vault/${p}`),
  // Issue #3219 — cross-vault resolver util pulled in by sparql-query.ts
  DomainIRI: class { constructor(public value: string) {} },
  DomainLiteral: class { constructor(public value: string) {} },
  DomainTriple: class {
    constructor(public subject: unknown, public predicate: unknown, public object: unknown) {}
  },
  SPARQL_PREFIXES: "PREFIX exo: <https://exocortex.my/ontology/exo#>",
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    loadOrBuild: mockTripleCacheLoadOrBuild,
  })),
}));
jest.unstable_mockModule("../../../src/cache/QueryResultCache.js", () => ({
  QueryResultCache: jest.fn(() => ({
    get: mockResultCacheGet,
    set: mockResultCacheSet,
  })),
}));
jest.unstable_mockModule("../../../src/utils/VaultNamespaceScanner.js", () => ({
  scanVaultNamespaces: jest.fn().mockReturnValue(new Map()),
}));
jest.unstable_mockModule("../../../src/utils/QueryPrefixInjector.js", () => ({
  injectExocortexPrefixes: jest.fn((q: string) => q),
  transformShorthandNotation: jest.fn((q: string) => q),
  filterOntologyPrefixes: jest.fn((m: Map<string, string>) => m),
}));

// Stub out the heavy real resolver — its correctness is covered by
// `CliFocusProfileResolver.test.ts`. Here we only need to confirm
// the gate logic in sparql-query.ts wires `--profile` to the cache bypass.
jest.unstable_mockModule(
  "../../../src/utils/resolveProfileFilter.js",
  () => ({
    resolveProfileFilter: jest.fn(
      async (opts: { profileUid?: string }) => {
        if (!opts.profileUid) return null;
        // Return a real-shape result so the spread into convertVault works.
        return {
          effective: new Set(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]),
          folderMap: new Map([["assetspaces/ems", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]]),
        };
      },
    ),
  }),
);

const { sparqlQueryCommand } = await import("../../../src/commands/sparql-query.js");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "exo-sparql-profile-"));
const vaultDir = path.join(tmpBase, "vault");
fs.mkdirSync(vaultDir);

const PROFILE_UID = "11111111-1111-1111-1111-111111111111";

describe("sparqlQueryCommand --profile / cache interaction", () => {
  beforeEach(() => {
    mockAddAll.mockClear();
    mockConvertVault.mockClear();
    mockConvertVault.mockResolvedValue([]);
    mockResultCacheGet.mockClear();
    mockResultCacheGet.mockResolvedValue(null);
    mockResultCacheSet.mockClear();
    mockTripleCacheLoadOrBuild.mockClear();
    mockTripleCacheLoadOrBuild.mockResolvedValue({
      triples: [],
      cacheHit: false,
    });

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  it("should register --profile option", () => {
    const cmd = sparqlQueryCommand();
    const opt = cmd.options.find((o: { long?: string }) => o.long === "--profile");
    expect(opt).toBeDefined();
  });

  describe("backward-compat: without --profile, query-result cache is consulted", () => {
    it("calls QueryResultCache.get() when no --profile flag", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
      ]);
      expect(mockResultCacheGet).toHaveBeenCalled();
    });
  });

  describe("regression: with --profile, both caches are bypassed", () => {
    it("does NOT call QueryResultCache.get() when --profile is set", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
        "--profile", PROFILE_UID,
      ]);
      expect(mockResultCacheGet).not.toHaveBeenCalled();
    });

    it("does NOT call QueryResultCache.set() when --profile is set (result not cached back)", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
        "--profile", PROFILE_UID,
      ]);
      expect(mockResultCacheSet).not.toHaveBeenCalled();
    });

    it("does NOT call CacheManager.loadOrBuild() when --profile is set with --use-cache", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
        "--profile", PROFILE_UID,
        "--use-cache",
      ]);
      expect(mockTripleCacheLoadOrBuild).not.toHaveBeenCalled();
    });

    it("STILL bypasses QueryResultCache when --profile is set but resolveProfileFilter returns null (missing-profile / degraded)", async () => {
      // Simulate `--profile <unknown-uid>` → resolver returns null. Cache
      // bypass MUST stay engaged based on flag presence, NOT on filter
      // outcome — otherwise a missing-profile run would poison the
      // shared profileless cache key.
      const { resolveProfileFilter } = await import(
        "../../../src/utils/resolveProfileFilter.js"
      );
      (resolveProfileFilter as jest.MockedFunction<typeof resolveProfileFilter>)
        .mockResolvedValueOnce(null);

      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
        "--profile", PROFILE_UID,
      ]);
      expect(mockResultCacheGet).not.toHaveBeenCalled();
      expect(mockResultCacheSet).not.toHaveBeenCalled();
    });

    it("passes effectiveOntologies+assetSpaceFolderToUid to convertVault when --profile is set", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", vaultDir,
        "--profile", PROFILE_UID,
      ]);
      expect(mockConvertVault).toHaveBeenCalled();
      const callArgs = mockConvertVault.mock.calls[0][0];
      expect(callArgs).toBeDefined();
      expect((callArgs as { effectiveOntologies?: Set<string> }).effectiveOntologies).toBeDefined();
      expect((callArgs as { assetSpaceFolderToUid?: Map<string, string> }).assetSpaceFolderToUid).toBeDefined();
    });
  });
});
