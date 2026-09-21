import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import { InMemoryTripleStore } from "@kitelev/exocortex-core";
import {
  createTripleStoreRequiredPropertyResolver,
  IRI,
  Literal,
  type Triple,
} from "@kitelev/exocortex-core";
import { loadVaultTriples } from "../../src/cache/loadVaultTriples.js";

/**
 * Ticket b4b76541 — the SEAM between the parser and the resolver.
 *
 * The unit axes (`packages/core/tests/unit/services/RequiredPropertyResolver.test.ts`
 * Y1–Y6) hand the resolver triples the TEST built. That leaves the question this
 * file answers: does the shape `NoteToRDFConverter` ACTUALLY emits from ordinary
 * vault files still reach the resolver? The defect lived exactly there — the
 * converter emits a class reference symbolically whenever the target carries a
 * `prefix__Name` label (95 of 95 live required-property domains, 400 of 408 live
 * superClass parents, measured 2026-09-22), and the resolver understood only the
 * path form, so every live class resolved to zero required fields.
 *
 * The fixture is a THREE-FILE vault of our own, not a live one: it goes through
 * the production loader (`loadVaultTriples` — the same call `validate-schema`
 * makes), but nothing about the assertion depends on anybody's real data.
 */

const SETTING = "88b938af-1a55-451c-b3cc-2f03e5115fcf";
const SCOPED = "99999999-8888-7777-6666-555555555555";
const PROP = "00000000-0000-0000-0000-000000000101";

const CLASS_MD = (uid: string, label: string, superUid?: string): string =>
  [
    "---",
    `exo__Asset_uid: ${uid}`,
    "exo__Instance_class:",
    '  - "[[8619c4fc-64f1-4869-b17e-e34186cacca9]]"',
    `exo__Asset_label: ${label}`,
    ...(superUid
      ? ["exo__Class_superClass:", `  - "[[${superUid}]]"`]
      : []),
    "---",
    "",
  ].join("\n");

/**
 * A required property def. Both the domain and the class refs are written as
 * `[[<uid>]]` — the canonical strip-canon form the CLI itself writes — so the
 * SYMBOLIC emission is produced by the converter, not staged by the fixture.
 */
const PROP_MD = [
  "---",
  `exo__Asset_uid: ${PROP}`,
  "exo__Instance_class:",
  '  - "[[38277bfa-d7f9-4a75-b856-b23276ab0db3]]"',
  "exo__Asset_label: exo__Setting_value",
  "exo__Property_domain:",
  `  - "[[${SETTING}]]"`,
  'exo__Property_range: "xsd:string"',
  "exo__Property_minCount: 1",
  "---",
  "",
].join("\n");

async function withVault(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reqprop-loader-"));
  try {
    await fs.mkdir(path.join(dir, "tbox"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "tbox", `${SETTING}.md`),
      CLASS_MD(SETTING, "exo__Setting"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(dir, "tbox", `${SCOPED}.md`),
      CLASS_MD(SCOPED, "exo__ScopedSetting", SETTING),
      "utf-8",
    );
    await fs.writeFile(path.join(dir, "tbox", `${PROP}.md`), PROP_MD, "utf-8");
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function resolveOn(dir: string, hostUid: string): Promise<string[]> {
  const loaded = await loadVaultTriples(dir, { useCache: false });
  const store = new InMemoryTripleStore();
  await store.addAll(loaded.triples as Triple[]);
  const fields = await createTripleStoreRequiredPropertyResolver(store)(hostUid);
  return fields.map((f) => f.propertyKey);
}

describe("required-property resolution through the production loader (ticket b4b76541)", () => {
  it("Z1 @req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 a required property declared on the class itself reaches the form after a REAL parse — the converter emits its domain symbolically, which is the form every live definition carries", async () => {
    await withVault(async (dir) => {
      expect(await resolveOn(dir, SETTING)).toEqual(["exo__Setting_value"]);
    });
  }, 120000);

  it("Z2 @req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 a required property INHERITED through a superClass edge whose parent is emitted symbolically reaches the form too — the Gherkin's transitive-closure clause, end to end", async () => {
    await withVault(async (dir) => {
      expect(await resolveOn(dir, SCOPED)).toEqual(["exo__Setting_value"]);
    });
  }, 120000);

  it("Z3 @req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 the emitted shape is what this seam is about: the domain and the superClass parent arrive as symbolic ontology IRIs, the superClass subject as a file IRI", async () => {
    await withVault(async (dir) => {
      const loaded = await loadVaultTriples(dir, { useCache: false });
      const triples = loaded.triples as Triple[];
      // `Subject` / `RDFObject` are unions — a BlankNode carries no `.value`,
      // so every read narrows first (the type gate `check-test-types` is a
      // stricter superset of what ts-jest asks, and it is right here).
      const iriValue = (node: unknown): string | null =>
        node instanceof IRI || node instanceof Literal ? node.value : null;
      const objectOf = (pred: string): Array<string | null> =>
        triples
          .filter((t) => t.predicate.value.endsWith(pred))
          .map((t) => iriValue(t.object));
      expect(objectOf("Property_domain")).toEqual([
        "https://exocortex.my/ontology/exo#Setting",
      ]);
      expect(objectOf("Class_superClass")).toEqual([
        "https://exocortex.my/ontology/exo#Setting",
      ]);
      const superSubjects = triples
        .filter((t) => t.predicate.value.endsWith("Class_superClass"))
        .map((t) => iriValue(t.subject));
      expect(superSubjects).toHaveLength(1);
      expect(superSubjects[0] ?? "").toMatch(/\/99999999-8888-7777-6666-555555555555\.md$/);
      // And the label TWINS coexist: a `prefix__Name` label is emitted as an IRI
      // under exo__Asset_label AND as a Literal under rdfs:label. This is what
      // makes the Literal branch of `labelKeyOf` sufficient on today's emission
      // and the IRI branch defensive — pinned here so that a future change in
      // emission reddens THIS axis with a one-line explanation instead of
      // quietly turning Z1/Z2 into vacuous passes.
      const labelsOfSetting = triples
        .filter(
          (t) =>
            (iriValue(t.subject) ?? "").endsWith(`${SETTING}.md`) &&
            /label$/i.test(t.predicate.value),
        )
        .map((t) => `${t.predicate.value.split(/[#/]/).pop()}:${t.object.constructor.name}`)
        .sort();
      expect(labelsOfSetting).toEqual(["Asset_label:IRI", "label:Literal"]);
    });
  }, 120000);
});
