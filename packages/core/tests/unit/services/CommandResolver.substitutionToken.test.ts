/**
 * CommandResolver — RFC v2 Phase 3a SubstitutionToken resolver registry
 * dispatched from PropertyDefault values (Issue kitelev/exocortex#3162).
 *
 * Coverage:
 * - DAY-granularity date resolvers (`today`, `todayStart`, `tomorrow`,
 *   `nowDate`, `nowYear`, `nowMonth`) → emit an execute-time marker
 *   `__SUBSTITUTE__<id>__<uid>__` (bug 3883 removed the last parse-time bake so
 *   a session open across local midnight can no longer freeze the launch day).
 * - Context-dependent `targetFolder` resolver → emits marker
 *   `__SUBSTITUTE__targetFolder__<uid>__` (Phase 3b executor wires this).
 * - Unknown resolver-id → fallback to `"[[<UID>]]"` wikilink form + warn.
 *
 * Strategy: assetIsSubstitutionToken detects a value asset by inspecting
 * `exo__Instance_class` triples. NoteToRDFConverter normalises every
 * Instance_class triple's object to the canonical namespace IRI
 * (`https://exocortex.my/ontology/exocmd#SubstitutionToken`) regardless of
 * authoring shape, so tests emit IRI-form `Instance_class` triples to
 * mirror production-grade RDF storage shape.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";
import {
  getResolver,
  installDefaultResolvers,
  type ResolverContext,
} from "../../../src/services/SubstitutionResolverRegistry";

interface RecordingLogger extends ILogger {
  readonly warnings: string[];
}

function makeRecordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  return {
    debug() {},
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    warnings,
  };
}

async function addLabelledAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
}

/**
 * `exocmd__SubstitutionToken` instance.
 *
 * Stored shape mirrors NoteToRDFConverter output:
 *   - `exo__Instance_class` → IRI of `exocmd:SubstitutionToken` (normalised).
 *   - `exocmd__SubstitutionToken_resolver` → literal resolver-id.
 */
async function addSubstitutionToken(
  store: InMemoryTripleStore,
  opts: { uid: string; label: string; resolverId: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EXO.term("Instance_class"),
      Namespace.EXOCMD.term("SubstitutionToken"),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("SubstitutionToken_resolver"),
      new Literal(opts.resolverId),
    ),
  ]);
}

async function addPropertyDefault(
  store: InMemoryTripleStore,
  opts: { uid: string; propertyRefUid: string; valueRefUid: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("PropertyDefault"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("PropertyDefault_property"),
      new IRI(`obsidian://vault/${opts.propertyRefUid}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("PropertyDefault_value"),
      new IRI(`obsidian://vault/${opts.valueRefUid}.md`),
    ),
  ]);
}

async function addGrounding(
  store: InMemoryTripleStore,
  opts: { uid: string; label: string; propertyDefaultRefs: string[] },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      // RFC 9d20c91f Phase 3: wikilink-form UID ref into exocmd__GroundingType
      // catalog (create_instance → 4367e2d6), not a bare-string literal. Legacy
      // bare-string resolves to null → grounding inert → command dropped (#3506).
      new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
    ),
  ];
  for (const ref of opts.propertyDefaultRefs) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("Grounding_propertyDefault"),
        new IRI(`obsidian://vault/${ref}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

async function addCommand(
  store: InMemoryTripleStore,
  commandUid: string,
  groundingUid: string,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${commandUid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Command")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(commandUid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(commandUid)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Command_grounding"),
      new IRI(`obsidian://vault/${groundingUid}.md`),
    ),
  ]);
}

// ────────────────────────────────────────────────────────────────────────────
// UUID v4 fixtures
// ────────────────────────────────────────────────────────────────────────────

const PROP_UID = "11111111-1111-4111-8111-111111111111";

