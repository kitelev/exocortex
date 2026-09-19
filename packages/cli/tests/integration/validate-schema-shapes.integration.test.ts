/**
 * P1.7 — CLI integration test: validate schema --shapes-mode
 *
 * Synthetic vault with known violations → expected ValidationReport (golden file diff).
 *
 * Scenarios:
 * 1. Asset A — sh:maxCount violation (ems__Task_name Single cardinality, 2 values given)
 * 2. Asset B — sh:datatype violation (ems__Task_count expects xsd:integer, got string)
 * 3. Asset C — both violations simultaneously
 * 4. Asset D — CONFORMS: CURIE-literal ranges `"xsd:integer"` / `xsd:gYear` (the live-corpus
 *    form) reach sh:datatype, and converter number-tagged literals (xsd:decimal until d5ad5217,
 *    xsd:integer for whole numbers since) conform by lexical form (ticket a9b55ead,
 *    @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2)
 * 5. Asset E — sh:datatype violations under the same CURIE ranges (10.5 vs integer, 2026-05 vs gYear)
 * 6. Asset F — CONFORMS: `3` under `ems__Task_rank`, a def typed ONLY `exo__DatatypeProperty`
 *    (pure-UID form) that reaches the registry through the `tbox/` superclass chain
 *    (ticket 84bb4d08, @req:67767fcb-15e3-4deb-9b70-5b96c7110a22)
 * 7. Asset G — sh:datatype violation under that same DatatypeProperty-only shape (3.5 vs integer);
 *    silent before the loaders walked `exo__Class_superClass`
 * 8. Asset H — CONFORMS: whole numbers `20` under range xsd:decimal and `7` under xsd:integer —
 *    both tagged xsd:integer by the converter since ticket d5ad5217 (parity with the JSON-LD
 *    parser); the xsd:integer tag is judged by the same lexical table as xsd:decimal
 *    (@req:d553b1a4-c312-4819-964d-fe6dae0a50e1)
 * 9. Asset I — CONFORMS: `https://youtu.be/…` (string tag) under the xsd:anyURI shape
 *    `ems__Task_sourceUrl` — judged by IRI.isValidIRI since ticket e55b0a07 (amendment of
 *    @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2); before it every string under anyURI violated
 * 10. Asset J — sh:datatype violation: `not a uri` under the same anyURI shape
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

const { NoteToRDFConverter } = await import("@kitelev/exocortex-core");
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

  it("@req:6e00a56c-11d4-4915-b81c-006b6ae16bd9 Scenario: asset-a.md — sh:maxCount violation for ems__Task_name (Single cardinality, 2 values)", () => {
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

  it("I1 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 Scenario: asset-d.md — CURIE range xsd:integer / xsd:gYear: whole number 10 and year 1987 CONFORM (no violation)", () => {
    const assetD = violations.filter((x) => x.focusNode.includes("asset-d.md"));
    expect(assetD).toEqual([]);
  });

  it("I2 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 Scenario: asset-e.md — CURIE range \"xsd:integer\" reaches sh:datatype: 10.5 is a violation", () => {
    const v = violations.find(
      (x) =>
        x.focusNode.includes("asset-e.md") &&
        x.propertyPath.includes("Task_weight"),
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("sh:Violation");
    expect(v?.constraint).toBe("datatype");
    expect(v?.actualValue).toBe("10.5");
    expect(v?.expectedRange).toBe("http://www.w3.org/2001/XMLSchema#integer");
  });

  it("I3 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 Scenario: asset-e.md — bare CURIE range xsd:gYear reaches sh:datatype: 2026-05 is a violation", () => {
    const v = violations.find(
      (x) =>
        x.focusNode.includes("asset-e.md") &&
        x.propertyPath.includes("Task_year"),
    );
    expect(v).toBeDefined();
    expect(v?.constraint).toBe("datatype");
    expect(v?.expectedRange).toBe("http://www.w3.org/2001/XMLSchema#gYear");
  });

  it("I4 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 Scenario: asset-f.md — a def typed ONLY exo__DatatypeProperty (pure-UID form, chain in tbox/) gates: whole number 3 CONFORMS (no violation)", () => {
    const assetF = violations.filter((x) => x.focusNode.includes("asset-f.md"));
    expect(assetF).toEqual([]);
  });

  it("I5 @req:67767fcb-15e3-4deb-9b70-5b96c7110a22 Scenario: asset-g.md — the DatatypeProperty-only shape ems__Task_rank reaches sh:datatype: 3.5 is a violation (silent before the superclass walk)", () => {
    const v = violations.find(
      (x) =>
        x.focusNode.includes("asset-g.md") &&
        x.propertyPath.includes("Task_rank"),
    );
    expect(v).toBeDefined();
    expect(v?.severity).toBe("sh:Violation");
    expect(v?.constraint).toBe("datatype");
    expect(v?.actualValue).toBe("3.5");
    expect(v?.expectedRange).toBe("http://www.w3.org/2001/XMLSchema#integer");
  });

  it("H1 @req:d553b1a4-c312-4819-964d-fe6dae0a50e1 Scenario: asset-h.md — whole number 20 under range xsd:decimal (the b5a670e8 case) and 7 under xsd:integer CONFORM with the xsd:integer converter tag", () => {
    const assetH = violations.filter((x) => x.focusNode.includes("asset-h.md"));
    expect(assetH).toEqual([]);
  });

  it("H2 @req:d553b1a4-c312-4819-964d-fe6dae0a50e1 Scenario: asset-d.md still conforms after the tag change — 1987 under xsd:gYear and 10 under xsd:integer arrive as xsd:integer, not xsd:decimal", () => {
    const assetD = violations.filter((x) => x.focusNode.includes("asset-d.md"));
    expect(assetD).toEqual([]);
    // the violation messages of the OTHER assets carry the new tag for whole numbers only
    const tags = violations
      .map((x) => x.message as string)
      .filter((m) => m.includes("has datatype"))
      .map((m) => /has datatype <([^>]+)>/.exec(m)?.[1]);
    expect(tags).toContain("http://www.w3.org/2001/XMLSchema#decimal"); // 10.5 / 3.5 stay decimal
    expect(tags).not.toContain("http://www.w3.org/2001/XMLSchema#integer"); // no whole number is reported
  });

  it("U1 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 Scenario: asset-i.md — a string-tagged absolute URL under the xsd:anyURI shape ems__Task_sourceUrl CONFORMS (no violation; amendment e55b0a07)", () => {
    const assetI = violations.filter((x) => x.focusNode.includes("asset-i.md"));
    expect(assetI).toEqual([]);
  });

  it("U2 @req:b0ad1160-74af-44b0-bb8b-1a665b8ba5d2 Scenario: asset-j.md — `not a uri` under the xsd:anyURI shape is an sh:datatype violation (IRI.isValidIRI rejects whitespace)", () => {
    const assetJ = violations.filter((x) => x.focusNode.includes("asset-j.md"));
    expect(assetJ).toHaveLength(1);
    expect(assetJ[0].constraint).toBe("datatype");
    expect(assetJ[0].propertyPath).toBe("https://exocortex.my/ontology/ems#Task_sourceUrl");
    expect(assetJ[0].message).toContain("not a uri");
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
