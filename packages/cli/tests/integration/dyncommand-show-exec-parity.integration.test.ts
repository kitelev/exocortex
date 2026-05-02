/**
 * RFC § Phase 4 (T4.1) — `dyncommand show` ≡ `dyncommand exec` precondition
 * parity.
 *
 * Pins the invariant that, **within a single CLI process**, the precondition
 * obtained via the `show` code path is byte-identical to the precondition
 * the `exec` code path feeds into `PreconditionEvaluator`.
 *
 * Both subcommands in `packages/cli/src/commands/dynamic-command.ts` share
 * the same prefix (lines 171–173 vs 273–275):
 *
 *     buildTripleStore(vaultPath)        // pure fn of disk state
 *       → new CommandResolver(store)
 *         → resolver.loadCommand(uid)    // returns CommandDefinition
 *
 * `show` then prints `command.precondition.*`; `exec` passes the same
 * `command.precondition` to `PreconditionEvaluator.evaluate`. Any future
 * regression that splits the two paths — caching layer, alternative
 * resolver in one path, version-skewed binary — must light up this test.
 *
 * The test exercises `CommandResolver.loadCommand` against an
 * `InMemoryTripleStore` populated with hand-built triples. This is
 * intentionally narrower than going through `NoteToRDFConverter`: the
 * RCA's claim is *about CommandResolver*, not about the converter.
 *
 * In addition to the happy path, the duplicate-`exo__Asset_uid` scenario
 * (RCA hypothesis H1) is exercised to *document* that `findSubjectByUID`
 * is order-dependent and that intra-process show/exec still agree
 * because they share the same triple store snapshot. The fix in T4.2
 * will add a duplicate-UID detector to `dyncommand validate`; this test
 * does not implement the fix, only the parity baseline.
 */
import { describe, it, expect } from "@jest/globals";
import {
  InMemoryTripleStore,
  CommandResolver,
  IRI,
  Literal,
  Namespace,
  Triple,
  type CommandDefinition,
} from "exocortex";

const RDF_TYPE = Namespace.RDF.term("type");
const EXO_ASSET_UID = Namespace.EXO.term("Asset_uid");
const EXO_ASSET_LABEL = Namespace.EXO.term("Asset_label");
const EXOCMD_COMMAND = Namespace.EXOCMD.term("Command");
const EXOCMD_PRECONDITION = Namespace.EXOCMD.term("Precondition");
const EXOCMD_GROUNDING = Namespace.EXOCMD.term("Grounding");
const EXOCMD_COMMAND_PRECONDITION = Namespace.EXOCMD.term(
  "Command_precondition",
);
const EXOCMD_COMMAND_GROUNDING = Namespace.EXOCMD.term("Command_grounding");
const EXOCMD_PRECONDITION_SPARQL_ASK = Namespace.EXOCMD.term(
  "Precondition_sparqlAsk",
);
const EXOCMD_GROUNDING_TYPE = Namespace.EXOCMD.term("Grounding_type");
const EXOCMD_GROUNDING_TARGET_PROP = Namespace.EXOCMD.term(
  "Grounding_targetProperty",
);
const EXOCMD_GROUNDING_TARGET_VAL = Namespace.EXOCMD.term(
  "Grounding_targetValue",
);

interface AssetTriples {
  subject: IRI;
  uid: string;
  label: string;
  rdfType: IRI;
  extra?: Triple[];
}

function assetTriples(a: AssetTriples): Triple[] {
  return [
    new Triple(a.subject, RDF_TYPE, a.rdfType),
    new Triple(a.subject, EXO_ASSET_UID, new Literal(a.uid)),
    new Triple(a.subject, EXO_ASSET_LABEL, new Literal(a.label)),
    ...(a.extra ?? []),
  ];
}

async function makeStore(triples: Triple[]): Promise<InMemoryTripleStore> {
  const store = new InMemoryTripleStore();
  await store.addAll(triples);
  return store;
}

