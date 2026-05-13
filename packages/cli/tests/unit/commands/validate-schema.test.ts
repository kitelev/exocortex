import { jest } from "@jest/globals";
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "fs";

// Mock exocortex (heavy dependency)
jest.unstable_mockModule("exocortex", () => ({
  InMemoryTripleStore: jest.fn(),
  ExoQLParser: jest.fn(),
  ExoQLAlgebraTranslator: jest.fn(),
  AlgebraOptimizer: jest.fn(),
  ExoQLQueryExecutor: jest.fn(),
  NoteToRDFConverter: jest.fn(),
  Triple: jest.fn(),
  SPARQL_PREFIXES: "",
  // SHACL-lite validation
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

// Mock CacheManager
jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    loadOrBuild: jest.fn(() => ({ triples: [], cacheHit: false })),
    validateVault: jest.fn(() => []),
  })),
}));

const {
  validateSchemaCommand,
  NON_ONTOLOGY_KEYS,
  NAMESPACE_PREFIX_MAP,
  extractFrontmatter,
  hasKnownPrefix,
  keyToURI,
  uriToKey,
  classifyKeys,
  validateFile,
  extractPropertyNameFromURI,
  TripleClassHierarchy,
  labelToOntologyIRI,
  domainToAlgebraTriples,
  buildEARLReport,
  runShapesValidation,
  applyLegacyExceptionFilter,
} = await import("../../../src/commands/validate-schema.js");

// Import mocked DomainIRI/DomainLiteral so instanceof checks in applyLegacyExceptionFilter work
const { DomainIRI, DomainLiteral } = await import("exocortex");

const TMP_DIR = "/tmp/validate-schema-test-" + Date.now();

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

/**
 * Issue #2713: Tests for validate schema CLI command
 */
