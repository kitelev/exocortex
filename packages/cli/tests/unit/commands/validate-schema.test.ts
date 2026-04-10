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
} = await import("../../../src/commands/validate-schema.js");

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

    it("should register exactly 4 options", () => {
      const cmd = validateSchemaCommand();
      expect(cmd.options).toHaveLength(4);
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
