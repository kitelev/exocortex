import "reflect-metadata";
import { NoteToRDFConverter } from "../../../src/services/NoteToRDFConverter";
import type { IVaultAdapter, IFile, IFrontmatter } from "../../../src/interfaces/IVaultAdapter";
import type { ILogger } from "../../../src/interfaces/ILogger";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";

/**
 * RFC 14217015 AC1c (decision №7, req ebbe3db4) — a reified statement whose class
 * is a SUBCLASS of `exo__Statement` materializes its logical edge at index time.
 *
 * Before the change `convertLegacyNote` (EKA D5) emitted the edge only when one of
 * the asset's classes resolved to EXACTLY `exo#Statement`; «Тезис»
 * (`exoization__Thesis` ⊂ `exo__Statement`, one class per thesis) gave none.
 *
 * Production shape: the class hierarchy is declared the way the vault declares it —
 * `exo__Class_superClass: "[[<uid>]]"` on UID-named class files whose
 * `exo__Asset_label` is `prefix__Local` (live `exoization__Thesis` 3035ed7d:
 * `exo__Class_superClass: "[[7920028c-…]]"`). The instance's class is the bare-UID
 * wikilink (UUID-canon). Only the vault adapter is a double; the converter, the
 * store and the SPARQL engine are real.
 */

const REQ = "@req:ebbe3db4-ab96-4e5c-ada1-198698c91570";

// exo__Statement class file — same UID as the live one
const STMT_UID = "7920028c-8613-4756-9761-95846155ce9c";
const ASSET_UID = "11111111-0000-4000-8000-0000000000a0"; // exo__Asset
const THESIS_UID = "22222222-0000-4000-8000-0000000000b0"; // test__Thesis ⊂ exo__Statement
const SUB_UID = "33333333-0000-4000-8000-0000000000c0"; // test__SubThesis ⊂ test__Thesis
const NOTE_UID = "44444444-0000-4000-8000-0000000000d0"; // test__Note ⊂ exo__Asset
const CYC_A_UID = "55555555-0000-4000-8000-0000000000e1"; // test__CycA ⊂ test__CycB
const CYC_B_UID = "55555555-0000-4000-8000-0000000000e2"; // test__CycB ⊂ test__CycA

const A_UID = "a0000000-0000-4000-8000-000000000001"; // concept A
const B_UID = "b0000000-0000-4000-8000-000000000002"; // concept B
const L_UID = "c0000000-0000-4000-8000-000000000003"; // link predicate test__Concept_leadsTo

const STMT_OBJ = (cls: string, n: string): IFrontmatter => ({
  exo__Asset_uid: `90000000-0000-4000-8000-0000000000${n}`,
  exo__Instance_class: [`[[${cls}]]`],
  exo__Statement_subject: `[[${A_UID}]]`,
  exo__Statement_predicate: `[[${L_UID}]]`,
  exo__Statement_object: `[[${B_UID}]]`,
});

/** Class file frontmatter: UID-named, `prefix__Local` label, bare-UID superClass. */
function classFm(uid: string, label: string, superUid?: string): IFrontmatter {
  const fm: IFrontmatter = {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: ["[[exo__Class]]"],
  };
  if (superUid) fm.exo__Class_superClass = `[[${superUid}]]`;
  return fm;
}

/** The depth cap the requirement names (scenario S5). */
const WALK_DEPTH_CAP = 16;

