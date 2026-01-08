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
jest.unstable_mockModule("exocortex", () => ({
  InMemoryTripleStore: jest.fn(() => ({
    addAll: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  })),
  SPARQLParser: jest.fn(() => ({
    parse: jest.fn().mockReturnValue({ type: "query" }),
  })),
  AlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraOptimizer: jest.fn(() => ({
    optimize: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  QueryExecutor: jest.fn(() => ({
    executeAll: jest.fn().mockResolvedValue([]),
    isConstructQuery: jest.fn().mockReturnValue(false),
  })),
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: jest.fn().mockResolvedValue([]),
  })),
  SolutionMapping: class SolutionMapping extends Map {
    toJSON() {
      return Object.fromEntries(this);
    }
  },
  IRI: class IRI { constructor(public value: string) {} },
  Literal: class Literal { constructor(public value: string) {} },
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

const { assetCommand, expandPrefixedUri } = await import("../../../src/commands/asset.js");

describe("assetCommand", () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let existsSyncSpy: jest.SpiedFunction<typeof fs.existsSync>;
  let processCwdSpy: jest.SpiedFunction<typeof process.cwd>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    existsSyncSpy = jest.spyOn(fs, "existsSync");
    processCwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/test/vault");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = assetCommand();
      expect(cmd.name()).toBe("asset");
    });

    it("should have correct description", () => {
      const cmd = assetCommand();
      expect(cmd.description()).toBe("Asset relation queries (backlinks, references)");
    });

    it("should have 'relations' subcommand", () => {
      const cmd = assetCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain("relations");
    });

    it("should have 'backlinks' subcommand", () => {
      const cmd = assetCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain("backlinks");
    });

    it("should have 'references' subcommand", () => {
      const cmd = assetCommand();
      const subcommands = cmd.commands.map(c => c.name());
      expect(subcommands).toContain("references");
    });
  });

  describe("relations subcommand", () => {
    it("should have --file option", () => {
      const cmd = assetCommand();
      const relationsCmd = cmd.commands.find(c => c.name() === "relations");
      expect(relationsCmd).toBeDefined();
      const fileOption = relationsCmd?.options.find(opt => opt.long === "--file");
      expect(fileOption).toBeDefined();
    });

    it("should have --format option with default 'table'", () => {
      const cmd = assetCommand();
      const relationsCmd = cmd.commands.find(c => c.name() === "relations");
      expect(relationsCmd).toBeDefined();
      const formatOption = relationsCmd?.options.find(opt => opt.long === "--format");
      expect(formatOption).toBeDefined();
      expect(formatOption?.defaultValue).toBe("table");
    });

    it("should have --vault option", () => {
      const cmd = assetCommand();
      const relationsCmd = cmd.commands.find(c => c.name() === "relations");
      expect(relationsCmd).toBeDefined();
      const vaultOption = relationsCmd?.options.find(opt => opt.long === "--vault");
      expect(vaultOption).toBeDefined();
    });

    it("should have --output option", () => {
      const cmd = assetCommand();
      const relationsCmd = cmd.commands.find(c => c.name() === "relations");
      expect(relationsCmd).toBeDefined();
      const outputOption = relationsCmd?.options.find(opt => opt.long === "--output");
      expect(outputOption).toBeDefined();
    });
  });

  describe("backlinks subcommand", () => {
    it("should have --file option", () => {
      const cmd = assetCommand();
      const backlinksCmd = cmd.commands.find(c => c.name() === "backlinks");
      expect(backlinksCmd).toBeDefined();
      const fileOption = backlinksCmd?.options.find(opt => opt.long === "--file");
      expect(fileOption).toBeDefined();
    });

    it("should have --format option", () => {
      const cmd = assetCommand();
      const backlinksCmd = cmd.commands.find(c => c.name() === "backlinks");
      expect(backlinksCmd).toBeDefined();
      const formatOption = backlinksCmd?.options.find(opt => opt.long === "--format");
      expect(formatOption).toBeDefined();
    });

    it("should have --vault option", () => {
      const cmd = assetCommand();
      const backlinksCmd = cmd.commands.find(c => c.name() === "backlinks");
      expect(backlinksCmd).toBeDefined();
      const vaultOption = backlinksCmd?.options.find(opt => opt.long === "--vault");
      expect(vaultOption).toBeDefined();
    });
  });

  describe("references subcommand", () => {
    it("should have --file option", () => {
      const cmd = assetCommand();
      const referencesCmd = cmd.commands.find(c => c.name() === "references");
      expect(referencesCmd).toBeDefined();
      const fileOption = referencesCmd?.options.find(opt => opt.long === "--file");
      expect(fileOption).toBeDefined();
    });

    it("should have --predicate option for filtering", () => {
      const cmd = assetCommand();
      const referencesCmd = cmd.commands.find(c => c.name() === "references");
      expect(referencesCmd).toBeDefined();
      const predicateOption = referencesCmd?.options.find(opt => opt.long === "--predicate");
      expect(predicateOption).toBeDefined();
    });

    it("should have --format option", () => {
      const cmd = assetCommand();
      const referencesCmd = cmd.commands.find(c => c.name() === "references");
      expect(referencesCmd).toBeDefined();
      const formatOption = referencesCmd?.options.find(opt => opt.long === "--format");
      expect(formatOption).toBeDefined();
    });
  });
});

describe("expandPrefixedUri", () => {
  it("should expand exo: prefix", () => {
    const result = expandPrefixedUri("exo:Asset_relates");
    expect(result).toBe("https://exocortex.my/ontology/exo#Asset_relates");
  });

  it("should expand dcterms: prefix", () => {
    const result = expandPrefixedUri("dcterms:references");
    expect(result).toBe("http://purl.org/dc/terms/references");
  });

  it("should expand rdf: prefix", () => {
    const result = expandPrefixedUri("rdf:type");
    expect(result).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  });

  it("should expand rdfs: prefix", () => {
    const result = expandPrefixedUri("rdfs:label");
    expect(result).toBe("http://www.w3.org/2000/01/rdf-schema#label");
  });

  it("should return unchanged if no matching prefix", () => {
    const fullUri = "https://example.org/predicate";
    const result = expandPrefixedUri(fullUri);
    expect(result).toBe(fullUri);
  });

  it("should return unchanged for unknown prefix", () => {
    const result = expandPrefixedUri("unknown:predicate");
    expect(result).toBe("unknown:predicate");
  });

  it("should handle empty string", () => {
    const result = expandPrefixedUri("");
    expect(result).toBe("");
  });

  it("should handle prefix-like string without colon match", () => {
    const result = expandPrefixedUri("exocortex#something");
    expect(result).toBe("exocortex#something");
  });
});
