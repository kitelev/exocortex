/**
 * Production-shape integration test: a query by a property sees the values of its
 * SUB-PROPERTIES (req e036289d; RFC 14217015 decision №7, CQ6).
 *
 * ## The shape under test
 *
 * RFC 14217015 §2: `exoization-ideas__ExoizationIdea_exoizable` has sub-properties
 * by material type — `_video`, `_book`, `_article` — each declared by
 * `exo__Property_superProperty` → `_exoizable` and each with its own range. An idea
 * records its source through the typed sub-property. A frontmatter key is emitted
 * as the SYMBOLIC predicate IRI, while the `superProperty` declaration keys on the
 * property's FILE IRI; the engine had no inference over that edge, so CQ6 in the
 * simple form `?idea eideas:ExoizationIdea_exoizable ?src` saw only the ideas that
 * used the super-property itself, and had to be written with a second UNION branch
 * that joined by label.
 *
 * The store is built by the REAL converter over fixture notes (not hand-authored
 * triples), so the declaration and data shapes are exactly what production emits;
 * the forms that matter (file-IRI object of a label-form wikilink, symbolic subject
 * of a reified exo__Statement) are asserted on the raw store before they are
 * relied on.
 *
 * Revert-verify: the mutants in `property-hierarchy-subproperties-e036289d.spec.json`
 * remove one guarantee each; `resolvePropertyHierarchy: false` (SP9) is the
 * pre-fix baseline — CQ6 returns 1 of 4.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import type { QueryExecutorConfig } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { PropertyHierarchyResolvingStore } from "../../../src/infrastructure/sparql/PropertyHierarchyResolvingStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { AskOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import type { Triple, Subject, Predicate, Object as RDFObject } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const REQ = "@req:e036289d-166f-487d-aa96-08ab0ba9555c";

const ei = (local: string) => Namespace.forPrefix("exoization-ideas")!.term(local).value;
const t = (local: string) => Namespace.forPrefix("test")!.term(local).value;
const EXOIZABLE = ei("ExoizationIdea_exoizable");
const VIDEO = ei("ExoizationIdea_video");
const YOUTUBE = ei("ExoizationIdea_youtubeVideo");
const SUPER_PROPERTY = Namespace.EXO.term("Property_superProperty").value;

let seq = 0;
const uid = () => `e0360000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const fileIri = (u: string) => `obsidian://vault/${u}.md`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}
const note = (u: string, fm: IFrontmatter): FixtureNote => ({ uid: u, frontmatter: { exo__Asset_uid: u, ...fm } });

// ---------------------------------------------------------------- TBox
const U = {
  ideaClass: uid(),
  exoizable: uid(),
  video: uid(),
  book: uid(),
  article: uid(),
  youtube: uid(),
  superPropertyProp: uid(),
  statementClass: uid(),
  instanceClassProp: uid(),
  superClassProp: uid(),
  rdfSubject: uid(),
};

const prop = (u: string, label: string, parent?: string): FixtureNote =>
  note(u, {
    exo__Asset_label: label,
    ...(parent ? { exo__Property_superProperty: `[[${parent}]]` } : {}),
  });

const IDEA_TBOX: FixtureNote[] = [
  note(U.ideaClass, { exo__Asset_label: "exoization-ideas__ExoizationIdea" }),
  prop(U.exoizable, "exoization-ideas__ExoizationIdea_exoizable"),
  prop(U.video, "exoization-ideas__ExoizationIdea_video", U.exoizable),
  prop(U.book, "exoization-ideas__ExoizationIdea_book", U.exoizable),
  prop(U.article, "exoization-ideas__ExoizationIdea_article", U.exoizable),
];

// ---------------------------------------------------------------- sources + ideas
const S = { generic: uid(), video: uid(), book: uid(), article: uid(), youtube: uid(), s1: uid(), s2: uid() };
const SOURCES: FixtureNote[] = [
  note(S.generic, { exo__Asset_label: "A generic source" }),
  note(S.video, { exo__Asset_label: "A video" }),
  note(S.book, { exo__Asset_label: "A book" }),
  note(S.article, { exo__Asset_label: "An article" }),
  note(S.youtube, { exo__Asset_label: "A YouTube clip" }),
  note(S.s1, { exo__Asset_label: "Source one" }),
  note(S.s2, { exo__Asset_label: "Source two" }),
];

const idea = (u: string, label: string, fm: IFrontmatter): FixtureNote =>
  note(u, { exo__Asset_label: label, exo__Instance_class: `[[${U.ideaClass}]]`, ...fm });

const I = { direct: uid(), video: uid(), book: uid(), article: uid(), youtube: uid(), dup: uid(), twoSubs: uid() };
const IDEAS: FixtureNote[] = [
  idea(I.direct, "Exoize a generic source", { "exoization-ideas__ExoizationIdea_exoizable": `[[${S.generic}]]` }),
  idea(I.video, "Exoize a video", { "exoization-ideas__ExoizationIdea_video": `[[${S.video}]]` }),
  idea(I.book, "Exoize a book", { "exoization-ideas__ExoizationIdea_book": `[[${S.book}]]` }),
  idea(I.article, "Exoize an article", { "exoization-ideas__ExoizationIdea_article": `[[${S.article}]]` }),
];

// ---------------------------------------------------------------- harness
function makeFile(u: string): IFile {
  return { path: `${u}.md`, basename: u, name: `${u}.md`, extension: "md", parent: null } as unknown as IFile;
}

async function convertAll(notes: FixtureNote[]): Promise<Triple[]> {
  const files = notes.map((n) => makeFile(n.uid));
  const fmByPath = new Map<string, IFrontmatter>();
  const fileByLinkpath = new Map<string, IFile>();
  notes.forEach((n, i) => {
    fmByPath.set(files[i].path, n.frontmatter);
    fileByLinkpath.set(n.uid, files[i]);
    // A label-form wikilink resolves through the label/aliases (the CLI adapter's
    // behaviour) — needed for the file-IRI declaration form (SP6).
    const label = n.frontmatter.exo__Asset_label;
    if (typeof label === "string") fileByLinkpath.set(label, files[i]);
  });
  const vault = {
    getAllFiles: jest.fn(() => files),
    getFrontmatter: jest.fn((f: IFile) => fmByPath.get(f.path) ?? null),
    getFirstLinkpathDest: jest.fn((linkpath: string) => fileByLinkpath.get(linkpath) ?? null),
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
  const converter = new NoteToRDFConverter(vault);
  const out: Triple[] = [];
  for (const f of files) out.push(...(await converter.convertNote(f)));
  return out;
}

/** Records the predicate of every `match` the engine makes against the raw store. */
class CountingStore extends InMemoryTripleStore {
  readonly predicateCalls: string[] = [];
  override async match(subject?: Subject, predicate?: Predicate, object?: RDFObject): Promise<Triple[]> {
    this.predicateCalls.push(predicate?.value ?? "*");
    return super.match(subject, predicate, object);
  }
}

