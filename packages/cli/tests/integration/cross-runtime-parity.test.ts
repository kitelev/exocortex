/**
 * P1.13 — Cross-runtime parity test
 *
 * Verifies that the CLI SHACL engine and the plugin SHACL engine produce
 * byte-identical ValidationReports when run against the same vault fixture.
 *
 * Both paths use the same underlying `shaclValidate` function.
 * The differences being tested:
 *
 *   CLI path:
 *     - ShapeLoader.loadFromVaultFS (FS-based shape loading)
 *     - domainToAlgebraTriples() helper for triple conversion
 *     - TripleClassHierarchy (rdfs:subClassOf-aware BFS hierarchy)
 *
 *   Plugin-style path:
 *     - ShapeLoader.loadFromVaultFS (same shapes, different code path would be
 *       loadFromRDFGraph — but that requires class-definition files in vault;
 *       shape loading parity is covered by ShapeLoader unit tests)
 *     - Inline triple conversion loop (mirrors ExocortexPlugin.ts scheduleValidation)
 *     - Simple { isSubClassOf: (c, p) => c === p } hierarchy (production plugin)
 *
 * R2 mitigation: divergence in triple-conversion or hierarchy logic will surface here.
 *
 * Golden fixture: tests/fixtures/shacl-integration/
 */
import {
  describe,
  it,
  expect,
  beforeAll,
} from "@jest/globals";
import * as path from "path";
import * as url from "url";

const _currentFile = url.fileURLToPath(import.meta.url);
const _currentDir = path.dirname(_currentFile);

const FIXTURE_DIR = path.resolve(_currentDir, "../fixtures/shacl-integration");

const { runShapesValidation, domainToAlgebraTriples } = await import(
  "../../src/commands/validate-schema.js"
);

const {
  NoteToRDFConverter,
  ShapeLoader,
  shaclValidate,
  ShaclShapeRegistry,
  DomainIRI,
  DomainLiteral,
} = await import("exocortex");

const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

type Violation = {
  focusNode: string;
  propertyPath: string;
  severity: string;
  message: string;
  actualValue?: string;
  expectedRange?: string;
};

