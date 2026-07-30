/**
 * Production-shape revert-verify for RFC 78572fa9 Phase 3 stage-1 (req c359e3d2):
 * the `exo__Instance_class` OBJECT-position emission flip (uid-only, behind a
 * default-OFF flag) + the query-time name-resolver that keeps direct-membership
 * queries written by the readable SYMBOLIC name matching once the store holds the
 * class FILE IRI.
 *
 * The store is built by the REAL {@link NoteToRDFConverter} (NOT hand-authored
 * triples), toggling the `emitInstanceClassAsUid` flag, so the shape under test is
 * exactly what production would emit. The revert-verify axis for F5 is the
 * `resolveClassHierarchy` config toggle on {@link ExoQLQueryExecutor} — the same
 * axis the shipped Phase-0 resolver test uses (type-preserving, no git-checkout /
 * Edit-break): resolver ON = GREEN, resolver OFF = RED.
 *
 * @req:c359e3d2-d97d-4a88-8d13-e2bb4652c10b
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type {
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SymbolicClassAmbiguityError } from "../../../src/infrastructure/sparql/ClassHierarchyResolvingStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { AskOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const REQ = "@req:c359e3d2-d97d-4a88-8d13-e2bb4652c10b";

const EXO = "https://exocortex.my/ontology/exo#";
const EMS = "https://exocortex.my/ontology/ems#";
const PREFIX = `PREFIX exo: <${EXO}>`;

// Symbolic class IRIs the queries reference — derived by the SAME rule the converter
// uses (Namespace.forPrefix(...).term(...)).
const EXO_CLASS = Namespace.EXO.term("Class").value; // .../exo#Class (the metaclass)
const EXO_PROTOTYPE = Namespace.EXO.term("Prototype").value;
const EMS_WIDGET = Namespace.forPrefix("ems")!.term("Widget").value;

// File IRIs (converter emits obsidian://vault/<uid>.md for each note).
const F = (uid: string) => `obsidian://vault/${uid}.md`;

// UUIDs (valid-hex so `isUUID` gates the class-emission path; see the sibling
// class-hierarchy-resolver.test.ts cycle-note).
const UID_EXO_CLASS = "ec1a0000-0000-4000-8000-000000000000"; // exo__Class metaclass def
const UID_EXO_PROTO = "ec00b000-0000-4000-8000-000000000000"; // exo__Prototype def
const UID_WIDGET = "01d70000-0000-4000-8000-000000000000"; // ems__Widget class def
const UID_WIDGET_INST = "a5570000-0000-4000-8000-000000000000"; // instance → ems__Widget
const UID_PROTO_MARKER = "9b0a0000-0000-4000-8000-000000000000"; // directly Instance_class = exo__Prototype

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}

function makeFile(uid: string): IFile {
  return {
    path: `${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    extension: "md",
    parent: null,
  } as unknown as IFile;
}

/**
 * Convert fixture notes through the REAL NoteToRDFConverter, with the
 * `emitInstanceClassAsUid` flip flag set as given. The mock vault resolves a
 * `[[<uid>]]` wikilink to the note whose basename equals that uid (UID-canon), and
 * a `[[prefix__Local]]` label wikilink to NOTHING (unresolved — the symbolic-emission
 * path) unless a note happens to be named that.
 */
async function convertNotes(
  notes: FixtureNote[],
  emitInstanceClassAsUid: boolean,
) {
  const files = notes.map((n) => makeFile(n.uid));
  const fmByPath = new Map<string, IFrontmatter>();
  const fileByBasename = new Map<string, IFile>();
  notes.forEach((n, i) => {
    fmByPath.set(files[i].path, n.frontmatter);
    fileByBasename.set(n.uid, files[i]);
  });

  const mockVault = {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fmByPath.get(f.path) ?? null),
    getFirstLinkpathDest: jest.fn(
      (linkpath: string) => fileByBasename.get(linkpath) ?? null,
    ),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;

  const converter = new NoteToRDFConverter(mockVault, undefined, {
    emitInstanceClassAsUid,
  });
  const out = [];
  for (const file of files) {
    out.push(...(await converter.convertNote(file)));
  }
  return out;
}

async function buildStore(
  notes: FixtureNote[],
  emitInstanceClassAsUid: boolean,
): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  await store.addAll(await convertNotes(notes, emitInstanceClassAsUid));
  return store;
}

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();

