/**
 * Production-shape integration test: a class DECORATED by an adapter keeps its
 * native (frontmatter) ancestors in the query-time class-hierarchy walk
 * (req 9fddda62 regression coverage; RFC 14217015 AC1b, decision №6).
 *
 * ## The shape under test
 *
 * An adapter ontology subscribes a FOREIGN class under its own class without
 * editing the foreign ontology: a reified `exo__Statement`
 * [`test__WebVideo`, `exo__Class_superClass`, `test__Video`] (EKA D5). At index
 * time `NoteToRDFConverter` materializes it as a plain triple whose SUBJECT is the
 * SYMBOLIC class IRI (`…/ontology/test#WebVideo` — the Statement references the
 * class by uid, the class label is `prefix__Local`). The class's NATIVE edge
 * (`test__WebVideo ⊑ test__WebPage`, from its own frontmatter) keys on the class
 * FILE IRI. So the same class node now carries hierarchy edges under BOTH forms.
 *
 * `ClassHierarchyResolvingStore.matchHierarchySubject` used to return the direct
 * (symbolic-subject) edges and skip the file-IRI bridge whenever any existed —
 * its invariant «a symbolic IRI is never a hierarchy-edge subject» was voided by
 * EKA D5. Decorating a class therefore HID its native ancestors: every instance of
 * `test__WebVideo` vanished from `Class_superClass* <test#WebPage>` walks.
 *
 * The store is built by the REAL converter over fixture notes (not hand-authored
 * triples), so the dual-form shape is exactly what production emits.
 *
 * Revert-verify: the fix is the union of direct + file-bridged edges. Restoring the
 * early `if (direct.length > 0) return direct;` reddens D1, D3 and D4; dropping the
 * dedup reddens D5.
 */

