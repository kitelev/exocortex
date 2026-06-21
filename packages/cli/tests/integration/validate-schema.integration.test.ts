/**
 * Issue #2713: Integration tests for validate schema command.
 *
 * BDD-style scenarios testing the schema linting against a test vault
 * with real filesystem and real SPARQL engine.
 *
 * Scenarios:
 * 1. All properties valid → exit code 0
 * 2. Undeclared property found → exit code 1, reports file and property
 * 3. Non-ontology keys are ignored → exit code 0
 * 4. Validate only staged files (--staged)
 * 5. Unknown namespace prefix flagged
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const {
  validateFile,
  extractFrontmatter,
  classifyKeys,
  loadDeclaredProperties,
  getStagedMdFiles,
} = await import("../../src/commands/validate-schema.js");

// Import exocortex components for building a test triple store
const {
  NoteToRDFConverter,
} = await import("@kitelev/exocortex-core");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

/**
 * Build a minimal test vault directory with ontology property definitions
 * and test data files.
 */
function createTestVault(rootDir: string): void {
  // Ontology directory with property definitions
  const exoDir = path.join(rootDir, "03 Knowledge", "exo");
  const emsDir = path.join(rootDir, "03 Knowledge", "ems");
  const dataDir = path.join(rootDir, "data");

  fs.mkdirSync(exoDir, { recursive: true });
  fs.mkdirSync(emsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  // Define exo__Asset_uid property
  fs.writeFileSync(
    path.join(exoDir, "exo__Asset_uid.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: aaa-bbb-ccc
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__UUIDProperty]]"
exo__Asset_label: exo__Asset_uid
aliases:
  - exo__Asset_uid
---
`
  );

  // Define exo__Asset_label property
  fs.writeFileSync(
    path.join(exoDir, "exo__Asset_label.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: bbb-ccc-ddd
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__StringProperty]]"
exo__Asset_label: exo__Asset_label
aliases:
  - exo__Asset_label
---
`
  );

  // Define exo__Asset_createdAt property
  fs.writeFileSync(
    path.join(exoDir, "exo__Asset_createdAt.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ccc-ddd-eee
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__TimestampProperty]]"
exo__Asset_label: exo__Asset_createdAt
aliases:
  - exo__Asset_createdAt
---
`
  );

  // Define exo__Instance_class property
  fs.writeFileSync(
    path.join(exoDir, "exo__Instance_class.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ddd-eee-fff
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: exo__Instance_class
aliases:
  - exo__Instance_class
---
`
  );

  // Define exo__Asset_isDefinedBy property
  fs.writeFileSync(
    path.join(exoDir, "exo__Asset_isDefinedBy.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: eee-fff-ggg
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: exo__Asset_isDefinedBy
aliases:
  - exo__Asset_isDefinedBy
---
`
  );

  // Define ems__Effort_status property
  fs.writeFileSync(
    path.join(emsDir, "ems__Effort_status.md"),
    `---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: fff-ggg-hhh
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: ems__Effort_status
aliases:
  - ems__Effort_status
---
`
  );

  // ===== Test data files =====

  // Valid file — all properties declared
  fs.writeFileSync(
    path.join(dataDir, "valid-task.md"),
    `---
exo__Asset_uid: 11111111-2222-3333-4444-555555555555
exo__Asset_label: Valid Task
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
ems__Effort_status: "[[ems__EffortStatusDraft]]"
aliases:
  - valid task
tags:
  - test
---
# Valid task content
`
  );

  // File with undeclared property
  fs.writeFileSync(
    path.join(dataDir, "undeclared-prop.md"),
    `---
exo__Asset_uid: 22222222-3333-4444-5555-666666666666
rfc__status: draft
---
# Undeclared property
`
  );

  // File with only whitelisted keys
  fs.writeFileSync(
    path.join(dataDir, "whitelist-only.md"),
    `---
aliases:
  - just aliases
tags:
  - only
  - tags
archived: false
cssclasses:
  - wide
---
# Whitelist only
`
  );

  // File without frontmatter
  fs.writeFileSync(
    path.join(dataDir, "no-frontmatter.md"),
    `# No Frontmatter

Just body content, no YAML block.
`
  );

  // File with undeclared known-prefix property
  fs.writeFileSync(
    path.join(dataDir, "bad-known-prefix.md"),
    `---
exo__Asset_uid: 33333333-4444-5555-6666-777777777777
ems__Task_status: "[[draft]]"
---
# Bad known prefix
`
  );
}

let testVaultDir: string;
let declaredProperties: Set<string>;

beforeAll(async () => {
  testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-schema-"));
  createTestVault(testVaultDir);

  // Load the test vault into triples and build declared properties set
  const adapter = new FileSystemVaultAdapter(testVaultDir);
  const converter = new NoteToRDFConverter(adapter);
  const triples = await converter.convertVault();
  declaredProperties = await loadDeclaredProperties(triples);
});

afterAll(() => {
  if (testVaultDir) {
    fs.rmSync(testVaultDir, { recursive: true, force: true });
  }
});

describe("BDD: exocortex-cli validate schema linting (Issue #2713)", () => {
  // Scenario 1: All properties valid
  it("Scenario: All properties valid — file with only declared properties has no violations", () => {
    const filePath = path.join(testVaultDir, "data", "valid-task.md");
    const violations = validateFile(filePath, "data/valid-task.md", declaredProperties);
    expect(violations).toHaveLength(0);
  });

  // Scenario 2: Undeclared property found
  it("Scenario: Undeclared property found — rfc__status triggers violation with file and property named", () => {
    const filePath = path.join(testVaultDir, "data", "undeclared-prop.md");
    const violations = validateFile(filePath, "data/undeclared-prop.md", declaredProperties);

    // rfc__status has unknown prefix → should be flagged
    const rfcViolation = violations.find((v) => v.property === "rfc__status");
    expect(rfcViolation).toBeDefined();
    expect(rfcViolation?.file).toBe("data/undeclared-prop.md");
    expect(rfcViolation?.reason).toContain("Unknown namespace prefix");
  });

  // Scenario 3: Non-ontology keys are ignored
  it("Scenario: Non-ontology keys are ignored — aliases, tags, archived, cssclasses produce no violations", () => {
    const filePath = path.join(testVaultDir, "data", "whitelist-only.md");
    const violations = validateFile(filePath, "data/whitelist-only.md", declaredProperties);
    expect(violations).toHaveLength(0);
  });

  // Scenario 4: Validate only staged files
  it("Scenario: Validate only staged files — getStagedMdFiles in non-git dir returns empty", () => {
    // Non-git directory should return empty
    const staged = getStagedMdFiles(testVaultDir);
    expect(staged).toHaveLength(0);
  });

  // Scenario 5: Unknown namespace prefix flagged
  it("Scenario: Undeclared known-prefix property — ems__Task_status is not declared in ontology", () => {
    const filePath = path.join(testVaultDir, "data", "bad-known-prefix.md");
    const violations = validateFile(filePath, "data/bad-known-prefix.md", declaredProperties);

    const taskStatusViolation = violations.find((v) => v.property === "ems__Task_status");
    expect(taskStatusViolation).toBeDefined();
    expect(taskStatusViolation?.reason).toContain("not declared in the ontology");
  });

  // Additional: Empty frontmatter produces no errors
  it("Scenario: File without frontmatter — no violations", () => {
    const filePath = path.join(testVaultDir, "data", "no-frontmatter.md");
    const violations = validateFile(filePath, "data/no-frontmatter.md", declaredProperties);
    expect(violations).toHaveLength(0);
  });

  // Verify declared properties were loaded from test vault
  it("loadDeclaredProperties returns expected property URIs from test vault", () => {
    expect(declaredProperties.size).toBeGreaterThan(0);
    // Properties defined in test vault
    expect(declaredProperties.has("https://exocortex.my/ontology/exo#Asset_uid")).toBe(true);
    expect(declaredProperties.has("https://exocortex.my/ontology/ems#Effort_status")).toBe(true);
  });
});
