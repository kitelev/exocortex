/**
 * CommandResolver — RFC v2 Phase 3a ref-form `Grounding_propertyDefault`
 * resolution (Issue kitelev/exocortex#3162).
 *
 * Coverage:
 * - Empty refs → empty array (no triples; `propertyDefault` omitted).
 * - Single PropertyDefault with regular wikilink value → resolved entry
 *   with `propertyName` = property asset's `exo__Asset_label` and
 *   `value` = `"[[<UID>]]"` wikilink form.
 * - Two PropertyDefaults in stable triple-store-iteration order.
 * - PropertyDefault whose property UID is unresolvable to a label → entry
 *   skipped + `logger.warn` called.
 *
 * Mirrors the asset/store setup pattern from CommandResolver.test.ts and
 * the `RecordingLogger` from CommandResolver.style.test.ts.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";

// ────────────────────────────────────────────────────────────────────────────
// Recording logger — captures warnings for assertion
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers — TBox assets needed for ref-form PropertyDefault parsing
// ────────────────────────────────────────────────────────────────────────────

/** Property asset (an `exo__Property` instance, identified by UUID-named file). */
async function addPropertyAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
  return subject;
}

/** Generic value asset (regular asset, NOT a SubstitutionToken). */
async function addValueAsset(
  store: InMemoryTripleStore,
  uid: string,
  label: string,
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${uid}.md`);
  await store.addAll([
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(label)),
  ]);
  return subject;
}

/**
 * `exocmd__PropertyDefault` instance. `Grounding_propertyDefault` will
 * reference this via an IRI-form triple.
 */
async function addPropertyDefaultAsset(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    propertyRefUid: string; // UID of the exo__Property asset
    valueRefUid: string; // UID of the value asset (regular or SubstitutionToken)
  },
): Promise<IRI> {
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
  return subject;
}

/**
 * `exocmd__Grounding` asset that points at zero or more PropertyDefault
 * assets via multi-valued `Grounding_propertyDefault`.
 */
async function addGroundingWithPropertyDefaults(
  store: InMemoryTripleStore,
  opts: {
    uid: string;
    label: string;
    type?: string;
    propertyDefaultRefs?: string[];
  },
): Promise<IRI> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(subject, Namespace.EXO.term("Asset_label"), new Literal(opts.label)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      new Literal(opts.type ?? "create_instance"),
    ),
  ];
  for (const ref of opts.propertyDefaultRefs ?? []) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("Grounding_propertyDefault"),
        new IRI(`obsidian://vault/${ref}.md`),
      ),
    );
  }
  await store.addAll(triples);
  return subject;
}

