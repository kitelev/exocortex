/**
 * `$today` local-timezone revert-verify (req 5c47471a / #3807, sibling of #3806).
 *
 * `$today` must resolve to today's LOCAL calendar day (YYYY-MM-DD), not the UTC
 * day. Since bug 3883 `$today` is resolved at EXECUTE time (the loader emits a
 * marker, never a baked day — so a session across local midnight cannot freeze
 * the launch day), so both checked paths are execute-time:
 *
 *  1. Loader — the real `CommandResolver.loadCommand` (a real InMemoryTripleStore
 *     seeds a `$today` SubstitutionToken + PropertyDefault + create_instance
 *     grounding) emits an execute-time marker, whose live-registry `today`
 *     resolution is then asserted to be the LOCAL calendar day.
 *  2. Registry — `SubstitutionResolverRegistry` `today` resolver, exercised via
 *     `getResolver("today")`, asserted to agree with `$date` at the boundary.
 *
 * Revert-verify ([[integration-test-revert-verify]]): reverting the registry
 * `today` to `new Date().toISOString().slice(0,10)` makes the boundary assertion
 * resolve to "2026-07-02" (the UTC day) → RED; the local form → GREEN
 * ("2026-07-03"). Restoring the parse-time bake makes the loader value a baked
 * literal → the marker assertion in path 1 fails (RED).
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
import { installFakeOffsetDate } from "../../helpers/installFakeOffsetDate";

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

// Fixed UTC+5 (Asia/Almaty, no DST) at 2026-07-02T19:27:00Z = 00:27 local
// (local day 03, UTC day 02) — see the shared installFakeOffsetDate helper.
const installFakeAlmatyDate = () =>
  installFakeOffsetDate(5, "2026-07-02T19:27:00Z");

describe("$today resolvers return the LOCAL calendar day (req 5c47471a / #3807)", () => {
  // Loader path — production-shape via CommandResolver.loadCommand. Bug 3883
  // made `$today` emit an execute-time MARKER (was parse-time-baked), so the
  // loader no longer bakes a day; the req-guaranteed LOCAL calendar day is
  // resolved fresh at execute time by the registry `today` resolver (asserted
  // below under the simulated tz).
  it("emits a $today marker whose execute-time registry value is today's LOCAL day just after local midnight (UTC still previous day) @req:5c47471a-d7f7-44ce-bed8-a677bbed9b56", async () => {
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
      // Bug 3883 — loadCommand now emits an execute-time marker (not a baked
      // day), so a session open across local midnight can never freeze the
      // launch day. Revert-verify: restoring the parse-time bake makes `value`
      // "2026-07-03" (a literal) → the marker `.toBe(...)` fails (RED).
      expect(value).toBe(`__SUBSTITUTE__today__${TOKEN_TODAY_UID}__`);
      expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Req 5c47471a — the marker resolves (execute-time, live registry) to
      // today's LOCAL calendar day = 2026-07-03. The former UTC form returned
      // "2026-07-02" (yesterday's local date at this instant) — RED.
      installDefaultResolvers();
      const resolved = getResolver("today")!({} as ResolverContext) as string;
      expect(resolved).toBe("2026-07-03");
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
