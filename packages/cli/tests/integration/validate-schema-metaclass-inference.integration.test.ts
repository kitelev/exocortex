/**
 * Issue #3247 — integration: metaclass inference (OWL Full punning)
 *
 * Scenario reproduced from vault-2025 baseline (2026-05-23):
 *
 *   exo__Class                       (typed as exo__Class, subClassOf exo__Asset)
 *     ↑ rdf:type (metaclass)
 *   ems__Area-like class             (typed as exo__Class, NO exo__Class_superClass declared)
 *     ↑ rdf:type (instance-of-class)
 *   asset instance                   (typed as the class above)
 *
 *   reference asset                  (has exo__Asset_relates: [[asset instance]])
 *
 * Shape: exo__Asset_relates with range exo__Asset.
 *
 * Pre-fix: the class file has no own subClassOf declaration. TripleClassHierarchy
 * only builds the chain from explicit subClassOf triples, so isSubClassOf for the
 * class → exo__Asset returns false. The shape's range check fires a false sh:class
 * violation for the asset instance.
 *
 * Post-fix: Pass 3 in TripleClassHierarchy constructor propagates the metaclass's
 * superClass chain to every instance of the metaclass (OWL Full punning). The
 * class inherits exo__Asset via the metaclass propagation, isSubClassOf returns
 * true, and no violation fires.
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

const { runShapesValidation } = await import(
  "../../src/commands/validate-schema.js"
);
const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

const EXO_CLASS_UID = "11111111-aaaa-aaaa-aaaa-111111111111";
const EXO_ASSET_UID = "22222222-bbbb-bbbb-bbbb-222222222222";
const AREA_CLASS_UID = "33333333-cccc-cccc-cccc-333333333333";
const AREA_INSTANCE_UID = "44444444-dddd-dddd-dddd-444444444444";
const REFERENCE_UID = "55555555-eeee-eeee-eeee-555555555555";
const RELATES_SHAPE_UID = "66666666-ffff-ffff-ffff-666666666666";

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "exocortex-issue-3247-"),
  );

  fs.mkdirSync(path.join(fixtureDir, "exo"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "ems"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "shapes"), { recursive: true });

  // exo__Asset — root class (labeled, anchors the chain)
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

  // exo__Class — metaclass (typed as itself / exo__Class), declares subClassOf exo__Asset
  fs.writeFileSync(
    path.join(fixtureDir, `exo/${EXO_CLASS_UID}.md`),
    `---
exo__Asset_uid: ${EXO_CLASS_UID}
exo__Asset_label: exo__Class
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`,
  );

  // ems__Area-like class — typed as exo__Class but does NOT declare its own
  // exo__Class_superClass. Pre-fix: this class is invisible to the hierarchy.
  // Post-fix: metaclass propagation gives it exo__Asset as superClass.
  fs.writeFileSync(
    path.join(fixtureDir, `ems/${AREA_CLASS_UID}.md`),
    `---
exo__Asset_uid: ${AREA_CLASS_UID}
exo__Asset_label: ems__Area
exo__Instance_class:
  - "[[${EXO_CLASS_UID}]]"
---
`,
  );

  // ABox instance typed as the ems__Area-like class
  fs.writeFileSync(
    path.join(fixtureDir, `${AREA_INSTANCE_UID}.md`),
    `---
exo__Asset_uid: ${AREA_INSTANCE_UID}
exo__Asset_label: "QA Chapter"
exo__Instance_class:
  - "[[${AREA_CLASS_UID}]]"
---
`,
  );

  // reference asset — typed as exo__Asset, with exo__Asset_relates to the QA Chapter
  fs.writeFileSync(
    path.join(fixtureDir, `${REFERENCE_UID}.md`),
    `---
exo__Asset_uid: ${REFERENCE_UID}
exo__Asset_label: "Карта метрик QA-стрима"
exo__Instance_class:
  - "[[${EXO_ASSET_UID}]]"
exo__Asset_relates:
  - "[[${AREA_INSTANCE_UID}]]"
---
`,
  );

  // Shape: exo__Asset_relates with domain=exo__Asset, range=exo__Asset
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

describe("Issue #3247 integration: metaclass inference chain", () => {
  it("does not emit sh:class violation against exo__Asset for instance of class typed-as exo__Class without own superClass", () => {
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

  it("does not emit any violation on exo__Asset_relates path for the reference focus", () => {
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
