/**
 * RFC 78c2b7d0 C5 — regression: a `property_set` grounding whose
 * `exocmd__Grounding_targetValueQuery` points at a `query__NamedQuery` must NOT
 * raise a false `sh:class` violation against the property's `exo__Asset` range.
 *
 * NamedQuery IS-A exo__Asset via the chain
 *   query#NamedQuery → exoql#Query → exo#Asset
 * but `TripleClassHierarchy.labelToOntologyIRI` only builds ontology-URI
 * subClassOf edges for prefixes present in `NAMESPACE_PREFIX_MAP`. Before the
 * fix, `query__` and `exoql__` were absent, so the chain was never materialised
 * in ontology-URI space and `isSubClassOf("query#NamedQuery", "exo#Asset")`
 * returned false — a false violation that blocks authoring C5's homoiconic
 * «Archive Ontologically» command assets.
 *
 * Production-shape: the REAL NoteToRDFConverter emits the triples and the REAL
 * shapes-mode validator (runShapesValidation → TripleClassHierarchy → shaclValidate)
 * runs — exactly the path the pre-write SHACL hook uses. Empirically verified to
 * FAIL pre-fix (sh:class violation fires) and PASS post-fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
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

const EXO_CLASS_UID = "2b45f716-12c0-46de-891d-8a488c487424";
const EXO_ASSET_UID = "0f837190-c443-4c7a-b04c-a603c7a2f0c1";
const GROUNDING_CLASS_UID = "6035376d-06d6-4c2b-b13a-8636ebbf183a";
const EXOQL_QUERY_UID = "facdd3c1-2317-433f-87da-9c3125da058c";
const NAMED_QUERY_CLASS_UID = "c68419a7-6352-46e3-beea-c626a4f2f032";
const TVQ_SHAPE_UID = "943d2bc5-9101-49db-a5ce-a86d750e55c4";
const NAMED_QUERY_INSTANCE_UID = "4680e591-05d6-4f9f-b996-24977855eb68";
const GROUNDING_INSTANCE_UID = "4fa0b84b-2609-4b15-bd70-5b8b38bfe51e";

const TVQ_PATH = "https://exocortex.my/ontology/exocmd#Grounding_targetValueQuery";
const EXO_ASSET_IRI = "https://exocortex.my/ontology/exo#Asset";

let fixtureDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let violations: any[];

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c5-nq-range-"));
  fs.mkdirSync(path.join(fixtureDir, "exo"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "exoql"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "exocmd"), { recursive: true });
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
  // exocmd__Grounding class (domain of the shape) → exo__Asset
  w(`exocmd/${GROUNDING_CLASS_UID}.md`, `---
exo__Asset_uid: ${GROUNDING_CLASS_UID}
exo__Asset_label: exocmd__Grounding
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // exoql__Query → exo__Asset
  w(`exoql/${EXOQL_QUERY_UID}.md`, `---
exo__Asset_uid: ${EXOQL_QUERY_UID}
exo__Asset_label: exoql__Query
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // query__NamedQuery → exoql__Query (the 2-hop chain to exo__Asset)
  w(`exoql/${NAMED_QUERY_CLASS_UID}.md`, `---
exo__Asset_uid: ${NAMED_QUERY_CLASS_UID}
exo__Asset_label: query__NamedQuery
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${EXOQL_QUERY_UID}]]"
---
`);
  // exocmd__Grounding_targetValueQuery shape: domain=Grounding, range=exo__Asset
  w(`exocmd/${TVQ_SHAPE_UID}.md`, `---
exo__Asset_uid: ${TVQ_SHAPE_UID}
exo__Asset_label: exocmd__Grounding_targetValueQuery
exo__Instance_class:
  - "[[exo__Property]]"
exo__Property_domain:
  - "[[${GROUNDING_CLASS_UID}]]"
exo__Property_range:
  - "[[${EXO_ASSET_UID}]]"
---
`);
  // A NamedQuery instance
  w(`${NAMED_QUERY_INSTANCE_UID}.md`, `---
exo__Asset_uid: ${NAMED_QUERY_INSTANCE_UID}
exo__Asset_label: "Resolve archive ontology"
exo__Instance_class:
  - "[[${NAMED_QUERY_CLASS_UID}]]"
---
`);
  // A grounding referencing the NamedQuery via targetValueQuery
  w(`${GROUNDING_INSTANCE_UID}.md`, `---
exo__Asset_uid: ${GROUNDING_INSTANCE_UID}
exo__Asset_label: "Re-anchor isDefinedBy"
exo__Instance_class:
  - "[[${GROUNDING_CLASS_UID}]]"
exocmd__Grounding_targetValueQuery: "[[${NAMED_QUERY_INSTANCE_UID}|q]]"
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

describe("RFC 78c2b7d0 C5 — targetValueQuery → query__NamedQuery range resolution", () => {
  it("does NOT emit a sh:class violation against exo__Asset for a NamedQuery-valued targetValueQuery", () => {
    const groundingIRI = `obsidian://vault/${GROUNDING_INSTANCE_UID}.md`;
    const falsePositives = violations.filter(
      (v) =>
        v.propertyPath === TVQ_PATH &&
        v.focusNode === groundingIRI &&
        v.severity === "sh:Violation" &&
        v.message.includes(EXO_ASSET_IRI),
    );
    expect(falsePositives).toEqual([]);
  });
});
