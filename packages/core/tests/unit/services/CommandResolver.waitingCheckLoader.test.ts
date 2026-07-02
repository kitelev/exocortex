/**
 * CommandResolver loader-stage coverage for the ems__WaitingCheckTask feature
 * (req 915b20b2). Production-shape: the grounding is loaded FROM the triple
 * store via `CommandResolver.loadCommand` (the real plugin + CLI loader path),
 * NOT a hand-injected GroundingDefinition — so it catches the two multi-parser
 * loader gaps a hand-injected fixture masks:
 *
 *  1. `exocmd__Grounding_cloneTargetBody` — read by GroundingFrontmatterParser
 *     (CLI-BDD/tests only) but NOT by the production loader
 *     `loadGroundingDefinition` → the body clone was inert in every real apply.
 *  2. `$tomorrow` SubstitutionToken — the `tomorrow` resolver exists in
 *     SubstitutionResolverRegistry but was absent from CommandResolver's
 *     KNOWN_SUBSTITUTION_RESOLVER_IDS + PARSE_TIME_RESOLVERS whitelists → a
 *     parameterless `$tomorrow` PD value fell back to `"[[<uid>]]"` wikilink
 *     form instead of resolving to a date.
 *
 * Revert-verify ([[integration-test-revert-verify]]): reverting the loader read
 * of `Grounding_cloneTargetBody` makes AC#1 RED; removing `"tomorrow"` from the
 * whitelists makes AC#2 RED. Restored → GREEN.
 *
 * @req:915b20b2-e0d7-4198-80c0-5561293149f0
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";

const CREATE_INSTANCE_TYPE_UID = "4367e2d6-6c92-450a-becb-abce1fb07682";

const PROP_PLANNED_UID = "7f773e3e-54d0-426b-98c5-5b75d01695cb"; // ems__Effort_plannedStartTimestamp
const TOKEN_TOMORROW_UID = "d8d07c5b-3e73-4c9a-aa11-471263d527ae"; // $tomorrow
const PD_PLANNED_UID = "aac7c7cd-8b70-4562-9290-d870f3e28551";
const GROUNDING_UID = "af871e36-b8be-45b3-b80b-3a57c1d21c41";
const COMMAND_UID = "0f8393bc-5ae7-4041-a10f-8651e407345e";

function iri(uid: string): IRI {
  return new IRI(`obsidian://vault/${uid}.md`);
}

async function addLabelled(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  await store.addAll([
    new Triple(iri(uid), Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(iri(uid), Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

async function addCommand(store: InMemoryTripleStore): Promise<void> {
  await store.addAll([
    new Triple(iri(COMMAND_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(iri(COMMAND_UID), Namespace.EXO.term("Asset_uid"), new Literal(COMMAND_UID)),
    new Triple(iri(COMMAND_UID), Namespace.EXO.term("Asset_label"), new Literal("Следующая итерация")),
    new Triple(
      iri(COMMAND_UID),
      Namespace.EXOCMD.term("Command_grounding"),
      iri(GROUNDING_UID),
    ),
  ]);
}

/** create_instance grounding; `cloneTargetBody`/`propertyDefault` are optional. */
async function addGrounding(
  store: InMemoryTripleStore,
  opts: { cloneTargetBody?: boolean; propertyDefaultRefs?: string[] },
): Promise<void> {
  const triples: Triple[] = [
    new Triple(iri(GROUNDING_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(iri(GROUNDING_UID), Namespace.EXO.term("Asset_uid"), new Literal(GROUNDING_UID)),
    new Triple(iri(GROUNDING_UID), Namespace.EXO.term("Asset_label"), new Literal("Create next iteration")),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(`[[${CREATE_INSTANCE_TYPE_UID}]]`),
    ),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXOCMD.term("Grounding_targetClass"),
      new Literal("ems__WaitingCheckTask"),
    ),
    new Triple(
      iri(GROUNDING_UID),
      Namespace.EXOCMD.term("Grounding_targetFolder"),
      new Literal("$targetFolder"),
    ),
  ];
  if (opts.cloneTargetBody !== undefined) {
    triples.push(
      new Triple(
        iri(GROUNDING_UID),
        Namespace.EXOCMD.term("Grounding_cloneTargetBody"),
        new Literal(String(opts.cloneTargetBody)),
      ),
    );
  }
  for (const ref of opts.propertyDefaultRefs ?? []) {
    triples.push(
      new Triple(
        iri(GROUNDING_UID),
        Namespace.EXOCMD.term("Grounding_propertyDefault"),
        iri(ref),
      ),
    );
  }
  await store.addAll(triples);
}

