import { createTripleStoreDeclaredRanges } from "../../../src/services/DeclaredRangesResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import { Triple } from "../../../src/domain/models/rdf/Triple";

/**
 * Ticket 534a7a46 — the declared-range index `GroundingExecutor` reads so its
 * create_instance / property_set writes type a scalar by the DECLARATION
 * (CLI↔UI parity #3417).
 *
 * ⛔ THE FIXTURE MODELS THE LIVE EMISSION FORM, WHICH IS NOT THE OBVIOUS ONE.
 * Measured on vault-exodev 2026-09-20: a property definition's
 * `exo__Asset_label` reaches the store as a SYMBOLIC IRI in 478 of 485 cases —
 * `NoteToRDFConverter` substitutes class-shaped string literals with term IRIs
 * at that predicate (#2782 / #2959) — while `rdfs:label` is a literal for all
 * 485. The 7 literal `exo__Asset_label` cases are labels that do not parse as
 * `<prefix>__<Name>` at all. The nearest precedent fixture
 * (`RequiredPropertyResolver.test.ts`) seeds the label as a LITERAL only (0
 * RDFS mentions, 0 IRI-form labels in that file), so it exercises a shape the
 * live corpus almost never has; `seedDef` below seeds BOTH.
 *
 * ⛔ AND THE NAMESPACE IS LOAD-BEARING. The key is derived with
 * `iriToObsidianName` (→ `Namespace.fromTermIRI`), not with
 * `FrontmatterService.normalizeIRI`, which reverses through a static
 * nine-namespace map. Of the 104 property definitions whose range actually
 * types a scalar [vault-exodev], that map knows 23 (exo 9, pmbok 7, lit 4,
 * ems 3); the other 81 — flow 48, pmi 17, person 5, team 5, bot 3, exodev 3 —
 * it does not. So an axis written on `ems` or `exo` is GREEN UNDER BOTH
 * derivations and proves nothing about that 78 %: K1 uses `flow` (out of the
 * map) and K2 uses `ems` (in it) as its paired control, so the mutant that
 * swaps the derivation back reddens K1 and leaves K2 green — addressability
 * shown, not asserted.
 */

const REQ = "675cb0ab-b73d-4736-934d-6094e792af5d";
const EXO = Namespace.EXO;
const RDFS = Namespace.RDFS;
const XSD = "http://www.w3.org/2001/XMLSchema#";

let defCounter = 0;
function defFileIRI(): string {
  defCounter++;
  const n = defCounter.toString(16).padStart(12, "0");
  return `obsidian://vault/assetspaces/kitelev/exoas-x/x/00000000-0000-0000-0000-${n}.md`;
}

type LabelForm = "live" | "literal-only" | "iri-only" | "none";

/**
 * Seed one property definition.
 *
 * `labelForm`:
 *  - `live`         — `exo__Asset_label` as a symbolic IRI + `rdfs:label` literal
 *                     (478/485 of the live corpus).
 *  - `literal-only` — `exo__Asset_label` as a literal (the 7 live cases).
 *  - `iri-only`     — the symbolic IRI and NO `rdfs:label` (the inverse fallback).
 *  - `none`         — no label at all.
 */
function seedDef(
  triples: Triple[],
  opts: {
    prefix: string;
    localName: string;
    ranges: string[];
    labelForm: LabelForm;
    rangeAsIRI?: boolean;
    subject?: string;
  },
): string {
  const subject = opts.subject ?? defFileIRI();
  const subj = new IRI(subject);
  const termIRI = `https://exocortex.my/ontology/${opts.prefix}#${opts.localName}`;
  const label = `${opts.prefix}__${opts.localName}`;
  if (opts.labelForm === "live" || opts.labelForm === "iri-only") {
    triples.push(new Triple(subj, EXO.term("Asset_label"), new IRI(termIRI)));
  }
  if (opts.labelForm === "literal-only") {
    triples.push(new Triple(subj, EXO.term("Asset_label"), new Literal(label)));
  }
  if (opts.labelForm === "live") {
    triples.push(new Triple(subj, RDFS.term("label"), new Literal(label)));
  }
  for (const r of opts.ranges) {
    triples.push(
      new Triple(
        subj,
        EXO.term("Property_range"),
        opts.rangeAsIRI === true ? new IRI(r) : new Literal(r),
      ),
    );
  }
  return label;
}

async function storeOf(triples: Triple[]): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  return store;
}

