/**
 * Integration tests for SPARQL queries on Exo 0.0.3 file format.
 *
 * Issue #1367: CLI needs to support SPARQL queries on vaults using the new
 * Exo 0.0.3 file format (anchor, statement, body files).
 *
 * These tests verify that:
 * 1. Exo 0.0.3 format files are correctly parsed
 * 2. RDF triples are correctly built from anchor/statement/body files
 * 3. SPARQL queries return expected results
 * 4. Mixed format (legacy + Exo003) works correctly
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Get CLI dist path relative to test file location
const CLI_DIST_PATH = path.resolve(process.cwd(), "packages/cli/dist/index.js");

// Skip in CI if needed
const isCI = process.env.CI === "true";
const describeOrSkip = isCI ? describe.skip : describe;

/**
 * Helper to run CLI command and capture output.
 */
async function runCLI(args: string[], cwd?: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", [
      "--experimental-vm-modules",
      CLI_DIST_PATH,
      ...args,
    ], {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
    });

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on("data", (data) => stdout.push(data.toString()));
    child.stderr?.on("data", (data) => stderr.push(data.toString()));

    child.on("close", (code) => {
      resolve({
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        exitCode: code,
      });
    });

    child.on("error", reject);

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("CLI command timed out"));
    }, 30000);
  });
}

/**
 * Create an Exo 0.0.3 anchor file.
 */
function createAnchorFile(dir: string, filename: string, uri: string): void {
  const content = `---
metadata: anchor
uri: "${uri}"
---
`;
  fs.writeFileSync(path.join(dir, filename), content);
}

/**
 * Create an Exo 0.0.3 namespace file.
 */
function createNamespaceFile(dir: string, filename: string, uri: string): void {
  const content = `---
metadata: namespace
uri: "${uri}"
---
`;
  fs.writeFileSync(path.join(dir, filename), content);
}

/**
 * Create an Exo 0.0.3 statement file.
 */
function createStatementFile(
  dir: string,
  filename: string,
  subject: string,
  predicate: string,
  object: string
): void {
  const content = `---
metadata: statement
subject: "${subject}"
predicate: "${predicate}"
object: "${object}"
---
`;
  fs.writeFileSync(path.join(dir, filename), content);
}

/**
 * Create an Exo 0.0.3 body file.
 */
function createBodyFile(
  dir: string,
  filename: string,
  subject: string,
  predicate: string,
  bodyContent: string
): void {
  const content = `---
metadata: body
subject: "${subject}"
predicate: "${predicate}"
---

${bodyContent}`;
  fs.writeFileSync(path.join(dir, filename), content);
}

/**
 * Create a legacy format file.
 */
function createLegacyFile(
  dir: string,
  filename: string,
  properties: Record<string, string>
): void {
  const lines = ["---"];
  for (const [key, value] of Object.entries(properties)) {
    lines.push(`${key}: "${value}"`);
  }
  lines.push("---\n");
  fs.writeFileSync(path.join(dir, filename), lines.join("\n"));
}

