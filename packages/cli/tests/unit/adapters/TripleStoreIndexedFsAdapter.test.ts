/**
 * #4272 — @req:5ab3d237-cae9-498c-925c-6951b9c9c5db (AC2 / AC4 + Known limits).
 * `TripleStoreIndexedFsAdapter.findFilesByMetadata` must return EXACTLY what
 * `NodeFsAdapter.findFilesByMetadata` (the vault-wide scan it replaces) returns,
 * for every query the create-instance path issues — while never entering the
 * scan. The source is produced by the REAL loader (`NoteToRDFConverter` over
 * `FileSystemVaultAdapter`, explicit triples + the files it skipped) so the
 * fixture carries the real value-form seam: TBox-form labels become class
 * IRIs, `[[uid]]` aliases become file or class IRIs, numbers become typed
 * literals, a label-less asset gets a basename-synthesised label, an asset
 * with an empty optional property is skipped whole.
 *
 * Axes (names are the mutant driver's machine key — `› (U\d+\w*) `):
 *   U1  parity per (key, value) — same set AND order as the scan on every
 *       distinct value of the three keys, incl. TBox-form label, quoted,
 *       wikilink alias (to a class file and to a plain file), case-different,
 *       numeric, ISO date-time, two-key query, no match, dangling-link literal
 *   U2  no scan: getMarkdownFiles never called, scanFallbacks 0, candidateReads
 *       bounded by the number of candidates (not ≈ N files)
 *   U3  delegation: an unknown key / an empty query value / an empty query go
 *       to the base scan (parity) and are counted
 *   U4  verification: a store-only label (basename-synthesised for a label-less
 *       asset) is a candidate the scan would NOT return → []
 *   U5  AC4 explicit-only: an alias the production store carries only in its
 *       inferred layer (prototype-chain materialisation, same default graph)
 *       is not a candidate — one candidate read, not N
 *   U6  duplicates: same order as the (now sorted) scan, independent of the
 *       source's insertion order
 *   U7  findFileByUID parity (+ quoted uid) and unreadable-candidate skip
 *   U8  a loader-skipped asset (invariant violation → 0 triples) is still found
 *       — read once from `zeroTriplePaths` — identical to the scan
 *   U9  own writes: createFile / updateFile / deleteFile / renameFile through
 *       the adapter are visible to the next lookup (as they are to the scan)
 *   U10 value-form traps: prefixed `exo__Asset_aliases:` key, `[[uid|alias]]`,
 *       `[[Label]]`-by-alias link, dot-segment path — parity with the scan
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
  Namespace,
  Triple,
  IRI,
  Literal,
  vaultPathToIRI,
} from "@kitelev/exocortex-core";
import { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  TripleStoreIndexedFsAdapter,
  type TripleStoreIndexSource,
} from "../../../src/adapters/TripleStoreIndexedFsAdapter.js";

const CLASS_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task (canonical)
const STATUS_UID = "11111111-1111-4111-8111-111111111111";
const QUOTED_UID = "22222222-2222-4222-8222-222222222222";
const WIKI_UID = "33333333-3333-4333-8333-333333333333";
const LABELLESS_UID = "44444444-4444-4444-8444-444444444444";
const SKIPPED_UID = "55555555-5555-4555-8555-555555555555";
const DUP_A_UID = "66666666-6666-4666-8666-666666666666";
const DUP_B_UID = "77777777-7777-4777-8777-777777777777";
const CASE_UID = "88888888-8888-4888-8888-888888888888";
const NUM_UID = "99999999-9999-4999-8999-999999999999";
const DATE_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VANISH_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DANGLING_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROTO_UID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INST_UID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PREFIXED_ALIAS_UID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PIPED_UID = "12121212-1212-4121-8121-121212121212";
const BYALIAS_UID = "13131313-1313-4131-8131-131313131313";
const HIDDEN_UID = "14141414-1414-4141-8141-141414141414";

const CLASS_REF = `exo__Instance_class:\n  - "[[${CLASS_UID}]]"`;

let vault: string;
let source: TripleStoreIndexSource;
let explicit: Triple[];

function write(
  rel: string,
  frontmatter: string | null,
  body = "Body.\n",
): void {
  const full = join(vault, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  const text =
    frontmatter === null ? body : `---\n${frontmatter}\n---\n${body}`;
  writeFileSync(full, text, "utf-8");
}

/** The loader's product, exactly as `loadVaultTriples` hands it to `apply`. */
async function buildSource(): Promise<{
  source: TripleStoreIndexSource;
  explicit: Triple[];
}> {
  const vaultAdapter = new FileSystemVaultAdapter(vault);
  const converter = new NoteToRDFConverter(vaultAdapter);
  // Same population rule as `loadVaultTriples` (full parse) and the cache
  // entries: every walked file that committed no triples.
  const files = vaultAdapter.getAllFiles();
  const committed = new Map<string, number>();
  const { triples } = await converter.convertVaultWithValidation({
    strict: false,
    files,
    onFileTriples: (file, own) => {
      committed.set(file.path, own.length);
    },
  });
  const zeroTriplePaths = files
    .filter((f) => (committed.get(f.path) ?? 0) === 0)
    .map((f) => f.path);
  return {
    source: { explicitTriples: triples, zeroTriplePaths },
    explicit: triples,
  };
}