async function runAsk(
  store: InMemoryTripleStore,
  sparql: string,
  resolveClassHierarchy: boolean,
): Promise<boolean> {
  const algebra = translator.translate(parser.parse(sparql));
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy });
  return executor.executeAsk(algebra as AskOperation);
}

async function runSelect(
  store: InMemoryTripleStore,
  sparql: string,
  variable: string,
  resolveClassHierarchy: boolean,
): Promise<string[]> {
  const algebra = translator.translate(parser.parse(sparql));
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy });
  const solutions = await executor.executeAll(algebra);
  return solutions
    .map((s) => {
      const v = s.get(variable);
      return v instanceof IRI ? v.value : undefined;
    })
    .filter((v): v is string => v !== undefined);
}

// exo__Class metaclass def + exo__Prototype def + one domain class ems__Widget whose
// Instance_class = the metaclass, one instance of that class, and a marker asset that
// is DIRECTLY Instance_class = exo__Prototype.
const BASE_NOTES: FixtureNote[] = [
  {
    uid: UID_EXO_CLASS,
    frontmatter: { exo__Asset_uid: UID_EXO_CLASS, exo__Asset_label: "exo__Class" },
  },
  {
    uid: UID_EXO_PROTO,
    frontmatter: {
      exo__Asset_uid: UID_EXO_PROTO,
      exo__Asset_label: "exo__Prototype",
    },
  },
  {
    uid: UID_WIDGET,
    frontmatter: {
      exo__Asset_uid: UID_WIDGET,
      exo__Asset_label: "ems__Widget",
      // A class-def is an instance of the exo__Class metaclass.
      exo__Instance_class: `[[${UID_EXO_CLASS}]]`,
    },
  },
  {
    uid: UID_WIDGET_INST,
    frontmatter: {
      exo__Asset_uid: UID_WIDGET_INST,
      exo__Asset_label: "A widget instance",
      exo__Instance_class: `[[${UID_WIDGET}]]`,
    },
  },
  {
    uid: UID_PROTO_MARKER,
    frontmatter: {
      exo__Asset_uid: UID_PROTO_MARKER,
      exo__Asset_label: "A prototype marker",
      exo__Instance_class: `[[${UID_EXO_PROTO}]]`,
    },
  },
];

