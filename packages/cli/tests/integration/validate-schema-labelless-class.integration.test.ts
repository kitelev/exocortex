/**
 * Issue #3242 — integration: label-less class file no longer breaks SHACL range checks
 *
 * Scenario reproduced from vault-2025 baseline (2026-05-23):
 *
 *   2026.md  (typed as period__Year)
 *     ↓ exo__Instance_class
 *   period__Year  (UUID-named, NO exo__Asset_label, only exo__Class_superClass)
 *     ↓ exo__Class_superClass
 *   period__Period  (UUID-named, has exo__Asset_label = "period__Period")
 *     ↓ exo__Class_superClass
 *   exo__Asset  (has exo__Asset_label = "exo__Asset")
 *
 *   asset-X.md  (has exo__Asset_relates: [[2026-uid]])
 *
 * Shape: exo__Asset_relates with range exo__Asset.
 *
 * Pre-fix: 2026's exo__Instance_class triple was emitted as Literal because
 * `valueToClassURI` could not derive an ontology IRI from the UUID-named
 * label-less class file. ShaclLiteValidator skipped the Literal type triple
 * (only IRI processed at L182), leaving 2026 apparently classless. The
 * `exo__Asset_relates` shape on asset-X then fired with a false sh:class
 * violation against exo__Asset.
 *
 * Post-fix: `valueToClassURI` falls back to the file IRI when no class IRI
 * can be derived. TripleClassHierarchy traverses
 * <year-file> → <period-file> → <asset-file> (the last labeled, identity-
 * mapped to https://exocortex.my/ontology/exo#Asset). isSubClassOf reaches
 * exo__Asset via the file-IRI chain. No violation.
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

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];
let conforms: boolean;

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "exocortex-issue-3242-"),
  );

  // exo__Asset class definition (labeled — anchors the chain)
  fs.mkdirSync(path.join(fixtureDir, "exo"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "exo/exo__Asset.md"),
    `---
exo__Asset_uid: 11111111-0000-0000-0000-000000000000
exo__Asset_label: exo__Asset
---
`,
  );

  // period__Period class definition (labeled)
  fs.mkdirSync(path.join(fixtureDir, "period"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "period/22222222-2222-2222-2222-222222222222.md"),
    `---
exo__Asset_uid: 22222222-2222-2222-2222-222222222222
exo__Asset_label: period__Period
exo__Class_superClass:
  - "[[11111111-0000-0000-0000-000000000000]]"
---
`,
  );

  // period__Year class definition (NO label — root cause)
  fs.writeFileSync(
    path.join(fixtureDir, "period/33333333-3333-3333-3333-333333333333.md"),
    `---
exo__Asset_uid: 33333333-3333-3333-3333-333333333333
exo__Class_superClass:
  - "[[22222222-2222-2222-2222-222222222222]]"
---
`,
  );

  // The 2026-instance: typed as period__Year (label-less class)
  fs.writeFileSync(
    path.join(fixtureDir, "year-2026.md"),
    `---
exo__Asset_uid: 44444444-4444-4444-4444-444444444444
exo__Asset_label: "2026"
exo__Instance_class:
  - "[[33333333-3333-3333-3333-333333333333]]"
---
`,
  );

  // Reference asset: relates to 2026 — this is the focus node that emitted
  // false sh:class violations pre-fix.
  fs.writeFileSync(
    path.join(fixtureDir, "reference.md"),
    `---
exo__Asset_uid: 55555555-5555-5555-5555-555555555555
exo__Asset_label: reference
exo__Instance_class:
  - "[[11111111-0000-0000-0000-000000000000]]"
exo__Asset_relates:
  - "[[44444444-4444-4444-4444-444444444444]]"
---
`,
  );

  // Shape: exo__Asset_relates with range exo__Asset.
  fs.mkdirSync(path.join(fixtureDir, "shapes"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "shapes/exo__Asset_relates.md"),
    `---
exo__Asset_uid: 66666666-6666-6666-6666-666666666666
exo__Asset_label: exo__Asset_relates
exo__Instance_class:
  - "[[https://exocortex.my/ontology/exo#Property]]"
exo__Property_domain:
  - "[[11111111-0000-0000-0000-000000000000]]"
exo__Property_range:
  - "[[11111111-0000-0000-0000-000000000000]]"
---
`,
  );

  const adapter = new FileSystemVaultAdapter(fixtureDir);
  const converter = new NoteToRDFConverter(adapter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  const report = await runShapesValidation(fixtureDir, triples);
  violations = report.violations;
  conforms = report.conforms;
});

afterAll(() => {
  if (fixtureDir) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

describe("Issue #3242 integration: label-less class chain", () => {
  it("does not emit sh:class violation against exo__Asset for asset typed via label-less class", () => {
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

  it("validator conforms or the only violations are unrelated to the label-less chain", () => {
    // We don't require zero global violations (shape registry may flag other
    // properties on the synthetic fixtures), but the regression-specific
    // sh:class -> exo__Asset path must be clean.
    const relatesViolations = violations.filter(
      (v) =>
        v.propertyPath ===
        "https://exocortex.my/ontology/exo#Asset_relates",
    );
    expect(relatesViolations).toEqual([]);
    void conforms;
  });
});
