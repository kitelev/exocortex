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
  /**
   * Recorded separately from `warnings` because the level is load-bearing:
   * a plain (non-token) asset ref is the COMMON, correct path, so it must not
   * warn — otherwise every `assetRef` field would emit noise and devalue the
   * genuine cold-start warning next to it (req b354316b).
   */
  readonly debugs: string[];
}

function makeRecordingLogger(): RecordingLogger {
  const warnings: string[] = [];
  const debugs: string[] = [];
  return {
    debug(message: string) {
      debugs.push(message);
    },
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
    warnings,
    debugs,
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

/**
 * A SubstitutionToken whose `exo__Instance_class` triple did NOT load — the
 * cold-start shape behind defect 0310aa28. Everything else about the asset is
 * intact, including its resolver property.
 */
async function addTokenWithoutClassTriple(
  store: InMemoryTripleStore,
  opts: { uid: string; label: string; resolverId: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("SubstitutionToken_resolver"),
      new Literal(opts.resolverId),
    ),
  ]);
}

/**
 * A TokenInvocation whose `exo__Instance_class` triple did NOT load — the SECOND
 * door to defect 0310aa28, and the earlier one: `assetIsTokenInvocation` runs
 * before `assetIsSubstitutionToken`. Shape mirrors the canonical invocation
 * fixture (`CommandResolver.universalDefaultTemplate.test.ts`) minus the class
 * triple: `_token` is an IRI ref, `_parameter` a literal.
 */
/**
 * A well-formed TokenInvocation — class triple PRESENT. Shape mirrors the
 * canonical fixture in `CommandResolver.universalDefaultTemplate.test.ts`.
 * Exists so the happy path can be asserted against a RECORDING logger: that
 * suite's logger is a no-op stub (`debug() {}`) and is structurally unable to
 * assert silence.
 */
