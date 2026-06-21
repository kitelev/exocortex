/**
 * Issue #3242 — integration: label-less class file no longer breaks SHACL range checks
 *
 * Scenario reproduced from vault-2025 baseline (2026-05-23):
 *
 *   year-2026.md  (typed as period__Year)
 *     ↓ exo__Instance_class [[<period__Year-uuid>]]
 *   period__Year  (UUID-named, NO exo__Asset_label, only exo__Class_superClass)
 *     ↓ exo__Class_superClass [[<period__Period-uuid>]]
 *   period__Period  (UUID-named, has exo__Asset_label = "period__Period")
 *     ↓ exo__Class_superClass [[<exo__Asset-uuid>]]
 *   exo__Asset  (UUID-named, has exo__Asset_label = "exo__Asset")
 *
 *   reference.md  (has exo__Asset_relates: [[year-2026-uuid]])
 *
 * Shape: exo__Asset_relates with range exo__Asset (Property_range as UUID
 * wikilink to the canonical exo__Asset class file).
 *
 * All class files are UUID-named (RFC-004 UUID-canon) so wikilinks resolve via
 * FileSystemVaultAdapter.buildUuidIndex.
 *
 * Pre-fix: year-2026's exo__Instance_class triple was emitted as Literal
 * because `valueToClassURI` could not derive an ontology IRI from the
 * UUID-named label-less period__Year class file. ShaclLiteValidator skipped
 * the Literal type triple (only IRI processed at L182), leaving year-2026
 * apparently classless. The exo__Asset_relates shape on reference.md then
 * fired with a false sh:class violation against exo__Asset.
 *
 * Post-fix: `valueToClassURI` falls back to the resolved file IRI when no
 * class IRI can be derived. TripleClassHierarchy traverses
 *   <year-file> → <period-file> → <asset-file>
 * via `exo__Class_superClass` triples; <asset-file> is identity-mapped to
 * https://exocortex.my/ontology/exo#Asset (its label resolves). isSubClassOf
 * reaches exo__Asset via the file-IRI chain. No violation.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
void __dirname;

const { runShapesValidation } = await import(
  "../../src/commands/validate-schema.js"
);
const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

const EXO_ASSET_UID = "11111111-0000-0000-0000-000000000000";
const PERIOD_PERIOD_UID = "22222222-2222-2222-2222-222222222222";
const PERIOD_YEAR_UID = "33333333-3333-3333-3333-333333333333";
const YEAR_2026_UID = "44444444-4444-4444-4444-444444444444";
const REFERENCE_UID = "55555555-5555-5555-5555-555555555555";
const RELATES_SHAPE_UID = "66666666-6666-6666-6666-666666666666";

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "exocortex-issue-3242-"),
  );

  // exo__Asset class definition — UUID-named, labeled (anchors the chain).
  // All class files require exo__Instance_class to pass validateExocortexAsset;
  // we use the canonical "[[exo__Class]]" form which Namespace.fromPropertyKey
  // recognises without needing a separate exo__Class file in the fixture.
  fs.mkdirSync(path.join(fixtureDir, "exo"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, `exo/${EXO_ASSET_UID}.md`),
    `---
exo__Asset_uid: ${EXO_ASSET_UID}
exo__Asset_label: exo__Asset
exo__Instance_class:
  - "[[exo__Class]]"
---
`,
  );

  // period__Period class definition — UUID-named, labeled
  fs.mkdirSync(path.join(fixtureDir, "period"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, `period/${PERIOD_PERIOD_UID}.md`),
    `---
exo__Asset_uid: ${PERIOD_PERIOD_UID}
exo__Asset_label: period__Period
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`,
  );

  // period__Year class definition — UUID-named, NO LABEL (root cause of bug)
  fs.writeFileSync(
    path.join(fixtureDir, `period/${PERIOD_YEAR_UID}.md`),
    `---
exo__Asset_uid: ${PERIOD_YEAR_UID}
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${PERIOD_PERIOD_UID}]]"
---
`,
  );

  // year-2026 instance — typed as period__Year (label-less class)
  fs.writeFileSync(
    path.join(fixtureDir, `${YEAR_2026_UID}.md`),
    `---
exo__Asset_uid: ${YEAR_2026_UID}
exo__Asset_label: "2026"
exo__Instance_class:
  - "[[${PERIOD_YEAR_UID}]]"
---
`,
  );

  // reference asset — typed as exo__Asset, related to year-2026.
  // The shape exo__Asset_relates (domain=exo__Asset, range=exo__Asset) applies
  // to this asset; pre-fix the range check against year-2026 produced a
  // false sh:class violation.
  fs.writeFileSync(
    path.join(fixtureDir, `${REFERENCE_UID}.md`),
    `---
exo__Asset_uid: ${REFERENCE_UID}
exo__Asset_label: reference
exo__Instance_class:
  - "[[${EXO_ASSET_UID}]]"
exo__Asset_relates:
  - "[[${YEAR_2026_UID}]]"
---
`,
  );

  // Shape: exo__Asset_relates, domain=exo__Asset, range=exo__Asset.
  // Uses canonical [[exo__Property]] for Instance_class (recognised by
  // Namespace.fromPropertyKey) so ShapeLoader registers the shape. domain
  // and range use UUID wikilinks to the canonical UUID-named exo__Asset class
  // file; ShapeLoader.resolveClassIRI resolves them via rdfs:label lookup.
  fs.mkdirSync(path.join(fixtureDir, "shapes"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "shapes/exo__Asset_relates.md"),
    `---
exo__Asset_uid: ${RELATES_SHAPE_UID}
exo__Asset_label: exo__Asset_relates
exo__Instance_class:
  - "[[exo__Property]]"
exo__Property_domain:
  - "[[${EXO_ASSET_UID}]]"
exo__Property_range:
  - "[[${EXO_ASSET_UID}]]"
---
`,
  );

  const adapter = new FileSystemVaultAdapter(fixtureDir);
  const converter = new NoteToRDFConverter(adapter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  const report = await runShapesValidation(fixtureDir, triples);
  violations = report.violations;
});

afterAll(() => {
  if (fixtureDir) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

describe("Issue #3242 integration: label-less class chain", () => {
  it("does not emit sh:class violation against exo__Asset on exo__Asset_relates path @req:7a337cbd-75ab-436c-986b-d061ace9f4da", () => {
    const falsePositives = violations.filter(
      (v) =>
        v.propertyPath ===
          "https://exocortex.my/ontology/exo#Asset_relates" &&
        v.message.includes(
          "expected class https://exocortex.my/ontology/exo#Asset",
        ),
    );
    expect(falsePositives).toEqual([]);
  });

  it("does not emit any violation on exo__Asset_relates path for reference focus", () => {
    const referenceIRI = `obsidian://vault/${REFERENCE_UID}.md`;
    const relatesViolations = violations.filter(
      (v) =>
        v.propertyPath ===
          "https://exocortex.my/ontology/exo#Asset_relates" &&
        v.focusNode === referenceIRI,
    );
    expect(relatesViolations).toEqual([]);
  });
});