const TOKEN_TODAY_UID         = "22222222-2222-4222-8222-222222222222";
const TOKEN_TARGET_FOLDER_UID = "33333333-3333-4333-8333-333333333333";
const TOKEN_UNKNOWN_UID       = "44444444-4444-4444-8444-444444444444";
const TOKEN_TODAY_START_UID   = "66666666-6666-4666-8666-666666666666";
const TOKEN_NOW_TIMESTAMP_UID = "77777777-7777-4777-8777-777777777777";

const PD_UID  = "55555555-5555-4555-8555-555555555555";

const GROUNDING_UID = "88888888-8888-4888-8888-888888888888";
const COMMAND_UID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandResolver — RFC v2 Phase 3a SubstitutionToken dispatch", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
    await addLabelledAsset(store, PROP_UID, "ems__Effort_plannedStartTimestamp");
  });

  // Bug 3883 — DAY-granularity resolvers (today/tomorrow/todayStart/nowDate/
  // nowYear/nowMonth) MUST emit an execute-time marker, NOT a parse-time-baked
  // literal. Parse-time baking + the session command / Universal-Template cache
  // froze the LAUNCH calendar day into cached create_instance defaults when a
  // plugin session stayed open across local midnight (sibling of the
  // nowTimestamp freeze, #3882). Revert-verify: restoring the parse-time bake
  // (re-adding "today" to PARSE_TIME_RESOLVERS + parseTimeResolve) makes `value`
  // a baked `YYYY-MM-DD` literal → the marker `.toBe(...)` assertion fails (RED).
  it("encodes a `today` SubstitutionToken as an execute-time marker (must not freeze the launch day across local midnight)", async () => {
    await addSubstitutionToken(store, {
      uid: TOKEN_TODAY_UID,
      label: "$today",
      resolverId: "today",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_TODAY_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with $today PD",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    const value = cmd!.grounding.propertyDefault![0].value;
    expect(value).toBe(`__SUBSTITUTE__today__${TOKEN_TODAY_UID}__`);
    // Must NOT be a parse-time-baked calendar-day literal (the frozen-launch bug).
    expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(logger.warnings).toHaveLength(0);
  });

  // Bug 3883 — `$todayStart` now emits an execute-time marker (was parse-time-
  // baked → froze the launch day across local midnight). Its req-guaranteed
  // naive-local `YYYY-MM-DDT00:00:00` SHAPE (#3811) is preserved at the
  // execute-time layer by the registry `todayStart` resolver, asserted here.
  // Revert-verify: restoring the parse-time bake makes `value` a baked literal
  // → the marker `.toBe(...)` assertion fails (RED).
  it("encodes a `todayStart` SubstitutionToken as an execute-time marker resolving to naive-local YYYY-MM-DDT00:00:00 (no Z, no millis) @req:ecb90c06-92af-41bd-bb81-1d4510e53fa3", async () => {
    await addSubstitutionToken(store, {
      uid: TOKEN_TODAY_START_UID,
      label: "$todayStart",
      resolverId: "todayStart",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_TODAY_START_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with $todayStart PD",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    const value = cmd!.grounding.propertyDefault![0].value;
    // Execute-time marker (not the former parse-time-baked literal).
    expect(value).toBe(`__SUBSTITUTE__todayStart__${TOKEN_TODAY_START_UID}__`);
    expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);

    // Req ecb90c06 — the marker resolves (execute-time, live registry) to
    // naive-local midnight, NOT the former UTC Z-instant `...T00:00:00.000Z`.
    installDefaultResolvers();
    const resolved = getResolver("todayStart")!({} as ResolverContext) as string;
    expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
    expect(resolved).not.toContain("Z");
    expect(resolved).not.toContain(".000");
    expect(logger.warnings).toHaveLength(0);
  });

  // Bug 3883 — completeness: EVERY former parse-time DAY-granularity resolver
  // now emits an execute-time marker (nothing baked → nothing frozen across
  // local midnight). tomorrow/nowDate/nowYear/nowMonth join today/todayStart.
  it.each(["today", "tomorrow", "todayStart", "nowDate", "nowYear", "nowMonth"])(
    "encodes the `%s` day-granularity resolver as an execute-time marker",
    async (resolverId) => {
      const dayTokenUid = "99999999-9999-4999-8999-999999999999";
      await addSubstitutionToken(store, {
        uid: dayTokenUid,
        label: `$${resolverId}`,
        resolverId,
      });
      await addPropertyDefault(store, {
        uid: PD_UID,
        propertyRefUid: PROP_UID,
        valueRefUid: dayTokenUid,
      });
      await addGrounding(store, {
        uid: GROUNDING_UID,
        label: `Grounding with $${resolverId} PD`,
        propertyDefaultRefs: [PD_UID],
      });
      await addCommand(store, COMMAND_UID, GROUNDING_UID);

      const cmd = await resolver.loadCommand(COMMAND_UID);
      expect(cmd!.grounding.propertyDefault![0].value).toBe(
        `__SUBSTITUTE__${resolverId}__${dayTokenUid}__`,
      );
      expect(logger.warnings).toHaveLength(0);
    },
  );

  // Bug 33d362e5 — `nowTimestamp` (second-precision, used for
  // exo__Asset_createdAt / exo__Asset_updatedAt) MUST emit an execute-time
  // marker, NOT a parse-time-baked literal. Parse-time baking + the session
  // command/Universal-Template cache froze every prototype instance created in
  // one Obsidian session to the SAME launch-time timestamp. It is the
  // second-precision sibling of `randomUUIDv4` (also marker-only): a cached
  // baked value is wrong for BOTH. Revert-verify: re-adding "nowTimestamp" to
  // PARSE_TIME_RESOLVERS makes `value` a baked `YYYY-MM-DDTHH:mm:ss` literal →
  // the marker `.toBe(...)` assertion fails (RED).
  it("encodes a `nowTimestamp` SubstitutionToken as an execute-time marker (createdAt/updatedAt must not freeze to session launch)", async () => {
    await addSubstitutionToken(store, {
      uid: TOKEN_NOW_TIMESTAMP_UID,
      label: "$nowTimestamp",
      resolverId: "nowTimestamp",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_NOW_TIMESTAMP_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with $nowTimestamp PD",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    const value = cmd!.grounding.propertyDefault![0].value;
    // Execute-time marker — resolved fresh per instance creation by the live
    // registry resolver, so createdAt/updatedAt reflect the real creation time.
    expect(value).toBe(
      `__SUBSTITUTE__nowTimestamp__${TOKEN_NOW_TIMESTAMP_UID}__`,
    );
    // Must NOT be a parse-time-baked timestamp literal (the frozen-launch bug).
    expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(logger.warnings).toHaveLength(0);
  });

  it("encodes a `targetFolder` SubstitutionToken as a marker for the Phase 3b executor", async () => {
    await addSubstitutionToken(store, {
      uid: TOKEN_TARGET_FOLDER_UID,
      label: "$targetFolder",
      resolverId: "targetFolder",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_TARGET_FOLDER_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with $targetFolder PD",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    // Marker format from buildSubstitutionMarker: __SUBSTITUTE__<id>__<uid>__
    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `__SUBSTITUTE__targetFolder__${TOKEN_TARGET_FOLDER_UID}__`,
    );
    expect(logger.warnings).toHaveLength(0);
  });

  it("falls back to wikilink form and warns when SubstitutionToken declares an unknown resolver-id", async () => {
    await addSubstitutionToken(store, {
      uid: TOKEN_UNKNOWN_UID,
      label: "$bogusResolver",
      resolverId: "definitelyNotAKnownResolver",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_UNKNOWN_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with unknown resolver",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    // Fallback to wikilink form with the token's own UID.
    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `"[[${TOKEN_UNKNOWN_UID}]]"`,
    );
    // Warning must surface the unknown resolver-id for actionable debugging.
    expect(
      logger.warnings.some(
        (w) =>
          w.includes("definitelyNotAKnownResolver") &&
          /unknown resolver-id/.test(w),
      ),
    ).toBe(true);
  });
});
