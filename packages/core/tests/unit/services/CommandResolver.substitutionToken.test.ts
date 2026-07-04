/**
 * CommandResolver — RFC v2 Phase 3a SubstitutionToken resolver registry
 * dispatched from PropertyDefault values (Issue kitelev/exocortex#3162).
 *
 * Coverage:
 * - Context-independent `today` resolver → resolved AT PARSE TIME to
 *   YYYY-MM-DD ISO date string. Asserted by regex (clock-flake safe).
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

  it("resolves a `today` SubstitutionToken at parse time to a YYYY-MM-DD literal", async () => {
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
    // Clock-flake safe assertion — regex, not literal.
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(logger.warnings).toHaveLength(0);
  });

  // #3811 — `$todayStart` canon: parse-time resolution emits the timezone-naive
  // `YYYY-MM-DDT00:00:00` shape (via DateFormatter.getTodayStartTimestamp),
  // matching the executor `$todayStart` (`${today}T00:00:00`) and the
  // effort/timestamp frontmatter convention. Revert-verify: the former
  // `new Date(...setHours(0,0,0,0)).toISOString()` emitted a UTC Z-instant
  // (`...T00:00:00.000Z`) → fails this naive-local shape → RED.
  it("resolves a `todayStart` SubstitutionToken at parse time to naive-local YYYY-MM-DDT00:00:00 (no Z, no millis) @req:ecb90c06-92af-41bd-bb81-1d4510e53fa3", async () => {
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
    // Naive-local midnight — NOT the former UTC Z-instant `...T00:00:00.000Z`.
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
    expect(value).not.toContain("Z");
    expect(value).not.toContain(".000");
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