async function buildStore(notes: FixtureNote[]): Promise<CountingStore> {
  const store = new CountingStore();
  await store.addAll(await convertAll(notes));
  return store;
}

/** An IRI as `<iri>`, a literal as its toString(), an unbound variable as ∅. */
const fmt = (term: unknown): string =>
  term instanceof IRI ? `<${term.value}>` : term === undefined ? "∅" : String(term);

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();
const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX eideas: <https://exocortex.my/ontology/exoization-ideas#>
PREFIX test: <https://exocortex.my/ontology/test#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>`;

async function rows(
  store: InMemoryTripleStore,
  sparql: string,
  vars: string[],
  config: QueryExecutorConfig = {},
): Promise<string[]> {
  const executor = new ExoQLQueryExecutor(store, config);
  const solutions = await executor.executeAll(translator.translate(parser.parse(`${PREFIX}\n${sparql}`)));
  return solutions
    .map((s) => vars.map((v) => fmt(s.get(v))).join(" | "))
    .sort();
}

async function ask(store: InMemoryTripleStore, sparql: string): Promise<boolean> {
  const executor = new ExoQLQueryExecutor(store);
  return executor.executeAsk(translator.translate(parser.parse(`${PREFIX}\n${sparql}`)) as AskOperation);
}

const pair = (ideaUid: string, srcUid: string) => `<${fileIri(ideaUid)}> | <${fileIri(srcUid)}>`;

/** RFC 14217015 CQ6 in the SIMPLE (single-branch) form. */
const CQ6 = `SELECT ?idea ?src WHERE {
  ?idea exo:Instance_class eideas:ExoizationIdea .
  ?idea eideas:ExoizationIdea_exoizable ?src }`;

const ALL_FOUR = [
  pair(I.direct, S.generic),
  pair(I.video, S.video),
  pair(I.book, S.book),
  pair(I.article, S.article),
].sort();

const BASE = [...IDEA_TBOX, ...SOURCES, ...IDEAS];