describe("CommandResolver — ems__WaitingCheckTask loader stage (req 915b20b2)", () => {
  let store: InMemoryTripleStore;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    resolver = new CommandResolver(store);
  });

  // AC#1 (HIGH#1) — the production loader reads Grounding_cloneTargetBody.
  it("loads cloneTargetBody=true from the Grounding_cloneTargetBody predicate", async () => {
    await addGrounding(store, { cloneTargetBody: true });
    await addCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    expect(cmd!.grounding.cloneTargetBody).toBe(true);
  });

  // AC#1 control — absent predicate → undefined (backward-compat, no clone).
  it("leaves cloneTargetBody undefined when the predicate is absent", async () => {
    await addGrounding(store, {});
    await addCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    expect(cmd!.grounding.cloneTargetBody).toBeUndefined();
  });

  // AC#2 (CODE#3) — a $tomorrow SubstitutionToken PD resolves to a date, not a
  // wikilink fallback.
  it("resolves a $tomorrow SubstitutionToken PropertyDefault to tomorrow's YYYY-MM-DD (not a wikilink)", async () => {
    await addLabelled(store, PROP_PLANNED_UID, "ems__Effort_plannedStartTimestamp");
    await store.addAll([
      new Triple(iri(TOKEN_TOMORROW_UID), Namespace.EXO.term("Asset_uid"), new Literal(TOKEN_TOMORROW_UID)),
      new Triple(iri(TOKEN_TOMORROW_UID), Namespace.EXO.term("Asset_label"), new Literal("$tomorrow")),
      new Triple(
        iri(TOKEN_TOMORROW_UID),
        Namespace.EXO.term("Instance_class"),
        Namespace.EXOCMD.term("SubstitutionToken"),
      ),
      new Triple(
        iri(TOKEN_TOMORROW_UID),
        Namespace.EXOCMD.term("SubstitutionToken_resolver"),
        new Literal("tomorrow"),
      ),
    ]);
    await store.addAll([
      new Triple(iri(PD_PLANNED_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("PropertyDefault")),
      new Triple(iri(PD_PLANNED_UID), Namespace.EXO.term("Asset_uid"), new Literal(PD_PLANNED_UID)),
      new Triple(iri(PD_PLANNED_UID), Namespace.EXOCMD.term("PropertyDefault_property"), iri(PROP_PLANNED_UID)),
      new Triple(iri(PD_PLANNED_UID), Namespace.EXOCMD.term("PropertyDefault_value"), iri(TOKEN_TOMORROW_UID)),
    ]);
    await addGrounding(store, { cloneTargetBody: true, propertyDefaultRefs: [PD_PLANNED_UID] });
    await addCommand(store);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    const value = cmd!.grounding.propertyDefault![0].value;
    // Resolved to a bare date (not the `"[[<uid>]]"` wikilink fallback).
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(value)).not.toContain("[[");
    // ...and it is a FUTURE date (tomorrow), strictly after today — proving it
    // resolved to today+1, not today. Lexicographic YYYY-MM-DD compare is
    // clock-flake-safe (no exact-tomorrow race at UTC midnight).
    const today = new Date().toISOString().slice(0, 10);
    expect(value).not.toBe(today);
    expect(String(value) > today).toBe(true);
  });
});