function sortViolations(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    const c = a.focusNode.localeCompare(b.focusNode);
    return c !== 0 ? c : a.propertyPath.localeCompare(b.propertyPath);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cliViolations: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pluginStyleViolations: any[];
let cliConforms: boolean;
let pluginStyleConforms: boolean;

beforeAll(async () => {
  const adapter = new FileSystemVaultAdapter(FIXTURE_DIR);
  const converter = new NoteToRDFConverter(adapter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const domainTriples = (await converter.convertVault()) as any[];

  // ── CLI path (P1.7 golden path) ────────────────────────────────────────────
  // Uses: ShapeLoader.loadFromVaultFS + domainToAlgebraTriples + TripleClassHierarchy
  const cliReport = await runShapesValidation(FIXTURE_DIR, domainTriples);
  cliViolations = cliReport.violations;
  cliConforms = cliReport.conforms;

  // ── Plugin-style path ──────────────────────────────────────────────────────
  // Uses: same shapes (loadFromVaultFS) + inline triple conversion (mirrors plugin)
  //       + simple { isSubClassOf: (c, p) => c === p } hierarchy (matches production plugin)
  //
  // This path exercises the same code branches that ExocortexPlugin.ts scheduleValidation()
  // uses, except for shape loading (loadFromRDFGraph requires class-definition files in vault;
  // both loaders are covered in ShapeLoader unit tests).

  // 1. Load shapes using the same FS loader as CLI
  const pluginShapeRegistry = await ShapeLoader.loadFromVaultFS(FIXTURE_DIR);

  // 2. Inline triple conversion — mirrors ExocortexPlugin.ts scheduleValidation() exactly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginAlgebraTriples: any[] = [];
  for (const t of domainTriples) {
    const subj = t.subject;
    const pred = t.predicate;
    const obj = t.object;
    if (!(subj instanceof DomainIRI) || !(pred instanceof DomainIRI)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let algObj: any = null;
    if (obj instanceof DomainIRI) {
      algObj = { type: "iri", value: obj.value };
    } else if (obj instanceof DomainLiteral) {
      algObj = { type: "literal", value: obj.value, datatype: obj.datatype?.value };
    }
    if (!algObj) continue;
    pluginAlgebraTriples.push({
      subject: { type: "iri", value: subj.value },
      predicate: { type: "iri", value: pred.value },
      object: algObj,
    });
  }

  // 3. CLI algebra triple conversion (for comparison)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cliAlgebraTriples = domainToAlgebraTriples(domainTriples as any);

  // 4. Build SHACL registry (same shapes) + simple hierarchy (production plugin behaviour)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shaclRegistry = new ShaclShapeRegistry(pluginShapeRegistry.getAll() as any);
  const simpleHierarchy = { isSubClassOf: (c: string, p: string) => c === p };

  // 5. Run the shared shaclValidate engine with plugin-style inputs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginReport = shaclValidate(pluginAlgebraTriples as any, shaclRegistry as any, simpleHierarchy);
  pluginStyleViolations = pluginReport.violations;
  pluginStyleConforms = pluginReport.conforms;

  // Store CLI algebra triples for structural comparison
  (global as Record<string, unknown>)._cliAlgebraTriples = cliAlgebraTriples;
  (global as Record<string, unknown>)._pluginAlgebraTriples = pluginAlgebraTriples;
});

describe("P1.13 — Cross-runtime parity: CLI vs Plugin SHACL engine", () => {
  describe("CLI engine baseline", () => {
    it("produces at least one violation from fixture", () => {
      expect(cliViolations.length).toBeGreaterThan(0);
    });

    it("reports conforms=false for violation-containing fixture", () => {
      expect(cliConforms).toBe(false);
    });
  });

  describe("Plugin-style engine baseline", () => {
    it("produces at least one violation from fixture", () => {
      expect(pluginStyleViolations.length).toBeGreaterThan(0);
    });

    it("reports conforms=false for violation-containing fixture", () => {
      expect(pluginStyleConforms).toBe(false);
    });
  });

  describe("Parity: CLI vs Plugin-style", () => {
    it("both runtimes report the same number of violations", () => {
      expect(pluginStyleViolations.length).toBe(cliViolations.length);
    });

    it("violations are deep-equal after canonical sort by focusNode+propertyPath", () => {
      const sortedCli = sortViolations(cliViolations as Violation[]);
      const sortedPlugin = sortViolations(pluginStyleViolations as Violation[]);
      expect(sortedPlugin).toEqual(sortedCli);
    });

    it("reports are bytes-identical when JSON-serialized (canonical sort)", () => {
      const sortedCli = sortViolations(cliViolations as Violation[]);
      const sortedPlugin = sortViolations(pluginStyleViolations as Violation[]);
      expect(JSON.stringify(sortedPlugin, null, 2)).toBe(
        JSON.stringify(sortedCli, null, 2),
      );
    });

    it("conforms field matches between runtimes", () => {
      expect(pluginStyleConforms).toBe(cliConforms);
    });
  });

  describe("Canonical sort invariant (both runtimes)", () => {
    it("CLI violations are already sorted by focusNode then propertyPath", () => {
      for (let i = 0; i < cliViolations.length - 1; i++) {
        const a = cliViolations[i] as Violation;
        const b = cliViolations[i + 1] as Violation;
        const cmp =
          a.focusNode !== b.focusNode
            ? a.focusNode.localeCompare(b.focusNode)
            : a.propertyPath.localeCompare(b.propertyPath);
        expect(cmp).toBeLessThanOrEqual(0);
      }
    });

    it("plugin-style violations are already sorted by focusNode then propertyPath", () => {
      for (let i = 0; i < pluginStyleViolations.length - 1; i++) {
        const a = pluginStyleViolations[i] as Violation;
        const b = pluginStyleViolations[i + 1] as Violation;
        const cmp =
          a.focusNode !== b.focusNode
            ? a.focusNode.localeCompare(b.focusNode)
            : a.propertyPath.localeCompare(b.propertyPath);
        expect(cmp).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("Triple conversion parity", () => {
    it("CLI and plugin inline conversion produce same number of algebra triples", () => {
      const cliTriples = (global as Record<string, unknown>)._cliAlgebraTriples as unknown[];
      const pluginTriples = (global as Record<string, unknown>)._pluginAlgebraTriples as unknown[];
      expect(pluginTriples.length).toBe(cliTriples.length);
    });
  });
});