describe("a query by a property sees its sub-properties (req e036289d, RFC 14217015 decision №7)", () => {
  it(`SP1 ${REQ} CQ6 in the single-branch form finds the ideas recorded through every sub-property (4 of 4)`, async () => {
    expect(await rows(await buildStore(BASE), CQ6, ["idea", "src"])).toEqual(ALL_FOUR);
  });

  it(`SP2 ${REQ} sub-properties are transitive: a sub-sub-property is seen by both ancestors`, async () => {
    const store = await buildStore([
      ...BASE,
      prop(U.youtube, "exoization-ideas__ExoizationIdea_youtubeVideo", U.video),
      idea(I.youtube, "Exoize a YouTube clip", { "exoization-ideas__ExoizationIdea_youtubeVideo": `[[${S.youtube}]]` }),
    ]);
    expect(await rows(store, CQ6, ["idea", "src"])).toEqual([...ALL_FOUR, pair(I.youtube, S.youtube)].sort());
    expect(
      await rows(store, `SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_video ?src }`, ["idea", "src"]),
    ).toEqual([pair(I.video, S.video), pair(I.youtube, S.youtube)].sort());
  });

  it(`SP3 ${REQ} widening goes DOWN only: a sub-property query does not see its parent or its siblings`, async () => {
    const store = await buildStore([
      ...BASE,
      prop(U.youtube, "exoization-ideas__ExoizationIdea_youtubeVideo", U.video),
      idea(I.youtube, "Exoize a YouTube clip", { "exoization-ideas__ExoizationIdea_youtubeVideo": `[[${S.youtube}]]` }),
    ]);
    expect(
      await rows(store, `SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_youtubeVideo ?src }`, ["idea", "src"]),
    ).toEqual([pair(I.youtube, S.youtube)]);
    expect(
      await rows(store, `SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_book ?src }`, ["idea", "src"]),
    ).toEqual([pair(I.book, S.book)]);
  });

  it(`SP4 ${REQ} a value reached through the property AND a sub-property, or two sub-properties, is returned once`, async () => {
    const store = await buildStore([
      ...BASE,
      idea(I.dup, "Same source twice", {
        "exoization-ideas__ExoizationIdea_exoizable": `[[${S.generic}]]`,
        "exoization-ideas__ExoizationIdea_video": `[[${S.generic}]]`,
      }),
      idea(I.twoSubs, "Same source, two sub-properties", {
        "exoization-ideas__ExoizationIdea_video": `[[${S.book}]]`,
        "exoization-ideas__ExoizationIdea_book": `[[${S.book}]]`,
      }),
    ]);
    expect(await rows(store, CQ6, ["idea", "src"])).toEqual(
      [...ALL_FOUR, pair(I.dup, S.generic), pair(I.twoSubs, S.book)].sort(),
    );
  });

  it(`SP5 ${REQ} a cycle of declarations terminates and each member sees the other's values`, async () => {
    const cycA = uid();
    const cycB = uid();
    const x = uid();
    const y = uid();
    const store = await buildStore([
      ...SOURCES,
      prop(cycA, "test__cycA", cycB),
      prop(cycB, "test__cycB", cycA),
      note(x, { exo__Asset_label: "x", test__cycA: `[[${S.s1}]]` }),
      note(y, { exo__Asset_label: "y", test__cycB: `[[${S.s2}]]` }),
    ]);
    const both = [`<${fileIri(x)}> | <${fileIri(S.s1)}>`, `<${fileIri(y)}> | <${fileIri(S.s2)}>`].sort();
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s test:cycA ?o }`, ["s", "o"])).toEqual(both);
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s test:cycB ?o }`, ["s", "o"])).toEqual(both);
  });

  it(`SP6 ${REQ} a declaration written as a LABEL-form wikilink (file-IRI object) is recognised`, async () => {
    const parent = uid();
    const child = uid();
    const x = uid();
    const notes = [
      ...SOURCES,
      prop(parent, "test__labelParent"),
      note(child, { exo__Asset_label: "test__labelChild", exo__Property_superProperty: "[[test__labelParent]]" }),
      note(x, { exo__Asset_label: "x", test__labelChild: `[[${S.s1}]]` }),
    ];
    const store = await buildStore(notes);
    // Input is built: the declaration's OBJECT is the parent's FILE IRI.
    const decl = await store.match(new IRI(fileIri(child)), new IRI(SUPER_PROPERTY), undefined);
    expect(decl.map((d) => fmt(d.object))).toEqual([`<${fileIri(parent)}>`]);
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s test:labelParent ?o }`, ["s", "o"])).toEqual([
      `<${fileIri(x)}> | <${fileIri(S.s1)}>`,
    ]);
  });

  it(`SP14 ${REQ} a declaration made by a reified exo__Statement adapter (symbolic subject) is recognised`, async () => {
    const parent = uid();
    const child = uid();
    const stmt = uid();
    const x = uid();
    const store = await buildStore([
      ...SOURCES,
      note(U.statementClass, { exo__Asset_label: "exo__Statement" }),
      note(U.superPropertyProp, { exo__Asset_label: "exo__Property_superProperty" }),
      prop(parent, "test__stmtParent"),
      prop(child, "test__stmtChild"),
      note(stmt, {
        exo__Asset_label: "stmtChild ⊑ stmtParent (adapter)",
        exo__Instance_class: `[[${U.statementClass}]]`,
        exo__Statement_subject: `[[${child}]]`,
        exo__Statement_predicate: `[[${U.superPropertyProp}]]`,
        exo__Statement_object: `[[${parent}]]`,
      }),
      note(x, { exo__Asset_label: "x", test__stmtChild: `[[${S.s1}]]` }),
    ]);
    // Input is built: the materialized declaration keys on the SYMBOLIC child IRI.
    const decl = await store.match(new IRI(t("stmtChild")), new IRI(SUPER_PROPERTY), undefined);
    expect(decl.map((d) => fmt(d.object))).toEqual([`<${t("stmtParent")}>`]);
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s test:stmtParent ?o }`, ["s", "o"])).toEqual([
      `<${fileIri(x)}> | <${fileIri(S.s1)}>`,
    ]);
  });

  it(`SP7 ${REQ} a predicate OUTSIDE the exocortex ontologies is not widened (the live Statement_object ⊑ rdf:subject shape)`, async () => {
    const child = uid();
    const x = uid();
    const store = await buildStore([
      ...SOURCES,
      prop(U.rdfSubject, "rdf__subject"),
      prop(child, "test__Statement_object", U.rdfSubject),
      note(x, { exo__Asset_label: "x", test__Statement_object: `[[${S.s1}]]` }),
    ]);
    const decl = await store.match(new IRI(fileIri(child)), new IRI(SUPER_PROPERTY), undefined);
    expect(decl.map((d) => fmt(d.object))).toEqual([`<${Namespace.RDF.term("subject").value}>`]);
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s rdf:subject ?o }`, ["s", "o"])).toEqual([]);
  });

  it(`SP13 ${REQ} exo:Instance_class is not widened by its declared sub-properties (owned by the class bridge)`, async () => {
    const child = uid();
    const klass = uid();
    const x = uid();
    const store = await buildStore([
      prop(U.instanceClassProp, "exo__Instance_class", U.instanceClassProp),
      prop(child, "test__kindOf", U.instanceClassProp),
      note(klass, { exo__Asset_label: "test__C" }),
      note(x, { exo__Asset_label: "x", test__kindOf: `[[${klass}]]` }),
    ]);
    expect(await rows(store, `SELECT ?s ?c WHERE { ?s exo:Instance_class ?c }`, ["s", "c"])).toEqual([]);
  });

  it(`SP18 ${REQ} exo:Class_superClass is not widened by its declared sub-properties (owned by the class bridge)`, async () => {
    const child = uid();
    const d = uid();
    const e = uid();
    const store = await buildStore([
      prop(U.superClassProp, "exo__Class_superClass"),
      prop(child, "test__broader", U.superClassProp),
      note(e, { exo__Asset_label: "test__E" }),
      note(d, { exo__Asset_label: "test__D", test__broader: `[[${e}]]` }),
    ]);
    expect(await rows(store, `SELECT ?c ?p WHERE { ?c exo:Class_superClass ?p }`, ["c", "p"])).toEqual([]);
  });

  it(`SP8 ${REQ} the ASK and property-path surfaces see sub-properties too`, async () => {
    const store = await buildStore(BASE);
    expect(
      await ask(store, `ASK { <${fileIri(I.video)}> eideas:ExoizationIdea_exoizable <${fileIri(S.video)}> }`),
    ).toBe(true);
    expect(
      await rows(store, `SELECT ?idea WHERE { <${fileIri(S.book)}> ^eideas:ExoizationIdea_exoizable ?idea }`, ["idea"]),
    ).toEqual([`<${fileIri(I.book)}>`]);
    expect(
      await rows(store, `SELECT ?l WHERE { <${fileIri(I.article)}> eideas:ExoizationIdea_exoizable/exo:Asset_label ?l }`, ["l"]),
    ).toEqual([`"An article"`]);
  });

  it(`SP9 ${REQ} resolvePropertyHierarchy:false restores the baseline; the class toggle is independent`, async () => {
    const store = await buildStore(BASE);
    expect(await rows(store, CQ6, ["idea", "src"], { resolvePropertyHierarchy: false })).toEqual([
      pair(I.direct, S.generic),
    ]);
    expect(await rows(store, CQ6, ["idea", "src"], { resolveClassHierarchy: false })).toEqual(ALL_FOUR);
  });

  it(`SP10 ${REQ} the index follows the store: a declaration added after the first query is seen by the next`, async () => {
    const bookWithoutParent = [...BASE.filter((n) => n.uid !== U.book), prop(U.book, "exoization-ideas__ExoizationIdea_book")];
    const store = await buildStore(bookWithoutParent);
    expect(await rows(store, CQ6, ["idea", "src"])).toEqual(ALL_FOUR.filter((r) => r !== pair(I.book, S.book)));
    const before = await convertAll([prop(U.book, "exoization-ideas__ExoizationIdea_book")]);
    const after = await convertAll([prop(U.book, "exoization-ideas__ExoizationIdea_book", U.exoizable), ...IDEA_TBOX]);
    await store.removeAll(before);
    const bookAfter = after.filter((x) => fmt(x.subject) === `<${fileIri(U.book)}>`);
    // Input is built: the edit adds the declaration (the store's count changes).
    expect(bookAfter.map((x) => x.predicate.value)).toContain(SUPER_PROPERTY);
    await store.addAll(bookAfter);
    expect(await rows(store, CQ6, ["idea", "src"])).toEqual(ALL_FOUR);
  });

  it(`SP11 ${REQ} a VARIABLE predicate returns the stored predicates only — no entailed triple is added`, async () => {
    const store = await buildStore(BASE);
    expect(await rows(store, `SELECT ?p WHERE { <${fileIri(I.video)}> ?p <${fileIri(S.video)}> }`, ["p"])).toEqual([
      `<${VIDEO}>`,
    ]);
  });

  it(`SP12 ${REQ} widening does not leak into the raw store's cached match results`, async () => {
    const store = await buildStore(BASE);
    const q = `SELECT ?idea ?src WHERE { ?idea eideas:ExoizationIdea_exoizable ?src }`;
    expect(await rows(store, q, ["idea", "src"])).toEqual(ALL_FOUR);
    expect(await store.match(undefined, new IRI(EXOIZABLE), undefined)).toHaveLength(1);
    expect(await rows(store, q, ["idea", "src"])).toEqual(ALL_FOUR);
  });

  it(`SP15 ${REQ} a self-declared property (P ⊑ P, the live exo:Instance_class shape) costs one direct match`, async () => {
    const self = uid();
    const x = uid();
    const store = await buildStore([
      ...SOURCES,
      prop(self, "test__selfP", self),
      note(x, { exo__Asset_label: "x", test__selfP: `[[${S.s1}]]` }),
    ]);
    store.predicateCalls.length = 0;
    expect(await rows(store, `SELECT ?s ?o WHERE { ?s test:selfP ?o }`, ["s", "o"])).toEqual([
      `<${fileIri(x)}> | <${fileIri(S.s1)}>`,
    ]);
    expect(store.predicateCalls.filter((p) => p === t("selfP"))).toHaveLength(1);
  });

  it(`SP16 ${REQ} the decorator returns ENTAILED triples: a sub-property triple carries the queried predicate`, async () => {
    const store = await buildStore(BASE);
    const triples = await new PropertyHierarchyResolvingStore(store).match(undefined, new IRI(EXOIZABLE), undefined);
    expect(triples).toHaveLength(4);
    expect(new Set(triples.map((x) => x.predicate.value))).toEqual(new Set([EXOIZABLE]));
  });

  it(`SP17 ${REQ} a property file whose label is not a valid predicate is skipped, not fatal`, async () => {
    const odd = uid();
    const store = await buildStore([
      ...BASE,
      note(odd, { exo__Asset_label: "exoization-ideas__Exoizable (old name)", exo__Property_superProperty: `[[${U.exoizable}]]` }),
    ]);
    expect(await rows(store, CQ6, ["idea", "src"])).toEqual(ALL_FOUR);
  });
});

// Keep the youtube constant referenced for readers of SP2/SP3.
void YOUTUBE;
