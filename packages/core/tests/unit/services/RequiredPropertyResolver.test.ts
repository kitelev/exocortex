import { createTripleStoreRequiredPropertyResolver } from "../../../src/services/RequiredPropertyResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { Triple } from "../../../src/domain/models/rdf/Triple";

/**
 * T3 «Create Instance» (project bbe40f8c) — unit tests for the SHACL-shape-driven
 * required-property resolver. Models the real `exo__Setting` scenario (a class
 * that actually declares `exo__Property_minCount` required props) plus datatype
 * range mapping and subclass closure.
 */

const EXO = Namespace.EXO;

// Real-data-shaped UIDs.
const SETTING = "88b938af-1a55-451c-b3cc-2f03e5115fcf";
const SETTINGKEY = "a37d39ec-413d-4d9c-8cf2-da9b6025b00c";
const OTHER_CLASS = "11111111-2222-3333-4444-555555555555";
const SETTING_SUBCLASS = "99999999-8888-7777-6666-555555555555";
const XSD = "http://www.w3.org/2001/XMLSchema#";

function fileIRI(uid: string): string {
  return `obsidian://vault/assetspaces/x/${uid}.md`;
}

let propCounter = 0;
function propUid(): string {
  propCounter++;
  const n = propCounter.toString(16).padStart(12, "0");
  return `00000000-0000-0000-0000-${n}`;
}

interface PropDef {
  key: string;
  domainUid: string;
  minCount?: number;
  rangeIRI?: string; // IRI object (class file IRI or xsd IRI)
  rangeLiteral?: string; // literal object (xsd datatype as literal)
}

async function seed(
  props: PropDef[],
  superEdges: Array<[string, string]> = [],
): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  const triples: Triple[] = [];
  for (const p of props) {
    const subj = new IRI(fileIRI(propUid()));
    triples.push(new Triple(subj, EXO.term("Asset_label"), new Literal(p.key)));
    triples.push(
      new Triple(
        subj,
        EXO.term("Property_domain"),
        new IRI(fileIRI(p.domainUid)),
      ),
    );
    if (p.minCount !== undefined) {
      triples.push(
        new Triple(
          subj,
          EXO.term("Property_minCount"),
          new Literal(String(p.minCount)),
        ),
      );
    }
    if (p.rangeIRI) {
      triples.push(
        new Triple(subj, EXO.term("Property_range"), new IRI(p.rangeIRI)),
      );
    }
    if (p.rangeLiteral) {
      triples.push(
        new Triple(
          subj,
          EXO.term("Property_range"),
          new Literal(p.rangeLiteral),
        ),
      );
    }
  }
  for (const [child, parent] of superEdges) {
    triples.push(
      new Triple(
        new IRI(fileIRI(child)),
        EXO.term("Class_superClass"),
        new IRI(fileIRI(parent)),
      ),
    );
  }
  await store.addAll(triples);
  return store;
}

beforeEach(() => {
  propCounter = 0;
});