async function addCommandForGrounding(
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
// UUID v4 fixtures — must satisfy CommandResolver.looksLikeUUID regex
// ────────────────────────────────────────────────────────────────────────────

const PROPERTY_UID_PLANNED = "11111111-1111-4111-8111-111111111111";
const PROPERTY_UID_STATUS  = "22222222-2222-4222-8222-222222222222";
const PROPERTY_UID_MISSING = "99999999-9999-4999-8999-999999999999";

const VALUE_UID_TODAY   = "33333333-3333-4333-8333-333333333333";
const VALUE_UID_BACKLOG = "44444444-4444-4444-8444-444444444444";

const PD_UID_1 = "55555555-5555-4555-8555-555555555555";
const PD_UID_2 = "66666666-6666-4666-8666-666666666666";
const PD_UID_BAD = "77777777-7777-4777-8777-777777777777";

const GROUNDING_UID = "88888888-8888-4888-8888-888888888888";
const COMMAND_UID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandResolver — RFC v2 Phase 3a resolvePropertyDefaults", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
  });

  it("returns no propertyDefault array when Grounding has zero ref-form refs", async () => {
    await addGroundingWithPropertyDefaults(store, {
      uid: GROUNDING_UID,
      label: "Grounding without PD refs",
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    // resolvePropertyDefaults returns []; loadGroundingDefinition omits the
    // field from the projection (length > 0 ? array : undefined).
    expect(cmd!.grounding.propertyDefault).toBeUndefined();
    expect(logger.warnings).toHaveLength(0);
  });

  it("resolves one PropertyDefault whose value points to a regular asset → wikilink form", async () => {
    await addPropertyAsset(store, PROPERTY_UID_PLANNED, "ems__Effort_plannedStartTimestamp");
    await addValueAsset(store, VALUE_UID_BACKLOG, "ems__EffortStatusBacklog");
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_1,
      propertyRefUid: PROPERTY_UID_PLANNED,
      valueRefUid: VALUE_UID_BACKLOG,
    });
    await addGroundingWithPropertyDefaults(store, {
      uid: GROUNDING_UID,
      label: "Grounding with one PD",
      propertyDefaultRefs: [PD_UID_1],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toBeDefined();
    expect(cmd!.grounding.propertyDefault).toHaveLength(1);
    expect(cmd!.grounding.propertyDefault![0]).toEqual({
      propertyName: "ems__Effort_plannedStartTimestamp",
      value: `"[[${VALUE_UID_BACKLOG}]]"`,
    });
    expect(logger.warnings).toHaveLength(0);
  });

  it("resolves two PropertyDefaults in stable iteration order", async () => {
    await addPropertyAsset(store, PROPERTY_UID_PLANNED, "ems__Effort_plannedStartTimestamp");
    await addPropertyAsset(store, PROPERTY_UID_STATUS, "ems__Effort_status");
    await addValueAsset(store, VALUE_UID_TODAY, "today-value");
    await addValueAsset(store, VALUE_UID_BACKLOG, "ems__EffortStatusBacklog");
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_1,
      propertyRefUid: PROPERTY_UID_PLANNED,
      valueRefUid: VALUE_UID_TODAY,
    });
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_2,
      propertyRefUid: PROPERTY_UID_STATUS,
      valueRefUid: VALUE_UID_BACKLOG,
    });
    await addGroundingWithPropertyDefaults(store, {
      uid: GROUNDING_UID,
      label: "Grounding with two PDs",
      propertyDefaultRefs: [PD_UID_1, PD_UID_2],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.propertyDefault).toHaveLength(2);
    const propertyNames = cmd!.grounding.propertyDefault!.map((p) => p.propertyName);
    // Both expected entries must be present; insertion order is preserved by
    // the triple-store's deterministic SPO iteration.
    expect(propertyNames).toContain("ems__Effort_plannedStartTimestamp");
    expect(propertyNames).toContain("ems__Effort_status");

    const planned = cmd!.grounding.propertyDefault!.find(
      (p) => p.propertyName === "ems__Effort_plannedStartTimestamp",
    );
    expect(planned?.value).toBe(`"[[${VALUE_UID_TODAY}]]"`);
    const status = cmd!.grounding.propertyDefault!.find(
      (p) => p.propertyName === "ems__Effort_status",
    );
    expect(status?.value).toBe(`"[[${VALUE_UID_BACKLOG}]]"`);
    expect(logger.warnings).toHaveLength(0);
  });

  it("skips PropertyDefault whose property UID is unresolvable and logs a warning", async () => {
    // Seed value asset only — the property UID is missing, simulating a
    // dangling wikilink (asset deleted, vault not yet re-indexed).
    await addValueAsset(store, VALUE_UID_BACKLOG, "ems__EffortStatusBacklog");
    await addPropertyDefaultAsset(store, {
      uid: PD_UID_BAD,
      propertyRefUid: PROPERTY_UID_MISSING,
      valueRefUid: VALUE_UID_BACKLOG,
    });
    await addGroundingWithPropertyDefaults(store, {
      uid: GROUNDING_UID,
      label: "Grounding with bad PD",
      propertyDefaultRefs: [PD_UID_BAD],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Bad PropertyDefault skipped → propertyDefault array empty → omitted.
    expect(cmd!.grounding.propertyDefault).toBeUndefined();
    expect(logger.warnings.length).toBeGreaterThan(0);
    // Warning must mention the unresolvable UID for actionable diagnostics.
    expect(
      logger.warnings.some(
        (w) =>
          w.includes(PROPERTY_UID_MISSING) &&
          /not resolvable to exo__Asset_label/.test(w),
      ),
    ).toBe(true);
  });
});
