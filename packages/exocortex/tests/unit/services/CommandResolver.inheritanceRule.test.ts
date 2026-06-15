/**
 * CommandResolver — RFC v2 Phase 3a ref-form `Grounding_inheritanceRule`
 * resolution (Issue kitelev/exocortex#3162).
 *
 * Coverage:
 * - Empty refs → no `inheritanceRule` field (optional).
 * - Three rules covering all branches: targetClassCondition,
 *   targetClassExclusion multi, unconditional — priorities + props parsed.
 * - Missing `InheritanceRule_priority` literal → default 50.
 * - Multi-valued `InheritanceRule_targetClassExclusion` → array of labels.
 *
 * Mirrors fixture patterns from CommandResolver.test.ts /
 * CommandResolver.style.test.ts.
 */

import { CommandResolver } from "../../../src/services/CommandResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../src/domain/models/rdf/Namespace";
import type { ILogger } from "../../../src/interfaces/ILogger";
import type { InheritanceRuleResolved } from "../../../src/domain/models/CommandDefinition";

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

interface InheritanceRuleOpts {
  uid: string;
  sourcePropertyRefUid: string;
  targetPropertyRefUid: string;
  targetClassConditionRefUid?: string;
  targetClassExclusionRefUids?: string[];
  priority?: number; // numeric → emitted as Literal(string); omit → no triple
}

