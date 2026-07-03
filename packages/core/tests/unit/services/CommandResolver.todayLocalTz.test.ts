/**
 * `$today` local-timezone revert-verify (req 5c47471a / #3807, sibling of #3806).
 *
 * Both `$today` resolution paths must return today's LOCAL calendar day
 * (YYYY-MM-DD), not the UTC day:
 *
 *  1. Parse-time — `CommandResolver.parseTimeResolve` case `today`, exercised
 *     production-shape through the real loader `CommandResolver.loadCommand`
 *     (a real InMemoryTripleStore seeds a `$today` SubstitutionToken +
 *     PropertyDefault + create_instance grounding; the resolved PD value is
 *     asserted).
 *  2. Registry — `SubstitutionResolverRegistry` `today` resolver, exercised via
 *     `getResolver("today")`, asserted to agree with `$date` at the boundary.
 *
 * Revert-verify ([[integration-test-revert-verify]]): reverting either path to
 * `new Date().toISOString().slice(0,10)` makes the boundary assertion resolve to
 * "2026-07-02" (the UTC day) → RED; the local form → GREEN ("2026-07-03").
 *
 * CI-robustness ([[jest-timezone-sensitive-tests]]): `process.env.TZ` cannot be
 * re-tzset at runtime under jest (V8 caches the worker timezone), and the fix
 * has NO observable effect in a UTC runner — so a `Date` subclass simulates a
 * fixed UTC+5 (Asia/Almaty, no DST) offset at the instant 2026-07-02T19:27:00Z
 * = 2026-07-03T00:27 local (local day 03, UTC day 02), independent of the
 * runner's real timezone. A guard proves the simulated tz is active so the
 * assertion can never silently pass both ways in a UTC-tz CI runner.
 *
 * @req:5c47471a-d7f7-44ce-bed8-a677bbed9b56
 */
import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import {
  clearResolvers,
  getResolver,
  installDefaultResolvers,
  type ResolverContext,
} from "../../../src/services/SubstitutionResolverRegistry";

const CREATE_INSTANCE_TYPE_UID = "4367e2d6-6c92-450a-becb-abce1fb07682";
const PROP_PLANNED_UID = "7f773e3e-54d0-426b-98c5-5b75d01695cb"; // ems__Effort_plannedStartTimestamp
const TOKEN_TODAY_UID = "b6f2f0a2-1c34-4d55-9a77-2f6a1e3d9c40"; // $today
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

/**
 * Installs a `Date` subclass simulating a fixed UTC+5 offset at 00:27 local
 * (2026-07-02T19:27:00Z). Local getters = UTC getters of (epoch + offset); UTC
 * getters are inherited. Returns a restore function.
 */
function installFakeAlmatyDate(): () => void {
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
        const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args as number[];
        super(RealDate.UTC(y, mo, d, h, mi, s, ms) - OFFSET_MS);
      }
    }
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
  return () => {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  };
}

describe("$today resolvers return the LOCAL calendar day (req 5c47471a / #3807)", () => {
  // Parse-time path — production-shape via CommandResolver.loadCommand.
  it("resolves a parse-time $today PropertyDefault to today's LOCAL day just after local midnight (UTC still previous day) @req:5c47471a-d7f7-44ce-bed8-a677bbed9b56", async () => {
    const restore = installFakeAlmatyDate();
    try {
      // Guard: prove the simulated tz is active (else the assertion below would
      // be vacuous in a UTC-tz runner and silently pass both ways — fail loud).
      expect(new Date().getHours()).toBe(0); // 00:27 local (Almaty)
      expect(new Date().getUTCDate()).toBe(2); // still July 2 in UTC

      const store = new InMemoryTripleStore();
      const resolver = new CommandResolver(store);

      await addLabelled(store, PROP_PLANNED_UID, "ems__Effort_plannedStartTimestamp");
      await store.addAll([
        new Triple(iri(TOKEN_TODAY_UID), Namespace.EXO.term("Asset_uid"), new Literal(TOKEN_TODAY_UID)),
        new Triple(iri(TOKEN_TODAY_UID), Namespace.EXO.term("Asset_label"), new Literal("$today")),
        new Triple(
          iri(TOKEN_TODAY_UID),
          Namespace.EXO.term("Instance_class"),
          Namespace.EXOCMD.term("SubstitutionToken"),
        ),
        new Triple(
          iri(TOKEN_TODAY_UID),
          Namespace.EXOCMD.term("SubstitutionToken_resolver"),
          new Literal("today"),
        ),
      ]);
      await store.addAll([
        new Triple(iri(PD_PLANNED_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("PropertyDefault")),
        new Triple(iri(PD_PLANNED_UID), Namespace.EXO.term("Asset_uid"), new Literal(PD_PLANNED_UID)),
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.EXOCMD.term("PropertyDefault_property"),
          iri(PROP_PLANNED_UID),
        ),
        new Triple(
          iri(PD_PLANNED_UID),
          Namespace.EXOCMD.term("PropertyDefault_value"),
          iri(TOKEN_TODAY_UID),
        ),
      ]);
      await store.addAll([
        new Triple(iri(GROUNDING_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
        new Triple(iri(GROUNDING_UID), Namespace.EXO.term("Asset_uid"), new Literal(GROUNDING_UID)),
        new Triple(iri(GROUNDING_UID), Namespace.EXO.term("Asset_label"), new Literal("Create with $today PD")),
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
          Namespace.EXOCMD.term("Grounding_propertyDefault"),
          iri(PD_PLANNED_UID),
        ),
      ]);
      await store.addAll([
        new Triple(iri(COMMAND_UID), Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
        new Triple(iri(COMMAND_UID), Namespace.EXO.term("Asset_uid"), new Literal(COMMAND_UID)),
        new Triple(iri(COMMAND_UID), Namespace.EXO.term("Asset_label"), new Literal("Create today")),
        new Triple(
          iri(COMMAND_UID),
          Namespace.EXOCMD.term("Command_grounding"),
          iri(GROUNDING_UID),
        ),
      ]);

      const cmd = await resolver.loadCommand(COMMAND_UID);

      expect(cmd).not.toBeNull();
      const value = cmd!.grounding.propertyDefault![0].value;
      // Local today = 2026-07-03. The UTC form returned "2026-07-02"
      // (yesterday's local date at this instant) — the bug #3807 corrects.
      expect(value).toBe("2026-07-03");
    } finally {
      restore();
    }
  });

  // Registry path — getResolver("today"), asserted to agree with $date.
  it("registry $today resolves to the LOCAL day and agrees with $date at the boundary @req:5c47471a-d7f7-44ce-bed8-a677bbed9b56", () => {
    const restore = installFakeAlmatyDate();
    try {
      expect(new Date().getHours()).toBe(0); // guard: simulated tz active
      expect(new Date().getUTCDate()).toBe(2);

      clearResolvers();
      installDefaultResolvers();
      const ctx = {} as ResolverContext;
      const today = getResolver("today")!(ctx, undefined) as string;
      const date = getResolver("date")!(ctx, undefined) as string;

      // Local today = 2026-07-03; the former UTC form returned "2026-07-02".
      expect(today).toBe("2026-07-03");
      // `$today` and `$date` must agree on today's LOCAL calendar day.
      expect(today).toBe(date);
    } finally {
      restore();
      clearResolvers();
      installDefaultResolvers();
    }
  });
});