import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import type { AskOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const sym = (local: string) => Namespace.forPrefix("test")!.term(local).value;
const RESOURCE = sym("Resource");
const WEB_PAGE = sym("WebPage");
const WEB_VIDEO = sym("WebVideo");
const VIDEO = sym("Video");
const EXOIZABLE = sym("Exoizable");

const UID = {
  resource: "d1000000-0000-4000-8000-000000000001",
  webPage: "d1000000-0000-4000-8000-000000000002",
  webVideo: "d1000000-0000-4000-8000-000000000003",
  video: "d1000000-0000-4000-8000-000000000004",
  exoizable: "d1000000-0000-4000-8000-000000000005",
  superClassProp: "d1000000-0000-4000-8000-000000000006",
  statementClass: "d1000000-0000-4000-8000-000000000007",
  statement: "d1000000-0000-4000-8000-000000000008",
  dupStatement: "d1000000-0000-4000-8000-000000000009",
  instance: "d1000000-0000-4000-8000-00000000000a",
  clip: "d1000000-0000-4000-8000-00000000000b",
  clipStatement: "d1000000-0000-4000-8000-00000000000c",
  clipInstance: "d1000000-0000-4000-8000-00000000000d",
};
const INSTANCE_IRI = `obsidian://vault/${UID.instance}.md`;
const CLIP_INSTANCE_IRI = `obsidian://vault/${UID.clipInstance}.md`;

interface FixtureNote {
  uid: string;
  frontmatter: IFrontmatter;
}

const note = (uid: string, fm: IFrontmatter): FixtureNote => ({
  uid,
  frontmatter: { exo__Asset_uid: uid, ...fm },
});

/**
 * Native TBox: WebVideo ⊑ WebPage ⊑ Resource (the `inbox__YoutubeVideo ⊂
 * lit__WebPage ⊂ lit__Resource` shape) and the adapter target Video ⊑ Exoizable
 * (`video__Video ⊂ exoization__Exoizable`). Plus the `exo__Class_superClass`
 * property and the `exo__Statement` class notes the Statement resolves through.
 */
const TBOX: FixtureNote[] = [
  note(UID.resource, { exo__Asset_label: "test__Resource" }),
  note(UID.webPage, { exo__Asset_label: "test__WebPage", exo__Class_superClass: `[[${UID.resource}]]` }),
  note(UID.webVideo, { exo__Asset_label: "test__WebVideo", exo__Class_superClass: `[[${UID.webPage}]]` }),
  note(UID.exoizable, { exo__Asset_label: "test__Exoizable" }),
  note(UID.video, { exo__Asset_label: "test__Video", exo__Class_superClass: `[[${UID.exoizable}]]` }),
  note(UID.superClassProp, { exo__Asset_label: "exo__Class_superClass" }),
  note(UID.statementClass, { exo__Asset_label: "exo__Statement" }),
];

const INSTANCE = note(UID.instance, {
  exo__Asset_label: "A web video",
  exo__Instance_class: `[[${UID.webVideo}]]`,
});

/** The adapter's decoration — predicate by bare UID, as RFC 14217015 §CQ4 prescribes. */
const ADAPTER_STATEMENT = note(UID.statement, {
  exo__Asset_label: "WebVideo ⊑ Video (adapter)",
  exo__Instance_class: `[[${UID.statementClass}]]`,
  exo__Statement_subject: `[[${UID.webVideo}]]`,
  exo__Statement_predicate: `[[${UID.superClassProp}]]`,
  exo__Statement_object: `[[${UID.video}]]`,
});

/** A Statement that RESTATES the native edge — the union must not double it. */
const DUPLICATE_NATIVE_STATEMENT = note(UID.dupStatement, {
  exo__Asset_label: "WebVideo ⊑ WebPage (restated)",
  exo__Instance_class: `[[${UID.statementClass}]]`,
  exo__Statement_subject: `[[${UID.webVideo}]]`,
  exo__Statement_predicate: `[[${UID.superClassProp}]]`,
  exo__Statement_object: `[[${UID.webPage}]]`,
});

/**
 * A foreign ROOT class (no native superClass) decorated by the adapter — its file
 * IRI carries no hierarchy edge at all, so the bridge finds nothing and the direct
 * (Statement) edge must stand on its own.
 */
const DECORATED_ROOT: FixtureNote[] = [
  note(UID.clip, { exo__Asset_label: "test__Clip" }),
  note(UID.clipStatement, {
    exo__Asset_label: "Clip ⊑ Video (adapter)",
    exo__Instance_class: `[[${UID.statementClass}]]`,
    exo__Statement_subject: `[[${UID.clip}]]`,
    exo__Statement_predicate: `[[${UID.superClassProp}]]`,
    exo__Statement_object: `[[${UID.video}]]`,
  }),
  note(UID.clipInstance, { exo__Asset_label: "A clip", exo__Instance_class: `[[${UID.clip}]]` }),
];

function makeFile(uid: string): IFile {
  return {
    path: `${uid}.md`,
    basename: uid,
    name: `${uid}.md`,
    extension: "md",
    parent: null,
  } as unknown as IFile;
}

async function buildStore(
  notes: FixtureNote[],
  emitInstanceClassAsUid = false,
): Promise<InMemoryTripleStore> {
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
    getFirstLinkpathDest: jest.fn((linkpath: string) => fileByBasename.get(linkpath) ?? null),
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

  const converter = new NoteToRDFConverter(mockVault, undefined, { emitInstanceClassAsUid });
  const store = new InMemoryTripleStore();
  for (const file of files) {
    await store.addAll(await converter.convertNote(file));
  }
  return store;
}

const parser = new SPARQLParser();
const translator = new ExoQLAlgebraTranslator();
const PREFIX = `PREFIX exo: <https://exocortex.my/ontology/exo#>`;

async function select(store: InMemoryTripleStore, sparql: string, variable: string): Promise<string[]> {
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy: true });
  const solutions = await executor.executeAll(translator.translate(parser.parse(sparql)));
  return solutions
    .map((s) => s.get(variable))
    .filter((v): v is IRI => v instanceof IRI)
    .map((v) => v.value);
}

async function ask(store: InMemoryTripleStore, sparql: string): Promise<boolean> {
  const executor = new ExoQLQueryExecutor(store, { resolveClassHierarchy: true });
  return executor.executeAsk(translator.translate(parser.parse(sparql)) as AskOperation);
}

/** The AC1b membership-by-path query: instances whose class is (a subclass of) `ancestor`. */
const membersOf = (ancestor: string) => `${PREFIX}
  SELECT ?s WHERE {
    ?s exo:Instance_class ?c .
    ?c exo:Class_superClass* <${ancestor}> .
  }`;

/** Every ancestor reachable from the decorated class itself (symbolic start node). */
const ancestorsOfWebVideo = `${PREFIX}
  SELECT ?anc WHERE { <${WEB_VIDEO}> exo:Class_superClass* ?anc }`;

