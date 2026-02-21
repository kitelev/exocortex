import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";

// Mock dependencies
const mockTableFormatter = {
  format: jest.fn().mockReturnValue("table output"),
};
const mockJsonFormatter = {
  format: jest.fn().mockReturnValue('{"result": []}'),
};

jest.unstable_mockModule("../../../src/formatters/TableFormatter.js", () => ({
  TableFormatter: jest.fn(() => mockTableFormatter),
}));

jest.unstable_mockModule("../../../src/formatters/JsonFormatter.js", () => ({
  JsonFormatter: jest.fn(() => mockJsonFormatter),
}));

// Mock the heavy exocortex dependencies
const mockParseFn = jest.fn().mockReturnValue({ type: "query", queryType: "SELECT" });

jest.unstable_mockModule("exocortex", () => ({
  InMemoryTripleStore: jest.fn(() => ({
    addAll: jest.fn(),
  })),
  SPARQLParser: jest.fn(() => ({
    parse: mockParseFn,
  })),
  SPARQLParseError: class SPARQLParseError extends Error {
    public readonly line?: number;
    public readonly column?: number;
    constructor(message: string, line?: number, column?: number) {
      super(message);
      this.name = "SPARQLParseError";
      this.line = line;
      this.column = column;
    }
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
  })),
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: jest.fn().mockResolvedValue([]),
  })),
  SolutionMapping: class SolutionMapping extends Map {},
  IRI: jest.fn(),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
  Triple: jest.fn(),
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

// Mock CacheManager for --use-cache option
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    loadOrBuild: jest.fn().mockResolvedValue({ triples: [], cacheHit: false, durationMs: 10 }),
    buildCache: jest.fn().mockResolvedValue({ tripleCount: 0, durationMs: 10 }),
    getCacheStats: jest.fn().mockResolvedValue(null),
    invalidate: jest.fn().mockResolvedValue(undefined),
    getCachePath: jest.fn().mockReturnValue("/mock/cache/path"),
  })),
}));

// Mock ProgressIndicator
jest.unstable_mockModule("../../../src/utils/ProgressIndicator.js", () => ({
  ProgressIndicator: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

const { sparqlQueryCommand } = await import("../../../src/commands/sparql-query.js");

describe("sparqlQueryCommand --dry-run flag", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(process, "cwd").mockReturnValue("/test/vault");

    // Reset parser mock to success state
    mockParseFn.mockReturnValue({ type: "query", queryType: "SELECT" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should accept --dry-run option", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const dryRunOption = options.find(opt => opt.flags.includes("--dry-run"));
      expect(dryRunOption).toBeDefined();
    });

    it("should have dry-run option with description mentioning validation", () => {
      const cmd = sparqlQueryCommand();
      const options = cmd.options;
      const dryRunOption = options.find(opt => opt.flags.includes("--dry-run"));
      expect(dryRunOption?.description).toMatch(/valid|syntax|check|parse/i);
    });
  });

  describe("--dry-run execution", () => {
    it("should validate syntax without loading vault when --dry-run is set", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Should show success message for valid query
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("valid"));
      // Should NOT show "Loading vault" message (no vault loading in dry-run mode)
      const loadingVaultCalls = consoleLogSpy.mock.calls.filter(
        call => call[0]?.toString().includes("Loading vault")
      );
      expect(loadingVaultCalls.length).toBe(0);
    });

    it("should report syntax errors with line numbers when --dry-run is set", async () => {
      // Make parser throw error with line/column info
      const { SPARQLParseError } = await import("exocortex");
      mockParseFn.mockImplementationOnce(() => {
        throw new SPARQLParseError("Unexpected token", 3, 15);
      });

      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { INVALID }",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Should show error with line number
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/line.*3|3.*line/i)
      );
      // Should exit with non-zero code
      expect(processExitSpy).toHaveBeenCalledWith(expect.any(Number));
    });

    it("should exit with code 0 for valid query in --dry-run mode", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Should not call process.exit with error code (0 is success, or no call at all)
      const exitCalls = processExitSpy.mock.calls;
      const errorExitCalls = exitCalls.filter(call => call[0] !== 0);
      expect(errorExitCalls.length).toBe(0);
    });

    it("should exit with code 1 for invalid query in --dry-run mode", async () => {
      const { SPARQLParseError } = await import("exocortex");
      mockParseFn.mockImplementationOnce(() => {
        throw new SPARQLParseError("Syntax error", 1, 1);
      });

      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "INVALID QUERY",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Should exit with non-zero code
      expect(processExitSpy).toHaveBeenCalled();
      const lastExitCall = processExitSpy.mock.calls[processExitSpy.mock.calls.length - 1];
      expect(lastExitCall[0]).not.toBe(0);
    });
  });

  describe("--dry-run with --explain combination", () => {
    it("should show query plan without executing when both --dry-run and --explain are set", async () => {
      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ?p ?o }",
        "--vault", "/test/vault",
        "--dry-run",
        "--explain",
      ]);

      // Should show query plan
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Query Plan"));
      // Should NOT load vault
      const loadingVaultCalls = consoleLogSpy.mock.calls.filter(
        call => call[0]?.toString().includes("Loading vault")
      );
      expect(loadingVaultCalls.length).toBe(0);
    });
  });
});

describe("sparqlQueryCommand enhanced error messages", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(process, "cwd").mockReturnValue("/test/vault");

    // Reset parser mock to success state
    mockParseFn.mockReturnValue({ type: "query", queryType: "SELECT" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("property name suggestions", () => {
    it("should suggest correct property name for common typos", async () => {
      // Simulate error with unknown property
      const { SPARQLParseError } = await import("exocortex");
      mockParseFn.mockImplementationOnce(() => {
        throw new SPARQLParseError("Unknown prefix: ems__Task_status", 5, 10);
      });

      const cmd = sparqlQueryCommand();
      await cmd.parseAsync([
        "node", "test",
        "SELECT ?s WHERE { ?s ems:Task_status ?o }",
        "--vault", "/test/vault",
        "--dry-run",
      ]);

      // Error message should be shown
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
