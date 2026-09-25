import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";

/**
 * Issue #4350 — frontmatter properties whose namespace prefix contains a hyphen
 * (`device-work-macbook__Exercise_chapter`) emitted NO triple: the converter
 * skips every key `Namespace.fromPropertyKey` cannot parse, and the old prefix
 * grammar `[a-z][a-zA-Z0-9]*` could not parse a hyphen. The same asset's
 * unhyphenated twin (`devicework__Exercise_chapter`) emitted normally — that
 * twin is the canary each axis carries, so a red axis means "the hyphenated
 * form was dropped", never "the fixture is broken".
 *
 * Production path: the REAL `convertNote` over a vault adapter that resolves
 * wikilinks by UID, the way `FileSystemVaultAdapter` / Obsidian do.
 */

const ONT = "https://exocortex.my/ontology/";

const EX_UID = "22222222-2222-4222-8222-222222222222";
const CHAP_UID = "11111111-1111-4111-8111-111111111111";
const CLASS_UID = "c0bb287d-e2a5-4b18-82a7-04155c6f6750"; // tbank-nessy__LessonLearned (live UID)
const LESSON_UID = "33333333-3333-4333-8333-333333333333";

function mkFile(uid: string, dir: string): IFile {
  return { path: `${dir}/${uid}.md`, basename: uid, name: `${uid}.md`, parent: null };
}

const EX_FILE = mkFile(EX_UID, "notes");
const CHAP_FILE = mkFile(CHAP_UID, "notes");
const CLASS_FILE = mkFile(CLASS_UID, "tbank-nessy");
const LESSON_FILE = mkFile(LESSON_UID, "notes");

const FM_BY_PATH: Record<string, IFrontmatter> = {
  [CHAP_FILE.path]: {
    exo__Asset_uid: CHAP_UID,
    exo__Asset_label: "Глава 1",
    exo__Instance_class: ["[[ems__Task]]"],
  },
  [EX_FILE.path]: {
    exo__Asset_uid: EX_UID,
    exo__Asset_label: "Упражнение 1",
    exo__Instance_class: ["[[ems__Task]]"],
    "device-work-macbook__Exercise_chapter": `[[${CHAP_UID}]]`,
    devicework__Exercise_chapter: `[[${CHAP_UID}]]`,
    "tbank-nessy__LessonLearned_text": "урок",
    tbanknessy__LessonLearned_text: "урок",
  },
  [CLASS_FILE.path]: {
    exo__Asset_uid: CLASS_UID,
    exo__Asset_label: "tbank-nessy__LessonLearned",
    exo__Instance_class: ["[[exo__Class]]"],
  },
  [LESSON_FILE.path]: {
    exo__Asset_uid: LESSON_UID,
    exo__Asset_label: "Урок из инцидента",
    exo__Instance_class: [`[[${CLASS_UID}]]`, "[[ems__Task]]"],
  },
};

const FILE_BY_UID: Record<string, IFile> = {
  [EX_UID]: EX_FILE,
  [CHAP_UID]: CHAP_FILE,
  [CLASS_UID]: CLASS_FILE,
  [LESSON_UID]: LESSON_FILE,
};

function makeVault(): jest.Mocked<IVaultAdapter> {
  return {
    getFrontmatter: jest.fn((file: IFile) => FM_BY_PATH[file.path] ?? null),
    getAllFiles: jest.fn(),
    read: jest.fn().mockResolvedValue(""),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const uid = linkpath.includes("|") ? linkpath.split("|")[0] : linkpath;
      return FILE_BY_UID[uid] ?? null;
    }),
    process: jest.fn(),
    updateLinks: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
  } as unknown as jest.Mocked<IVaultAdapter>;
}

const objectsOf = (triples: Triple[], predicate: string): string[] =>
  triples
    .filter((t) => t.predicate.value === predicate)
    .map((t) => (t.object instanceof IRI || t.object instanceof Literal ? t.object.value : String(t.object)));

describe("NoteToRDFConverter — hyphenated namespace prefixes (issue #4350)", () => {
  let converter: NoteToRDFConverter;

  beforeEach(() => {
    converter = new NoteToRDFConverter(makeVault());
  });

  it("[C1] an object property in a hyphenated namespace emits its predicate", async () => {
    const triples = await converter.convertNote(EX_FILE);
    const chapIRI = converter.notePathToIRI(CHAP_FILE.path).value;

    // canary — the unhyphenated twin has always been emitted
    expect(objectsOf(triples, `${ONT}devicework#Exercise_chapter`)).toEqual([chapIRI]);
    expect(objectsOf(triples, `${ONT}device-work-macbook#Exercise_chapter`)).toEqual([chapIRI]);
  });

  it("[C2] a datatype property in a hyphenated namespace emits its literal", async () => {
    const triples = await converter.convertNote(EX_FILE);

    expect(objectsOf(triples, `${ONT}tbanknessy#LessonLearned_text`)).toEqual(["урок"]);
    expect(objectsOf(triples, `${ONT}tbank-nessy#LessonLearned_text`)).toEqual(["урок"]);
  });

  it("[C3] a [[uid]] reference to a hyphen-labelled class resolves to its symbolic class IRI, like any other namespace", async () => {
    const triples = await converter.convertNote(LESSON_FILE);
    const classes = objectsOf(triples, Namespace.EXO.term("Instance_class").value);

    // canary — the unhyphenated class in the same list
    expect(classes).toContain(`${ONT}ems#Task`);
    // Pre-fix this was the class FILE IRI (`obsidian://…/c0bb287d….md`): the
    // label did not parse, so the dual-IRI bridge never applied to it.
    expect(classes).toContain(`${ONT}tbank-nessy#LessonLearned`);
    expect(classes).not.toContain(converter.notePathToIRI(CLASS_FILE.path).value);
  });

  it("[C5] the relation is queryable by its prefixed name — the SPARQL parser accepts the hyphenated PREFIX", async () => {
    const store = new InMemoryTripleStore();
    await store.addAll(await converter.convertNote(EX_FILE));
    const ast = new SPARQLParser().parse(
      `PREFIX device-work-macbook: <${ONT}device-work-macbook#>
       SELECT ?ex ?chap WHERE { ?ex device-work-macbook:Exercise_chapter ?chap }`,
    );
    const solutions = await new ExoQLQueryExecutor(store).executeAll(
      new ExoQLAlgebraTranslator().translate(ast),
    );
    const rows = solutions.map((s) => [
      (s.get("ex") as IRI).value,
      (s.get("chap") as IRI).value,
    ]);
    expect(rows).toEqual([
      [converter.notePathToIRI(EX_FILE.path).value, converter.notePathToIRI(CHAP_FILE.path).value],
    ]);
  });

  it("[C4] an Instance_class whose hyphenated local name carries whitespace is rejected exactly like an unhyphenated one", () => {
    const fm = (cls: string) => ({
      exo__Asset_uid: "44444444-4444-4444-8444-444444444444",
      exo__Asset_isDefinedBy: "[[!exo]]",
      exo__Instance_class: [`[[${cls}]]`],
    });

    // canary — the unhyphenated shape has always been rejected
    expect(converter.validateExocortexAsset(fm("tbanknessy__Lesson Learned"))?.code).toBe(
      "INVALID_INSTANCE_CLASS_IRI",
    );
    // `expandClassValue` refuses the IRI either way; the validator must agree,
    // or the asset loads while its class triple silently disappears.
    expect(converter.validateExocortexAsset(fm("tbank-nessy__Lesson Learned"))?.code).toBe(
      "INVALID_INSTANCE_CLASS_IRI",
    );
  });
});
