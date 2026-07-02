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
    // resolved to today+1, not today. The baseline is computed with LOCAL
    // getters (not UTC `toISOString`) to match the now-local `$tomorrow`
    // value — a UTC baseline would flake in UTC-minus timezones where local
    // tomorrow can be < UTC today. Lexicographic YYYY-MM-DD compare is
    // clock-flake-safe (no exact-tomorrow race at local midnight).
    const now = new Date();
    const p2 = (n: number): string => String(n).padStart(2, "0");
    const localToday = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    expect(value).not.toBe(localToday);
    expect(String(value) > localToday).toBe(true);
  });

  // FIX-2 (req bca93bfb — local-tz `$tomorrow`) — revert-verify
  // ([[integration-test-revert-verify]]). At a wall-clock instant just after
  // LOCAL midnight in a UTC+N timezone, the former UTC resolver (setUTCDate +
  // toISOString) mis-fired `$tomorrow` to the SAME local calendar day (UTC was
  // still the previous date). Vision Lock 5 requires the next LOCAL day.
  //
  // Deterministic + CI-robust: `process.env.TZ` cannot be changed at runtime
  // under jest (V8 caches the worker's timezone), and the fix has NO observable
  // effect in a UTC runner — so we install a Date subclass that simulates a
  // fixed UTC+5 (Asia/Almaty, no DST) offset at the instant 2026-07-02T19:27:00Z
  // = 2026-07-03T00:27 local (local day 03, UTC day 02), independent of the
  // runner's real timezone. Pre-fix resolves to "2026-07-03" (= local TODAY) →
  // RED; post-fix (local getFullYear/getMonth/getDate + 1) → "2026-07-04" GREEN.
  it("resolves $tomorrow to the next LOCAL calendar day just after local midnight (UTC still previous day) @req:bca93bfb-b663-4309-a19e-996de8e526da", async () => {
    const RealDate = Date;
    const OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5 (Asia/Almaty, no DST)
    const FIXED_EPOCH = RealDate.parse("2026-07-02T19:27:00Z"); // 00:27 Almaty
    class FakeAlmatyDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(FIXED_EPOCH); // "now" = the fixed boundary instant
        } else if (args.length === 1) {
          super(args[0] as number | string | Date);
        } else {
          // (y, m, d, …) are LOCAL Almaty components → shift to the UTC epoch.
          const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args as number[];
          super(RealDate.UTC(y, mo, d, h, mi, s, ms) - OFFSET_MS);
        }
      }
      // Local getters = UTC getters of (epoch + offset); UTC getters inherited.
      private shifted(): Date {
        return new RealDate(this.getTime() + OFFSET_MS);
      }
      override getFullYear(): number {
        return this.shifted().getUTCFullYear();
      }
      override getMonth(): number {
        return this.shifted().getUTCMonth();
      }
      override getDate(): number {
        return this.shifted().getUTCDate();
      }
      override getHours(): number {
        return this.shifted().getUTCHours();
      }
      override getDay(): number {
        return this.shifted().getUTCDay();
      }
    }
    (globalThis as { Date: DateConstructor }).Date =
      FakeAlmatyDate as unknown as DateConstructor;
    try {
      // Guard: prove the simulated tz is active (else the assertion below would
      // be vacuous in a UTC-tz runner and silently pass both ways — fail loud).
      expect(new Date().getHours()).toBe(0); // 00:27 local (Almaty)
      expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

      await addLabelled(
        store,
        PROP_PLANNED_UID,
        "ems__Effort_plannedStartTimestamp",
      );
      await store.addAll([
        new Triple(
          iri(TOKEN_TOMORROW_UID),
          Namespace.EXO.term("Asset_uid"),
          new Literal(TOKEN_TOMORROW_UID),
        ),
        new Triple(
          iri(TOKEN_TOMORROW_UID),
          Namespace.EXO.term("Asset_label"),
          new Literal("$tomorrow"),
        ),
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
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.RDF.term("type"),
          Namespace.EXOCMD.term("PropertyDefault"),
        ),
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.EXO.term("Asset_uid"),
          new Literal(PD_PLANNED_UID),
        ),
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.EXOCMD.term("PropertyDefault_property"),
          iri(PROP_PLANNED_UID),
        ),
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.EXOCMD.term("PropertyDefault_value"),
          iri(TOKEN_TOMORROW_UID),
        ),
      ]);
      await addGrounding(store, {
        cloneTargetBody: true,
        propertyDefaultRefs: [PD_PLANNED_UID],
      });
      await addCommand(store);

      const cmd = await resolver.loadCommand(COMMAND_UID);

      expect(cmd).not.toBeNull();
      const value = cmd!.grounding.propertyDefault![0].value;
      // Local tomorrow = 2026-07-04. The UTC form returned "2026-07-03"
      // (= local TODAY at this instant) — the bug FIX-2 corrects.
      expect(value).toBe("2026-07-04");
    } finally {
      (globalThis as { Date: DateConstructor }).Date = RealDate;
    }
  });
});
