import { jest } from "@jest/globals";
import { Command } from "commander";

// Mock CacheManager (transitively depends on exocortex, fs-extra)
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    validateVault: jest.fn(() => []),
    loadOrBuild: jest.fn(() => ({ triples: [], cacheHit: false })),
  })),
}));

// Mock exocortex (CacheManager dependency + validate-schema dependency)
jest.unstable_mockModule("exocortex", () => ({
  NoteToRDFConverter: jest.fn(),
  Triple: jest.fn(),
  IRI: jest.fn(),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
  InMemoryTripleStore: jest.fn(),
  ExoQLParser: jest.fn(),
  ExoQLAlgebraTranslator: jest.fn(),
  AlgebraOptimizer: jest.fn(),
  ExoQLQueryExecutor: jest.fn(),
  SPARQL_PREFIXES: "",
  // SHACL-lite exports (P1.6)
  ShapeLoader: { loadFromVaultFS: jest.fn().mockResolvedValue({ getAll: jest.fn().mockReturnValue([]) }) },
  ShaclShapeRegistry: jest.fn().mockImplementation(() => ({})),
  shaclValidate: jest.fn().mockReturnValue({ conforms: true, violations: [] }),
  DomainIRI: class { constructor(public value: string) {} },
  DomainLiteral: class { constructor(public value: string) {} },
  DomainTriple: jest.fn(),
}));

// Mock fs-extra (CacheManager dependency)
jest.unstable_mockModule("fs-extra", () => ({
  default: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    pathExists: jest.fn(),
    ensureDir: jest.fn(),
    stat: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
  },
}));

const { validateCommand } = await import("../../../src/commands/validate.js");

/**
 * Issue #2346: Tests for validate CLI command registration
 * Updated for #2713: validate is now a parent command with subcommands
 */
describe("Issue #2346: validate command", () => {
  it("should create a command with name 'validate'", () => {
    const cmd = validateCommand();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("validate");
  });

  it("should have a description mentioning validation", () => {
    const cmd = validateCommand();
    expect(cmd.description()).toBeTruthy();
    expect(cmd.description().toLowerCase()).toMatch(/valid|check|vault/);
  });

  it("should have 'iri' subcommand", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri");
    expect(iriCmd).toBeDefined();
  });

  it("should have 'schema' subcommand", () => {
    const cmd = validateCommand();
    const schemaCmd = cmd.commands.find((c: any) => c.name() === "schema");
    expect(schemaCmd).toBeDefined();
  });

  it("should have 'frontmatter' subcommand (Issue #2997 Phase 4)", () => {
    const cmd = validateCommand();
    const fmCmd = cmd.commands.find((c: any) => c.name() === "frontmatter");
    expect(fmCmd).toBeDefined();
  });

  it("iri subcommand should have optional --vault option with default value", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    const option = iriCmd.options.find(
      (opt: any) => opt.long === "--vault",
    );
    expect(option).toBeDefined();
    expect(option.mandatory).toBeFalsy();
    expect(option.defaultValue).toBeDefined();
  });

  it("iri subcommand should have optional --output option with default 'text'", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    const option = iriCmd.options.find(
      (opt: any) => opt.long === "--output",
    );
    expect(option).toBeDefined();
    expect(option.mandatory).toBeFalsy();
    expect(option.defaultValue).toBe("text");
  });

  it("iri subcommand should register exactly 2 options", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    expect(iriCmd.options).toHaveLength(2);
  });

  it("iri subcommand should have --vault option that accepts a path argument", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    const option = iriCmd.options.find(
      (opt: any) => opt.long === "--vault",
    );
    expect(option).toBeDefined();
    expect(option.flags).toContain("<path>");
  });

  it("iri subcommand should have --output option that accepts a type argument", () => {
    const cmd = validateCommand();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    const option = iriCmd.options.find(
      (opt: any) => opt.long === "--output",
    );
    expect(option).toBeDefined();
    expect(option.flags).toContain("<type>");
  });
});