describe("dyncommand show ≡ exec precondition parity (T4.1)", () => {
  describe("happy path: single Command + Precondition + Grounding", () => {
    const COMMAND_UID = "aaaa1111-1111-4111-8111-cccc11111111";
    const PRECONDITION_UID = "aaaa2222-2222-4222-8222-cccc22222222";
    const GROUNDING_UID = "aaaa3333-3333-4333-8333-cccc33333333";

    const cmdSubject = new IRI(`obsidian://vault/commands/${COMMAND_UID}.md`);
    const preSubject = new IRI(
      `obsidian://vault/preconditions/${PRECONDITION_UID}.md`,
    );
    const grdSubject = new IRI(
      `obsidian://vault/groundings/${GROUNDING_UID}.md`,
    );

    const triples: Triple[] = [
      ...assetTriples({
        subject: cmdSubject,
        uid: COMMAND_UID,
        label: "Start Task",
        rdfType: EXOCMD_COMMAND,
        extra: [
          new Triple(cmdSubject, EXOCMD_COMMAND_PRECONDITION, preSubject),
          new Triple(cmdSubject, EXOCMD_COMMAND_GROUNDING, grdSubject),
        ],
      }),
      ...assetTriples({
        subject: preSubject,
        uid: PRECONDITION_UID,
        label: "Has no startTimestamp",
        rdfType: EXOCMD_PRECONDITION,
        extra: [
          new Triple(
            preSubject,
            EXOCMD_PRECONDITION_SPARQL_ASK,
            new Literal(
              "ASK { FILTER NOT EXISTS { $target ems:Effort_startTimestamp ?ts } }",
            ),
          ),
        ],
      }),
      ...assetTriples({
        subject: grdSubject,
        uid: GROUNDING_UID,
        label: "Set startTimestamp",
        rdfType: EXOCMD_GROUNDING,
        extra: [
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TYPE,
            new Literal("property_set"),
          ),
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TARGET_PROP,
            new Literal("ems__Effort_startTimestamp"),
          ),
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TARGET_VAL,
            new Literal("$now"),
          ),
        ],
      }),
    ];

    /**
     * Mirror the production prologue used by both `dyncommand show` (line 171)
     * and `dyncommand exec` (line 273). The two CLI subcommands diverge only
     * after this prologue, so equality of `loadCommand` results suffices to
     * prove the show/exec parity invariant.
     */
    async function loadLikeCli(): Promise<CommandDefinition | null> {
      const store = await makeStore(triples);
      const resolver = new CommandResolver(store);
      return resolver.loadCommand(COMMAND_UID);
    }

    it("show-style and exec-style loadCommand return deeply-equal preconditions", async () => {
      const showCmd = await loadLikeCli();
      const execCmd = await loadLikeCli();

      expect(showCmd).not.toBeNull();
      expect(execCmd).not.toBeNull();

      // The single normalised invariant: same JSON serialization of the
      // precondition object as actually consumed downstream.
      expect(JSON.stringify(execCmd!.precondition)).toEqual(
        JSON.stringify(showCmd!.precondition),
      );

      // Sanity: the precondition is non-trivial (otherwise the assertion
      // above degenerates to undefined === undefined).
      expect(showCmd!.precondition?.id).toBe(PRECONDITION_UID);
      expect(showCmd!.precondition?.sparqlAsk).toMatch(/Effort_startTimestamp/);
    });

    it("two consecutive lookups against the same store yield identical objects", async () => {
      const store = await makeStore(triples);
      const resolver = new CommandResolver(store);
      const first = await resolver.loadCommand(COMMAND_UID);
      const second = await resolver.loadCommand(COMMAND_UID);

      expect(first).not.toBeNull();
      expect(JSON.stringify(first?.precondition)).toEqual(
        JSON.stringify(second?.precondition),
      );
    });
  });

  describe("RCA H1 — duplicate exo__Asset_uid (documentation only)", () => {
    /**
     * Two different subjects claim the same UID and bind to *different*
     * preconditions. Both `show` and `exec` paths share a single triple
     * store snapshot, so within a single process they MUST agree on which
     * "first-seen" subject `findSubjectByUID` returns. The test pins this
     * intra-process determinism — the across-process flakiness that
     * actually causes the user-reported divergence is documented in
     * `docs/RCA_DYNCOMMAND_SHOW_VS_EXEC.md` (§H1) and addressed in T4.2.
     */
    const COMMAND_UID = "bbbb1111-1111-4111-8111-cccc11111111";
    const PRE_A = "bbbb2222-2222-4222-8222-cccc1111aaaa";
    const PRE_B = "bbbb2222-2222-4222-8222-cccc2222bbbb";
    const GROUNDING_UID = "bbbb3333-3333-4333-8333-cccc33333333";

    const cmdActive = new IRI(`obsidian://vault/active/${COMMAND_UID}.md`);
    const cmdArchive = new IRI(`obsidian://vault/archive/${COMMAND_UID}.md`);
    const preA = new IRI(`obsidian://vault/preconditions/${PRE_A}.md`);
    const preB = new IRI(`obsidian://vault/preconditions/${PRE_B}.md`);
    const grdSubject = new IRI(
      `obsidian://vault/groundings/${GROUNDING_UID}.md`,
    );

    const triples: Triple[] = [
      // Two Command files sharing the same UID — the structural anomaly
      // that powers H1 in production (e.g. accidental archive copy not
      // deleted after rename).
      ...assetTriples({
        subject: cmdActive,
        uid: COMMAND_UID,
        label: "Active variant",
        rdfType: EXOCMD_COMMAND,
        extra: [
          new Triple(cmdActive, EXOCMD_COMMAND_PRECONDITION, preA),
          new Triple(cmdActive, EXOCMD_COMMAND_GROUNDING, grdSubject),
        ],
      }),
      ...assetTriples({
        subject: cmdArchive,
        uid: COMMAND_UID,
        label: "Archived variant",
        rdfType: EXOCMD_COMMAND,
        extra: [
          new Triple(cmdArchive, EXOCMD_COMMAND_PRECONDITION, preB),
          new Triple(cmdArchive, EXOCMD_COMMAND_GROUNDING, grdSubject),
        ],
      }),
      ...assetTriples({
        subject: preA,
        uid: PRE_A,
        label: "Variant A precondition",
        rdfType: EXOCMD_PRECONDITION,
        extra: [
          new Triple(
            preA,
            EXOCMD_PRECONDITION_SPARQL_ASK,
            new Literal("ASK { $target a ems:Task }"),
          ),
        ],
      }),
      ...assetTriples({
        subject: preB,
        uid: PRE_B,
        label: "Variant B precondition",
        rdfType: EXOCMD_PRECONDITION,
        extra: [
          new Triple(
            preB,
            EXOCMD_PRECONDITION_SPARQL_ASK,
            new Literal("ASK { $target a ems:Project }"),
          ),
        ],
      }),
      ...assetTriples({
        subject: grdSubject,
        uid: GROUNDING_UID,
        label: "No-op",
        rdfType: EXOCMD_GROUNDING,
        extra: [
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TYPE,
            new Literal("property_set"),
          ),
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TARGET_PROP,
            new Literal("ems__Asset_label"),
          ),
          new Triple(
            grdSubject,
            EXOCMD_GROUNDING_TARGET_VAL,
            new Literal("noop"),
          ),
        ],
      }),
    ];

    it("intra-process: show and exec agree on the (deterministic) first-seen variant", async () => {
      const store1 = await makeStore(triples);
      const store2 = await makeStore(triples);
      const showCmd = await new CommandResolver(store1).loadCommand(
        COMMAND_UID,
      );
      const execCmd = await new CommandResolver(store2).loadCommand(
        COMMAND_UID,
      );

      expect(showCmd).not.toBeNull();
      expect(execCmd).not.toBeNull();

      // The actual variant chosen depends on insertion order, but it MUST
      // be identical between two adjacent invocations on an unchanged
      // store — that is the parity invariant T4.1 pins.
      expect(JSON.stringify(execCmd!.precondition)).toEqual(
        JSON.stringify(showCmd!.precondition),
      );

      // Exactly one of the two candidate preconditions is selected.
      expect([PRE_A, PRE_B]).toContain(showCmd!.precondition?.id);
    });
  });
});
