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
  DomainTriple: class {
    constructor(public subject: unknown, public predicate: unknown, public object: unknown) {}
  },
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
  resolveCrossVaultInstanceClassWikilinks,
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

    it("should register exactly 8 options (incl. --also for multi-vault SHACL — Issue #3127, --class for RFC 8e83442b T1.4)", () => {
      const cmd = validateSchemaCommand();
      expect(cmd.options).toHaveLength(8);
    });

    it("should register --also option (Issue #3127 — repeatable additional vaults)", () => {
      const cmd = validateSchemaCommand();
      const option = cmd.options.find((o: any) => o.long === "--also");
      expect(option).toBeDefined();
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

// ──────────────────────────────────────────────────────────────────────────────
// Issue #3247: Metaclass inference (OWL Full punning)
// ──────────────────────────────────────────────────────────────────────────────
//
// Rule: ∀C: if `<C> rdf:type <Mc>` AND `<Mc> rdfs:subClassOf <Super>`,
//       then `<C> rdfs:subClassOf <Super>` (inferred).
//
// Concretely: any class file typed as `exo__Class` (the meta-class for
// classes) inherits exo__Class's own superclass declarations. Without
// this rule, class files that fail to declare `exo__Class_superClass`
// produce false sh:class violations for every instance, even though the
// chain is logically derivable from the metaclass declaration alone.

describe("Issue #3247 metaclass inference (OWL Full punning)", () => {
  const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

  function makeIRI(value: string) { return new DomainIRI(value); }
  function makeLiteral(value: string) { return new DomainLiteral(value); }
  function makeTriple(s: any, p: any, o: any) { return { subject: s, predicate: p, object: o }; }

  it("propagates Class's superClass to instances of Class (file IRI scope)", () => {
    // TBox: exo__Class declares exo__Class_superClass -> exo__Asset
    // Class file: ems__Area is rdf:type exo__Class BUT has no own exo__Class_superClass
    // Expectation: ems__Area inherits exo__Asset as superClass via metaclass propagation.
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";
    const areaFileIri = "obsidian://vault/ems/ems-area.md";

    const triples = [
      // Labels so file IRIs map to ontology URIs
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDFS_LABEL), makeLiteral("ems__Area")),
      // exo__Class subClassOf exo__Asset (the metaclass-level declaration)
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      // ems__Area rdf:type exo__Class (without its own subClassOf declaration)
      makeTriple(makeIRI(areaFileIri), makeIRI(RDF_TYPE), makeIRI(classFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    // Pre-fix: false (no inferred edge). Post-fix: true (metaclass propagation).
    expect(hier.isSubClassOf(areaFileIri, assetFileIri)).toBe(true);
  });

  it("propagates via ontology URI scope as well", () => {
    // Same scenario but assert against ontology URIs (validator's range checks
    // typically compare ontology URIs, not file IRIs).
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";
    const areaFileIri = "obsidian://vault/ems/ems-area.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDFS_LABEL), makeLiteral("ems__Area")),
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDF_TYPE), makeIRI(classFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(
      "https://exocortex.my/ontology/ems#Area",
      "https://exocortex.my/ontology/exo#Asset"
    )).toBe(true);
  });

  it("transitively propagates: metaclass superchain reaches instances", () => {
    // exo__Class subClassOf exo__Asset subClassOf rdfs:Resource
    // ems__Area rdf:type exo__Class
    // Expectation: ems__Area inherits ALL superclasses (Asset AND Resource).
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";
    const resourceFileIri = "obsidian://vault/rdfs/resource.md";
    const areaFileIri = "obsidian://vault/ems/ems-area.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDFS_LABEL), makeLiteral("ems__Area")),
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(resourceFileIri)),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDF_TYPE), makeIRI(classFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(areaFileIri, assetFileIri)).toBe(true);
    expect(hier.isSubClassOf(areaFileIri, resourceFileIri)).toBe(true);
  });

  it("does NOT infer when metaclass has no superClass declaration", () => {
    // ems__Area rdf:type exo__Class
    // exo__Class has NO subClassOf declaration
    // Expectation: nothing inferred — isSubClassOf(area, asset) returns false.
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";
    const areaFileIri = "obsidian://vault/ems/ems-area.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDFS_LABEL), makeLiteral("ems__Area")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDF_TYPE), makeIRI(classFileIri)),
      // NO subClassOf for exo__Class
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(areaFileIri, assetFileIri)).toBe(false);
  });

  it("self-typed metaclass (Class rdf:type Class) does not produce a self-loop", () => {
    // exo__Class rdf:type exo__Class (real vault pattern — exo__Class self-types)
    // exo__Class subClassOf exo__Asset
    // Expectation: no infinite loop; isSubClassOf works normally.
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      makeTriple(makeIRI(classFileIri), makeIRI(RDF_TYPE), makeIRI(classFileIri)),
    ];

    const hier = new TripleClassHierarchy(triples);

    // Should complete without infinite loop
    expect(hier.isSubClassOf(classFileIri, assetFileIri)).toBe(true);
  });

  it("does not infer when subject is not typed as the metaclass", () => {
    // ems__Area is a class but NOT typed as exo__Class — it's a stray
    // declaration with only its own subClassOf chain. Nothing to infer.
    const classFileIri = "obsidian://vault/exo/exo-class.md";
    const assetFileIri = "obsidian://vault/exo/exo-asset.md";
    const areaFileIri = "obsidian://vault/ems/ems-area.md";

    const triples = [
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Class")),
      makeTriple(makeIRI(assetFileIri), makeIRI(RDFS_LABEL), makeLiteral("exo__Asset")),
      makeTriple(makeIRI(areaFileIri), makeIRI(RDFS_LABEL), makeLiteral("ems__Area")),
      makeTriple(makeIRI(classFileIri), makeIRI(RDFS_SUBCLASS_OF), makeIRI(assetFileIri)),
      // ems__Area has NO rdf:type triple — not an instance of Class
    ];

    const hier = new TripleClassHierarchy(triples);

    expect(hier.isSubClassOf(areaFileIri, assetFileIri)).toBe(false);
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

// ═════════════════════════════════════════════════════════════════════════════
// resolveCrossVaultInstanceClassWikilinks — multi-vault literal Instance_class
// post-processing. Confirms uid→class-IRI map construction + canonical-IRI
// emission + rdf:type emission for cross-vault literal wikilinks.
// ═════════════════════════════════════════════════════════════════════════════

describe("resolveCrossVaultInstanceClassWikilinks", () => {
  const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
  const EXO_ASSET_LABEL = "https://exocortex.my/ontology/exo#Asset_label";
  const EXO_INSTANCE_CLASS = "https://exocortex.my/ontology/exo#Instance_class";
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const EMS_PROJECT = "https://exocortex.my/ontology/ems#Project";

  // Helpers matching the mocked DomainIRI/DomainLiteral/DomainTriple shape.
  const iri = (v: string) => new DomainIRI(v);
  const lit = (v: string) => new DomainLiteral(v);
  const makeTriple = (s: any, p: any, o: any): any => ({
    subject: s,
    predicate: p,
    object: o,
  });

  const CLASS_FILE_IRI =
    "obsidian://vault/assetspaces/ems/7db5eeff-718a-49b0-8d2b-39b084a356e3.md";
  const ASSET_IRI =
    "obsidian://vault/assetspaces/exodev/9541965c-c5dc-48ff-94b2-98aad3d62b2e.md";
  const CLASS_UID = "7db5eeff-718a-49b0-8d2b-39b084a356e3";

  it("emits canonical Instance_class IRI + rdf:type when class file is in primary vault and asset references via literal wikilink", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project")),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}]]`)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length + 2);
    const added = result.slice(triples.length);
    const canonicalInstance = added.find(
      (t: any) =>
        t.predicate.value === EXO_INSTANCE_CLASS &&
        t.object instanceof DomainIRI &&
        t.object.value === EMS_PROJECT,
    );
    const rdfType = added.find(
      (t: any) =>
        t.predicate.value === RDF_TYPE &&
        t.object instanceof DomainIRI &&
        t.object.value === EMS_PROJECT,
    );
    expect(canonicalInstance).toBeDefined();
    expect(rdfType).toBeDefined();
  });

  it("resolves class IRI from exo:Asset_label as well as rdfs:label", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(EXO_ASSET_LABEL), lit("ems__Project")),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}]]`)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length + 2);
  });

  it("handles [[uid|alias]] wikilink form", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project")),
      makeTriple(
        iri(ASSET_IRI),
        iri(EXO_INSTANCE_CLASS),
        lit(`[[${CLASS_UID}|ems__Project]]`),
      ),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length + 2);
  });

  it("no-op when class definition is missing (uid not in map)", () => {
    const triples = [
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}]]`)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result).toBe(triples);
  });

  it("no-op when value is already a canonical IRI (not a literal wikilink)", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project")),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), iri(EMS_PROJECT)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length);
  });

  it("skips multi-word labels that would yield invalid IRIs", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project Special")),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}]]`)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length);
  });

  it("deduplicates emissions when one subject has multiple literal wikilinks resolving to same class", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project")),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}]]`)),
      makeTriple(iri(ASSET_IRI), iri(EXO_INSTANCE_CLASS), lit(`[[${CLASS_UID}|alias]]`)),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length + 2);
  });

  it("ignores non-Instance_class predicates with literal wikilink values", () => {
    const triples = [
      makeTriple(iri(CLASS_FILE_IRI), iri(RDFS_LABEL), lit("ems__Project")),
      makeTriple(
        iri(ASSET_IRI),
        iri("https://exocortex.my/ontology/exo#Asset_relates"),
        lit(`[[${CLASS_UID}]]`),
      ),
    ];
    const result = resolveCrossVaultInstanceClassWikilinks(triples as any);
    expect(result.length).toBe(triples.length);
  });
});