describe(`Instance_class emission flip + query-time resolver (${REQ})`, () => {
  describe("emission flip — the converter stores the class FILE IRI (uid) when ON, SYMBOLIC when OFF", () => {
    const instanceClass = new IRI(Namespace.EXO.term("Instance_class").value);

    it(`${REQ} flag OFF: the ems__Widget class-def's Instance_class object is the SYMBOLIC metaclass IRI (byte-identical to today)`, async () => {
      const store = await buildStore(BASE_NOTES, false);
      const triples = await store.match(new IRI(F(UID_WIDGET)), instanceClass, undefined);
      const objects = triples.map((t) => (t.object as IRI).value);
      expect(objects).toEqual([EXO_CLASS]);
    });

    it(`${REQ} flag ON: the same Instance_class object is the class FILE IRI (uid), not symbolic`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const triples = await store.match(new IRI(F(UID_WIDGET)), instanceClass, undefined);
      const objects = triples.map((t) => (t.object as IRI).value);
      expect(objects).toEqual([F(UID_EXO_CLASS)]);
      expect(objects).not.toContain(EXO_CLASS);
    });

    it(`${REQ} flag ON: an instance's Instance_class = the domain class's FILE IRI`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const triples = await store.match(new IRI(F(UID_WIDGET_INST)), instanceClass, undefined);
      expect(triples.map((t) => (t.object as IRI).value)).toEqual([F(UID_WIDGET)]);
    });
  });

  describe("F5 — direct-membership queries by the readable symbolic name resolve post-flip (RED without resolver, GREEN with)", () => {
    // The shipped "is a class-def" precondition shape (exocmd eead5d36):
    // $target exo:Instance_class exo:Class.
    const askIsClassDef = (target: string) =>
      `${PREFIX} ASK { <${target}> exo:Instance_class exo:Class }`;

    it(`${REQ} GREEN: "exo:Instance_class exo:Class" gates TRUE for a class-def when the resolver is ON`, async () => {
      const store = await buildStore(BASE_NOTES, true); // flip ON → file-IRI store
      expect(await runAsk(store, askIsClassDef(F(UID_WIDGET)), true)).toBe(true);
    });

    it(`${REQ} RED (revert-verify): the SAME query returns FALSE when the resolver is OFF (store holds file-IRI, query used the symbolic form)`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      expect(await runAsk(store, askIsClassDef(F(UID_WIDGET)), false)).toBe(false);
    });

    it(`${REQ} the class metaclass resolves for a SELECT of all class-defs (?s exo:Instance_class exo:Class) — ON returns the class-def, OFF does not`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const q = `${PREFIX} SELECT ?s WHERE { ?s exo:Instance_class exo:Class }`;
      expect(await runSelect(store, q, "s", true)).toContain(F(UID_WIDGET));
      expect(await runSelect(store, q, "s", false)).not.toContain(F(UID_WIDGET));
    });

    it(`${REQ} exo:Prototype direct membership (the 3928f087 precondition shape) resolves ON, not OFF`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const ask = (t: string) =>
        `${PREFIX} ASK { <${t}> exo:Instance_class exo:Prototype }`;
      expect(await runAsk(store, ask(F(UID_PROTO_MARKER)), true)).toBe(true);
      expect(await runAsk(store, ask(F(UID_PROTO_MARKER)), false)).toBe(false);
    });

    it(`${REQ} negative control (non-vacuity): the class-def is NOT an instance of an UNRELATED class even with the resolver ON`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      // ems__Widget class-def's Instance_class is exo:Class, not exo:Prototype.
      const ask = `${PREFIX} ASK { <${F(UID_WIDGET)}> exo:Instance_class exo:Prototype }`;
      expect(await runAsk(store, ask, true)).toBe(false);
    });

    it(`${REQ} the co-emitted rdf:type membership ALSO bridges (the converter emits rdf:type from the same flag-gated object) — ON GREEN, OFF RED`, async () => {
      // NoteToRDFConverter.convertLegacyNote emits `<s> rdf:type <classObject>` from
      // the SAME valueToClassURI object as exo:Instance_class, so the flip couples
      // them. The RDF-standard membership query must keep working.
      const store = await buildStore(BASE_NOTES, true);
      const ask = (t: string) =>
        `PREFIX exo: <${EXO}> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ASK { <${t}> rdf:type exo:Class }`;
      expect(await runAsk(store, ask(F(UID_WIDGET)), true)).toBe(true);
      expect(await runAsk(store, ask(F(UID_WIDGET)), false)).toBe(false);
    });
  });

  describe("byte-identical when it should be (predicate/object-shape scoped)", () => {
    it(`${REQ} flag OFF: the same is-a-class-def query is TRUE regardless of the resolver (direct symbolic match)`, async () => {
      const store = await buildStore(BASE_NOTES, false); // symbolic store
      const ask = `${PREFIX} ASK { <${F(UID_WIDGET)}> exo:Instance_class exo:Class }`;
      expect(await runAsk(store, ask, true)).toBe(true);
      expect(await runAsk(store, ask, false)).toBe(true);
    });

    it(`${REQ} a VARIABLE-object Instance_class query is identical ON vs OFF (pure pass-through — object is not a symbolic IRI)`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const q = `${PREFIX} SELECT ?c WHERE { <${F(UID_WIDGET_INST)}> exo:Instance_class ?c }`;
      const on = (await runSelect(store, q, "c", true)).sort();
      const off = (await runSelect(store, q, "c", false)).sort();
      expect(on).toEqual(off);
      // With the flip ON the object is the FILE IRI (identity stays uid; the object
      // is not rewritten for a variable query).
      expect(on).toEqual([F(UID_WIDGET)]);
    });

    it(`${REQ} querying by the FILE IRI directly is identical ON vs OFF (already the stored form)`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const q = `${PREFIX} SELECT ?s WHERE { ?s exo:Instance_class <${F(UID_WIDGET)}> }`;
      expect((await runSelect(store, q, "s", true)).sort()).toEqual(
        (await runSelect(store, q, "s", false)).sort(),
      );
    });
  });

  describe("mixed store — an asset referencing the same class both RESOLVED and UNRESOLVED surfaces once (union + dedup)", () => {
    // ems__Widget is referenced by an asset via BOTH a resolved `[[<uid>]]` (→ file
    // IRI under the flip) AND an unresolved `[[ems__Widget]]` label wikilink (no note
    // is basename-named "ems__Widget" → symbolic emission). So the asset holds BOTH
    // the file-IRI form and the symbolic form for the SAME class.
    const MIXED_NOTES: FixtureNote[] = [
      ...BASE_NOTES,
      {
        uid: "111a0000-0000-4000-8000-000000000000",
        frontmatter: {
          exo__Asset_uid: "111a0000-0000-4000-8000-000000000000",
          exo__Asset_label: "Mixed-ref asset",
          exo__Instance_class: [`[[${UID_WIDGET}]]`, "[[ems__Widget]]"],
        },
      },
    ];
    const MIXED = F("111a0000-0000-4000-8000-000000000000");

    it(`${REQ} querying by the symbolic name returns the mixed-ref asset exactly ONCE`, async () => {
      const store = await buildStore(MIXED_NOTES, true);
      const q = `${PREFIX} SELECT ?s WHERE { ?s exo:Instance_class <${EMS_WIDGET}> }`;
      const results = await runSelect(store, q, "s", true);
      expect(results.filter((r) => r === MIXED)).toEqual([MIXED]); // present, not duplicated
    });

    it(`${REQ} the mixed asset is unreachable by the symbolic name with the resolver OFF for its FILE-IRI ref (only the symbolic residual matches)`, async () => {
      const store = await buildStore(MIXED_NOTES, true);
      // Resolver OFF: only the residual symbolic `IC ems#Widget` triple matches → the
      // asset is still returned (via the unresolved-ref residual), but NOT via the
      // flipped file-IRI ref. Sanity that the residual symbolic form exists.
      const q = `${PREFIX} SELECT ?s WHERE { ?s exo:Instance_class <${EMS_WIDGET}> }`;
      expect(await runSelect(store, q, "s", false)).toContain(MIXED);
    });
  });

  describe("ambiguous prefix → error with a disambiguation hint (RFC v3 point 9)", () => {
    // Two DISTINCT class files derive the same symbolic `dup#Thing`.
    const AMBIGUOUS_NOTES: FixtureNote[] = [
      {
        uid: "d000a000-0000-4000-8000-000000000000",
        frontmatter: {
          exo__Asset_uid: "d000a000-0000-4000-8000-000000000000",
          exo__Asset_label: "dup__Thing",
        },
      },
      {
        uid: "d000b000-0000-4000-8000-000000000000",
        frontmatter: {
          exo__Asset_uid: "d000b000-0000-4000-8000-000000000000",
          exo__Asset_label: "dup__Thing",
        },
      },
      {
        uid: "1a570000-0000-4000-8000-000000000000",
        frontmatter: {
          exo__Asset_uid: "1a570000-0000-4000-8000-000000000000",
          exo__Asset_label: "Ambiguous-ref instance",
          exo__Instance_class: "[[d000a000-0000-4000-8000-000000000000]]",
        },
      },
    ];

    it(`${REQ} a query resolving the ambiguous symbolic form throws SymbolicClassAmbiguityError with a hint`, async () => {
      const store = await buildStore(AMBIGUOUS_NOTES, true);
      const dupThing = Namespace.forPrefix("dup")!.term("Thing").value;
      const q = `PREFIX exo: <${EXO}> ASK { <${F("1a570000-0000-4000-8000-000000000000")}> exo:Instance_class <${dupThing}> }`;
      await expect(runAsk(store, q, true)).rejects.toBeInstanceOf(
        SymbolicClassAmbiguityError,
      );
      await expect(runAsk(store, q, true)).rejects.toThrow(/uid/i);
    });
  });

  describe("ZERO store growth — the anti-A2 guarantee holds for the object bridge", () => {
    it(`${REQ} the store triple-count is identical before/after a resolver-enabled Instance_class-object query`, async () => {
      const store = await buildStore(BASE_NOTES, true);
      const before = await store.count();
      // Sanity the resolver did something (matched via the bridge).
      expect(
        await runAsk(store, `${PREFIX} ASK { <${F(UID_WIDGET)}> exo:Instance_class exo:Class }`, true),
      ).toBe(true);
      expect(await store.count()).toBe(before); // nothing materialized
    });
  });
});