/** A chain C0 → C1 → … → C(n-1) → exo__Statement: n superclass hops from C0. */
function chainUid(i: number): string {
  return `66666666-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

interface Fixture {
  fm: Record<string, IFrontmatter>; // by uid
  /** uids whose frontmatter the metadataCache does NOT hold (cold) */
  cold: Set<string>;
}

function baseFixture(): Fixture {
  const fm: Record<string, IFrontmatter> = {
    [STMT_UID]: classFm(STMT_UID, "exo__Statement", ASSET_UID),
    [ASSET_UID]: classFm(ASSET_UID, "exo__Asset"),
    [THESIS_UID]: classFm(THESIS_UID, "test__Thesis", STMT_UID),
    [SUB_UID]: classFm(SUB_UID, "test__SubThesis", THESIS_UID),
    [NOTE_UID]: classFm(NOTE_UID, "test__Note", ASSET_UID),
    [CYC_A_UID]: classFm(CYC_A_UID, "test__CycA", CYC_B_UID),
    [CYC_B_UID]: classFm(CYC_B_UID, "test__CycB", CYC_A_UID),
    [A_UID]: { exo__Asset_uid: A_UID, exo__Asset_label: "Concept A" },
    [B_UID]: { exo__Asset_uid: B_UID, exo__Asset_label: "Concept B" },
    [L_UID]: { exo__Asset_uid: L_UID, exo__Asset_label: "test__Concept_leadsTo" },
  };
  return { fm, cold: new Set() };
}

function fileOf(uid: string): IFile {
  return { path: `assetspaces/t/${uid}.md`, basename: uid, name: `${uid}.md`, parent: null };
}

function makeVault(fx: Fixture, withFallback: boolean): IVaultAdapter {
  const byPath = (file: IFile): IFrontmatter | null => fx.fm[file.basename] ?? null;
  const vault: Partial<IVaultAdapter> = {
    getFrontmatter: jest.fn((file: IFile) => (fx.cold.has(file.basename) ? null : byPath(file))),
    read: jest.fn().mockResolvedValue(""),
    getFirstLinkpathDest: jest.fn((linkpath: string) => {
      const uid = linkpath.split("|")[0];
      return fx.fm[uid] ? fileOf(uid) : null;
    }),
  };
  if (withFallback) {
    vault.getFrontmatterWithFallback = jest.fn(async (file: IFile) => byPath(file));
  }
  return vault as IVaultAdapter;
}

function makeLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<ILogger>;
}

const A = () => new IRI(`obsidian://vault/assetspaces/t/${A_UID}.md`);
const B = () => new IRI(`obsidian://vault/assetspaces/t/${B_UID}.md`);
const L = () => new IRI("https://exocortex.my/ontology/test#Concept_leadsTo");

function hasEdge(triples: Triple[]): boolean {
  return triples.some(
    (t) =>
      t.subject instanceof IRI &&
      t.subject.value === A().value &&
      t.predicate.value === L().value &&
      t.object instanceof IRI &&
      t.object.value === B().value,
  );
}

async function convert(
  fx: Fixture,
  stmtFm: IFrontmatter,
  opts: { withFallback?: boolean; emitInstanceClassAsUid?: boolean; logger?: ILogger } = {},
): Promise<{ triples: Triple[]; converter: NoteToRDFConverter; file: IFile }> {
  const uid = String(stmtFm.exo__Asset_uid);
  fx.fm[uid] = stmtFm;
  const converter = new NoteToRDFConverter(
    makeVault(fx, opts.withFallback ?? false),
    opts.logger ?? makeLogger(),
    { emitInstanceClassAsUid: opts.emitInstanceClassAsUid ?? false },
  );
  const file = fileOf(uid);
  const triples = await converter.convertNote(file);
  return { triples, converter, file };
}

describe("RFC 14217015 AC1c — subclasses of exo__Statement materialize their logical edge", () => {
  it(`S1 ${REQ} a thesis with the single class Thesis gives the edge, and ?a <link> ?b finds it`, async () => {
    const fx = baseFixture();
    const { triples } = await convert(fx, STMT_OBJ(THESIS_UID, "01"));
    expect(hasEdge(triples)).toBe(true);

    const store = new InMemoryTripleStore();
    await store.addAll(triples);
    const ast = new SPARQLParser().parse(`SELECT ?a ?b WHERE { ?a <${L().value}> ?b }`);
    const algebra = new ExoQLAlgebraTranslator().translate(ast);
    const rows = await new ExoQLQueryExecutor(store).executeAll(algebra);
    const pairs = rows.map((r) => [
      (r.get("a") as IRI | undefined)?.value,
      (r.get("b") as IRI | undefined)?.value,
    ]);
    expect(pairs).toEqual([[A().value, B().value]]);
  });

  it(`S2 ${REQ} a TRANSITIVE subclass (SubThesis ⊂ Thesis ⊂ exo__Statement) gives the edge`, async () => {
    const fx = baseFixture();
    const { triples } = await convert(fx, STMT_OBJ(SUB_UID, "02"));
    expect(hasEdge(triples)).toBe(true);
  });

  it(`S3 ${REQ} a class that is NOT a subclass of exo__Statement gives NO edge, raw slots stay`, async () => {
    // Negative axis: green before AND after the change by design — it pins that the
    // walk recognises exo__Statement, not "any class with a superClass".
    const fx = baseFixture();
    const { triples, converter, file } = await convert(fx, STMT_OBJ(NOTE_UID, "03"));
    expect(triples.some((t) => t.predicate.value === L().value)).toBe(false);
    const self = converter.notePathToIRI(file.path).value;
    for (const slot of ["Statement_subject", "Statement_predicate", "Statement_object"]) {
      expect(
        triples.some(
          (t) =>
            t.subject instanceof IRI &&
            t.subject.value === self &&
            t.predicate.value === Namespace.EXO.term(slot).value,
        ),
      ).toBe(true);
    }
  });

  it(`S4 ${REQ} a cycle in the class hierarchy terminates without an edge and without hitting the depth cap`, async () => {
    const fx = baseFixture();
    const logger = makeLogger();
    const { triples } = await convert(fx, STMT_OBJ(CYC_A_UID, "04"), { logger });
    expect(hasEdge(triples)).toBe(false);
    // Stopped by the cycle guard, not by the depth cap.
    expect(logger.warn.mock.calls).toHaveLength(0);
  });

  it(`S5a ${REQ} a chain of exactly 16 hops still gives the edge`, async () => {
    const fx = baseFixture();
    // Fixed fixture, NOT derived from the production constant (§A21): the spec says 16.
    const max = WALK_DEPTH_CAP;
    // C0 → … → C(max-1) → exo__Statement: exo__Statement sits `max` hops from C0.
    for (let i = 0; i < max; i++) {
      const parent = i === max - 1 ? STMT_UID : chainUid(i + 1);
      fx.fm[chainUid(i)] = classFm(chainUid(i), `test__Chain${i}`, parent);
    }
    const { triples } = await convert(fx, STMT_OBJ(chainUid(0), "51"));
    expect(hasEdge(triples)).toBe(true);
  });

  /** C0 → … → C(cap) → exo__Statement: one hop beyond the cap. */
  function overCapChain(fx: Fixture): void {
    const max = WALK_DEPTH_CAP;
    for (let i = 0; i <= max; i++) {
      const parent = i === max ? STMT_UID : chainUid(i + 1);
      fx.fm[chainUid(i)] = classFm(chainUid(i), `test__Chain${i}`, parent);
    }
  }

  it(`S5b ${REQ} one hop beyond the cap gives NO edge`, async () => {
    const fx = baseFixture();
    overCapChain(fx);
    const { triples } = await convert(fx, STMT_OBJ(chainUid(0), "52"));
    expect(hasEdge(triples)).toBe(false);
  });

  it(`S5c ${REQ} stopping at the cap logs ONE warning that names the asset`, async () => {
    const fx = baseFixture();
    overCapChain(fx);
    const logger = makeLogger();
    const { file } = await convert(fx, STMT_OBJ(chainUid(0), "53"), { logger });
    expect(logger.warn.mock.calls).toHaveLength(1);
    expect(JSON.stringify(logger.warn.mock.calls[0])).toContain(file.path);
  });

  it(`S10 ${REQ} an asset WITHOUT the statement slots never walks its class hierarchy`, async () => {
    // The cost claim of the change: the walk runs only after the three slots
    // resolved. An ordinary asset on the same 17-hop chain would hit the cap and
    // warn if it were walked.
    const fx = baseFixture();
    overCapChain(fx);
    const logger = makeLogger();
    const plain: IFrontmatter = {
      exo__Asset_uid: "90000000-0000-4000-8000-000000000010",
      exo__Instance_class: [`[[${chainUid(0)}]]`],
      exo__Asset_label: "plain asset",
    };
    const { triples } = await convert(fx, plain, { logger });
    expect(logger.warn.mock.calls).toHaveLength(0);
    expect(hasEdge(triples)).toBe(false);
  });

  it(`S6 ${REQ} a cold class cache is read through the disk fallback`, async () => {
    const fx = baseFixture();
    // The metadataCache knows none of the class files (cold plugin start); only
    // getFrontmatterWithFallback can reach them. SubThesis is the asset's direct
    // target (pre-warmed by the converter); Thesis and exo__Statement are not.
    for (const uid of [STMT_UID, ASSET_UID, THESIS_UID, SUB_UID]) fx.cold.add(uid);
    const { triples } = await convert(fx, STMT_OBJ(SUB_UID, "06"), { withFallback: true });
    expect(hasEdge(triples)).toBe(true);
  });

  it(`S7 ${REQ} exactly exo__Statement keeps its edge when Instance_class is emitted as the class file IRI`, async () => {
    const fx = baseFixture();
    const { triples } = await convert(fx, STMT_OBJ(STMT_UID, "07"), { emitInstanceClassAsUid: true });
    expect(hasEdge(triples)).toBe(true);
  });

  it(`S9 ${REQ} control — exactly exo__Statement in the default emission mode gives the edge (unchanged path)`, async () => {
    const fx = baseFixture();
    const { triples } = await convert(fx, STMT_OBJ(STMT_UID, "09"));
    expect(hasEdge(triples)).toBe(true);
  });
});
