/**
 * CommandResolver — RFC v2 Phase 3a ref-form Grounding BDD scenarios
 * (Issue kitelev/exocortex#3162).
 *
 * Feature: CommandResolver — ref-form PropertyDefault and InheritanceRule
 *
 * Why BDD-style here, not Cucumber: `packages/core` has no
 * `@cucumber/cucumber` / `jest-cucumber` dependency. The package's `tests/`
 * tree is jest-only. Existing BDD feature files live under
 * `packages/cli/specs/features/`, driven by package-local step definitions
 * whose imports cannot reach
 * the exocortex package internals (CommandResolver) without significant
 * wiring. To keep the BDD-style verification close to the unit being tested
 * — and to land within scope — these 4 scenarios are expressed as
 * Given/When/Then-shaped jest `describe`/`it` blocks. Naming convention
 * `.bdd.test.ts` flags the intent; each `it` block names its scenario
 * verbatim.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";

// ────────────────────────────────────────────────────────────────────────────
// BDD scaffolding — recording logger, asset builders. Kept self-contained so
// the file is readable as a feature spec in isolation.
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

async function givenLabelledAsset(
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

async function givenSubstitutionToken(
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

async function givenPropertyDefault(
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

interface InheritanceRuleSpec {
  uid: string;
  sourcePropertyRefUid: string;
  targetPropertyRefUid: string;
  targetClassConditionRefUid?: string;
  targetClassExclusionRefUids?: string[];
  priority?: number;
}

async function givenInheritanceRule(
  store: InMemoryTripleStore,
  opts: InheritanceRuleSpec,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("InheritanceRule"),
    ),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXOCMD.term("InheritanceRule_sourceProperty"),
      new IRI(`obsidian://vault/${opts.sourcePropertyRefUid}.md`),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("InheritanceRule_targetProperty"),
      new IRI(`obsidian://vault/${opts.targetPropertyRefUid}.md`),
    ),
  ];
  if (opts.targetClassConditionRefUid) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassCondition"),
        new IRI(`obsidian://vault/${opts.targetClassConditionRefUid}.md`),
      ),
    );
  }
  for (const excl of opts.targetClassExclusionRefUids ?? []) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassExclusion"),
        new IRI(`obsidian://vault/${excl}.md`),
      ),
    );
  }
  if (opts.priority !== undefined) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("InheritanceRule_priority"),
        new Literal(String(opts.priority)),
      ),
    );
  }
  await store.addAll(triples);
}

interface GroundingSpec {
  uid: string;
  label?: string;
  propertyDefaultRefs?: string[];
  inheritanceRuleRefs?: string[];
}

async function givenGrounding(
  store: InMemoryTripleStore,
  opts: GroundingSpec,
): Promise<void> {
  const subject = new IRI(`obsidian://vault/${opts.uid}.md`);
  const triples: Triple[] = [
    new Triple(subject, Namespace.RDF.term("type"), Namespace.EXOCMD.term("Grounding")),
    new Triple(subject, Namespace.EXO.term("Asset_uid"), new Literal(opts.uid)),
    new Triple(
      subject,
      Namespace.EXO.term("Asset_label"),
      new Literal(opts.label ?? opts.uid),
    ),
    new Triple(
      subject,
      Namespace.EXOCMD.term("Grounding_type"),
      // RFC 9d20c91f Phase 3: wikilink-form UID ref into exocmd__GroundingType
      // catalog (create_instance → 4367e2d6), not a bare-string literal. Legacy
      // bare-string resolves to null → grounding inert → command dropped (#3506).
      new Literal("[[4367e2d6-6c92-450a-becb-abce1fb07682]]"),
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
  for (const ref of opts.inheritanceRuleRefs ?? []) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("Grounding_inheritanceRule"),
        new IRI(`obsidian://vault/${ref}.md`),
      ),
    );
  }
  await store.addAll(triples);
}

async function givenCommand(
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
// UUID v4 fixtures (per-scenario UIDs declared inside their describe blocks).
// ────────────────────────────────────────────────────────────────────────────

const PROP_UID_PRIMARY  = "11111111-1111-4111-8111-111111111111";
const VALUE_UID_BACKLOG = "22222222-2222-4222-8222-222222222222";
const TOKEN_UID_TODAY   = "33333333-3333-4333-8333-333333333333";

const PROP_UID_TARGET_INHERITED = "44444444-4444-4444-8444-444444444444";

const COND_CLASS_AREA = "55555555-5555-4555-8555-555555555555";
const EXCL_CLASS_TASK = "66666666-6666-4666-8666-666666666666";

const PD_UID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const RULE_UID_COND   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE_UID_EXCL   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_UID_UNCOND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const GROUNDING_UID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMMAND_UID   = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ────────────────────────────────────────────────────────────────────────────
// Feature: CommandResolver — ref-form PropertyDefault and InheritanceRule
// (RFC v2 Phase 3a)
// ────────────────────────────────────────────────────────────────────────────

describe("Feature: CommandResolver — ref-form PropertyDefault and InheritanceRule (RFC v2 Phase 3a)", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(() => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);
  });

  it(
    "Scenario: PropertyDefault refs resolve to array — " +
      "Given a Grounding asset with ref-form Grounding_propertyDefault pointing to 1 PropertyDefault instance " +
      "When the grounding is loaded by CommandResolver " +
      "Then the returned GroundingDefinition.propertyDefault has length 1 " +
      "And the entry's propertyName matches the resolved exo__Asset_label",
    async () => {
      // Given
      await givenLabelledAsset(store, PROP_UID_PRIMARY, "ems__Effort_plannedStartTimestamp");
      await givenLabelledAsset(store, VALUE_UID_BACKLOG, "ems__EffortStatusBacklog");
      await givenPropertyDefault(store, {
        uid: PD_UID_1,
        propertyRefUid: PROP_UID_PRIMARY,
        valueRefUid: VALUE_UID_BACKLOG,
      });
      await givenGrounding(store, {
        uid: GROUNDING_UID,
        label: "Grounding-1 PD ref",
        propertyDefaultRefs: [PD_UID_1],
      });
      await givenCommand(store, COMMAND_UID, GROUNDING_UID);

      // When
      const cmd = await resolver.loadCommand(COMMAND_UID);

      // Then
      expect(cmd).not.toBeNull();
      expect(cmd!.grounding.propertyDefault).toHaveLength(1);
      expect(cmd!.grounding.propertyDefault![0].propertyName).toBe(
        "ems__Effort_plannedStartTimestamp",
      );
    },
  );

  it(
    "Scenario: InheritanceRule mutual exclusion (3 rules) — " +
      "Given a Grounding asset with 3 InheritanceRule refs (Area condition prio 100, non-Area exclusion prio 50, unconditional prio 10) " +
      "When the grounding is loaded " +
      "Then the returned GroundingDefinition.inheritanceRule has length 3 " +
      "And priorities [100, 50, 10] are all present",
    async () => {
      // Given
      await givenLabelledAsset(store, PROP_UID_PRIMARY, "ems__Effort_area");
      await givenLabelledAsset(store, PROP_UID_TARGET_INHERITED, "ems__Effort_areaInherited");
      await givenLabelledAsset(store, COND_CLASS_AREA, "ems__Area");
      await givenLabelledAsset(store, EXCL_CLASS_TASK, "ems__Task");

      await givenInheritanceRule(store, {
        uid: RULE_UID_COND,
        sourcePropertyRefUid: PROP_UID_PRIMARY,
        targetPropertyRefUid: PROP_UID_TARGET_INHERITED,
        targetClassConditionRefUid: COND_CLASS_AREA,
        priority: 100,
      });
      await givenInheritanceRule(store, {
        uid: RULE_UID_EXCL,
        sourcePropertyRefUid: PROP_UID_PRIMARY,
        targetPropertyRefUid: PROP_UID_TARGET_INHERITED,
        targetClassExclusionRefUids: [EXCL_CLASS_TASK],
        priority: 50,
      });
      await givenInheritanceRule(store, {
        uid: RULE_UID_UNCOND,
        sourcePropertyRefUid: PROP_UID_PRIMARY,
        targetPropertyRefUid: PROP_UID_TARGET_INHERITED,
        priority: 10,
      });
      await givenGrounding(store, {
        uid: GROUNDING_UID,
        label: "Grounding-3 IRs",
        inheritanceRuleRefs: [RULE_UID_COND, RULE_UID_EXCL, RULE_UID_UNCOND],
      });
      await givenCommand(store, COMMAND_UID, GROUNDING_UID);

      // When
      const cmd = await resolver.loadCommand(COMMAND_UID);

      // Then
      expect(cmd!.grounding.inheritanceRule).toHaveLength(3);
      const priorities = cmd!.grounding.inheritanceRule!.map((r) => r.priority);
      // Iteration order is store-dependent but unique priorities allow a
      // set-equality check that is robust against re-ordering.
      expect(new Set(priorities)).toEqual(new Set([100, 50, 10]));
    },
  );

  // RFC v2 Phase 5 (#3167): the coexistence scenario (legacy JSON +
  // ref-form together → ref-form wins, deprecation warning) was removed
  // alongside the legacy parser. Ref-form is the only path.

  it(
    "Scenario: SubstitutionToken execute-time marker (bug 3883) — " +
      "Given a PropertyDefault with value pointing to SubstitutionToken (resolver `today`) " +
      "When the grounding is loaded " +
      "Then the returned value is the execute-time marker (never a parse-time-baked day)",
    async () => {
      // Given
      await givenLabelledAsset(store, PROP_UID_PRIMARY, "ems__Effort_plannedStartTimestamp");
      await givenSubstitutionToken(store, {
        uid: TOKEN_UID_TODAY,
        label: "$today",
        resolverId: "today",
      });
      await givenPropertyDefault(store, {
        uid: PD_UID_1,
        propertyRefUid: PROP_UID_PRIMARY,
        valueRefUid: TOKEN_UID_TODAY,
      });
      await givenGrounding(store, {
        uid: GROUNDING_UID,
        label: "Grounding-$today",
        propertyDefaultRefs: [PD_UID_1],
      });
      await givenCommand(store, COMMAND_UID, GROUNDING_UID);

      // When
      const cmd = await resolver.loadCommand(COMMAND_UID);

      // Then — bug 3883: `today` emits an execute-time marker resolved fresh per
      // execution, not a parse-time-baked calendar day frozen for the session.
      expect(cmd!.grounding.propertyDefault).toHaveLength(1);
      expect(cmd!.grounding.propertyDefault![0].value).toBe(
        `__SUBSTITUTE__today__${TOKEN_UID_TODAY}__`,
      );
      expect(cmd!.grounding.propertyDefault![0].value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
  );
});
