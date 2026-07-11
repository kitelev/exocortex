import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";

// Mock dependencies
jest.unstable_mockModule("@kitelev/exocortex-core", () => ({
  InMemoryTripleStore: jest.fn(() => ({
    addAll: jest.fn(),
    match: jest.fn().mockReturnValue([]),
  })),
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: jest.fn().mockResolvedValue([]),
  })),
  ExoQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query", queryType: "SELECT" }),
  })),

  SPARQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query" }),
  })),
  ExoQLAlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),

  AlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraOptimizer: jest.fn(() => ({
    optimize: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  ExoQLQueryExecutor: jest.fn(() => ({
    executeAll: jest.fn().mockResolvedValue([]),
  })),

  QueryExecutor: jest.fn(() => ({
    executeAll: jest.fn().mockResolvedValue([]),
    isConstructQuery: jest.fn().mockReturnValue(false),
  })),
  IRI: jest.fn((value: string) => ({ value, toString: () => value })),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
  Triple: jest.fn(),
  SolutionMapping: class SolutionMapping extends Map {
    variables() { return Array.from(this.keys()); }
    toJSON() { return Object.fromEntries(this); }
  },
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

// Mock CacheManager
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    loadOrBuild: jest.fn().mockResolvedValue({ triples: [], cacheHit: false, durationMs: 10 }),
    buildCache: jest.fn().mockResolvedValue({ tripleCount: 0, durationMs: 10 }),
    getCacheStats: jest.fn().mockResolvedValue(null),
    invalidate: jest.fn().mockResolvedValue(undefined),
    getCachePath: jest.fn().mockReturnValue("/mock/cache/path"),
  })),
}));

// req 2678df55 — classes now reads its introspection SPARQL through the
// NamedQueryRunner (built by this factory). Mock the seam so the unit test
// (command structure + vault-not-found) doesn't pull the real
// FsQueryBodyResolver / NodeFsAdapter core chain.
jest.unstable_mockModule("../../../src/services/NamedQueryCliRunner.js", () => ({
  buildNamedQueryRunner: jest.fn(() => ({
    run: jest.fn().mockResolvedValue({ kind: "select", rows: [] }),
  })),
}));

// Import the classes command after mocking
const { classesCommand } = await import("../../../src/commands/classes.js");

describe("classesCommand", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;
  let processCwdSpy: jest.SpiedFunction<typeof process.cwd>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);
    existsSyncSpy = jest.spyOn(fs, "existsSync");
    processCwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/test/vault");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = classesCommand();
      expect(cmd.name()).toBe("classes");
    });

    it("should have correct description", () => {
      const cmd = classesCommand();
      expect(cmd.description()).toContain("RDF classes");
    });

    it("should accept optional class-name argument", () => {
      const cmd = classesCommand();
      // The command should have registered arguments
      expect(cmd.registeredArguments).toBeDefined();
    });

    it("should have --vault option", () => {
      const cmd = classesCommand();
      const vaultOption = cmd.options.find(opt => opt.flags.includes("--vault"));
      expect(vaultOption).toBeDefined();
    });

    it("should have --format option", () => {
      const cmd = classesCommand();
      const formatOption = cmd.options.find(opt => opt.flags.includes("--format"));
      expect(formatOption).toBeDefined();
      expect(formatOption?.defaultValue).toBe("table");
    });

    it("should have --output option for MCP compatibility", () => {
      const cmd = classesCommand();
      const outputOption = cmd.options.find(opt => opt.flags.includes("--output"));
      expect(outputOption).toBeDefined();
    });

    it("should have --use-cache option", () => {
      const cmd = classesCommand();
      const cacheOption = cmd.options.find(opt => opt.flags.includes("--use-cache"));
      expect(cacheOption).toBeDefined();
    });

    // Issue #3043 Phase B: schema introspection AC requires `describe-class` name.
    it("should expose describe-class alias (#3043 RFC §B)", () => {
      const cmd = classesCommand();
      expect(cmd.aliases()).toContain("describe-class");
    });
  });

  describe("vault validation", () => {
    it("should error when vault not found", async () => {
      existsSyncSpy.mockReturnValue(false);

      const cmd = classesCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", "/missing/vault",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalled();
    });
  });

  // Skip execution tests due to complex mocking requirements
  // Integration tests provide coverage for actual behavior
  describe.skip("execution tests", () => {
    it("should list all RDF classes in vault when no argument provided", async () => {
      existsSyncSpy.mockReturnValue(true);

      const cmd = classesCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", "/test/vault",
      ]);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should show class details when class name provided", async () => {
      existsSyncSpy.mockReturnValue(true);

      const cmd = classesCommand();
      await cmd.parseAsync([
        "node", "test",
        "ems__Task",
        "--vault", "/test/vault",
      ]);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
