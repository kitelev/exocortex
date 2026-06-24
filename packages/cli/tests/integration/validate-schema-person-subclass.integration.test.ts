/**
 * Issue #3512 — regression: an instance typed as the canonical `person__Person`
 * class (a namespace NOT in the curated `NAMESPACE_PREFIX_MAP`) must resolve as a
 * subclass of `ems__Agent` when referenced by a property whose range is
 * `ems__Agent`, exactly as the legacy deprecated `ims__Person` (a whitelisted
 * namespace) always did.
 *
 * Root cause: `TripleClassHierarchy.labelToOntologyIRI` derived ontology URIs
 * only for prefixes present in the hardcoded `NAMESPACE_PREFIX_MAP`. `person__`
 * was absent, so the ontology-URI subClassOf edge
 *   person#Person → ems#Agent
 * was never materialised. `isSubClassOf("person#Person", "ems#Agent")` returned
 * false → false `sh:class` violation. EKA M2 reverted the person re-prefix
 * (deprecated 1bd359f1 → canonical 1ba807ee) because consolidating instances
 * produced 81 such violations. `ims__Person` bridged only because `ims__` was in
 * the curated map — the only difference between the two classes is the prefix.
 *
 * Fix: `labelToOntologyIRI` derives the canonical `https://exocortex.my/ontology/
 * <prefix>#<Local>` IRI for ANY well-formed lowercase prefix (mirrors
 * Namespace.forPrefix / NoteToRDFConverter's namespace-agnostic emission),
 * keeping the curated map only for the non-exocortex.my namespaces (rdf/rdfs/owl).
 *
 * Production-shape: the REAL NoteToRDFConverter emits the triples and the REAL
 * shapes-mode validator (runShapesValidation → TripleClassHierarchy → shaclValidate)
 * runs — exactly the path `validate schema --shapes-mode` uses. Empirically
 * verified to FAIL pre-fix (sh:class violation fires on the person__Person case)
 * and PASS post-fix, while the ims__Person case passes both (no regression).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const { runShapesValidation } = await import(
  "../../src/commands/validate-schema.js"
);
const { NoteToRDFConverter } = await import("@kitelev/exocortex-core");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

// Class TBox (UUID-named, production-shape)
const EXO_CLASS_UID = "2b45f716-12c0-46de-891d-8a488c487424";
const EXO_ASSET_UID = "0f837190-c443-4c7a-b04c-a603c7a2f0c1";
const AGENT_CLASS_UID = "86bd3cde-0000-4000-8000-000000000001"; // ems__Agent (issue refs 86bd3cde)
const PERSON_CLASS_UID = "1ba807ee-c235-4e1e-aa98-1ee301f60163"; // person__Person (canonical, D9-clean)
const IMS_PERSON_CLASS_UID = "1bd359f1-0000-4000-8000-000000000002"; // ims__Person (legacy deprecated)
const AREA_CLASS_UID = "0c0c0c0c-0000-4000-8000-00000000000a"; // ems__Area (property domain)

// Property shape: ems__Area_responsible, range = ems__Agent
const RESP_SHAPE_UID = "9a9a9a9a-0000-4000-8000-00000000000b";

// ABox instances
const PERSON_INSTANCE_UID = "0aa339bc-9b56-400a-8148-cbde57bbf0b6"; // a.kitelev analog, typed person__Person
const LEGACY_PERSON_INSTANCE_UID = "002eb099-0000-4000-8000-00000000000c"; // typed ims__Person
const AREA_PERSON_UID = "0a1e0001-0000-4000-8000-00000000000d"; // ems__Area, responsible → person__Person instance
const AREA_LEGACY_UID = "0a1e0002-0000-4000-8000-00000000000e"; // ems__Area, responsible → ims__Person instance

const RESP_PATH = "https://exocortex.my/ontology/ems#Area_responsible";
const AGENT_IRI = "https://exocortex.my/ontology/ems#Agent";

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3512-person-subclass-"));
  fs.mkdirSync(path.join(fixtureDir, "exo"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "ems"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "person"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "ims"), { recursive: true });
  const w = (rel: string, body: string) =>
    fs.writeFileSync(path.join(fixtureDir, rel), body);

  // exo__Class metaclass → exo__Asset
  w(`exo/${EXO_CLASS_UID}.md`, `---
exo__Asset_uid: ${EXO_CLASS_UID}
exo__Asset_label: exo__Class
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // exo__Asset root
  w(`exo/${EXO_ASSET_UID}.md`, `---
exo__Asset_uid: ${EXO_ASSET_UID}
exo__Asset_label: exo__Asset
exo__Instance_class:
  - "[[exo__Class]]"
---
`);
  // ems__Agent → exo__Asset
  w(`ems/${AGENT_CLASS_UID}.md`, `---
exo__Asset_uid: ${AGENT_CLASS_UID}
exo__Asset_label: ems__Agent
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // person__Person → ems__Agent  (KEY: non-whitelisted namespace, D9-clean canonical)
  w(`person/${PERSON_CLASS_UID}.md`, `---
exo__Asset_uid: ${PERSON_CLASS_UID}
exo__Asset_label: person__Person
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${AGENT_CLASS_UID}|ems__Agent]]"
---
`);
  // ims__Person → ems__Agent  (regression: whitelisted namespace, legacy deprecated)
  w(`ims/${IMS_PERSON_CLASS_UID}.md`, `---
exo__Asset_uid: ${IMS_PERSON_CLASS_UID}
exo__Asset_label: ims__Person
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${AGENT_CLASS_UID}|ems__Agent]]"
---
`);
  // ems__Area → exo__Asset  (domain of responsible property)
  w(`ems/${AREA_CLASS_UID}.md`, `---
exo__Asset_uid: ${AREA_CLASS_UID}
exo__Asset_label: ems__Area
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // ems__Area_responsible property: domain=ems__Area, range=ems__Agent
  w(`ems/${RESP_SHAPE_UID}.md`, `---
exo__Asset_uid: ${RESP_SHAPE_UID}
exo__Asset_label: ems__Area_responsible
exo__Instance_class:
  - "[[exo__Property]]"
exo__Property_domain:
  - "[[${AREA_CLASS_UID}]]"
exo__Property_range:
  - "[[${AGENT_CLASS_UID}]]"
---
`);
  // person__Person instance (a.kitelev analog)
  w(`${PERSON_INSTANCE_UID}.md`, `---
exo__Asset_uid: ${PERSON_INSTANCE_UID}
exo__Asset_label: "a.kitelev"
exo__Instance_class:
  - "[[${PERSON_CLASS_UID}]]"
---
`);
  // ims__Person instance (legacy)
  w(`${LEGACY_PERSON_INSTANCE_UID}.md`, `---
exo__Asset_uid: ${LEGACY_PERSON_INSTANCE_UID}
exo__Asset_label: "legacy person"
exo__Instance_class:
  - "[[${IMS_PERSON_CLASS_UID}]]"
---
`);
  // Area asset referencing the person__Person instance as responsible
  w(`${AREA_PERSON_UID}.md`, `---
exo__Asset_uid: ${AREA_PERSON_UID}
exo__Asset_label: "Area (person responsible)"
exo__Instance_class:
  - "[[${AREA_CLASS_UID}]]"
ems__Area_responsible: "[[${PERSON_INSTANCE_UID}|a.kitelev]]"
---
`);
  // Area asset referencing the ims__Person instance as responsible (regression)
  w(`${AREA_LEGACY_UID}.md`, `---
exo__Asset_uid: ${AREA_LEGACY_UID}
exo__Asset_label: "Area (legacy responsible)"
exo__Instance_class:
  - "[[${AREA_CLASS_UID}]]"
ems__Area_responsible: "[[${LEGACY_PERSON_INSTANCE_UID}|legacy person]]"
---
`);

  const adapter = new FileSystemVaultAdapter(fixtureDir);
  const converter = new NoteToRDFConverter(adapter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triples = (await converter.convertVault()) as any[];
  const report = await runShapesValidation(fixtureDir, triples);
  violations = report.violations;
});

afterAll(() => {
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const agentClassViolations = (focusUid: string) => {
  const focusNode = `obsidian://vault/${focusUid}.md`;
  return violations.filter(
    (v) =>
      v.propertyPath === RESP_PATH &&
      v.focusNode === focusNode &&
      v.severity === "sh:Violation" &&
      v.message.includes(AGENT_IRI),
  );
};

describe("Issue #3512 — person__Person resolves as subclass of ems__Agent", () => {
  it("does NOT emit a sh:class violation for a person__Person-typed responsible (KEY: fails pre-fix) @req:740244c1-a29a-4c31-8d4d-c74b141fb80e", () => {
    expect(agentClassViolations(AREA_PERSON_UID)).toEqual([]);
  });

  it("does NOT emit a sh:class violation for a legacy ims__Person-typed responsible (no regression)", () => {
    expect(agentClassViolations(AREA_LEGACY_UID)).toEqual([]);
  });
});