async function addInheritanceRuleAsset(
  store: InMemoryTripleStore,
  opts: InheritanceRuleOpts,
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
  for (const exclUid of opts.targetClassExclusionRefUids ?? []) {
    triples.push(
      new Triple(
        subject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassExclusion"),
        new IRI(`obsidian://vault/${exclUid}.md`),
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

async function addGroundingWithInheritanceRules(
  store: InMemoryTripleStore,
  opts: { uid: string; label: string; ruleRefUids: string[] },
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
  for (const ref of opts.ruleRefUids) {
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
// UUID v4 fixtures
// ────────────────────────────────────────────────────────────────────────────

const SRC_PROP_UID = "11111111-1111-4111-8111-111111111111";
const TGT_PROP_UID = "22222222-2222-4222-8222-222222222222";

const COND_CLASS_AREA   = "33333333-3333-4333-8333-333333333333";
const EXCL_CLASS_TASK   = "44444444-4444-4444-8444-444444444444";
const EXCL_CLASS_PROJ   = "55555555-5555-4555-8555-555555555555";

const RULE_UID_COND      = "66666666-6666-4666-8666-666666666666";
const RULE_UID_EXCL      = "77777777-7777-4777-8777-777777777777";
const RULE_UID_UNCOND    = "88888888-8888-4888-8888-888888888888";

const GROUNDING_UID = "99999999-9999-4999-8999-999999999999";
const COMMAND_UID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("CommandResolver — RFC v2 Phase 3a resolveInheritanceRules", () => {
  let store: InMemoryTripleStore;
  let logger: RecordingLogger;
  let resolver: CommandResolver;

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    logger = makeRecordingLogger();
    resolver = new CommandResolver(store, logger);

    // Seed common labelled assets — properties + classes used by most cases.
    await addLabelledAsset(store, SRC_PROP_UID, "ems__Effort_area");
    await addLabelledAsset(store, TGT_PROP_UID, "ems__Effort_areaInherited");
    await addLabelledAsset(store, COND_CLASS_AREA, "ems__Area");
    await addLabelledAsset(store, EXCL_CLASS_TASK, "ems__Task");
    await addLabelledAsset(store, EXCL_CLASS_PROJ, "ems__Project");
  });

  it("returns no inheritanceRule field when Grounding has zero ref-form refs", async () => {
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding without IR refs",
      ruleRefUids: [],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd).not.toBeNull();
    expect(cmd!.grounding.inheritanceRule).toBeUndefined();
    expect(logger.warnings).toHaveLength(0);
  });

  it("parses 3 rules (condition / exclusion / unconditional) with all 5 properties each", async () => {
    // Rule A — condition only, priority 100.
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_COND,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      targetClassConditionRefUid: COND_CLASS_AREA,
      priority: 100,
    });
    // Rule B — exclusion of two classes, priority 50.
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_EXCL,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      targetClassExclusionRefUids: [EXCL_CLASS_TASK, EXCL_CLASS_PROJ],
      priority: 50,
    });
    // Rule C — unconditional, priority 10.
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_UNCOND,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      priority: 10,
    });

    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with 3 IRs",
      ruleRefUids: [RULE_UID_COND, RULE_UID_EXCL, RULE_UID_UNCOND],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.inheritanceRule).toBeDefined();
    expect(cmd!.grounding.inheritanceRule).toHaveLength(3);

    // Find each rule by priority — order is store-iteration-dependent, but
    // priorities are unique per fixture, so a priority-keyed lookup is stable.
    const byPriority = new Map<number, InheritanceRuleResolved>();
    for (const rule of cmd!.grounding.inheritanceRule!) {
      byPriority.set(rule.priority, rule);
    }

    const cond = byPriority.get(100);
    expect(cond).toBeDefined();
    expect(cond!.sourcePropertyName).toBe("ems__Effort_area");
    expect(cond!.targetPropertyName).toBe("ems__Effort_areaInherited");
    expect(cond!.targetClassCondition).toBe("ems__Area");
    // Issue #3562: the UID-canon form of the condition is carried alongside the
    // label, so the executor can match UID↔UID without the (post-apply lagging)
    // label→UID resolver.
    expect(cond!.targetClassConditionUid).toBe(COND_CLASS_AREA);
    expect(cond!.targetClassExclusion).toEqual([]);

    const excl = byPriority.get(50);
    expect(excl).toBeDefined();
    expect(excl!.targetClassCondition).toBeUndefined();
    // Both excluded classes must be present.
    expect(excl!.targetClassExclusion).toEqual(
      expect.arrayContaining(["ems__Task", "ems__Project"]),
    );
    expect(excl!.targetClassExclusion).toHaveLength(2);

    const uncond = byPriority.get(10);
    expect(uncond).toBeDefined();
    expect(uncond!.targetClassCondition).toBeUndefined();
    expect(uncond!.targetClassExclusion).toEqual([]);
  });

  it("defaults priority to 50 when InheritanceRule_priority literal is absent", async () => {
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_UNCOND,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      // priority omitted → no Literal triple → resolver default 50
    });
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with default-prio rule",
      ruleRefUids: [RULE_UID_UNCOND],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.inheritanceRule).toHaveLength(1);
    expect(cmd!.grounding.inheritanceRule![0].priority).toBe(50);
    expect(logger.warnings).toHaveLength(0);
  });

  it("resolves multi-valued targetClassExclusion to a labelled array", async () => {
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_EXCL,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      targetClassExclusionRefUids: [EXCL_CLASS_TASK, EXCL_CLASS_PROJ],
      priority: 25,
    });
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with multi-excl rule",
      ruleRefUids: [RULE_UID_EXCL],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    expect(cmd!.grounding.inheritanceRule).toHaveLength(1);
    const rule = cmd!.grounding.inheritanceRule![0];
    expect(rule.targetClassExclusion).toHaveLength(2);
    expect(rule.targetClassExclusion).toEqual(
      expect.arrayContaining(["ems__Task", "ems__Project"]),
    );
    // Issue #3562: UID-canon forms carried alongside the labels for resolver-
    // free matching.
    expect(rule.targetClassExclusionUids).toEqual(
      expect.arrayContaining([EXCL_CLASS_TASK, EXCL_CLASS_PROJ]),
    );
    expect(rule.priority).toBe(25);
  });

  // Issue #3562: a UID-form condition whose LABEL is unresolvable is now
  // RETAINED with its UID (not dropped). The original "drop on unresolvable"
  // behaviour (PR #3224) conflated "broken ref" with "label not yet indexed" —
  // and the latter happens routinely right after `Apply profile` materialises
  // the class TBox, silently skipping the conditional rule until reload. The
  // rule still carries a condition (the UID), so scope is NOT broadened: it
  // matches ONLY assets of that UID class (none, if the class is genuinely
  // broken; the real class once its label later resolves). Still NOT
  // unconditional.
  it("retains rule with UID-only condition when targetClassCondition label is unresolvable (Issue #3562)", async () => {
    const STALE_CLASS_UID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    // InheritanceRule references a class UID that has no Asset_label triple
    // (mirrors a freshly-materialised class TBox not yet indexed post-apply).
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_COND,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      targetClassConditionRefUid: STALE_CLASS_UID,
      priority: 100,
    });
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with UID-only (label-unresolvable) condition",
      ruleRefUids: [RULE_UID_COND],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Rule retained — NOT dropped.
    expect(cmd!.grounding.inheritanceRule).toHaveLength(1);
    const rule = cmd!.grounding.inheritanceRule![0];
    // Condition preserved as the UID (resolver-free match path); label absent.
    expect(rule.targetClassConditionUid).toBe(STALE_CLASS_UID);
    expect(rule.targetClassCondition).toBeUndefined();
    // No "entire rule skipped" warn — retention is the correct, safe outcome.
    expect(
      logger.warnings.some((w) => w.includes("entire rule skipped")),
    ).toBe(false);
  });

  // Issue #3562: a genuinely BROKEN condition ref — one whose triple object
  // yields no usable name (here a whitespace-only literal, which
  // `getObsidianName`→`unwrapWikilink` trims to the empty string; the
  // `!refName || !refName.trim()` guard then fires) — still skips the entire
  // rule. Retaining it WOULD make the rule unconditional (scope broadening),
  // so the PR #3224 safety is preserved for the truly-nameless case (distinct
  // from a UID-form ref whose label merely isn't indexed yet).
  it("skips entire rule when targetClassCondition ref yields no parseable name", async () => {
    const ruleSubject = new IRI(`obsidian://vault/${RULE_UID_COND}.md`);
    await store.addAll([
      new Triple(
        ruleSubject,
        Namespace.RDF.term("type"),
        Namespace.EXOCMD.term("InheritanceRule"),
      ),
      new Triple(
        ruleSubject,
        Namespace.EXO.term("Asset_uid"),
        new Literal(RULE_UID_COND),
      ),
      new Triple(
        ruleSubject,
        Namespace.EXOCMD.term("InheritanceRule_sourceProperty"),
        new IRI(`obsidian://vault/${SRC_PROP_UID}.md`),
      ),
      new Triple(
        ruleSubject,
        Namespace.EXOCMD.term("InheritanceRule_targetProperty"),
        new IRI(`obsidian://vault/${TGT_PROP_UID}.md`),
      ),
      // Condition triple present but its object is a whitespace-only literal →
      // unwraps to the empty string → getObsidianName yields no usable name.
      new Triple(
        ruleSubject,
        Namespace.EXOCMD.term("InheritanceRule_targetClassCondition"),
        new Literal(" "),
      ),
      new Triple(
        ruleSubject,
        Namespace.EXOCMD.term("InheritanceRule_priority"),
        new Literal("100"),
      ),
    ]);
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with nameless condition ref",
      ruleRefUids: [RULE_UID_COND],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Entire rule dropped — would-be unconditional rule is not silently applied.
    expect(cmd!.grounding.inheritanceRule).toBeUndefined();
    expect(
      logger.warnings.some((w) =>
        w.includes("targetClassCondition triple but ref is unresolvable") &&
        w.includes("entire rule skipped"),
      ),
    ).toBe(true);
  });

  it("retains rule with UID-only exclusion when one exclusion label is unresolvable (Issue #3562)", async () => {
    const STALE_EXCL_UID = "ffffffff-ffff-4fff-8fff-fffffffffff0";
    // Two exclusion refs — one labelled, one whose label isn't indexed yet.
    await addInheritanceRuleAsset(store, {
      uid: RULE_UID_EXCL,
      sourcePropertyRefUid: SRC_PROP_UID,
      targetPropertyRefUid: TGT_PROP_UID,
      targetClassExclusionRefUids: [EXCL_CLASS_TASK, STALE_EXCL_UID],
      priority: 50,
    });
    await addGroundingWithInheritanceRules(store, {
      uid: GROUNDING_UID,
      label: "Grounding with UID-only (label-unresolvable) exclusion",
      ruleRefUids: [RULE_UID_EXCL],
    });
    await addCommandForGrounding(store, COMMAND_UID, GROUNDING_UID);

    const cmd = await resolver.loadCommand(COMMAND_UID);

    // Rule retained — exclusion enforced via UID, not silently dropped.
    expect(cmd!.grounding.inheritanceRule).toHaveLength(1);
    const rule = cmd!.grounding.inheritanceRule![0];
    // Both excluded class UIDs present (UID-canon enforcement path).
    expect(rule.targetClassExclusionUids).toEqual(
      expect.arrayContaining([EXCL_CLASS_TASK, STALE_EXCL_UID]),
    );
    // Only the resolvable label appears in the label-form list.
    expect(rule.targetClassExclusion).toEqual(["ems__Task"]);
    expect(
      logger.warnings.some((w) => w.includes("entire rule skipped")),
    ).toBe(false);
  });
});
