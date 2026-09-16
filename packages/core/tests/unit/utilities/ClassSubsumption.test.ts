/**
 * req 15f48fa1 (ticket 8df9e6eb) — subsumption-aware reference-picker
 * candidate resolution: the class-hierarchy closure the plugin's
 * `findAssetRefCandidates` (and any CLI consumer) keys its match on.
 *
 * Fixture mirrors the live exoas-public/ems hierarchy on 2026-09-16:
 *   Task → Effort · Project → [Effort, ParentEffort] · ParentEffort → Effort
 *   Meeting → Task · Area → AreaAware (NOT under Effort) · Effort → AreaAware
 *
 * Revert-verify (PR body): M1 (single pass, no fixpoint) → L1 RED (Meeting
 * lost); M2 (include every class that declares a superClass) → L2 RED;
 * M3 (match superClass refs by uid only) → L3 RED.
 */
import {
  resolveSubsumedClassKeys,
  instanceClassMatches,
  extractClassRefTarget,
  type ClassDefinitionLike,
} from "../../../src/utilities/ClassSubsumption";

const REQ = "@req:15f48fa1-a3a6-4df1-972e-efd639bfa344";

const AREA_AWARE = "f3892308-7a8b-4b81-8a01-a088d4bad97b";
const EFFORT = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const PROJECT = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
const PARENT_EFFORT = "17c5cf45-ce6a-4142-8d2a-65ac447f1168";
const MEETING = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
const AREA = "aaaaaaaa-0000-4000-8000-000000000001";

const HIERARCHY: ClassDefinitionLike[] = [
  { uid: AREA_AWARE, label: "ems__AreaAware", superClassRefs: [] },
  { uid: EFFORT, label: "ems__Effort", superClassRefs: [`"[[${AREA_AWARE}|ems__AreaAware]]"`] },
  // Listed BEFORE its parent Task on purpose: a single-pass walk (mutant M1)
  // never reaches it; only the fixpoint does.
  { uid: MEETING, label: "ems__Meeting", superClassRefs: [`"[[${TASK}]]"`] },
  { uid: TASK, label: "ems__Task", superClassRefs: [`"[[${EFFORT}]]"`] },
  {
    uid: PROJECT,
    label: "ems__Project",
    superClassRefs: [`"[[${EFFORT}]]"`, `"[[${PARENT_EFFORT}]]"`],
  },
  { uid: PARENT_EFFORT, label: "ems__ParentEffort", superClassRefs: [`"[[${EFFORT}]]"`] },
  { uid: AREA, label: "ems__Area", superClassRefs: [`"[[${AREA_AWARE}]]"`] },
];

describe("resolveSubsumedClassKeys (req 15f48fa1 — class subsumption for the reference picker)", () => {
  it(`L1 Effort ⇒ Effort + every transitive subclass (Task, Project, ParentEffort, Meeting) by uid AND label, multi-parent and transitive ${REQ}`, () => {
    const keys = resolveSubsumedClassKeys(EFFORT, HIERARCHY);
    for (const k of [
      EFFORT, "ems__effort",
      TASK, "ems__task",
      PROJECT, "ems__project",
      PARENT_EFFORT, "ems__parenteffort",
      MEETING, "ems__meeting", // two hops: Meeting → Task → Effort
    ]) {
      expect(keys.has(k)).toBe(true);
    }
    // A sibling (Area) and an ANCESTOR (AreaAware) of the target are NOT subsumed.
    expect(keys.has(AREA)).toBe(false);
    expect(keys.has("ems__area")).toBe(false);
    expect(keys.has(AREA_AWARE)).toBe(false);
    expect(keys.has("ems__areaaware")).toBe(false);
  });

  it(`L2 a class outside the hierarchy yields only its own keys; an undeclared target yields just itself (exact-class preserved) ${REQ}`, () => {
    const areaKeys = resolveSubsumedClassKeys(AREA, HIERARCHY);
    expect([...areaKeys].sort()).toEqual([AREA, "ems__area"].sort());

    const undeclared = "deadbeef-0000-4000-8000-000000000009";
    expect([...resolveSubsumedClassKeys(undeclared, HIERARCHY)]).toEqual([
      undeclared,
    ]);
    // Target given by LABEL resolves the uid too (dual-IRI tolerance).
    const byLabel = resolveSubsumedClassKeys("ems__Task", HIERARCHY);
    expect(byLabel.has(TASK)).toBe(true);
    expect(byLabel.has(MEETING)).toBe(true);
    expect(byLabel.has(EFFORT)).toBe(false);
  });

  it(`L3 label-form and piped superClass refs are followed; a cycle outside the target terminates; a cycle through the target is subsumed ${REQ}`, () => {
    const X = "aaaaaaaa-0000-4000-8000-00000000000a";
    const Y = "aaaaaaaa-0000-4000-8000-00000000000b";
    const LABEL_FORM = "aaaaaaaa-0000-4000-8000-00000000000c";
    const PIPED_FORM = "aaaaaaaa-0000-4000-8000-00000000000d";
    const defs: ClassDefinitionLike[] = [
      ...HIERARCHY,
      // Legacy symbolic superClass ref — the parent is named by label only.
      { uid: LABEL_FORM, label: "custom__LabelForm", superClassRefs: ["[[ems__Effort]]"] },
      // Piped form — uid wins over the alias.
      { uid: PIPED_FORM, label: "custom__Piped", superClassRefs: [`[[${EFFORT}|ems__Effort]]`] },
      // Cycle outside the target.
      { uid: X, label: "cyc__X", superClassRefs: [`[[${Y}]]`] },
      { uid: Y, label: "cyc__Y", superClassRefs: [`[[${X}]]`] },
    ];
    const keys = resolveSubsumedClassKeys(EFFORT, defs);
    expect(keys.has(LABEL_FORM)).toBe(true);
    expect(keys.has(PIPED_FORM)).toBe(true);
    expect(keys.has(X)).toBe(false);
    expect(keys.has(Y)).toBe(false);

    // A cycle THROUGH the target (X → Effort, Effort → X) is simply subsumed.
    const through = resolveSubsumedClassKeys(EFFORT, [
      { uid: EFFORT, label: "ems__Effort", superClassRefs: [`[[${X}]]`] },
      { uid: X, label: "cyc__X", superClassRefs: [`[[${EFFORT}]]`] },
    ]);
    expect(through.has(X)).toBe(true);
  });

  it(`L4 instanceClassMatches / extractClassRefTarget tolerate string, list, quoted and piped forms ${REQ}`, () => {
    const keys = resolveSubsumedClassKeys(EFFORT, HIERARCHY);
    expect(instanceClassMatches(`"[[${TASK}]]"`, keys)).toBe(true);
    expect(instanceClassMatches([`[[${PROJECT}|ems__Project]]`], keys)).toBe(true);
    expect(instanceClassMatches("[[ems__Meeting]]", keys)).toBe(true);
    expect(instanceClassMatches([`[[${AREA}]]`], keys)).toBe(false);
    expect(instanceClassMatches(undefined, keys)).toBe(false);
    expect(instanceClassMatches([42, null], keys)).toBe(false);
    expect(extractClassRefTarget(`"[[${TASK}|ems__Task]]"`)).toBe(TASK);
    expect(extractClassRefTarget("[[ems__Task]]")).toBe("ems__Task");
    expect(extractClassRefTarget(7)).toBe("");
    expect(resolveSubsumedClassKeys("   ", HIERARCHY).size).toBe(0);
  });
});