describe("decorated class keeps its native ancestors (req 9fddda62, RFC 14217015 AC1b)", () => {
  const PLAIN = [...TBOX, INSTANCE];
  const DECORATED = [...TBOX, INSTANCE, ADAPTER_STATEMENT];

  it("D1 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c the path-membership count of a NATIVE ancestor is identical with and without the adapter Statement", async () => {
    const without = await select(await buildStore(PLAIN), membersOf(WEB_PAGE), "s");
    const withAdapter = await select(await buildStore(DECORATED), membersOf(WEB_PAGE), "s");
    // Non-vacuity: the instance IS a WebPage natively.
    expect(without).toEqual([INSTANCE_IRI]);
    expect(withAdapter).toEqual(without);
    // ...and the transitive native ancestor two hops up survives too.
    expect(await select(await buildStore(DECORATED), membersOf(RESOURCE), "s")).toEqual([INSTANCE_IRI]);
  });

  it("D2 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c the adapter ancestor is reachable ONLY with the Statement (the decoration is real, not a fixture artifact)", async () => {
    expect(await select(await buildStore(PLAIN), membersOf(EXOIZABLE), "s")).toEqual([]);
    expect(await select(await buildStore(DECORATED), membersOf(EXOIZABLE), "s")).toEqual([INSTANCE_IRI]);
    expect(await select(await buildStore(DECORATED), membersOf(VIDEO), "s")).toEqual([INSTANCE_IRI]);
  });

  it("D3 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c the walk from the decorated class sees BOTH ancestor lines at once", async () => {
    const ancestors = (await select(await buildStore(DECORATED), ancestorsOfWebVideo, "anc")).sort();
    expect(ancestors).toEqual([EXOIZABLE, RESOURCE, VIDEO, WEB_PAGE, WEB_VIDEO].sort());
    // Control: without the Statement only the native line.
    const plain = (await select(await buildStore(PLAIN), ancestorsOfWebVideo, "anc")).sort();
    expect(plain).toEqual([RESOURCE, WEB_PAGE, WEB_VIDEO].sort());
  });

  it("D4 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c the ASK precondition surface gates on BOTH a native and the adapter ancestor", async () => {
    const store = await buildStore(DECORATED);
    const gate = (ancestor: string) => `${PREFIX}
      ASK { <${INSTANCE_IRI}> exo:Instance_class/exo:Class_superClass* <${ancestor}> }`;
    expect(await ask(store, gate(RESOURCE))).toBe(true);
    expect(await ask(store, gate(EXOIZABLE))).toBe(true);
    // Negative control: an unrelated class stays false.
    expect(await ask(store, gate(sym("Unrelated")))).toBe(false);
    // One-hop object-bound probe of the native edge on the decorated node.
    expect(await ask(store, `${PREFIX} ASK { <${WEB_VIDEO}> exo:Class_superClass <${WEB_PAGE}> }`)).toBe(true);
  });

  it("D5 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c a Statement restating the native edge does not duplicate the one-hop result", async () => {
    const store = await buildStore([...TBOX, INSTANCE, DUPLICATE_NATIVE_STATEMENT]);
    const parents = await select(
      store,
      `${PREFIX} SELECT ?p WHERE { <${WEB_VIDEO}> exo:Class_superClass ?p }`,
      "p",
    );
    expect(parents).toEqual([WEB_PAGE]);
  });

  it("D6 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c with Instance_class emitted as the class UID (RFC 78572fa9 flip ON) the native ancestors survive the decoration too", async () => {
    const without = await select(await buildStore(PLAIN, true), membersOf(WEB_PAGE), "s");
    const withAdapter = await select(await buildStore(DECORATED, true), membersOf(WEB_PAGE), "s");
    expect(without).toEqual([INSTANCE_IRI]);
    expect(withAdapter).toEqual(without);
  });

  it("D7 @req:9fddda62-be7f-453f-9f69-94f7d6835f1c a decorated ROOT class (no native parent) keeps the adapter parent", async () => {
    const store = await buildStore([...TBOX, ...DECORATED_ROOT]);
    expect(await select(store, membersOf(EXOIZABLE), "s")).toEqual([CLIP_INSTANCE_IRI]);
    expect(await select(store, membersOf(VIDEO), "s")).toEqual([CLIP_INSTANCE_IRI]);
  });
});