describe("DeclaredRangesResolver — declared exo__Property_range by prefix__Name label (ticket 534a7a46)", () => {
  it(`K1 a definition in a namespace ABSENT from the static prefix map (flow) resolves its range @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    const key = seedDef(triples, {
      prefix: "flow",
      localName: "Stage_order",
      ranges: ["xsd:integer"],
      labelForm: "live",
    });
    expect(key).toBe("flow__Stage_order");
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    // The whole point: `flow` is one of the 81 of 104 the static map misses.
    expect(ranges.get("flow__Stage_order")).toEqual(["xsd:integer"]);
  });

  it(`K2 a definition in a namespace PRESENT in the static prefix map (ems) resolves too — the paired control @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "ems",
      localName: "Effort_votes",
      ranges: ["xsd:integer"],
      labelForm: "live",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    expect(ranges.get("ems__Effort_votes")).toEqual(["xsd:integer"]);
  });

  it(`K3 a definition whose exo__Asset_label is a LITERAL (the 7 live cases) resolves @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "pmi",
      localName: "Deliverable_count",
      ranges: ["xsd:decimal"],
      labelForm: "literal-only",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    expect(ranges.get("pmi__Deliverable_count")).toEqual(["xsd:decimal"]);
  });

  it(`K4 a definition with ONLY the symbolic label IRI and no rdfs:label resolves through the inverse @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "team",
      localName: "Member_headcount",
      ranges: ["xsd:integer"],
      labelForm: "iri-only",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    expect(ranges.get("team__Member_headcount")).toEqual(["xsd:integer"]);
  });

  it(`K5 the full W3C range IRI is carried through verbatim, as the CURIE literal is @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "bot",
      localName: "Message_telegramMessageId",
      ranges: [`${XSD}integer`],
      labelForm: "live",
      rangeAsIRI: true,
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    expect(ranges.get("bot__Message_telegramMessageId")).toEqual([
      `${XSD}integer`,
    ]);
  });

  it(`K17 a MULTI-VALUED range arrives whole, so scalarTypingForRange declines to type it @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "flow",
      localName: "Stage_either",
      ranges: ["xsd:integer", "xsd:string"],
      labelForm: "live",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    // Both values, in emission order — the resolver does not pick one. That is
    // what makes the writer's "exactly ONE datatype types a scalar" rule
    // enforceable downstream: a two-valued range must reach
    // `scalarTypingForRange` as two values so it can return undefined and the
    // shape rule keeps running (fail-open).
    // ⛤ SYNTHETIC, and measured so: multi-valued ranges are 0 / 0 / 0 across the
    // three vaults (2026-09-20), so no live definition exercises this. Written
    // because the accumulation guard is otherwise unpinnable — the first version
    // of this file had no multi-valued fixture and the mutant that collapses the
    // accumulation (MR6) reddened nothing.
    expect(ranges.get("flow__Stage_either")).toEqual([
      "xsd:integer",
      "xsd:string",
    ]);
  });

  it(`K6 a duplicated label keeps the FIRST definition, as PropertyNameValidator does @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    const first = defFileIRI();
    const second = defFileIRI();
    seedDef(triples, {
      prefix: "flow",
      localName: "Stage_twin",
      ranges: ["xsd:integer"],
      labelForm: "live",
      subject: first,
    });
    seedDef(triples, {
      prefix: "flow",
      localName: "Stage_twin",
      ranges: ["xsd:string"],
      labelForm: "live",
      subject: second,
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    // One entry, and it is the first subject's range — not a merge of the two.
    expect(ranges.get("flow__Stage_twin")).toEqual(["xsd:integer"]);
  });

  it(`K16 the IRI fallback resolves an IN-MAP namespace too — K4's paired control @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "ems",
      localName: "Effort_headcount",
      ranges: ["xsd:integer"],
      labelForm: "iri-only",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    // `ems` IS in FrontmatterService.IRI_PREFIX_MAP, so this axis is green under
    // BOTH inverses. It exists to make K4 ADDRESSABLE: the mutant that swaps
    // `iriToObsidianName` for the static-map reversal must redden K4 (team, out
    // of the map) and leave THIS one green. Without the pair, "the inverse is
    // the right one" would be asserted rather than shown.
    expect(ranges.get("ems__Effort_headcount")).toEqual(["xsd:integer"]);
  });

  it(`K7 a definition with NO resolvable label is absent from the map rather than crashing the read @req:${REQ}`, async () => {
    const triples: Triple[] = [];
    seedDef(triples, {
      prefix: "flow",
      localName: "Stage_unlabelled",
      ranges: ["xsd:integer"],
      labelForm: "none",
    });
    seedDef(triples, {
      prefix: "flow",
      localName: "Stage_labelled",
      ranges: ["xsd:string"],
      labelForm: "live",
    });
    const ranges = await createTripleStoreDeclaredRanges(
      await storeOf(triples),
    )();
    // Canary: the labelled neighbour IS there, so an empty map would not be
    // mistaken for "the unlabelled one was skipped" (the read did run).
    expect(ranges.get("flow__Stage_labelled")).toEqual(["xsd:string"]);
    expect(ranges.has("flow__Stage_unlabelled")).toBe(false);
    expect(ranges.size).toBe(1);
  });
});