describe("Issue #2713: validate schema command", () => {
  describe("command registration", () => {
    it("should create a command with name 'schema'", () => {
      const cmd = validateSchemaCommand();
      expect(cmd).toBeInstanceOf(Command);
      expect(cmd.name()).toBe("schema");
    });

    it("should have a description mentioning schema or ontology", () => {
      const cmd = validateSchemaCommand();
      expect(cmd.description().toLowerCase()).toMatch(/schema|ontolog|frontmatter/);
    });

    it("should have --vault option with default value", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((opt: any) => opt.long === "--vault");
      expect(option).toBeDefined();
      expect((option as any).mandatory).toBeFalsy();
      expect((option as any).defaultValue).toBeDefined();
    });

    it("should have --output option with default 'text'", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((opt: any) => opt.long === "--output");
      expect(option).toBeDefined();
      expect((option as any).defaultValue).toBe("text");
    });

    it("should have --staged flag option", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((opt: any) => opt.long === "--staged");
      expect(option).toBeDefined();
    });

    it("should have --use-cache flag option", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((opt: any) => opt.long === "--use-cache");
      expect(option).toBeDefined();
    });

    it("should register exactly 6 options", () => {
      const cmd = validateSchemaCommand();
      expect(cmd.options).toHaveLength(6);
    });

    it("should register --shapes-mode option", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((o) => o.long === "--shapes-mode");
      expect(option).toBeDefined();
    });

    it("should register --format option", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((o) => o.long === "--format");
      expect(option).toBeDefined();
    });
  });

  describe("NON_ONTOLOGY_KEYS constant", () => {
    it("should include standard Obsidian keys", () => {
      expect(NON_ONTOLOGY_KEYS.has("aliases")).toBe(true);
      expect(NON_ONTOLOGY_KEYS.has("archived")).toBe(true);
      expect(NON_ONTOLOGY_KEYS.has("tags")).toBe(true);
      expect(NON_ONTOLOGY_KEYS.has("cssclasses")).toBe(true);
      expect(NON_ONTOLOGY_KEYS.has("publish")).toBe(true);
      expect(NON_ONTOLOGY_KEYS.has("share_link")).toBe(true);
    });

    it("should NOT include ontology property keys", () => {
      expect(NON_ONTOLOGY_KEYS.has("exo__Asset_uid")).toBe(false);
      expect(NON_ONTOLOGY_KEYS.has("ems__Effort_status")).toBe(false);
    });
  });

  describe("NAMESPACE_PREFIX_MAP constant", () => {
    it("should contain all standard Exocortex prefixes", () => {
      expect(NAMESPACE_PREFIX_MAP.has("exo__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("ems__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("ims__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("ztlk__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("lit__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("inbox__")).toBe(true);
    });

    it("should map to correct ontology URIs", () => {
      expect(NAMESPACE_PREFIX_MAP.get("ems__")).toBe("https://exocortex.my/ontology/ems#");
      expect(NAMESPACE_PREFIX_MAP.get("exo__")).toBe("https://exocortex.my/ontology/exo#");
    });

    it("should include extended prefixes (period, rdf, rdfs, owl)", () => {
      expect(NAMESPACE_PREFIX_MAP.has("period__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("rdf__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("rdfs__")).toBe(true);
      expect(NAMESPACE_PREFIX_MAP.has("owl__")).toBe(true);
    });
  });

  describe("extractPropertyNameFromURI()", () => {
    it("should extract property name from vault URI with named file", () => {
      expect(extractPropertyNameFromURI(
        "obsidian://vault/03%20Knowledge/ems/ems__Effort_status.md"
      )).toBe("ems__Effort_status");
    });

    it("should extract property name from URL-encoded URI", () => {
      expect(extractPropertyNameFromURI(
        "obsidian://vault/01%20Inbox/exo__Event_timestamp.md"
      )).toBe("exo__Event_timestamp");
    });

    it("should return null for UUID-only filenames", () => {
      expect(extractPropertyNameFromURI(
        "obsidian://vault/03%20Knowledge/ems/58add058-47fe-45da-ad92-40d77f31cc5e.md"
      )).toBeNull();
    });

    it("should return null for non-prefixed filenames", () => {
      expect(extractPropertyNameFromURI(
        "obsidian://vault/03%20Knowledge/notes/my-note.md"
      )).toBeNull();
    });
  });

  describe("extractFrontmatter()", () => {
    it("should extract keys from valid frontmatter", () => {
      const content = `---
exo__Asset_uid: some-uuid
ems__Effort_status: "[[draft]]"
aliases:
  - test
---
# Body content`;
      const result = extractFrontmatter(content);
      expect(result).not.toBeNull();
      expect(Object.keys(result as any)).toContain("exo__Asset_uid");
      expect(Object.keys(result as any)).toContain("ems__Effort_status");
      expect(Object.keys(result as any)).toContain("aliases");
    });

    it("should return null for files without frontmatter", () => {
      const content = "# Just a heading\n\nSome content.";
      expect(extractFrontmatter(content)).toBeNull();
    });

    it("should return empty object for empty frontmatter", () => {
      const content = "---\n---\n# Body";
      const result = extractFrontmatter(content);
      expect(result).not.toBeNull();
      expect(Object.keys(result as any)).toHaveLength(0);
    });

    it("should handle file with only whitelisted keys", () => {
      const content = `---
aliases:
  - test
tags:
  - foo
---`;
      const result = extractFrontmatter(content);
      expect(result).not.toBeNull();
      expect(Object.keys(result as any)).toContain("aliases");
      expect(Object.keys(result as any)).toContain("tags");
    });
  });

  describe("hasKnownPrefix()", () => {
    it("should return true for known Exocortex prefixes", () => {
      expect(hasKnownPrefix("exo__Asset_uid")).toBe(true);
      expect(hasKnownPrefix("ems__Effort_status")).toBe(true);
      expect(hasKnownPrefix("ims__Concept_broader")).toBe(true);
      expect(hasKnownPrefix("lit__WebPage_url")).toBe(true);
    });

    it("should return false for unknown prefixes", () => {
      expect(hasKnownPrefix("rfc__status")).toBe(false);
      expect(hasKnownPrefix("custom__field")).toBe(false);
      expect(hasKnownPrefix("aliases")).toBe(false);
    });
  });

  describe("keyToURI()", () => {
    it("should convert known-prefix keys to full URIs", () => {
      expect(keyToURI("ems__Effort_status")).toBe(
        "https://exocortex.my/ontology/ems#Effort_status"
      );
      expect(keyToURI("exo__Asset_uid")).toBe(
        "https://exocortex.my/ontology/exo#Asset_uid"
      );
    });

    it("should return null for unknown prefix keys", () => {
      expect(keyToURI("rfc__status")).toBeNull();
      expect(keyToURI("aliases")).toBeNull();
    });
  });

  describe("uriToKey()", () => {
    it("should convert ontology URIs back to frontmatter keys", () => {
      expect(uriToKey("https://exocortex.my/ontology/ems#Effort_status")).toBe(
        "ems__Effort_status"
      );
      expect(uriToKey("https://exocortex.my/ontology/exo#Asset_uid")).toBe(
        "exo__Asset_uid"
      );
    });

    it("should return null for unrecognized URIs", () => {
      expect(uriToKey("http://example.com/foo")).toBeNull();
    });
  });

  describe("classifyKeys()", () => {
    it("should separate ontology keys from unknown-prefix keys", () => {
      const { toValidate, unknownPrefix } = classifyKeys([
        "exo__Asset_uid",
        "ems__Effort_status",
        "rfc__status",
        "aliases",
        "custom__field",
      ]);
      expect(toValidate).toEqual(["exo__Asset_uid", "ems__Effort_status"]);
      expect(unknownPrefix).toEqual(["rfc__status", "custom__field"]);
    });

    it("should filter out NON_ONTOLOGY_KEYS", () => {
      const { toValidate, unknownPrefix } = classifyKeys([
        "aliases",
        "archived",
        "tags",
        "cssclasses",
      ]);
      expect(toValidate).toHaveLength(0);
      expect(unknownPrefix).toHaveLength(0);
    });

    it("should return empty arrays for empty input", () => {
      const { toValidate, unknownPrefix } = classifyKeys([]);
      expect(toValidate).toHaveLength(0);
      expect(unknownPrefix).toHaveLength(0);
    });
  });

  describe("validateFile()", () => {
    const declaredProperties = new Set([
      "https://exocortex.my/ontology/exo#Asset_uid",
      "https://exocortex.my/ontology/exo#Asset_label",
      "https://exocortex.my/ontology/exo#Asset_createdAt",
      "https://exocortex.my/ontology/exo#Instance_class",
      "https://exocortex.my/ontology/exo#Asset_isDefinedBy",
      "https://exocortex.my/ontology/ems#Effort_status",
    ]);

    it("should return no violations for valid file", () => {
      writeFileSync(
        `${TMP_DIR}/valid.md`,
        `---
exo__Asset_uid: some-uuid
ems__Effort_status: "[[draft]]"
aliases:
  - test
---
# Content`
      );

      const violations = validateFile(
        `${TMP_DIR}/valid.md`,
        "valid.md",
        declaredProperties
      );
      expect(violations).toHaveLength(0);
    });

    it("should report undeclared properties with known prefix", () => {
      writeFileSync(
        `${TMP_DIR}/undeclared.md`,
        `---
exo__Asset_uid: some-uuid
ems__Task_status: "[[draft]]"
---`
      );

      const violations = validateFile(
        `${TMP_DIR}/undeclared.md`,
        "undeclared.md",
        declaredProperties
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].property).toBe("ems__Task_status");
      expect(violations[0].file).toBe("undeclared.md");
      expect(violations[0].reason).toContain("not declared in the ontology");
    });

    it("should report unknown prefix keys", () => {
      writeFileSync(
        `${TMP_DIR}/unknown-prefix.md`,
        `---
rfc__status: draft
---`
      );

      const violations = validateFile(
        `${TMP_DIR}/unknown-prefix.md`,
        "unknown-prefix.md",
        declaredProperties
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].property).toBe("rfc__status");
      expect(violations[0].reason).toContain("Unknown namespace prefix");
    });

    it("should return empty array for file without frontmatter", () => {
      writeFileSync(`${TMP_DIR}/no-fm.md`, "# Just content");

      const violations = validateFile(
        `${TMP_DIR}/no-fm.md`,
        "no-fm.md",
        declaredProperties
      );
      expect(violations).toHaveLength(0);
    });

    it("should return empty array for file with only whitelisted keys", () => {
      writeFileSync(
        `${TMP_DIR}/whitelist-only.md`,
        `---
aliases:
  - test
tags:
  - foo
---`
      );

      const violations = validateFile(
        `${TMP_DIR}/whitelist-only.md`,
        "whitelist-only.md",
        declaredProperties
      );
      expect(violations).toHaveLength(0);
    });

    it("should return empty array for nonexistent file", () => {
      const violations = validateFile(
        "/tmp/nonexistent-file-xyz.md",
        "nonexistent-file-xyz.md",
        declaredProperties
      );
      expect(violations).toHaveLength(0);
    });
  });
});

/**
 * Issue #2713: Tests for validate parent command restructuring
 */
describe("Issue #2713: validate parent command", () => {
  let validateCommandFn: () => Command;

  beforeAll(async () => {
    const mod = await import("../../../src/commands/validate.js");
    validateCommandFn = mod.validateCommand;
  });

  it("should create validate parent command", () => {
    const cmd = validateCommandFn();
    expect(cmd).toBeInstanceOf(Command);
    expect(cmd.name()).toBe("validate");
  });

  it("should have 'iri' subcommand", () => {
    const cmd = validateCommandFn();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri");
    expect(iriCmd).toBeDefined();
  });

  it("should have 'schema' subcommand", () => {
    const cmd = validateCommandFn();
    const schemaCmd = cmd.commands.find((c: any) => c.name() === "schema");
    expect(schemaCmd).toBeDefined();
  });

  it("iri subcommand should have --vault and --output options", () => {
    const cmd = validateCommandFn();
    const iriCmd = cmd.commands.find((c: any) => c.name() === "iri") as any;
    expect(iriCmd.options.find((o: any) => o.long === "--vault")).toBeDefined();
    expect(iriCmd.options.find((o: any) => o.long === "--output")).toBeDefined();
  });

  it("schema subcommand should have --staged option", () => {
    const cmd = validateCommandFn();
    const schemaCmd = cmd.commands.find((c: any) => c.name() === "schema") as any;
    expect(schemaCmd.options.find((o: any) => o.long === "--staged")).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// P1.6 Shapes-mode tests
// ──────────────────────────────────────────────────────────────────────────────

describe("P1.6 TripleClassHierarchy", () => {
  it("returns false when subClassMap is empty", () => {
    const hier = new TripleClassHierarchy([]);
    expect(hier.isSubClassOf("https://a.com/A", "https://a.com/B")).toBe(false);
  });

  it("is instantiated without errors from an empty array", () => {
    expect(() => new TripleClassHierarchy([])).not.toThrow();
  });
});

describe("P1.6 labelToOntologyIRI", () => {
  it("converts ims__Concept to ontology URI", () => {
    expect(labelToOntologyIRI("ims__Concept")).toBe("https://exocortex.my/ontology/ims#Concept");
  });

  it("converts exo__Asset to ontology URI", () => {
    expect(labelToOntologyIRI("exo__Asset")).toBe("https://exocortex.my/ontology/exo#Asset");
  });

  it("converts ems__Task to ontology URI", () => {
    expect(labelToOntologyIRI("ems__Task")).toBe("https://exocortex.my/ontology/ems#Task");
  });

  it("returns null for label without double-underscore", () => {
    expect(labelToOntologyIRI("SomePlainLabel")).toBeNull();
  });

  it("returns null for label with unknown prefix", () => {
    expect(labelToOntologyIRI("unknown__Foo")).toBeNull();
  });

  it("returns null for label with prefix only (no local name)", () => {
    expect(labelToOntologyIRI("ims__")).toBeNull();
  });
});

describe("P1.6 TripleClassHierarchy ontology URI resolution", () => {
  const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

  function makeIRI(value: string) { return new DomainIRI(value); }
  function makeLiteral(value: string) { return new DomainLiteral(value); }
  function makeTriple(s: any, p: any, o: any) { return { subject: s, predicate: p, object: o }; }

  it("resolves isSubClassOf via ontology URIs when rdfs:label triples are present", () => {
    const conceptFileIri = "obsidian://vault/ims/ims-concept.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";

    const triples = [
      // rdfs:label for ims__Concept file
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
      // rdfs:label for exo__Asset file
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      // rdfs:subClassOf (file IRI based)
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    // Ontology URI-based check (the previously broken case)
    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/exo#Asset"
    )).toBe(true);

    // File IRI-based check still works
    expect(hier.isSubClassOf(conceptFileIri, assetFileIri)).toBe(true);
  });

  it("returns true when checking fileIRI against its own ontology URI (identity mapping)", () => {
    // exo__Instance_class [[UUID|ims__Concept]] → NoteToRDFConverter emits ims#Concept as class
    // But when another file references UUID, it may produce UUID-file-IRI as the type.
    // TripleClassHierarchy must also handle isSubClassOf("UUID-file-IRI", "ims#Concept").
    const conceptFileIri = "obsidian://vault/ims/dda12c48-1234.md";

    const triples = [
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
    ];

    const hier = new TripleClassHierarchy(triples);

    // fileIRI "is" ims#Concept because it declares rdfs:label "ims__Concept"
    expect(hier.isSubClassOf(conceptFileIri, "https://exocortex.my/ontology/ims#Concept")).toBe(true);
  });

  it("returns false for unrelated ontology URIs", () => {
    const hier = new TripleClassHierarchy([]);
    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/ems#Task"
    )).toBe(false);
  });

  it("resolves isSubClassOf via filename fallback when no rdfs:label triple exists", () => {
    // exo__Asset.md has no exo__Asset_label, so no rdfs:label triple
    // but filename "exo__Asset.md" can be decoded from the file IRI
    const conceptFileIri = "obsidian://vault/03%20Knowledge/ims/dda12c48-6886-4624-8710.md";
    const assetFileIri = "obsidian://vault/03%20Knowledge/exo/exo__Asset.md";

    const triples = [
      // UUID-named concept file has rdfs:label "ims__Concept"
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
      // Label-named asset file has no rdfs:label — fallback to filename
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/exo#Asset"
    )).toBe(true);
  });

  it("resolves transitive ontology URI hierarchy", () => {
    const conceptFileIri = "obsidian://vault/ims/concept.md";
    const assetFileIri = "obsidian://vault/exo/asset.md";
    const thingFileIri = "obsidian://vault/exo/thing.md";

    const triples = [
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(thingFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Thing")),
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(thingFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/exo#Thing"
    )).toBe(true);
  });
});

describe("P1.6 TripleClassHierarchy exo:Class_superClass support", () => {
  const EXO_CLASS_SUPER_CLASS = "https://exocortex.my/ontology/exo#Class_superClass";
  const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

  function makeIRI(value: string) { return new DomainIRI(value); }
  function makeLiteral(value: string) { return new DomainLiteral(value); }
  function makeTriple(s: any, p: any, o: any) { return { subject: s, predicate: p, object: o }; }

  it("treats exo:Class_superClass as subclass source (direct ontology URIs)", () => {
    const classFileIri = "obsidian://vault/exo/exo__Class.md";
    const assetFileIri = "obsidian://vault/exo/exo__Asset.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      // exo:Class_superClass — the Exocortex-native superclass declaration predicate
      makeTriple(makeIRI(classFileIri), makeIRI(EXO_CLASS_SUPER_CLASS), makeIRI(assetFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/exo#Class",
      "https://exocortex.my/ontology/exo#Asset"
    )).toBe(true);
  });

  it("treats exo:Class_superClass as subclass source when no rdfs:subClassOf triple present", () => {
    const conceptFileIri = "obsidian://vault/ims/concept.md";
    const assetFileIri = "obsidian://vault/exo/asset.md";

    const triples = [
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      // Only exo:Class_superClass, no rdfs:subClassOf
      makeTriple(makeIRI(conceptFileIri), makeIRI(EXO_CLASS_SUPER_CLASS), makeIRI(assetFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/exo#Asset"
    )).toBe(true);
    // Inverse should still be false
    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/exo#Asset",
      "https://exocortex.my/ontology/ims#Concept"
    )).toBe(false);
  });

  it("handles transitive chain via exo:Class_superClass", () => {
    const conceptFileIri = "obsidian://vault/ims/concept.md";
    const assetFileIri = "obsidian://vault/exo/asset.md";
    const thingFileIri = "obsidian://vault/exo/thing.md";

    const triples = [
      makeTriple(makeIRI(conceptFileIri), makeIRI(RDFS_LABEL), makeLiteral("ims__Concept")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(thingFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Thing")),
      makeTriple(makeIRI(conceptFileIri), makeIRI(EXO_CLASS_SUPER_CLASS), makeIRI(assetFileIri)),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(thingFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ims#Concept",
      "https://exocortex.my/ontology/exo#Thing"
    )).toBe(true);
  });
});

describe("P1.6 domainToAlgebraTriples", () => {
  it("returns empty array for empty input", () => {
    expect(domainToAlgebraTriples([])).toEqual([]);
  });

  it("skips triples with non-IRI/non-Literal nodes", () => {
    const triple = { subject: {}, predicate: {}, object: {} };
    const result = domainToAlgebraTriples([triple as any]);
    expect(result).toHaveLength(0);
  });
});

describe("P1.6 buildEARLReport", () => {
  it("produces earl:passed when conforms=true", () => {
    const report = buildEARLReport("/vault", { conforms: true, violations: [] });
    expect(report["@context"].earl).toBe("http://www.w3.org/ns/earl#");
    const passed = report["@graph"].find((n: any) => n["earl:result"]?.["earl:outcome"]?.["@id"] === "earl:passed");
    expect(passed).toBeDefined();
  });

  it("produces earl:failed entries for violations", () => {
    const report = buildEARLReport("/vault", {
      conforms: false,
      violations: [{
        focusNode: "https://node.com/n1",
        propertyPath: "https://prop.com/p1",
        severity: "sh:Violation" as const,
        message: "Missing required property",
      }],
    });
    const failed = report["@graph"].find((n: any) => n["earl:result"]?.["earl:outcome"]?.["@id"] === "earl:failed");
    expect(failed).toBeDefined();
    expect((failed as any)["earl:result"]["dc:description"]).toBe("Missing required property");
  });
});

describe("P4.3 applyLegacyExceptionFilter", () => {
  const LEGACY_IRI = "https://exocortex.my/ontology/exo#Asset_legacyValidationException";
  const EXEMPT_NODE = "obsidian://vault/03%20Knowledge/exo/ebf717aa.md";
  const OTHER_NODE = "obsidian://vault/03%20Knowledge/exo/other.md";

  // Use the same mocked DomainIRI/DomainLiteral classes that the production code imports
  const makeTriple = (subjectIRI: string, predicateIRI: string, value: string) => ({
    subject: new DomainIRI(subjectIRI),
    predicate: new DomainIRI(predicateIRI),
    object: new DomainLiteral(value),
  });

  it("returns report unchanged when no exempt nodes", () => {
    const report = { conforms: false, violations: [{ focusNode: EXEMPT_NODE, propertyPath: "p", severity: "sh:Violation" as const, message: "err" }] };
    const result = applyLegacyExceptionFilter([], report);
    expect(result.violations).toHaveLength(1);
    expect(result.conforms).toBe(false);
  });

  it("removes violations for exempt node", () => {
    const triples = [makeTriple(EXEMPT_NODE, LEGACY_IRI, "true")];
    const report = {
      conforms: false,
      violations: [{ focusNode: EXEMPT_NODE, propertyPath: "p", severity: "sh:Violation" as const, message: "err" }],
    };
    const result = applyLegacyExceptionFilter(triples as any, report);
    expect(result.violations).toHaveLength(0);
    expect(result.conforms).toBe(true);
  });

  it("preserves violations for non-exempt nodes", () => {
    const triples = [makeTriple(EXEMPT_NODE, LEGACY_IRI, "true")];
    const report = {
      conforms: false,
      violations: [
        { focusNode: EXEMPT_NODE, propertyPath: "p", severity: "sh:Violation" as const, message: "exempt" },
        { focusNode: OTHER_NODE, propertyPath: "p", severity: "sh:Violation" as const, message: "keep" },
      ],
    };
    const result = applyLegacyExceptionFilter(triples as any, report);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].focusNode).toBe(OTHER_NODE);
    expect(result.conforms).toBe(false);
  });

  it("is idempotent — second call produces same result", () => {
    const triples = [makeTriple(EXEMPT_NODE, LEGACY_IRI, "true")];
    const report = {
      conforms: false,
      violations: [{ focusNode: EXEMPT_NODE, propertyPath: "p", severity: "sh:Violation" as const, message: "err" }],
    };
    const first = applyLegacyExceptionFilter(triples as any, report);
    const second = applyLegacyExceptionFilter(triples as any, first);
    expect(second).toEqual(first);
  });
});
