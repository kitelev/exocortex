/**
 * P1.7 — CLI integration test: validate schema --shapes-mode
 *
 * Synthetic vault with known violations → expected ValidationReport (golden file diff).
 *
 * Scenarios:
 * 1. Asset A — sh:maxCount violation (ems__Task_name Single cardinality, 2 values given)
 * 2. Asset B — sh:datatype violation (ems__Task_count expects xsd:integer, got string)
 * 3. Asset C — both violations simultaneously
 *
 * To regenerate the golden file:
 *   UPDATE_GOLDEN=1 npx jest validate-schema-shapes
 */
import {
  describe,
  it,
  expect,
  beforeAll,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/shacl-integration");
const GOLDEN_FILE = path.join(FIXTURE_DIR, "golden-report.json");

const { runShapesValidation } = await import(
  "../../src/commands/validate-schema.js"
);

const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];
let conforms: boolean;

beforeAll(async () => {
  const adapter = new FileSystemVaultAdapter(FIXTURE_DIR);
  const converter = new NoteToRDFConverter(adapter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  const report = await runShapesValidation(FIXTURE_DIR, triples);
  violations = report.violations;
  conforms = report.conforms;
});

describe("BDD: validate schema --shapes-mode (P1.7 — synthetic vault fixtures)", () => {
  it("Scenario: synthetic vault has violations — validation finds at least one violation", () => {
    expect(violations.length).toBeGreaterThan(0);
  });

  it("Scenario: exit code behavior — conforms=false when violations found (maps to CLI exit code 1)", () => {
    expect(conforms).toBe(false);
  });

  it("Scenario: canonical sort — violations are sorted by focusNode then propertyPath", () => {
    for (let i = 0; i < violations.length - 1; i++) {
      const a = violations[i];
      const b = violations[i + 1];
      const cmp =
        a.focusNode !== b.focusNode
          ? a.focusNode.localeCompare(b.focusNode)
          : a.propertyPath.localeCompare(b.propertyPath);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it("Scenario: asset-a.md — sh:maxCount violation for ems__Task_name (Single cardinality, 2 values)", () => {
    const v = violations.find(
      (x) =>
        x.focusNode.includes("asset-a.md") &&
        x.propertyPath.includes("Task_name"),
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("sh:Violation");
    expect(v?.message).toContain("sh:maxCount violation");
  });

  it("Scenario: asset-b.md — sh:datatype violation for ems__Task_count (expects xsd:integer, got string)", () => {
    const v = violations.find(
      (x) =>
        x.focusNode.includes("asset-b.md") &&
        x.propertyPath.includes("Task_count"),
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("sh:Violation");
    expect(v?.message).toContain("sh:datatype violation");
  });

  it("Scenario: asset-c.md — has both maxCount and datatype violations (at least 2 violations)", () => {
    const assetC = violations.filter((x) => x.focusNode.includes("asset-c.md"));
    expect(assetC.length).toBeGreaterThanOrEqual(2);
    expect(assetC.some((x) => x.message.includes("sh:maxCount violation"))).toBe(true);
    expect(assetC.some((x) => x.message.includes("sh:datatype violation"))).toBe(true);
  });

  it("Scenario: golden file — violations match golden report byte-by-byte (canonical sort)", () => {
    const actual = JSON.stringify(violations, null, 2);
    if (process.env.UPDATE_GOLDEN === "1") {
      fs.writeFileSync(GOLDEN_FILE, actual + "\n", "utf-8");
    }
    expect(fs.existsSync(GOLDEN_FILE)).toBe(true);
    const golden = fs.readFileSync(GOLDEN_FILE, "utf-8");
    expect(actual + "\n").toBe(golden);
  });
});