beforeAll(async () => {
  vault = join(
    tmpdir(),
    `tsindex-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(vault, { recursive: true });
  // Class TBox: TBox-form label + aliases (the converter emits the class IRI).
  write(
    `tbox/${CLASS_UID}.md`,
    [
      `exo__Asset_uid: ${CLASS_UID}`,
      `exo__Asset_label: ems__Task`,
      `aliases:`,
      `  - ems__Task`,
      `  - Task`,
      `exo__Instance_class:`,
      `  - "[[exo__Class]]"`,
    ].join("\n"),
  );
  // Status enum: TBox-form label, resolved by label in the create path.
  write(
    `tbox/${STATUS_UID}.md`,
    [
      `exo__Asset_uid: ${STATUS_UID}`,
      `exo__Asset_label: ems__EffortStatusBacklog`,
      `exo__Instance_class:`,
      `  - "[[exo__Class]]"`,
    ].join("\n"),
  );
  // Quoted YAML strings (the scan strips the quotes, YAML already did).
  // The two `Dup Alias` forms normalise to ONE value (`[ ]` stripped): the
  // scan lists the file once — the index must not list its path twice.
  write(
    `a/${QUOTED_UID}.md`,
    [
      `exo__Asset_uid: "${QUOTED_UID}"`,
      `exo__Asset_label: "Quoted Label"`,
      `aliases:`,
      `  - QL`,
      `  - Dup Alias`,
      `  - "[Dup Alias]"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Alias carrying a bare [[uid]] wikilink (→ file IRI in the store).
  write(
    `a/${WIKI_UID}.md`,
    [
      `exo__Asset_uid: ${WIKI_UID}`,
      `exo__Asset_label: Wiki alias carrier`,
      `aliases:`,
      `  - "[[${CLASS_UID}]]"`,
      `  - "[[${QUOTED_UID}]]"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Unresolvable wikilink-form label → the converter keeps it as a literal WITH brackets.
  write(
    `a/${DANGLING_UID}.md`,
    [
      `exo__Asset_uid: ${DANGLING_UID}`,
      `exo__Asset_label: "[[Dangling label link]]"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Label-less asset: the converter synthesises exo:Asset_label = basename.
  write(
    `a/${LABELLESS_UID}.md`,
    [`exo__Asset_uid: ${LABELLESS_UID}`, CLASS_REF].join("\n"),
  );
  // Loader-skipped asset (empty optional property → invariant violation → 0 triples).
  write(
    `a/${SKIPPED_UID}.md`,
    [
      `exo__Asset_uid: ${SKIPPED_UID}`,
      `exo__Asset_label: Skipped by loader`,
      `ems__Effort_parent:`,
      CLASS_REF,
    ].join("\n"),
  );
  // Duplicate label in two folders whose names invert creation order.
  write(
    `z/${DUP_A_UID}.md`,
    [
      `exo__Asset_uid: ${DUP_A_UID}`,
      `exo__Asset_label: Duplicate Label`,
      CLASS_REF,
    ].join("\n"),
  );
  write(
    `b/${DUP_B_UID}.md`,
    [
      `exo__Asset_uid: ${DUP_B_UID}`,
      `exo__Asset_label: Duplicate Label`,
      CLASS_REF,
    ].join("\n"),
  );
  // Case-different label (no case folding anywhere).
  write(
    `a/${CASE_UID}.md`,
    [
      `exo__Asset_uid: ${CASE_UID}`,
      `exo__Asset_label: duplicate label`,
      CLASS_REF,
    ].join("\n"),
  );
  // Numeric label (→ xsd:decimal literal) and quoted ISO date-time label (→ xsd:dateTime).
  write(
    `a/${NUM_UID}.md`,
    [`exo__Asset_uid: ${NUM_UID}`, `exo__Asset_label: 42`, CLASS_REF].join(
      "\n",
    ),
  );
  write(
    `a/${DATE_UID}.md`,
    [
      `exo__Asset_uid: ${DATE_UID}`,
      `exo__Asset_label: "2026-01-02T03:04:05"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Asset that will vanish after the store is built (U7).
  write(
    `a/${VANISH_UID}.md`,
    [
      `exo__Asset_uid: ${VANISH_UID}`,
      `exo__Asset_label: Vanishing`,
      CLASS_REF,
    ].join("\n"),
  );
  // Prototype with an alias + an instance inheriting it through the prototype chain (U5).
  write(
    `p/${PROTO_UID}.md`,
    [
      `exo__Asset_uid: ${PROTO_UID}`,
      `exo__Asset_label: Proto`,
      `aliases:`,
      `  - TaskProto`,
      `exo__Instance_class:`,
      `  - "[[ems__TaskPrototype]]"`,
    ].join("\n"),
  );
  write(
    `p/${INST_UID}.md`,
    [
      `exo__Asset_uid: ${INST_UID}`,
      `exo__Asset_label: Inst`,
      `exo__Asset_prototype: "[[${PROTO_UID}]]"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Prefixed alias key: the converter reads it as exo:Asset_aliases, the scan reads only `aliases` (U10).
  write(
    `a/${PREFIXED_ALIAS_UID}.md`,
    [
      `exo__Asset_uid: ${PREFIXED_ALIAS_UID}`,
      `exo__Asset_label: Prefixed alias carrier`,
      `exo__Asset_aliases:`,
      `  - PrefixedOnly`,
      CLASS_REF,
    ].join("\n"),
  );
  // `[[uid|alias]]` alias (the scan's normalised value keeps the `|alias`) and a `[[QL]]` alias
  // that resolves BY ALIAS to the quoted asset (the scan sees the text `QL`, the store a file IRI).
  write(
    `a/${PIPED_UID}.md`,
    [
      `exo__Asset_uid: ${PIPED_UID}`,
      `exo__Asset_label: Piped alias carrier`,
      `aliases:`,
      `  - "[[${CLASS_UID}|Task]]"`,
      CLASS_REF,
    ].join("\n"),
  );
  write(
    `a/${BYALIAS_UID}.md`,
    [
      `exo__Asset_uid: ${BYALIAS_UID}`,
      `exo__Asset_label: By-alias link carrier`,
      `aliases:`,
      `  - "[[QL]]"`,
      CLASS_REF,
    ].join("\n"),
  );
  // Dot-FILE in a normal folder: the loader's walk includes it (it skips only dot-DIRECTORIES),
  // the scan's glob (dot: false) does not.
  write(
    `a/.hidden-${HIDDEN_UID}.md`,
    [
      `exo__Asset_uid: ${HIDDEN_UID}`,
      `exo__Asset_label: Hidden asset`,
      CLASS_REF,
    ].join("\n"),
  );
  // No frontmatter at all.
  write(`a/plain-note.md`, null, "Just prose, no frontmatter.\n");
  ({ source, explicit } = await buildSource());
});

afterAll(() => {
  rmSync(vault, { recursive: true, force: true });
});

function fresh(src: TripleStoreIndexSource = source): {
  scan: NodeFsAdapter;
  idx: TripleStoreIndexedFsAdapter;
} {
  return {
    scan: new NodeFsAdapter(vault),
    idx: new TripleStoreIndexedFsAdapter(vault, src),
  };
}

/** Same set AND same order as the scan (the scan's order is now the sorted path order). */
async function parity(query: Record<string, unknown>): Promise<string[]> {
  const { scan, idx } = fresh();
  const expected = await scan.findFilesByMetadata(query);
  const got = await idx.findFilesByMetadata(query);
  expect(got).toEqual(expected);
  return got;
}

const REQ = "@req:5ab3d237-cae9-498c-925c-6951b9c9c5db";

describe(`TripleStoreIndexedFsAdapter — identity with the scan (#4272, req 5ab3d237) ${REQ}`, () => {
  it(`U1 parity per (key, value): TBox-form label resolves to the class file ${REQ}`, async () => {
    expect(await parity({ exo__Asset_label: "ems__Task" })).toEqual([
      `tbox/${CLASS_UID}.md`,
    ]);
    expect(
      await parity({ exo__Asset_label: "ems__EffortStatusBacklog" }),
    ).toEqual([`tbox/${STATUS_UID}.md`]);
  });

  it(`U1a parity: aliases — TBox-form alias, plain alias, and a bare [[uid]] wikilink alias ${REQ}`, async () => {
    expect(await parity({ aliases: "ems__Task" })).toEqual([
      `tbox/${CLASS_UID}.md`,
    ]);
    expect(await parity({ aliases: "Task" })).toEqual([`tbox/${CLASS_UID}.md`]);
    // The scan strips `[[ ]]` from the stored alias, so the bare uid matches it.
    expect(await parity({ aliases: CLASS_UID })).toEqual([`a/${WIKI_UID}.md`]);
    // … and a [[uid]] alias to a NON-class file is emitted as a file IRI — same bare-uid match.
    expect(await parity({ aliases: QUOTED_UID })).toEqual([`a/${WIKI_UID}.md`]);
    // Two alias forms that normalise to the same value → the path ONCE (index dedup = scan).
    expect(await parity({ aliases: "Dup Alias" })).toEqual([`a/${QUOTED_UID}.md`]);
  });

  it(`U1d parity: an unresolvable wikilink-form label ([[…]] kept as a literal) matches its bracket-stripped text ${REQ}`, async () => {
    expect(await parity({ exo__Asset_label: "Dangling label link" })).toEqual([
      `a/${DANGLING_UID}.md`,
    ]);
    expect(
      await parity({ exo__Asset_label: "[[Dangling label link]]" }),
    ).toEqual([`a/${DANGLING_UID}.md`]);
  });

  it(`U1b parity: quoted values, numeric and ISO date-time labels, case is NOT folded ${REQ}`, async () => {
    expect(await parity({ exo__Asset_label: "Quoted Label" })).toEqual([
      `a/${QUOTED_UID}.md`,
    ]);
    expect(await parity({ exo__Asset_uid: QUOTED_UID })).toEqual([
      `a/${QUOTED_UID}.md`,
    ]);
    expect(await parity({ exo__Asset_label: 42 })).toEqual([`a/${NUM_UID}.md`]);
    expect(await parity({ exo__Asset_label: "42" })).toEqual([
      `a/${NUM_UID}.md`,
    ]);
    expect(await parity({ exo__Asset_label: "2026-01-02T03:04:05" })).toEqual([
      `a/${DATE_UID}.md`,
    ]);
    expect(await parity({ exo__Asset_label: "DUPLICATE LABEL" })).toEqual([]);
    expect(await parity({ exo__Asset_label: "duplicate label" })).toEqual([
      `a/${CASE_UID}.md`,
    ]);
  });

  it(`U1c parity: two-key query intersects (one candidate read, not the union); no match is [] on both sides ${REQ}`, async () => {
    expect(
      await parity({
        exo__Asset_label: "Duplicate Label",
        exo__Asset_uid: DUP_B_UID,
      }),
    ).toEqual([`b/${DUP_B_UID}.md`]);
    const { idx } = fresh();
    await idx.findFilesByMetadata({
      exo__Asset_label: "Duplicate Label",
      exo__Asset_uid: DUP_B_UID,
    });
    expect(idx.stats.candidateReads).toBe(1);
    expect(
      await parity({
        exo__Asset_label: "Duplicate Label",
        exo__Asset_uid: QUOTED_UID,
      }),
    ).toEqual([]);
    expect(
      await parity({ exo__Asset_label: "No such label anywhere" }),
    ).toEqual([]);
    expect(
      await parity({ exo__Asset_uid: "00000000-0000-4000-8000-000000000000" }),
    ).toEqual([]);
  });

  it(`U2 no scan: getMarkdownFiles is never called, no fallback, reads bounded by candidates ${REQ}`, async () => {
    const { idx } = fresh();
    const walk = jest.spyOn(idx, "getMarkdownFiles");
    const meta = jest.spyOn(idx, "getFileMetadata");
    await idx.findFilesByMetadata({ exo__Asset_label: "ems__Task" });
    await idx.findFilesByMetadata({ exo__Asset_uid: CLASS_UID });
    await idx.findFilesByMetadata({ aliases: "Task" });
    await idx.findFilesByMetadata({ exo__Asset_label: "Duplicate Label" });
    await idx.findFilesByMetadata({ exo__Asset_label: "nothing here" });
    expect(walk).not.toHaveBeenCalled();
    expect(idx.stats.scanFallbacks).toBe(0);
    expect(idx.stats.indexedLookups).toBe(5);
    // 1 + 1 + 1 + 2 (duplicate) + 0 candidates — never ≈ the 20+ files of the vault.
    expect(idx.stats.candidateReads).toBe(5);
    // + the two zero-triple files read ONCE while building the index (U8):
    // the invariant-skipped asset and the frontmatter-less note.
    expect(idx.stats.zeroTripleReads).toBe(2);
    expect(meta).toHaveBeenCalledTimes(5 + 2);
    const readPaths = meta.mock.calls.map((c) => String(c[0]));
    expect(readPaths).not.toContain(`a/${QUOTED_UID}.md`);
    // read at build only — never again as a candidate of any of the 5 lookups
    expect(readPaths.filter((p) => p === `a/plain-note.md`)).toHaveLength(1);
  });

  it(`U3 delegation: unknown key, empty query value and empty query go to the base scan (parity) ${REQ}`, async () => {
    const { idx } = fresh();
    const walk = jest.spyOn(idx, "getMarkdownFiles");
    const byOtherKey = await parity({
      exo__Instance_class: `[[${CLASS_UID}]]`,
    });
    expect(byOtherKey.length).toBeGreaterThan(0);
    // An empty value matches every file LACKING the key — only the scan can answer that.
    const byEmpty = await parity({ exo__Asset_label: "" });
    expect(byEmpty).toContain(`a/${LABELLESS_UID}.md`);
    expect(byEmpty).toContain(`a/plain-note.md`);
    await idx.findFilesByMetadata({});
    await idx.findFilesByMetadata({ exo__Asset_label: "" });
    await idx.findFilesByMetadata({ exo__Instance_class: `[[${CLASS_UID}]]` });
    expect(idx.stats.scanFallbacks).toBe(3);
    expect(idx.stats.indexedLookups).toBe(0);
    expect(walk).toHaveBeenCalledTimes(3);
  });

  it(`U4 verification: a basename-synthesised (store-only) label is NOT a match ${REQ}`, async () => {
    // The converter synthesised exo:Asset_label = basename for the label-less asset …
    const subject = vaultPathToIRI(`a/${LABELLESS_UID}.md`);
    const synthesised = explicit.filter(
      (t) =>
        t.subject instanceof IRI &&
        t.subject.value === subject &&
        t.predicate.value === Namespace.EXO.term("Asset_label").value,
    );
    expect(synthesised.map((t) => (t.object as Literal).value)).toEqual([
      LABELLESS_UID,
    ]);
    // … but the file's own frontmatter has no label, so the scan returns nothing — and so must the index.
    const { idx } = fresh();
    expect(await parity({ exo__Asset_label: LABELLESS_UID })).toEqual([]);
    expect(
      await idx.findFilesByMetadata({ exo__Asset_label: LABELLESS_UID }),
    ).toEqual([]);
    expect(idx.stats.candidateReads).toBe(1); // the candidate was read and rejected
  });

  it(`U5 AC4 explicit-only: an inherited alias (inferred layer, same default graph in the CLI store) is not a candidate ${REQ}`, async () => {
    // The production store holds explicit + inferred in ONE array (`apply.ts` addAll) —
    // the instance inherits the prototype's alias through the prototype chain:
    const inherited = new Triple(
      new IRI(vaultPathToIRI(`p/${INST_UID}.md`)),
      Namespace.EXO.term("Asset_aliases"),
      new Literal("TaskProto"),
    );
    const store = new InMemoryTripleStore();
    await store.addAll([...explicit, inherited]);
    expect(
      await store.match(
        new IRI(vaultPathToIRI(`p/${INST_UID}.md`)),
        Namespace.EXO.term("Asset_aliases"),
      ),
    ).toHaveLength(1);
    // The adapter is fed the EXPLICIT boundary only (what loadVaultTriples reports) …
    const { scan, idx } = fresh();
    expect(await idx.findFilesByMetadata({ aliases: "TaskProto" })).toEqual([
      `p/${PROTO_UID}.md`,
    ]);
    expect(await scan.findFilesByMetadata({ aliases: "TaskProto" })).toEqual([
      `p/${PROTO_UID}.md`,
    ]);
    // … so the instance was never even read: exactly one candidate, the prototype.
    expect(idx.stats.candidateReads).toBe(1);
  });

  it(`U6 duplicates: same set as the scan, deterministic path order ${REQ}`, async () => {
    const got = await parity({ exo__Asset_label: "Duplicate Label" });
    expect(got).toEqual([`b/${DUP_B_UID}.md`, `z/${DUP_A_UID}.md`]);
    // Stable across adapters / calls (the scan's own order is glob-walk order, not stable) —
    // and independent of the store's insertion order: a store fed the same triples in
    // REVERSE order must answer with the same path order.
    const again = await new TripleStoreIndexedFsAdapter(
      vault,
      source,
    ).findFilesByMetadata({ exo__Asset_label: "Duplicate Label" });
    expect(again).toEqual(got);
    const reversed: TripleStoreIndexSource = {
      explicitTriples: [...explicit].reverse(),
      zeroTriplePaths: source.zeroTriplePaths,
    };
    const viaReversed = await new TripleStoreIndexedFsAdapter(
      vault,
      reversed,
    ).findFilesByMetadata({ exo__Asset_label: "Duplicate Label" });
    expect(viaReversed).toEqual(got);
  });

  it(`U7 findFileByUID parity (bare + quoted) and an unreadable candidate is skipped like the scan ${REQ}`, async () => {
    const { scan, idx } = fresh();
    expect(await idx.findFileByUID(CLASS_UID)).toBe(
      await scan.findFileByUID(CLASS_UID),
    );
    expect(await idx.findFileByUID(QUOTED_UID)).toBe(`a/${QUOTED_UID}.md`);
    expect(await idx.findFileByUID(QUOTED_UID)).toBe(
      await scan.findFileByUID(QUOTED_UID),
    );
    rmSync(join(vault, `a/${VANISH_UID}.md`));
    try {
      expect(
        await idx.findFilesByMetadata({ exo__Asset_uid: VANISH_UID }),
      ).toEqual([]);
      expect(
        await scan.findFilesByMetadata({ exo__Asset_uid: VANISH_UID }),
      ).toEqual([]);
    } finally {
      write(
        `a/${VANISH_UID}.md`,
        [
          `exo__Asset_uid: ${VANISH_UID}`,
          `exo__Asset_label: Vanishing`,
          CLASS_REF,
        ].join("\n"),
      );
    }
  });

  it(`U8 a loader-skipped asset (invariant violation → 0 triples) is found through zeroTriplePaths — identical to the scan, read once ${REQ}`, async () => {
    const { scan, idx } = fresh();
    // The population rule is the cache's: every walked file that committed no
    // triples — the invariant-skipped asset AND the frontmatter-less note (a
    // cache entry with `triples: []` for each). Both are read once at build.
    expect([...source.zeroTriplePaths].sort()).toEqual([
      `a/${SKIPPED_UID}.md`,
      `a/plain-note.md`,
    ]);
    expect(
      explicit.some(
        (t) =>
          t.subject instanceof IRI &&
          t.subject.value === vaultPathToIRI(`a/${SKIPPED_UID}.md`),
      ),
    ).toBe(false);
    expect(
      await scan.findFilesByMetadata({ exo__Asset_uid: SKIPPED_UID }),
    ).toEqual([`a/${SKIPPED_UID}.md`]);
    expect(
      await idx.findFilesByMetadata({ exo__Asset_uid: SKIPPED_UID }),
    ).toEqual([`a/${SKIPPED_UID}.md`]);
    expect(
      await idx.findFilesByMetadata({ exo__Asset_label: "Skipped by loader" }),
    ).toEqual([`a/${SKIPPED_UID}.md`]);
    expect(idx.stats.zeroTripleReads).toBe(2);
    // and not on every lookup: the two lookups above cost two candidate reads, two zero-triple reads (build)
    expect(idx.stats.candidateReads).toBe(2);
  });

  it(`U9 own writes through the adapter are visible to the next lookup — as they are to the scan ${REQ}`, async () => {
    const NEW_UID = "15151515-1515-4151-8151-151515151515";
    const { scan, idx } = fresh();
    const rel = `w/${NEW_UID}.md`;
    const body = (label: string) =>
      `---\nexo__Asset_uid: ${NEW_UID}\nexo__Asset_label: ${label}\n${CLASS_REF}\n---\nBody.\n`;
    try {
      expect(
        await idx.findFilesByMetadata({ exo__Asset_uid: NEW_UID }),
      ).toEqual([]);
      await idx.createFile(rel, body("Fresh label"));
      expect(
        await idx.findFilesByMetadata({ exo__Asset_uid: NEW_UID }),
      ).toEqual([rel]);
      expect(
        await idx.findFilesByMetadata({ exo__Asset_label: "Fresh label" }),
      ).toEqual(
        await scan.findFilesByMetadata({ exo__Asset_label: "Fresh label" }),
      );
      // Each own write also RETIRES the old keys (`forget`): a stale key would
      // survive the frontmatter verdict unseen (the read says "no match" / the
      // file is gone), so the counter is what locks it — the old value must
      // cost ZERO candidate reads, the live value exactly one.
      const readsBefore = () => idx.stats.candidateReads;
      await idx.updateFile(rel, body("Renamed label"));
      let r0 = readsBefore();
      expect(
        await idx.findFilesByMetadata({ exo__Asset_label: "Fresh label" }),
      ).toEqual([]);
      expect(idx.stats.candidateReads - r0).toBe(0);
      r0 = readsBefore();
      expect(
        await idx.findFilesByMetadata({ exo__Asset_label: "Renamed label" }),
      ).toEqual([rel]);
      expect(idx.stats.candidateReads - r0).toBe(1);
      await idx.renameFile(rel, `w2/${NEW_UID}.md`);
      r0 = readsBefore();
      expect(
        await idx.findFilesByMetadata({ exo__Asset_uid: NEW_UID }),
      ).toEqual([`w2/${NEW_UID}.md`]);
      expect(idx.stats.candidateReads - r0).toBe(1); // the old path is not a candidate any more
      await idx.deleteFile(`w2/${NEW_UID}.md`);
      r0 = readsBefore();
      expect(
        await idx.findFilesByMetadata({ exo__Asset_uid: NEW_UID }),
      ).toEqual([]);
      expect(idx.stats.candidateReads - r0).toBe(0); // forgotten, not "read and found vanished"
      expect(
        await scan.findFilesByMetadata({ exo__Asset_uid: NEW_UID }),
      ).toEqual([]);
    } finally {
      rmSync(join(vault, "w"), { recursive: true, force: true });
      rmSync(join(vault, "w2"), { recursive: true, force: true });
    }
  });

  it(`U10 value-form traps: prefixed exo__Asset_aliases, [[uid|alias]], [[Label]]-by-alias, dot-segment path — parity ${REQ}`, async () => {
    // exo__Asset_aliases: → exo:Asset_aliases in the store, but the scan reads only `aliases` → no match on either side.
    expect(await parity({ aliases: "PrefixedOnly" })).toEqual([]);
    // [[uid|alias]] normalises to `uid|alias` in the scan — neither the bare uid nor the alias
    // matches it there, and the index (a candidate via the class file's uid) agrees after the verdict.
    expect(await parity({ aliases: CLASS_UID })).toEqual([`a/${WIKI_UID}.md`]);
    expect(await parity({ aliases: "Task" })).toEqual([`tbox/${CLASS_UID}.md`]);
    // [[QL]] resolves BY ALIAS to the quoted asset → file IRI in the store; the scan sees the text `QL`
    // (the quoted asset carries QL as its own alias, the carrier as a link — both match `QL`).
    expect(await parity({ aliases: "QL" })).toEqual([
      `a/${BYALIAS_UID}.md`,
      `a/${QUOTED_UID}.md`,
    ]);
    // A dot-segment path is in the loader's population but outside the scan's (glob dot: false) — and
    // outside the index's answers: the loader DID emit its triples …
    expect(
      explicit.some(
        (t) =>
          t.subject instanceof IRI &&
          t.subject.value === vaultPathToIRI(`a/.hidden-${HIDDEN_UID}.md`),
      ),
    ).toBe(true);
    expect(await parity({ exo__Asset_label: "Hidden asset" })).toEqual([]);
    expect(await parity({ exo__Asset_uid: HIDDEN_UID })).toEqual([]);
  });
});