describeOrSkip("SPARQL queries on Exo 0.0.3 format (Issue #1367)", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exocortex-sparql-exo003-"));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("anchor file support", () => {
    it("should load anchor files and make them queryable via owl:sameAs", async () => {
      // Create anchor file for a Task class
      createAnchorFile(tempDir, "ems-task.md", "https://exocortex.my/ontology/ems#Task");

      // Query for owl:sameAs triples
      const result = await runCLI([
        "query",
        "SELECT ?s ?o WHERE { ?s <http://www.w3.org/2002/07/owl#sameAs> ?o } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      expect(response.data.count).toBeGreaterThanOrEqual(1);

      // Verify that the anchor URI appears in results
      const bindings = response.data.bindings;
      const hasAnchorUri = bindings.some((b: Record<string, { value: string }>) =>
        b.s?.value?.includes("ems#Task") || b.o?.value?.includes("ems#Task")
      );
      expect(hasAnchorUri).toBe(true);
    }, 60000);
  });

  describe("statement file support", () => {
    it("should convert statement files to RDF triples", async () => {
      // Create anchor files for subject, predicate, object
      createAnchorFile(tempDir, "my-task.md", "https://example.org/tasks/task-1");
      createAnchorFile(tempDir, "rdf-type.md", "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
      createAnchorFile(tempDir, "task-class.md", "https://exocortex.my/ontology/ems#Task");

      // Create statement file: task-1 rdf:type ems:Task
      createStatementFile(
        tempDir,
        "statement-type.md",
        "[[my-task]]",
        "[[rdf-type]]",
        "[[task-class]]"
      );

      // Query for the statement triple
      const result = await runCLI([
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?s), 'task-1')) } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      // Should have at least the statement triple
      expect(response.data.count).toBeGreaterThanOrEqual(1);
    }, 60000);

    it("should handle statement files with direct URIs (not wikilinks)", async () => {
      // Create statement with direct URIs
      createStatementFile(
        tempDir,
        "statement-direct.md",
        "https://example.org/resource/1",
        "https://example.org/predicate/name",
        "https://example.org/resource/2"
      );

      const result = await runCLI([
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?s), 'resource/1')) } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      expect(response.data.count).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe("body file support", () => {
    it("should convert body files to literal triples", async () => {
      // Create anchor for subject
      createAnchorFile(tempDir, "my-note.md", "https://example.org/notes/note-1");
      // Create anchor for predicate (label property)
      createAnchorFile(tempDir, "label-prop.md", "https://exocortex.my/ontology/exo#Asset_label");

      // Create body file with literal content
      createBodyFile(
        tempDir,
        "body-label.md",
        "[[my-note]]",
        "[[label-prop]]",
        "This is the note label content"
      );

      const result = await runCLI([
        "query",
        "SELECT ?s ?o WHERE { ?s <https://exocortex.my/ontology/exo#Asset_label> ?o } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      // Should have the body literal triple
      expect(response.data.count).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe("namespace file support", () => {
    it("should process namespace files without errors", async () => {
      // Create namespace file (defines prefix mapping)
      createNamespaceFile(tempDir, "ems-ns.md", "https://exocortex.my/ontology/ems#");

      // Should not error when loading namespace files
      const result = await runCLI([
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      // Namespace files don't generate triples, but shouldn't cause errors
    }, 60000);
  });

  describe("mixed format support (legacy + Exo003)", () => {
    it("should handle vault with both legacy and Exo003 files", async () => {
      // Create legacy format file
      createLegacyFile(tempDir, "legacy-task.md", {
        exo__Asset_label: "Legacy Task",
        exo__Instance_class: "[[ems__Task]]",
      });

      // Create Exo003 anchor file
      createAnchorFile(tempDir, "exo003-class.md", "https://exocortex.my/ontology/ems#Meeting");

      // Query for Asset_label (from legacy)
      const labelResult = await runCLI([
        "query",
        "SELECT ?s ?label WHERE { ?s <https://exocortex.my/ontology/exo#Asset_label> ?label } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(labelResult.exitCode).toBe(0);
      const labelResponse = JSON.parse(labelResult.stdout);
      expect(labelResponse.success).toBe(true);
      expect(labelResponse.data.count).toBeGreaterThanOrEqual(1);

      // Query for owl:sameAs (from Exo003)
      const sameAsResult = await runCLI([
        "query",
        "SELECT ?s ?o WHERE { ?s <http://www.w3.org/2002/07/owl#sameAs> ?o } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(sameAsResult.exitCode).toBe(0);
      const sameAsResponse = JSON.parse(sameAsResult.stdout);
      expect(sameAsResponse.success).toBe(true);
      expect(sameAsResponse.data.count).toBeGreaterThanOrEqual(1);
    }, 60000);

    it("should correctly count triples from both formats", async () => {
      // Create multiple legacy files
      createLegacyFile(tempDir, "legacy1.md", { exo__Asset_label: "File 1" });
      createLegacyFile(tempDir, "legacy2.md", { exo__Asset_label: "File 2" });

      // Create Exo003 anchor files
      createAnchorFile(tempDir, "anchor1.md", "https://example.org/a1");
      createAnchorFile(tempDir, "anchor2.md", "https://example.org/a2");

      // Count all triples
      const result = await runCLI([
        "query",
        "SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      expect(response.data.count).toBe(1);

      // Should have triples from both legacy (Asset_label + Asset_fileName) and Exo003 (owl:sameAs)
      const countBinding = response.data.bindings[0];
      const tripleCount = parseInt(countBinding.count?.value || "0", 10);
      // Legacy: 2 files * (Asset_label + Asset_fileName) = 4 triples
      // Exo003: 2 anchors * 2 owl:sameAs = 4 triples
      // Total: 8+ triples
      expect(tripleCount).toBeGreaterThanOrEqual(8);
    }, 60000);
  });

  describe("error handling", () => {
    it("should handle invalid Exo003 files gracefully", async () => {
      // Create an invalid Exo003 file (missing required uri)
      const invalidContent = `---
metadata: anchor
---
`;
      fs.writeFileSync(path.join(tempDir, "invalid-anchor.md"), invalidContent);

      // Should still work without crashing
      const result = await runCLI([
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 1",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
    }, 60000);

    it("should handle statement files with unresolvable wikilinks", async () => {
      // Create statement with wikilinks to non-existent files
      createStatementFile(
        tempDir,
        "orphan-statement.md",
        "[[non-existent-subject]]",
        "[[non-existent-predicate]]",
        "[[non-existent-object]]"
      );

      // Should handle gracefully (may produce literals for unresolvable links)
      const result = await runCLI([
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
    }, 60000);
  });

  describe("CONSTRUCT queries on Exo003", () => {
    it("should support CONSTRUCT queries on Exo003 data", async () => {
      createAnchorFile(tempDir, "test-subject.md", "https://example.org/subject");
      createAnchorFile(tempDir, "test-predicate.md", "https://example.org/predicate");
      createAnchorFile(tempDir, "test-object.md", "https://example.org/object");

      createStatementFile(
        tempDir,
        "test-statement.md",
        "[[test-subject]]",
        "[[test-predicate]]",
        "[[test-object]]"
      );

      const result = await runCLI([
        "query",
        "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?s), 'example.org')) }",
        "--vault", tempDir,
        "--format", "ntriples",
        "--output", "text",
      ]);

      expect(result.exitCode).toBe(0);
      // Should produce N-Triples output
      expect(result.stdout).toContain("Generated");
    }, 60000);
  });

  describe("cross-directory UUID resolution (Issue #1388)", () => {
    it("should resolve wikilinks to anchor files in different subdirectories", async () => {
      // Create subdirectories mimicking exocortex-public-ontologies structure
      const exoDir = path.join(tempDir, "exo");
      const rdfsDir = path.join(tempDir, "rdfs");
      fs.mkdirSync(exoDir);
      fs.mkdirSync(rdfsDir);

      // Create anchor files in different directories (using UUID-like filenames)
      const subjectUuid = "7f53bc4f-891e-58d7-abbc-1e0314a2e3c9";
      const predicateUuid = "4b368645-5f7a-551b-940f-acebfe3d0bd2";
      const objectUuid = "c6a11966-a018-5be8-95a0-eba182c2fd93";

      createAnchorFile(exoDir, `${subjectUuid}.md`, "https://exocortex.my/ontology/exo#Property_range");
      createAnchorFile(rdfsDir, `${predicateUuid}.md`, "http://www.w3.org/2000/01/rdf-schema#subPropertyOf");
      createAnchorFile(rdfsDir, `${objectUuid}.md`, "http://www.w3.org/2000/01/rdf-schema#range");

      // Create statement file in exo/ that references anchor in rdfs/
      createStatementFile(
        exoDir,
        "b7dd4e93-e06a-5304-974e-5abc41201dfa.md",
        `[[${subjectUuid}|exo:Property_range]]`,
        `[[${predicateUuid}|rdfs:subPropertyOf]]`,
        `[[${objectUuid}|rdfs:range]]`
      );

      // Query for rdfs:subPropertyOf triples - this should work across directories
      const result = await runCLI([
        "sparql",
        "query",
        "SELECT ?s ?o WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#subPropertyOf> ?o }",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      // Should find the statement triple with resolved URIs
      expect(response.data.count).toBeGreaterThanOrEqual(1);

      // Verify the correct URIs are resolved
      const bindings = response.data.bindings;
      const hasCorrectSubject = bindings.some((b: Record<string, { value: string }>) =>
        b.s?.value === "https://exocortex.my/ontology/exo#Property_range"
      );
      const hasCorrectObject = bindings.some((b: Record<string, { value: string }>) =>
        b.o?.value === "http://www.w3.org/2000/01/rdf-schema#range"
      );
      expect(hasCorrectSubject).toBe(true);
      expect(hasCorrectObject).toBe(true);
    }, 60000);

    it("should handle wikilinks with aliases (UUID|readable-name format)", async () => {
      // Create directory structure
      const exoDir = path.join(tempDir, "exo");
      fs.mkdirSync(exoDir);

      // Create anchor files
      createAnchorFile(exoDir, "abc123.md", "https://example.org/class/MyClass");
      createAnchorFile(exoDir, "def456.md", "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
      createAnchorFile(exoDir, "ghi789.md", "http://www.w3.org/2000/01/rdf-schema#Class");

      // Create statement with aliased wikilinks (common in exocortex-public-ontologies)
      createStatementFile(
        exoDir,
        "statement-with-alias.md",
        "[[abc123|ex:MyClass]]",
        "[[def456|rdf:type]]",
        "[[ghi789|rdfs:Class]]"
      );

      const result = await runCLI([
        "sparql",
        "query",
        "SELECT ?s ?p ?o WHERE { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?o }",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);
      expect(response.data.count).toBeGreaterThanOrEqual(1);

      // Verify URIs are correctly resolved (alias should be stripped)
      const bindings = response.data.bindings;
      const hasMyClass = bindings.some((b: Record<string, { value: string }>) =>
        b.s?.value === "https://example.org/class/MyClass"
      );
      expect(hasMyClass).toBe(true);
    }, 60000);

    it("should build UUID index for efficient cross-directory resolution", async () => {
      // Create 100 files across 5 directories to test performance
      const dirs = ["ns1", "ns2", "ns3", "ns4", "ns5"];
      for (const dir of dirs) {
        fs.mkdirSync(path.join(tempDir, dir));
      }

      // Create 20 anchor files per directory
      for (let i = 0; i < dirs.length; i++) {
        const dir = path.join(tempDir, dirs[i]);
        for (let j = 0; j < 20; j++) {
          const uuid = `uuid-${i}-${j}`;
          createAnchorFile(dir, `${uuid}.md`, `https://example.org/${dirs[i]}/${j}`);
        }
      }

      // Create statements that reference across directories
      const stmtDir = path.join(tempDir, "ns1");
      createStatementFile(
        stmtDir,
        "cross-ref-statement.md",
        "[[uuid-0-0]]",                    // ns1
        "[[uuid-2-10]]",                   // ns3
        "[[uuid-4-15]]"                    // ns5
      );

      const startTime = Date.now();
      const result = await runCLI([
        "sparql",
        "query",
        "SELECT ?s ?p ?o WHERE { ?s ?p ?o . FILTER(CONTAINS(STR(?s), 'ns1/0')) }",
        "--vault", tempDir,
        "--format", "json",
        "--output", "json",
      ]);
      const duration = Date.now() - startTime;

      expect(result.exitCode).toBe(0);

      const response = JSON.parse(result.stdout);
      expect(response.success).toBe(true);

      // Performance check: should complete in reasonable time
      // With 100 files, indexing + query should be under 5 seconds
      expect(duration).toBeLessThan(5000);
    }, 60000);
  });
});
