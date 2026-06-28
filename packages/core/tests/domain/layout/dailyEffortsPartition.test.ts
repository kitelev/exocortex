/**
 * dailyEffortsPartition — single-scan split of day efforts into
 * Actions / Tasks / Projects. Covers req a38ac95b assertions (b) partition by
 * class and (c) RL#1 meeting-regression (the day's meeting stays in Tasks).
 *
 * @req:a38ac95b-b347-42e4-8522-f481ab422337
 *
 * revert-verify: changing the Tasks bucket to also exclude meetings (e.g. an
 * extra `classListMatches(..., "ems__Meeting", ...)` branch routing meetings
 * away from `tasks`) turns the RL#1 meeting test RED; the carve-out as written
 * keeps meetings in Tasks → GREEN.
 */

import {
  EMS_ACTION_CLASS_UID,
  EMS_PROJECT_CLASS_UID,
  partitionDailyEffortsByClass,
} from "../../../src/domain/layout/dailyEffortsPartition";

interface Effort {
  readonly path: string;
  readonly metadata: Record<string, unknown>;
}

function effort(path: string, classes: string[]): Effort {
  return { path, metadata: { exo__Instance_class: classes } };
}

describe("partitionDailyEffortsByClass (req a38ac95b)", () => {
  test("partitions symbolic-form classes into actions / tasks / projects", () => {
    const efforts = [
      effort("a.md", ["[[ems__Action]]"]),
      effort("t.md", ["[[ems__Task]]"]),
      effort("p.md", ["[[ems__Project]]"]),
    ];
    const { actions, tasks, projects } = partitionDailyEffortsByClass(efforts);
    expect(actions.map((e) => e.path)).toEqual(["a.md"]);
    expect(tasks.map((e) => e.path)).toEqual(["t.md"]);
    expect(projects.map((e) => e.path)).toEqual(["p.md"]);
  });

  test("@req:a38ac95b-b347-42e4-8522-f481ab422337 RL#1 — a day's meeting STAYS in Tasks (inclusive carve-out)", () => {
    const efforts = [
      effort("m.md", ["[[ems__Meeting]]"]),
      effort("i.md", ["[[ems__Initiative]]"]),
      effort("a.md", ["[[ems__Action]]"]),
    ];
    const { actions, tasks, projects } = partitionDailyEffortsByClass(efforts);
    expect(tasks.map((e) => e.path).sort()).toEqual(["i.md", "m.md"]);
    expect(actions.map((e) => e.path)).toEqual(["a.md"]);
    expect(projects).toHaveLength(0);
  });

  test("matches UID-canon class form ([[<uid>]]) for Action and Project", () => {
    const efforts = [
      effort("a.md", [`[[${EMS_ACTION_CLASS_UID}]]`]),
      effort("p.md", [`[[${EMS_PROJECT_CLASS_UID}]]`]),
      effort("t.md", ["[[6f000000-0000-0000-0000-000000000000]]"]), // unknown uid → tasks
    ];
    const { actions, tasks, projects } = partitionDailyEffortsByClass(efforts);
    expect(actions.map((e) => e.path)).toEqual(["a.md"]);
    expect(projects.map((e) => e.path)).toEqual(["p.md"]);
    expect(tasks.map((e) => e.path)).toEqual(["t.md"]);
  });

  test("matches aliased class form ([[<uid>|ems__Action]])", () => {
    const efforts = [
      effort("a.md", [`[[${EMS_ACTION_CLASS_UID}|ems__Action]]`]),
      effort("p.md", ["[[7db5eeff-718a-49b0-8d2b-39b084a356e3|ems__Project]]"]),
    ];
    const { actions, projects } = partitionDailyEffortsByClass(efforts);
    expect(actions.map((e) => e.path)).toEqual(["a.md"]);
    expect(projects.map((e) => e.path)).toEqual(["p.md"]);
  });

  test("Project takes precedence when an effort carries both Action and Project", () => {
    const efforts = [effort("x.md", ["[[ems__Action]]", "[[ems__Project]]"])];
    const { actions, projects } = partitionDailyEffortsByClass(efforts);
    expect(projects.map((e) => e.path)).toEqual(["x.md"]);
    expect(actions).toHaveLength(0);
  });

  test("efforts with no class array → Tasks; each effort placed exactly once", () => {
    const efforts = [
      { path: "n.md", metadata: {} },
      effort("a.md", ["[[ems__Action]]"]),
    ];
    const { actions, tasks, projects } = partitionDailyEffortsByClass(efforts);
    expect(tasks.map((e) => e.path)).toEqual(["n.md"]);
    expect(actions.map((e) => e.path)).toEqual(["a.md"]);
    // every input lands in exactly one bucket (no dup, no drop)
    expect(actions.length + tasks.length + projects.length).toBe(efforts.length);
  });

  test("supports a custom class extractor", () => {
    const items = [
      { path: "a.md", kind: "ems__Action" },
      { path: "t.md", kind: "ems__Task" },
    ];
    const { actions, tasks } = partitionDailyEffortsByClass(
      items as unknown as Array<{ metadata?: Record<string, unknown> }>,
      (e) => [(e as unknown as { kind: string }).kind],
    );
    expect(actions.map((e) => (e as unknown as { path: string }).path)).toEqual([
      "a.md",
    ]);
    expect(tasks.map((e) => (e as unknown as { path: string }).path)).toEqual([
      "t.md",
    ]);
  });
});
