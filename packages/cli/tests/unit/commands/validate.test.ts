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
jest.unstable_mockModule("@kitelev/exocortex-core", () => ({
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
  // M1.5: the `validate vault` subcommand pulls validate-vault.ts →
  // CachingNodeFsAdapter → NodeFsAdapter into this command's static graph.
  // ESM-linking the mocked core requires every named export that graph
  // references (otherwise the suite fails to load on the first missing one).
  FileAlreadyExistsError: class FileAlreadyExistsError extends Error {},
  FileNotFoundError: class FileNotFoundError extends Error {},
  VaultCheckRunner: jest.fn(),
  createDefaultCheckRegistry: jest.fn(),
  KNOWN_CHECK_IDS: new Set<string>(),
  extractAssetReference: jest.fn(),
  readEnabledCheckIds: jest.fn(() => []),
  // #3800: NodeFsAdapter (pulled via validate-vault → CachingNodeFsAdapter) now
  // imports this — must be a named export or the mocked-core ESM link fails.
  parseYamlFrontmatterTolerant: jest.fn(),
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
 * Issue #2346: Tests for validate CLI command registration.
 * Updated for #2713 (validate became a parent command) and the CLI-removals
 * cleanup: the legacy `validate iri` (Issue #2205) and `validate frontmatter`
 * (Issue #2997 Phase 4) subcommands were removed — both superseded by
 * `validate schema --shapes-mode`. The "does NOT register" assertions below
 * are the executable-spec / revert-verify for that removal.
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

  it("should have 'schema' subcommand", () => {
    const cmd = validateCommand();
    const schemaCmd = cmd.commands.find((c: any) => c.name() === "schema");
    expect(schemaCmd).toBeDefined();
  });

  it("should have 'vault' subcommand", () => {
    const cmd = validateCommand();
    const vaultCmd = cmd.commands.find((c: any) => c.name() === "vault");
    expect(vaultCmd).toBeDefined();
  });

  it("does NOT register the removed 'iri' subcommand (superseded by validate schema)", () => {
    const cmd = validateCommand();
    const names = cmd.commands.map((c: any) => c.name());
    expect(names).not.toContain("iri");
  });

  it("does NOT register the removed 'frontmatter' subcommand (superseded by validate schema)", () => {
    const cmd = validateCommand();
    const names = cmd.commands.map((c: any) => c.name());
    expect(names).not.toContain("frontmatter");
  });
});
