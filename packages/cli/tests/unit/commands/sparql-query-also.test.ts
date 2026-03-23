import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

// ── Shared mock state ──────────────────────────────────────────────────
const mockAddAll = jest.fn();
const mockConvertVault = jest.fn().mockResolvedValue([]);

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
  SPARQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query" }),
    setVaultPrefixes: jest.fn(),
  })),
  SPARQLParseError: class extends Error {
    constructor(m: string) { super(m); this.name = "SPARQLParseError"; }
  },
  AlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraOptimizer: jest.fn(() => ({
    optimize: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraSerializer: jest.fn(() => ({
    toString: jest.fn().mockReturnValue("BGP()"),
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
  SPARQL_PREFIXES: "PREFIX exo: <https://exocortex.my/ontology/exo#>",
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    loadOrBuild: jest.fn().mockResolvedValue({ triples: [], cacheHit: false }),
  })),
}));
jest.unstable_mockModule("../../../src/cache/QueryResultCache.js", () => ({
  QueryResultCache: jest.fn(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
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

const { sparqlQueryCommand } = await import("../../../src/commands/sparql-query.js");

// Create real temp directories for vault paths
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "exo-test-"));
const primaryVault = path.join(tmpBase, "vault");
const archiveVault = path.join(tmpBase, "archive");
const archiveVault2 = path.join(tmpBase, "archive2");
fs.mkdirSync(primaryVault);
fs.mkdirSync(archiveVault);
fs.mkdirSync(archiveVault2);

describe("sparqlQueryCommand --also flag", () => {
  beforeEach(() => {
    mockAddAll.mockClear();
    mockConvertVault.mockClear();
    mockConvertVault.mockResolvedValue([
      { subject: "s1", predicate: "p1", object: "o1" },
      { subject: "s2", predicate: "p2", object: "o2" },
    ]);

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  describe("command setup", () => {
    it("should have --also option registered", () => {
      const cmd = sparqlQueryCommand();
      const opt = cmd.options.find((o: { long?: string }) => o.long === "--also");
      expect(opt).toBeDefined();
    });

    it("--also description should mention repeatable", () => {
      const cmd = sparqlQueryCommand();
      const opt = cmd.options.find((o: { long?: string }) => o.long === "--also");
      expect(opt?.description).toContain("repeatable");
    });
  });

  describe("backward compatibility (no --also)", () => {
    it("should call convertVault once for primary vault only", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", primaryVault,
        "--no-cache",
      ]);

      expect(mockConvertVault).toHaveBeenCalledTimes(1);
      expect(mockAddAll).toHaveBeenCalledTimes(1);
      expect(mockAddAll.mock.calls[0][0]).toHaveLength(2);
    });
  });

  describe("single --also vault", () => {
    it("should call convertVault twice and merge triples", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", primaryVault,
        "--also", archiveVault,
        "--no-cache",
      ]);

      expect(mockConvertVault).toHaveBeenCalledTimes(2);
      expect(mockAddAll).toHaveBeenCalledTimes(1);
      expect(mockAddAll.mock.calls[0][0]).toHaveLength(4);
    });

    it("should log additional vault loading message", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", primaryVault,
        "--also", archiveVault,
        "--no-cache",
      ]);

      const logs = logSpy.mock.calls.map(c => String(c[0]));
      expect(logs.some(m => m.includes("additional vault"))).toBe(true);
      expect(logs.some(m => m.includes("2 vaults"))).toBe(true);
      logSpy.mockRestore();
    });
  });

  describe("multiple --also vaults", () => {
    it("should call convertVault three times and merge all triples", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", primaryVault,
        "--also", archiveVault,
        "--also", archiveVault2,
        "--no-cache",
      ]);

      expect(mockConvertVault).toHaveBeenCalledTimes(3);
      expect(mockAddAll).toHaveBeenCalledTimes(1);
      expect(mockAddAll.mock.calls[0][0]).toHaveLength(6);
    });
  });

  describe("error handling", () => {
    it("should error when --also vault path does not exist", async () => {
      const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", primaryVault,
        "--also", "/nonexistent/path/vault-missing-12345",
        "--no-cache",
      ]);

      expect(exitSpy).toHaveBeenCalled();
      exitSpy.mockRestore();
      errSpy.mockRestore();
    });
  });
});