async function addTokenInvocation(
  store: InMemoryTripleStore,
  opts: { uid: string; tokenRefUid: string; parameter: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXO.term("Instance_class"),
      Namespace.EXOCMD.term("TokenInvocation"),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("TokenInvocation_token"),
      new IRI(`obsidian://vault/${opts.tokenRefUid}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("TokenInvocation_parameter"),
      new Literal(opts.parameter),
    ),
  ]);
}

async function addInvocationWithoutClassTriple(
  store: InMemoryTripleStore,
  opts: { uid: string; tokenRefUid: string; parameter: string },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("TokenInvocation_token"),
      new IRI(`obsidian://vault/${opts.tokenRefUid}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("TokenInvocation_parameter"),
      new Literal(opts.parameter),
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
// Deliberately never seeded — models the cold-start race (value asset absent).
// MUST be valid UUID-v4 shape, otherwise `looksLikeUUID` short-circuits into
// the legacy-symbolic branch and the test would exercise the wrong fallback.
const TOKEN_ABSENT_UID        = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// An ordinary asset (not a SubstitutionToken) — the common, correct path.
const PLAIN_ASSET_UID         = "99999999-9999-4999-8999-999999999999";
// req 81d2e07e — an invocation whose class triple never loaded. Distinct UID:
// ⛤ Deliberately NOT written `@req:<8 chars>`: that is the BINDING syntax, and
// a truncated one is malformed — `requirements-audit` matches full UUIDs only,
// so it would be an orphan tag, while archgate REQ-001 flags it as a warning
// (non-blocking, hence invisible in a green CI). The four real bindings for
// this requirement are the `it(...)` titles below.
// reusing an existing fixture constant is exactly how the earlier axis silently
// measured the wrong branch (see the guard in the TOKEN_ABSENT_UID test).
const INVOCATION_NO_CLASS_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
// …and its well-formed twin: class triple PRESENT. Locks the ORDER of the two
// checks, which nothing else does.
const INVOCATION_OK_UID       = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

  // ──────────────────────────────────────────────────────────────────────────
  // The two fallbacks that used to be SILENT. Both emit `"[[<uid>]]"` — the
  // exact shape observed corrupting `exo__Asset_label` in the live vault
  // (defect 0310aa28) — and neither logged anything, which made the class
  // undiagnosable: the root had to be narrowed by ELIMINATION rather than
  // measured. These lock the diagnostics, not the corruption itself.
  // ──────────────────────────────────────────────────────────────────────────

  it("@req:ef825945-62a8-4a9d-b5ea-5992903d3bff dispatches a token whose exo__Instance_class did not load, instead of writing a link into the value", async () => {
    // THE defect: with the class triple missing, the token was classified
    // "not a token" and its ref was emitted as `"[[<uid>]]"` — landing in
    // exo__Asset_label where the substituted value belonged. The resolver
    // property breaks the tie; it is exclusive to the class (measured 17/17 on
    // both live vaults), so plain asset refs are unaffected.
    await addTokenWithoutClassTriple(store, {
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
      label: "Grounding whose token lost its class triple",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);
    const value = cmd!.grounding.propertyDefault![0].value;

    // Dispatched — a marker, NOT the corrupting wikilink.
    expect(value).toContain("__SUBSTITUTE__");
    expect(value).not.toContain(`[[${TOKEN_TODAY_UID}]]`);
    // Recovery is quiet on the warn channel: nothing was damaged.
    expect(logger.warnings).toHaveLength(0);
  });

  it("@req:ef825945-62a8-4a9d-b5ea-5992903d3bff still emits a wikilink for a plain asset that merely lacks a class triple", async () => {
    // Non-vacuity control for the tie-breaker: the fallback must key on the
    // RESOLVER property, not merely on "class triple missing" — otherwise every
    // unindexed plain ref would be mis-dispatched as a token.
    //
    // ⛔ The emitted VALUE alone cannot prove this, and asserting only that was
    // this test's first, vacuous form: a mis-dispatched plain asset reaches
    // `dispatchSubstitutionToken`, finds no `_resolver`, and falls back to the
    // SAME `"[[<uid>]]"` string. The discriminator is the WARN it emits on that
    // path — proven by the mutant that makes the tie-breaker fire on any
    // class-less asset.
    await store.addAll([
      new Triple(
        new IRI(`obsidian://vault/${PLAIN_ASSET_UID}.md`),
        Namespace.EXO.term("Asset_uid"),
        new Literal(PLAIN_ASSET_UID),
      ),
    ]);
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: PLAIN_ASSET_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with a class-less plain asset ref",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `"[[${PLAIN_ASSET_UID}]]"`,
    );
    // Never entered token dispatch: that path warns about the missing resolver.
    expect(logger.warnings).toHaveLength(0);
  });

  it("@req:b354316b-3b26-478b-a8c0-18606da8e6ec warns when the PropertyDefault value asset is absent from the store (cold-start race)", async () => {
    // NOTE: the value ref is deliberately NOT seeded — this models the
    // cold-start race where the command definition is parsed before the token
    // asset has been indexed. Production then bakes the wikilink into a
    // session-cached command template, poisoning every instance created in
    // that session.
    // GUARD: ask the STORE whether the UID is seeded, rather than diffing
    // against a hand-listed set of fixture constants. The enumeration form
    // silently stops covering fixtures added later; this asks the same
    // question `findSubjectByUID` asks. (This test first used the same
    // constant as GROUNDING_UID and so measured the OTHER fallback while
    // still looking plausible.)
    const seeded = (
      await store.match(undefined, Namespace.EXO.term("Asset_uid"), undefined)
    ).filter(
      (tr) => tr.object instanceof Literal && tr.object.value === TOKEN_ABSENT_UID,
    );
    expect(seeded).toHaveLength(0);
    // …and the index `findSubjectByUID` consults FIRST: it keys on the UUID
    // inside the SUBJECT IRI, not on Asset_uid triples. Asserting only the
    // Asset_uid scan would pass for a fixture seeded as
    // `obsidian://vault/<uid>.md` with no Asset_uid triple — routing this test
    // to the OTHER fallback while the guard still reported "unseeded", which is
    // verbatim the failure the guard exists to prevent.
    expect(await store.findSubjectsByUUID(TOKEN_ABSENT_UID)).toHaveLength(0);
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_ABSENT_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding whose token asset is not in the store",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `"[[${TOKEN_ABSENT_UID}]]"`,
    );
    // The warning is the whole deliverable: it must name the value uid (what
    // to look for), the property (where the damage lands) and the grounding
    // (which command) — enough to identify the case without a repro.
    const hit = logger.warnings.find((w) => w.includes(TOKEN_ABSENT_UID));
    expect(hit).toBeDefined();
    expect(hit).toContain(GROUNDING_UID);
    expect(hit).toMatch(/not in store/);
    // The user-facing string must NOT assert a cause the PR itself calls
    // unmeasured — candidate causes live in the code comment.
    expect(hit).not.toMatch(/cold-start|pruned vault/);
  });

  it("@req:b354316b-3b26-478b-a8c0-18606da8e6ec warns ONCE per (grounding, value) across repeated resolves", async () => {
    // `warn` is routed to a user-facing Obsidian toast AND the log file, and
    // this branch re-runs on every button render. Undeduped, one dangling ref
    // would toast on every render (precedent: #3186, ~6 MB of log in two days).
    //
    // ⛤ The production re-entry chain is: `.md` save → reindex +
    // `invalidateCache()` (ExocortexPlugin.ts:2867) → next render misses the
    // `resolveForAsset` caches → `loadCommand` → here. `loadCommand` itself is
    // UNCACHED, so two direct loads reproduce the repetition exactly; an
    // `invalidateCache()` call in this test would be INERT (proven: removing it
    // left the suite green), and asserting otherwise would be one more comment
    // claiming a mechanism it does not have.
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: TOKEN_ABSENT_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding re-resolved after invalidation",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    await resolver.loadCommand(COMMAND_UID);
    const afterFirst = logger.warnings.length;
    expect(afterFirst).toBe(1);

    await resolver.loadCommand(COMMAND_UID);

    expect(logger.warnings).toHaveLength(afterFirst);
  });

  it("@req:b354316b-3b26-478b-a8c0-18606da8e6ec logs at debug (never warn) when the PropertyDefault value is a plain asset, not a token", async () => {
    // A plain asset ref is the COMMON, correct path: a wikilink IS the intended
    // value. Warning here would fire on every assetRef field and drown the
    // cold-start warning above — the level is part of the spec, not taste.
    await addLabelledAsset(store, PLAIN_ASSET_UID, "Some ordinary asset");
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: PLAIN_ASSET_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with a plain asset ref",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `"[[${PLAIN_ASSET_UID}]]"`,
    );
    expect(logger.warnings).toHaveLength(0);
    expect(
      logger.debugs.some((d) => d.includes(PLAIN_ASSET_UID)),
    ).toBe(true);
  });

  it("@req:b354316b-3b26-478b-a8c0-18606da8e6ec stays silent on the happy path (valid token resolves, no fallback taken)", async () => {
    // Non-vacuity control: without this, both assertions above could pass on a
    // build that logs unconditionally.
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
      label: "Grounding with a valid token",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Marker, not a wikilink — no fallback was taken.
    expect(cmd!.grounding.propertyDefault![0].value).toContain("__SUBSTITUTE__");
    expect(logger.warnings).toHaveLength(0);
    expect(logger.debugs.some((d) => d.includes(TOKEN_TODAY_UID))).toBe(false);
  });

  it("@req:81d2e07e-413e-4e40-9159-83ccdb813561 dispatches an invocation whose exo__Instance_class did not load", async () => {
    // The SECOND door to defect 0310aa28, and the one reached FIRST:
    // `assetIsTokenInvocation` runs before `assetIsSubstitutionToken`. Without
    // the `_token` tell, a class-less invocation is judged "not an invocation",
    // falls through to the SubstitutionToken check — which cannot catch it
    // either (an invocation carries no `_resolver`) — and the ref is emitted as
    // a wikilink where the substituted value belonged.
    await addSubstitutionToken(store, {
      uid: TOKEN_TODAY_UID,
      label: "$today",
      resolverId: "today",
    });
    await addInvocationWithoutClassTriple(store, {
      uid: INVOCATION_NO_CLASS_UID,
      tokenRefUid: TOKEN_TODAY_UID,
      parameter: "+1d",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: INVOCATION_NO_CLASS_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding whose value is an invocation with no class triple",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    const value = cmd!.grounding.propertyDefault![0].value;
    // Assert BOTH: that the corruption shape is gone AND that the invocation
    // actually dispatched. The first alone would pass on a build that emits any
    // non-wikilink string; the second alone would pass if the wikilink form
    // happened to contain a marker.
    expect(value).not.toBe(`"[[${INVOCATION_NO_CLASS_UID}]]"`);
    // `_P` is the PARAMETERISED marker — the bare-token path emits
    // `__SUBSTITUTE__` without it, so this suffix alone proves the INVOCATION
    // branch ran rather than a plain token dispatch.
    expect(value).toContain("__SUBSTITUTE_P__");
    expect(value).toContain(TOKEN_TODAY_UID);
    // The parameter travels base64-encoded: "+1d" -> "KzFk". Asserted as the
    // literal rather than re-deriving it in the test, so a change to the
    // encoding surfaces here instead of being tracked silently.
    expect(value).toContain("KzFk");

    const hit = logger.debugs.find((d) => d.includes(INVOCATION_NO_CLASS_UID));
    expect(hit).toBeDefined();
    expect(hit).toMatch(/TokenInvocation/);
  });

  it("@req:81d2e07e-413e-4e40-9159-83ccdb813561 does not mis-attribute the invocation to the SubstitutionToken branch", async () => {
    // Before the tell, this asset reached the `!isSubstitutionToken` branch,
    // whose line reads "is not a SubstitutionToken" — literally true, and it
    // sends the reader hunting for a `_resolver` an invocation can never carry.
    // The diagnostic must name the door that was actually taken.
    await addSubstitutionToken(store, {
      uid: TOKEN_TODAY_UID,
      label: "$today",
      resolverId: "today",
    });
    await addInvocationWithoutClassTriple(store, {
      uid: INVOCATION_NO_CLASS_UID,
      tokenRefUid: TOKEN_TODAY_UID,
      parameter: "+1d",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: INVOCATION_NO_CLASS_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding whose value is an invocation with no class triple",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    await resolver.loadCommand(COMMAND_UID);

    const about = logger.debugs.filter((d) =>
      d.includes(INVOCATION_NO_CLASS_UID),
    );
    expect(about.length).toBeGreaterThan(0);
    expect(
      about.some((d) => /is not a SubstitutionToken/.test(d)),
    ).toBe(false);
  });

  it("@req:81d2e07e-413e-4e40-9159-83ccdb813561 leaves a plain class-less asset as a wikilink (tell keys on _token, not on 'class missing')", async () => {
    // Non-vacuity control, and the one that matters most here: a tell that fired
    // on ANY asset lacking a class triple would mis-dispatch every unindexed
    // plain ref. Seeded WITHOUT a class triple on purpose — that is the input a
    // too-broad tell would swallow.
    const subject = new IRI(`obsidian://vault/${PLAIN_ASSET_UID}.md`);
    await store.addAll([
      new Triple(
        subject,
        Namespace.EXO.term("Asset_uid"),
        new Literal(PLAIN_ASSET_UID),
      ),
      new Triple(
        subject,
        Namespace.EXO.term("Asset_label"),
        new Literal("Ordinary asset, no class triple, no _token"),
      ),
    ]);
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: PLAIN_ASSET_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with a class-less plain asset ref",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault![0].value).toBe(
      `"[[${PLAIN_ASSET_UID}]]"`,
    );
    // Value alone is a weak assertion — a mis-dispatched plain asset falls back
    // to the SAME string further down. Assert the classification never claimed
    // TokenInvocation, and that nothing escalated to a user-facing toast.
    expect(
      logger.debugs.some(
        (d) => d.includes(PLAIN_ASSET_UID) && /TokenInvocation/.test(d),
      ),
    ).toBe(false);
    expect(logger.warnings).toHaveLength(0);
  });

  it("@req:81d2e07e-413e-4e40-9159-83ccdb813561 stays silent for a well-formed invocation (class present) — locks the ORDER of the two checks", async () => {
    // This axis exists because the ordering rationale in the source comment was
    // otherwise ARGUED, not locked: permuting the two checks left the whole
    // suite green, so nothing would have caught it.
    //
    // Every well-formed invocation carries BOTH signals. Run the `_token` check
    // first and the debug line — which asserts `exo__Instance_class was absent
    // or unresolved` — fires on an invocation whose class is right there,
    // i.e. it starts lying. The order is what keeps that line honest, and this
    // test is what keeps the order.
    //
    // ⛤ The sibling suite has a happy-path invocation fixture already, but its
    // logger is a no-op stub (`debug() {}`) — structurally unable to assert
    // silence. Hence the fixture is rebuilt here against the recording logger.
    await addSubstitutionToken(store, {
      uid: TOKEN_TODAY_UID,
      label: "$today",
      resolverId: "today",
    });
    await addTokenInvocation(store, {
      uid: INVOCATION_OK_UID,
      tokenRefUid: TOKEN_TODAY_UID,
      parameter: "+1d",
    });
    await addPropertyDefault(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: INVOCATION_OK_UID,
    });
    await addGrounding(store, {
      uid: GROUNDING_UID,
      label: "Grounding with a well-formed invocation",
      propertyDefaultRefs: [PD_UID],
    });
    await addCommand(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Dispatched normally — proves the fixture really exercises the happy path
    // rather than silently failing somewhere before the diagnostic.
    expect(cmd!.grounding.propertyDefault![0].value).toContain(
      "__SUBSTITUTE_P__",
    );
    expect(logger.warnings).toHaveLength(0);
    // The claim under lock: no line may assert the class was absent, because
    // it is present.
    expect(
      logger.debugs.some((d) => /was absent or unresolved/.test(d)),
    ).toBe(false);
  });
});
