/**
 * @req:fcbde537-f09a-410e-8bee-d3d607a70302 — no code path writes an
 * `ems__EffortStatus*` value that has no TBox instance.
 *
 * `ems__EffortStatusToDo` (`6a0e933a-…`) and `ems__EffortStatusAnalysis`
 * (`cde3525c-…`) were deleted from the shared ontology on 2026-08-13
 * (`exoas-public@c35a660d`); the parking status `ems__EffortStatusWaiting`
 * (`0610947c-…`) shipped in their place. Every constant asserted here is
 * written verbatim into user frontmatter, so a value with no asset behind it
 * becomes a dangling wikilink that no workflow can express.
 *
 * Each `describe` block is an independent revert-verify axis: restoring a dead
 * value in ONE source reddens ONLY that block.
 */
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import { EFFORT_STATUS_OPTIONS } from "../../../src/domain/constants";
import { STATUS_UID_BY_ENUM } from "../../../src/services/GroundingExecutor";
import {
  PROJECT_DEFAULT_WORKFLOW,
  TASK_DEFAULT_WORKFLOW,
} from "../../../src/domain/defaults/DefaultWorkflows";

/** Symbolic + UUID forms of every status deleted from the shared ontology. */
const DELETED_STATUS_TOKENS = [
  "ems__EffortStatusToDo",
  "ems__EffortStatusAnalysis",
  "6a0e933a-6653-46f4-95ae-ed7508177c73",
  "cde3525c-57ea-4efc-b477-2e7e7ccd3a1e",
] as const;

const WAITING_SYMBOLIC = "ems__EffortStatusWaiting";
const WAITING_UID = "0610947c-6a62-41c8-9d44-7863d3ba3a8e";

/** Both wikilink forms a value can reach frontmatter in. */
function tokensIn(value: unknown): string {
  return JSON.stringify(value);
}

describe("@req:fcbde537-f09a-410e-8bee-d3d607a70302 EffortStatus enum mirrors the ontology", () => {
  it("carries no status whose TBox instance was deleted", () => {
    const serialized = tokensIn(Object.values(EffortStatus));
    for (const dead of DELETED_STATUS_TOKENS) {
      expect(serialized).not.toContain(dead);
    }
  });

  it("carries the parking status that replaced them", () => {
    expect(Object.values(EffortStatus)).toContain(WAITING_SYMBOLIC);
  });
});

describe("@req:fcbde537-f09a-410e-8bee-d3d607a70302 STATUS_UID_BY_ENUM resolves to live TBox files", () => {
  it("maps no enum member onto a deleted status UID", () => {
    const serialized = tokensIn(STATUS_UID_BY_ENUM);
    for (const dead of DELETED_STATUS_TOKENS) {
      expect(serialized).not.toContain(dead);
    }
  });

  it("maps WAITING onto the shipped Waiting UID", () => {
    expect(STATUS_UID_BY_ENUM[EffortStatus.WAITING]).toBe(WAITING_UID);
  });

  it("covers every enum member exactly once", () => {
    const members = Object.values(EffortStatus);
    expect(Object.keys(STATUS_UID_BY_ENUM).sort()).toEqual([...members].sort());
    expect(new Set(Object.values(STATUS_UID_BY_ENUM)).size).toBe(members.length);
  });
});

describe("@req:fcbde537-f09a-410e-8bee-d3d607a70302 EFFORT_STATUS_OPTIONS offers only live statuses", () => {
  it("offers no deleted status in the dropdown", () => {
    const serialized = tokensIn(EFFORT_STATUS_OPTIONS);
    for (const dead of DELETED_STATUS_TOKENS) {
      expect(serialized).not.toContain(dead);
    }
  });

  it("offers Waiting", () => {
    const waiting = EFFORT_STATUS_OPTIONS.find((o) => o.label === "Waiting");
    expect(waiting?.value).toBe(`[[${WAITING_SYMBOLIC}]]`);
  });
});

describe("@req:fcbde537-f09a-410e-8bee-d3d607a70302 default workflows never transition into a deleted status", () => {
  for (const [name, workflow] of [
    ["PROJECT_DEFAULT_WORKFLOW", PROJECT_DEFAULT_WORKFLOW],
    ["TASK_DEFAULT_WORKFLOW", TASK_DEFAULT_WORKFLOW],
  ] as const) {
    it(`${name} references no deleted status in its states or transitions`, () => {
      const serialized = tokensIn({
        states: workflow.states,
        transitions: workflow.transitions,
        initialState: workflow.initialState,
        terminalStates: workflow.terminalStates,
      });
      for (const dead of DELETED_STATUS_TOKENS) {
        expect(serialized).not.toContain(dead);
      }
    });
  }

  it("keeps Backlog → Doing reachable in the Project fallback", () => {
    const forward = PROJECT_DEFAULT_WORKFLOW.transitions.find(
      (t) => t.from === EffortStatus.BACKLOG && !t.isRollback,
    );
    expect(forward?.to).toBe(EffortStatus.DOING);
  });
});