describe("createTripleStoreRequiredPropertyResolver", () => {
  it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 resolves a class's required (minCount>0) properties, skipping non-required", async () => {
    const store = await seed([
      {
        key: "exo__Setting_key",
        domainUid: SETTING,
        minCount: 1,
        rangeIRI: fileIRI(SETTINGKEY),
      },
      { key: "exo__Setting_value", domainUid: SETTING, minCount: 1 },
      // optional (no minCount) — must NOT appear
      { key: "exo__Setting_note", domainUid: SETTING },
    ]);
    const resolve = createTripleStoreRequiredPropertyResolver(store);
    const fields = await resolve(SETTING);
    const keys = fields.map((f) => f.propertyKey);
    expect(keys).toContain("exo__Setting_key");
    expect(keys).toContain("exo__Setting_value");
    expect(keys).not.toContain("exo__Setting_note");
  });

  it("maps an object (class) range to an assetRef field with the range class UID", async () => {
    const store = await seed([
      {
        key: "exo__Setting_key",
        domainUid: SETTING,
        minCount: 1,
        rangeIRI: fileIRI(SETTINGKEY),
      },
    ]);
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING);
    expect(fields[0]).toMatchObject({
      propertyKey: "exo__Setting_key",
      fieldType: "assetRef",
      targetClassUid: SETTINGKEY,
    });
  });

  it("maps datatype ranges to date / number / boolean / text", async () => {
    const store = await seed([
      {
        key: "ex__C_when",
        domainUid: SETTING,
        minCount: 1,
        rangeIRI: `${XSD}date`,
      },
      {
        key: "ex__C_count",
        domainUid: SETTING,
        minCount: 1,
        rangeIRI: `${XSD}integer`,
      },
      {
        key: "ex__C_flag",
        domainUid: SETTING,
        minCount: 1,
        rangeLiteral: `${XSD}boolean`,
      },
      {
        key: "ex__C_text",
        domainUid: SETTING,
        minCount: 1,
        rangeIRI: `${XSD}string`,
      },
      { key: "ex__C_norange", domainUid: SETTING, minCount: 1 },
    ]);
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING);
    const byKey = Object.fromEntries(
      fields.map((f) => [f.propertyKey, f.fieldType]),
    );
    expect(byKey["ex__C_when"]).toBe("date");
    expect(byKey["ex__C_count"]).toBe("number");
    expect(byKey["ex__C_flag"]).toBe("boolean");
    expect(byKey["ex__C_text"]).toBe("text");
    expect(byKey["ex__C_norange"]).toBe("text");
  });

  describe("CURIE-literal datatype range `xsd:<local>` (ticket 5380e7fd)", () => {
    // On the live vaults every datatype range is the CURIE literal form
    // `"xsd:<local>"`; not one carries the full `http://www.w3.org/2001/XMLSchema#`
    // form the resolver used to require (measurement table in the PR body).
    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 C1 maps a CURIE-literal range (xsd:dateTime / xsd:integer / xsd:boolean / xsd:string) like the full XSD IRI", async () => {
      const store = await seed([
        {
          key: "ems__Reminder_at",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "xsd:dateTime",
        },
        {
          key: "ex__C_count",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "xsd:integer",
        },
        {
          key: "ex__C_flag",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "xsd:boolean",
        },
        {
          key: "ems__Reminder_text",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "xsd:string",
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      const byKey = Object.fromEntries(
        fields.map((f) => [f.propertyKey, f.fieldType]),
      );
      expect(byKey["ems__Reminder_at"]).toBe("date");
      expect(byKey["ex__C_count"]).toBe("number");
      expect(byKey["ex__C_flag"]).toBe("boolean");
      expect(byKey["ems__Reminder_text"]).toBe("text");
      for (const f of fields) expect(f.targetClassUid).toBeUndefined();
    });

    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 C2 keeps the full XSD IRI form (IRI and literal) mapping unchanged", async () => {
      const store = await seed([
        {
          key: "ex__C_when",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: `${XSD}dateTime`,
        },
        {
          key: "ex__C_flag",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: `${XSD}boolean`,
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      const byKey = Object.fromEntries(
        fields.map((f) => [f.propertyKey, f.fieldType]),
      );
      expect(byKey["ex__C_when"]).toBe("date");
      expect(byKey["ex__C_flag"]).toBe("boolean");
    });

    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 C3 does NOT treat a foreign-prefix CURIE (ex:date), a bare `xsd:` or an unknown xsd local as a date/number/boolean", async () => {
      const store = await seed([
        {
          key: "ex__C_foreign",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "ex:date",
        },
        { key: "ex__C_bare", domainUid: SETTING, minCount: 1, rangeLiteral: "xsd:" },
        {
          key: "ex__C_gyear",
          domainUid: SETTING,
          minCount: 1,
          rangeLiteral: "xsd:gYear",
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      for (const f of fields) {
        expect(f.fieldType).toBe("text");
        expect(f.targetClassUid).toBeUndefined();
      }
      expect(fields).toHaveLength(3);
    });
  });

  it("does NOT return required properties of a different class", async () => {
    const store = await seed([
      { key: "exo__Setting_value", domainUid: SETTING, minCount: 1 },
      { key: "other__Thing_name", domainUid: OTHER_CLASS, minCount: 1 },
    ]);
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING);
    expect(fields.map((f) => f.propertyKey)).toEqual(["exo__Setting_value"]);
  });

  it("includes inherited required properties via transitive subclass closure", async () => {
    const store = await seed(
      [
        { key: "exo__Setting_value", domainUid: SETTING, minCount: 1 },
        { key: "sub__X_extra", domainUid: SETTING_SUBCLASS, minCount: 1 },
      ],
      [[SETTING_SUBCLASS, SETTING]],
    );
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING_SUBCLASS);
    const keys = fields.map((f) => f.propertyKey).sort();
    expect(keys).toEqual(["exo__Setting_value", "sub__X_extra"]);
  });

  it("returns [] for a class with no required properties (no-op for the common case)", async () => {
    const store = await seed([
      { key: "exo__Setting_note", domainUid: SETTING },
    ]);
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING);
    expect(fields).toEqual([]);
  });

  it("matches the host even when its domain arrived as a synthesized bare-uid file IRI", async () => {
    // NoteToRDFConverter can emit a domain wikilink as obsidian://vault/<uid>.md
    // (no dir) for cross-vault deps. Both forms must match by bare UID.
    const store = new InMemoryTripleStore();
    const subj = new IRI(`obsidian://vault/assetspaces/x/${propUid()}.md`);
    await store.addAll([
      new Triple(
        subj,
        EXO.term("Asset_label"),
        new Literal("exo__Setting_value"),
      ),
      new Triple(subj, EXO.term("Property_minCount"), new Literal("1")),
      // synthesized bare-uid file IRI for the domain
      new Triple(
        subj,
        EXO.term("Property_domain"),
        new IRI(`obsidian://vault/${SETTING}.md`),
      ),
    ]);
    const fields =
      await createTripleStoreRequiredPropertyResolver(store)(SETTING);
    expect(fields.map((f) => f.propertyKey)).toEqual(["exo__Setting_value"]);
  });
  /**
   * Ticket dc04eded (parent bbac67ce) — the converter emits a class range as a
   * SYMBOLIC IRI (`…/ontology/<ns>#<Local>`) for every class with a
   * `prefix__LocalName` label — on the live vaults nearly every required
   * (`minCount > 0`) object range has that form (measured 2026-09-17, see
   * PR #4254). `uidFrom` only understands path-form / bare-UID values, so every
   * such field reached the create-instance form as `assetRef` WITHOUT
   * `targetClassUid` → the plugin's `DynamicFormModal.buildCandidates` skipped
   * it → a plain text input instead of the reference picker (req c4adae42
   * consumer control). The same class of defect as ticket 7d91d13a (#4253), on
   * the second consumer.
   *
   * Invariant under test: `fieldTypeFromRange` maps a symbolic range to its
   * LABEL form `<ns>__<Local>` via `iriToObsidianName` → `Namespace.fromTermIRI`
   * (the shared inverse — registered AND ad-hoc namespaces; NOT the static
   * `FrontmatterService.IRI_PREFIX_MAP`); `findAssetRefCandidates` accepts a
   * class LABEL as the key and closes subclasses from there (req 15f48fa1).
   * Path-form → bare UID first, as before. Mutant matrix — PR #4254.
   */
  describe("symbolic Property_range → targetClassUid label form (ticket dc04eded)", () => {
    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 S1 maps a symbolic range in a REGISTERED namespace (ems#Effort) to targetClassUid = ems__Effort", async () => {
      const store = await seed([
        {
          key: "ems__Effort_parent",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: Namespace.EMS.term("Effort").value,
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      expect(fields).toHaveLength(1);
      expect(fields[0]).toMatchObject({
        propertyKey: "ems__Effort_parent",
        fieldType: "assetRef",
        targetClassUid: "ems__Effort",
      });
    });

    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 S2 maps a symbolic range in an AD-HOC namespace (sess#Session, not registered) to targetClassUid = sess__Session", async () => {
      // `sess` is a live namespace outside every static prefix map.
      expect(
        Namespace.knownNamespaces().some((ns) => ns.prefix === "sess"),
      ).toBe(false);
      const store = await seed([
        {
          key: "sess__LifecycleEvent_session",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: "https://exocortex.my/ontology/sess#Session",
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      expect(fields[0]).toMatchObject({
        fieldType: "assetRef",
        targetClassUid: "sess__Session",
      });
    });

    it("@req:ace6df4f-b2c7-4dcb-afb6-bda8b20e7da0 S3 keeps mapping a path-form range (obsidian://…/<uid>.md and bare-uid form) to the bare class UID", async () => {
      const store = await seed([
        {
          key: "exo__Setting_key",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: fileIRI(SETTINGKEY),
        },
        {
          // Synthesized no-dir form with an UPPER-CASE hex uid in the filename:
          // must normalise to the lower-case bare UID (not the raw basename).
          key: "exo__Setting_kind",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: `obsidian://vault/${SETTINGKEY.toUpperCase()}.md`,
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      const byKey = Object.fromEntries(
        fields.map((f) => [f.propertyKey, f.targetClassUid]),
      );
      expect(byKey["exo__Setting_key"]).toBe(SETTINGKEY);
      expect(byKey["exo__Setting_kind"]).toBe(SETTINGKEY);
    });

    it("S5 does NOT turn a W3C datatype range (xsd:string as an IRI) into an assetRef", async () => {
      const store = await seed([
        {
          key: "ex__C_text",
          domainUid: SETTING,
          minCount: 1,
          rangeIRI: `${XSD}string`,
        },
      ]);
      const fields =
        await createTripleStoreRequiredPropertyResolver(store)(SETTING);
      expect(fields[0]).toMatchObject({ fieldType: "text" });
      expect(fields[0].targetClassUid).toBeUndefined();
    });
  });
});
