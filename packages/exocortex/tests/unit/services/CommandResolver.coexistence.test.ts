/**
 * CommandResolver — RFC v2 Phase 3a coexistence rule
 * (Issue kitelev/exocortex#3162).
 *
 * Coverage:
 * - Grounding with BOTH legacy `Grounding_propertyDefaults` JSON literal
 *   AND ref-form `Grounding_propertyDefault` refs → ref-form wins,
 *   legacy is dropped (`propertyDefaults` undefined), one warning logged.
 * - Same Grounding parsed twice (via two distinct commands sharing it) →
 *   warn is emitted **once** total per resolver instance / Grounding-uid.
 *   `loadCommand` does not memoise, so the second call does re-enter the
 *   coexistence branch — the warn-suppression Set must engage.
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

async function addPropertyDefaultAsset(
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

/**
 * Grounding with BOTH legacy JSON `propertyDefaults` AND ref-form
 * `Grounding_propertyDefault` (coexistence scenario).
 */
async function addGroundingWithBothShapes(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    legacyJson: string;
    refUids: string[];
  },
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal("create_instance"),
    ),
    // Legacy JSON literal — must remain valid JSON object so the parser does
    // not throw before reaching the coexistence branch.
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_propertyDefaults"),
      new Literal(opts.legacyJson),
    ),
  ];
  for (const ref of opts.refUids) {
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

const PROP_UID  = "11111111-1111-4111-8111-111111111111";
const VALUE_UID = "22222222-2222-4222-8222-222222222222";
const PD_UID    = "33333333-3333-4333-8333-333333333333";

const GROUNDING_UID = "44444444-4444-4444-8444-444444444444";
const COMMAND_A     = "55555555-5555-4555-8555-555555555555";
const COMMAND_B     = "66666666-6666-4666-8666-666666666666";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandResolver — RFC v2 Phase 3a coexistence (ref-form vs legacy JSON)", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);

    // Seed property + value + PropertyDefault assets common to both tests.
    await addLabelledAsset(store, PROP_UID, "ems__Effort_plannedStartTimestamp");
    await addLabelledAsset(store, VALUE_UID, "ems__EffortStatusBacklog");
    await addPropertyDefaultAsset(store, {
      uid: PD_UID,
      propertyRefUid: PROP_UID,
      valueRefUid: VALUE_UID,
    });
  });

  it("drops legacy propertyDefaults JSON when ref-form propertyDefault is present (one warn)", async () => {
    await addGroundingWithBothShapes(store, {
      uid: GROUNDING_UID,
      label: "Coexistence grounding",
      legacyJson: '{"ems__Effort_status":"[[legacy-default]]"}',
      refUids: [PD_UID],
    });
    await addCommand(store, COMMAND_A, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_A);

    expect(cmd).not.toBeNull();
    // Ref-form wins → legacy JSON dropped → propertyDefaults undefined.
    expect(cmd!.grounding.propertyDefaults).toBeUndefined();
    // Ref-form entry survives.
    expect(cmd!.grounding.propertyDefault).toBeDefined();
    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    expect(cmd!.grounding.propertyDefault![0].propertyName).toBe(
      "ems__Effort_plannedStartTimestamp",
    );

    // Exactly one deprecation warning, mentioning both the Grounding-uid and
    // the precedence direction.
    const coexistenceWarns = logger.warnings.filter((w) =>
      /legacy exocmd__Grounding_propertyDefaults JSON ignored/.test(w),
    );
    expect(coexistenceWarns).toHaveLength(1);
    expect(coexistenceWarns[0]).toContain(GROUNDING_UID);
    expect(coexistenceWarns[0]).toContain("ref-form");
  });

  it("warns once per Grounding-uid across multiple loadCommand calls on the same resolver", async () => {
    await addGroundingWithBothShapes(store, {
      uid: GROUNDING_UID,
      label: "Coexistence grounding (shared)",
      legacyJson: '{"ems__Effort_status":"[[legacy-default]]"}',
      refUids: [PD_UID],
    });
    // Two distinct Commands sharing the SAME Grounding — guarantees two
    // re-entries into loadGroundingDefinition (loadCommand has no result
    // cache; resolveForAsset's cache is irrelevant here).
    await addCommand(store, COMMAND_A, GROUNDING_UID);
    await addCommand(store, COMMAND_B, GROUNDING_UID);

    const cmdA = await resolver.loadCommand(COMMAND_A);
    const cmdB = await resolver.loadCommand(COMMAND_B);

    expect(cmdA).not.toBeNull();
    expect(cmdB).not.toBeNull();

    const coexistenceWarns = logger.warnings.filter((w) =>
      /legacy exocmd__Grounding_propertyDefaults JSON ignored/.test(w),
    );
    // Once-per-session-per-Grounding-uid suppression: even though the
    // Grounding was parsed twice, only one coexistence warn was emitted.
    expect(coexistenceWarns).toHaveLength(1);
  });
});
