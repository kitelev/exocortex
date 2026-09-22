/**
 * req 454ccedf-fefe-4cfe-bdf7-704f050c1f34 (ticket 533856e4, techbacklog
 * bbac67ce) — GroundingExecutor stamps `exo__Asset_updatedAt` on EVERY
 * mutating grounding write, from the injected clock, only when the write
 * actually changes the content.
 *
 * Mechanism under test (`GroundingExecutor.stampUpdatedAt`): the eight write
 * points — property_set (:813, also the workflow_transition status write),
 * property_delete, convert-to-task / convert-to-project (service_call class
 * flips), body_template, property_append, property_increment, property_shift —
 * pass the content they are about to write through one helper. Before this
 * requirement only the 18 composite groundings carrying the data step
 * `49e00287` ("Bump updatedAt" = `$nowLocal`) recorded a modification; the 19
 * single-grounding commands (`set-parent`, `set-criticality-*`, `archive`,
 * `shift-day-*`, `vote-on-effort`, `rollback-to-backlog`, …) never did.
 *
 * Axes (mutants M1–M5 in the PR body):
 *   B2  every mutating branch stamps (it.each over 7 branch shapes)
 *   B2b an asset WITHOUT the key gets it
 *   B3  a composite whose own step writes updatedAt carries exactly ONE key
 *   B4  a refusal writes nothing (no stamp without a write)
 *   B5  composite rollback restores the seeded updatedAt
 *   B7  a NO-OP write is byte-identical — the stamp does not manufacture a
 *       spurious ExoSync delta
 *   B8  a frontmatter-less body_template target gets no invented block
 *   B9  the explicit-step guard under a TICKING clock: the step that writes
 *       updatedAt itself consumes one clock call fewer than the same step on
 *       another property — the executor stamp is skipped (review LOW-1)
 */

import {
  GroundingExecutor,
  ServiceRegistry,
  type WorkflowResolverPort,
} from "../../../src/services/GroundingExecutor";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import type { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import type { WorkflowDefinition } from "../../../src/domain/models/WorkflowDefinition";
import { frozenClock } from "../../../src/services/IClock";

const SEED_STAMP = "2020-01-01T00:00:00";
const CLOCK_ISO = "2026-06-20T12:34:56";
const CLOCK = frozenClock(CLOCK_ISO);
const STAMP_LINE = `exo__Asset_updatedAt: ${CLOCK_ISO}`;
const LOCAL_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const TARGET_IRI = "obsidian://vault/tasks/t-1.md";
const FILE_PATH = "/vault/tasks/t-1.md";

const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";

/** In-memory fs honouring read-after-write (composites re-read the target). */
function makeFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const reader = {
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    }),
    fileExists: jest.fn(async (path: string) => files.has(path)),
    getMarkdownFiles: jest.fn().mockResolvedValue([]),
  };
  const writer = {
    createFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return "";
    }),
    updateFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    deleteFile: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    renameFile: jest.fn().mockResolvedValue(undefined),
  };
  return { files, reader, writer };
}

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-stamp",
    label: "updatedAt stamp axis",
    ...overrides,
  } as unknown as GroundingDefinition;
}

function seedTask(
  extra: string[] = [],
  updatedAt: string | null = SEED_STAMP,
  alias = "Seed task",
): string {
  const lines = [
    "exo__Asset_uid: t-1",
    `exo__Instance_class:\n  - "[[${TASK_UID}|ems__Task]]"`,
    "exo__Asset_label: Seed task",
    `ems__Effort_status: "[[${DOING_UID}]]"`,
    "ems__Effort_votes: 3",
    "ems__Effort_plannedStartTimestamp: 2026-06-01T09:00:00",
    `aliases:\n  - "${alias}"`,
    ...extra,
  ];
  if (updatedAt !== null) lines.push(`exo__Asset_updatedAt: ${updatedAt}`);
  return `---\n${lines.join("\n")}\n---\nBody`;
}

function updatedAtOf(content: string): string | undefined {
  return /^exo__Asset_updatedAt: (\S+)$/m.exec(content)?.[1];
}

function makeExecutor(
  fs: ReturnType<typeof makeFs>,
  options: Record<string, unknown> = {},
): GroundingExecutor {
  return new GroundingExecutor(
    fs.reader,
    fs.writer,
    new ServiceRegistry(),
    undefined,
    { clock: CLOCK, ...options },
  );
}

/** A Task workflow with a single forward Doing→Done transition (no postActions). */
function doingToDoneResolver(): WorkflowResolverPort {
  const wf: WorkflowDefinition = {
    id: "wf-task",
    name: "Task Default Workflow",
    targetClass: AssetClass.TASK,
    states: [],
    transitions: [
      {
        from: EffortStatus.DOING,
        to: EffortStatus.DONE,
        label: "✓ Done",
        isRollback: false,
        postActions: [],
      },
    ],
    initialState: EffortStatus.DRAFT,
    terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
    isDefault: true,
  };
  return { resolveForAssetOrNull: jest.fn().mockResolvedValue(wf) };
}

describe("@req:454ccedf-fefe-4cfe-bdf7-704f050c1f34 GroundingExecutor stamps exo__Asset_updatedAt on every mutating write (ticket 533856e4)", () => {
  // ---------------------------------------------------------------------------
  // B2 — one axis per mutating branch. Each row is the grounding shape a REAL
  // command uses (set-parent / un-archive / copy-label-to-aliases /
  // vote-on-effort / shift-day-forward / a body template / convert-to-task).
  // ---------------------------------------------------------------------------
  it.each<{
    name: string;
    grounding: GroundingDefinition;
    check: (written: string) => void;
    seed?: string;
  }>([
    {
      name: "property_set (set-parent shape: targetValueRef)",
      grounding: gnd({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_parent",
        targetValueRef: "99999999-3779-4000-8000-000000000009",
      }),
      check: (w) =>
        expect(w).toContain(
          'ems__Effort_parent: "[[99999999-3779-4000-8000-000000000009]]"',
        ),
    },
    {
      name: "property_delete (un-archive shape)",
      grounding: gnd({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "aliases",
      }),
      check: (w) => expect(w).not.toContain("aliases:"),
    },
    {
      name: "property_append (copy-label-to-aliases shape)",
      grounding: gnd({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
        appendUnique: true,
      }),
      // seed carries a STALE alias so the append is a real change (the
      // "already present" case is B7)
      check: (w) => expect(w).toContain('- "Seed task"'),
      seed: seedTask([], SEED_STAMP, "Stale alias"),
    },
    {
      name: "property_increment (vote-on-effort shape)",
      grounding: gnd({
        type: GroundingType.PROPERTY_INCREMENT,
        targetProperty: "ems__Effort_votes",
        incrementBy: 1,
      }),
      check: (w) => expect(w).toContain("ems__Effort_votes: 4"),
    },
    {
      name: "property_shift (shift-day-forward shape)",
      grounding: gnd({
        type: GroundingType.PROPERTY_SHIFT,
        targetProperty: "ems__Effort_plannedStartTimestamp",
        shiftDelta: "P1D",
      }),
      check: (w) =>
        expect(w).toContain(
          "ems__Effort_plannedStartTimestamp: 2026-06-02T09:00:00",
        ),
    },
    {
      name: "body_template (inline bodyTemplate)",
      grounding: gnd({
        type: GroundingType.BODY_TEMPLATE,
        bodyTemplate: "## New body",
      }),
      check: (w) => expect(w).toMatch(/---\n## New body$/),
    },
    {
      name: "service_call convertToTask (class flip)",
      grounding: gnd({
        type: GroundingType.SERVICE_CALL,
        targetProperty: "convertToTask",
      }),
      check: (w) =>
        expect(w).toContain('exo__Instance_class: ["[[ems__Task]]"]'),
    },
  ])(
    "B2 $name — stamps updatedAt from the executor clock",
    async ({ grounding, check, seed }) => {
      const fs = makeFs({ [FILE_PATH]: seed ?? seedTask() });
      const exec = makeExecutor(fs);

      const res = await exec.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(res.success).toBe(true);
      const written = fs.files.get(FILE_PATH) as string;
      check(written);
      expect(written).not.toContain(`exo__Asset_updatedAt: ${SEED_STAMP}`);
      expect(written).toContain(STAMP_LINE);
      expect(updatedAtOf(written)).toMatch(LOCAL_TS_RE);
      // exactly one key line — the seeded one was REPLACED, not duplicated
      expect((written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
    },
  );

  it("B2 workflow_transition (rollback-to-backlog / re-open shape) — the status write is stamped", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs, { workflowResolver: doingToDoneResolver() });

    const res = await exec.execute(
      gnd({ type: GroundingType.WORKFLOW_TRANSITION, direction: "forward" }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res.success).toBe(true);
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain(`ems__Effort_status: "[[${DONE_UID}]]"`);
    expect(written).toContain(STAMP_LINE);
    expect(written).not.toContain(`exo__Asset_updatedAt: ${SEED_STAMP}`);
  });

  it("B2b an asset WITHOUT exo__Asset_updatedAt gets the key added on its first mutation", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask([], null) });
    const exec = makeExecutor(fs);

    const res = await exec.execute(
      gnd({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Task_zone",
        targetValueRef: "e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res.success).toBe(true);
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain(
      'ems__Task_zone: "[[e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f]]"',
    );
    expect(written).toContain(STAMP_LINE);
    expect((written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // B3 — the data-side step 49e00287 (`property_set exo__Asset_updatedAt =
  // $nowLocal`) keeps working and the executor does NOT write a second key:
  // the composite [set label → clear aliases → append alias → bump updatedAt]
  // mirrors production grounding 3dfa3379.
  // ---------------------------------------------------------------------------
  it("B3 a composite whose own step writes updatedAt ($nowLocal, step 49e00287) leaves exactly ONE key = clock-now", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs);

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        gnd({
          id: "s-label",
          type: GroundingType.PROPERTY_SET,
          targetProperty: "exo__Asset_label",
          targetValueLiteral: "Relabelled",
        }),
        gnd({
          id: "s-clear",
          type: GroundingType.PROPERTY_DELETE,
          targetProperty: "aliases",
        }),
        gnd({
          id: "s-alias",
          type: GroundingType.PROPERTY_APPEND,
          targetProperty: "aliases",
          appendExpression: "$target.exo__Asset_label",
          appendUnique: true,
        }),
        gnd({
          id: "s-updated",
          type: GroundingType.PROPERTY_SET,
          targetProperty: "exo__Asset_updatedAt",
          targetValueSubstitution: "$nowLocal",
        }),
      ],
    });

    const res = await exec.execute(composite, TARGET_IRI, FILE_PATH);

    expect(res.success).toBe(true);
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain("exo__Asset_label: Relabelled");
    expect(written).toContain('- "Relabelled"');
    expect((written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
    // $nowLocal and the executor stamp read the SAME injected clock.
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
    // Four steps → four writes, and the LAST write (the explicit step) already
    // carries the single key — there was no fifth, executor-authored write.
    // (Review LOW-2: `lastWrite === written` was tautological — the in-memory
    // fs stores the last updateFile argument — so the count is asserted.)
    expect(fs.writer.updateFile).toHaveBeenCalledTimes(4);
    const lastWrite = fs.writer.updateFile.mock.calls[3][1] as string;
    expect((lastWrite.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(1);
    expect(updatedAtOf(lastWrite)).toBe(CLOCK_ISO);
  });

  // ---------------------------------------------------------------------------
  // B9 (review LOW-1) — under the frozen clock the `$nowLocal` substitution and
  // an executor stamp produce the SAME string, so B3 cannot see whether the
  // "branch owns the key" guard fires. A TICKING clock makes every clock call
  // distinct: a step whose own target is exo__Asset_updatedAt must consume
  // exactly ONE clock call fewer than an otherwise identical step on another
  // property (the substitution only — no stamp call). The control run derives
  // that count from the same machinery instead of pinning a magic number.
  // ---------------------------------------------------------------------------
  it("B9 explicit updatedAt step under a ticking clock: no stamp call after the substitution (one clock call fewer than the control step)", async () => {
    const { toLocalTimestamp } =
      await import("../../../src/utilities/DateFormatter").then(
        (m) => m.DateFormatter,
      );
    const runComposite = async (explicitTarget: string) => {
      const ticks: Date[] = [];
      const ticking = {
        now: () => {
          const d = new Date(2026, 5, 20, 12, 0, ticks.length); // 12:00:00, :01, :02 …
          ticks.push(d);
          return d;
        },
      };
      const fs = makeFs({ [FILE_PATH]: seedTask() });
      const exec = makeExecutor(fs, { clock: ticking });
      const composite = gnd({
        type: GroundingType.COMPOSITE,
        steps: [
          gnd({
            id: "s-label",
            type: GroundingType.PROPERTY_SET,
            targetProperty: "exo__Asset_label",
            targetValueLiteral: "Relabelled",
          }),
          gnd({
            id: "s-explicit",
            type: GroundingType.PROPERTY_SET,
            targetProperty: explicitTarget,
            targetValueSubstitution: "$nowLocal",
          }),
        ],
      });
      const res = await exec.execute(composite, TARGET_IRI, FILE_PATH);
      expect(res.success).toBe(true);
      return { written: fs.files.get(FILE_PATH) as string, ticks };
    };

    // Control: the explicit step targets ANOTHER property → substitution tick,
    // then the executor stamp consumes one more tick.
    const ctrl = await runComposite("ems__Effort_endTimestamp");
    const ctrlEnd = /^ems__Effort_endTimestamp: (\S+)$/m.exec(
      ctrl.written,
    )?.[1];
    expect(ctrlEnd).toBe(toLocalTimestamp(ctrl.ticks.at(-2) as Date)); // substitution
    expect(updatedAtOf(ctrl.written)).toBe(
      toLocalTimestamp(ctrl.ticks.at(-1) as Date),
    ); // stamp

    // Guarded: the explicit step targets exo__Asset_updatedAt → substitution
    // tick only; the key holds the substituted value and no stamp tick follows.
    const own = await runComposite("exo__Asset_updatedAt");
    expect(updatedAtOf(own.written)).toBe(
      toLocalTimestamp(own.ticks.at(-1) as Date),
    );
    expect((own.written.match(/^exo__Asset_updatedAt:/gm) ?? []).length).toBe(
      1,
    );
    expect(own.ticks.length).toBe(ctrl.ticks.length - 1);
  });

  // ---------------------------------------------------------------------------
  // B4 — a refusal returns BEFORE any write; nothing is stamped.
  // ---------------------------------------------------------------------------
  it("B4 a refused property_set (unquoted wikilink, req 29e0d1b6) writes NOTHING — file byte-identical, no stamp", async () => {
    const seed = seedTask();
    const fs = makeFs({ [FILE_PATH]: seed });
    const exec = makeExecutor(fs);

    const res = await exec.execute(
      gnd({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_parent",
        targetValueLiteral: "[[99999999-3779-4000-8000-000000000009]]",
      }),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/UNQUOTED wikilink/);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
    expect(fs.files.get(FILE_PATH)).toBe(seed);
  });

  // ---------------------------------------------------------------------------
  // B5 — composite rollback restores the pre-composite bytes (seed stamp back).
  // ---------------------------------------------------------------------------
  it("B5 a failing composite rolls back to the seeded updatedAt (the stamp of the earlier step does not survive)", async () => {
    const seed = seedTask();
    const fs = makeFs({ [FILE_PATH]: seed });
    const exec = makeExecutor(fs);

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        gnd({
          id: "s-parent",
          type: GroundingType.PROPERTY_SET,
          targetProperty: "ems__Effort_parent",
          targetValueRef: "99999999-3779-4000-8000-000000000009",
        }),
        // service_call to an UNREGISTERED serviceId → {success:false} → rollback
        gnd({
          id: "s-fail",
          type: GroundingType.SERVICE_CALL,
          targetProperty: "no-such-service-533856e4",
        }),
      ],
    });

    const res = await exec.execute(composite, TARGET_IRI, FILE_PATH);

    expect(res.success).toBe(false);
    // The first step DID write a stamped intermediate state …
    const intermediate = fs.writer.updateFile.mock.calls[0][1] as string;
    expect(intermediate).toContain(STAMP_LINE);
    // … and the rollback restored the seed verbatim.
    expect(fs.files.get(FILE_PATH)).toBe(seed);
    expect(updatedAtOf(fs.files.get(FILE_PATH) as string)).toBe(SEED_STAMP);
  });

  // ---------------------------------------------------------------------------
  // B7 — a NO-OP write is byte-identical: the stamp must not turn an
  // idempotent re-apply into a spurious ExoSync delta (same rule as
  // remove-property "bumps only when a change occurs").
  // ---------------------------------------------------------------------------
  it.each<[string, GroundingDefinition]>([
    [
      "property_set to the value already on disk",
      gnd({
        type: GroundingType.PROPERTY_SET,
        targetProperty: "ems__Effort_votes",
        targetValueLiteral: "3",
      }),
    ],
    [
      "property_append of an alias already present",
      gnd({
        type: GroundingType.PROPERTY_APPEND,
        targetProperty: "aliases",
        appendExpression: "$target.exo__Asset_label",
        appendUnique: true,
      }),
    ],
    [
      "property_delete of an absent key",
      gnd({
        type: GroundingType.PROPERTY_DELETE,
        targetProperty: "ems__Effort_blocker",
      }),
    ],
  ])(
    "B7 %s — the file stays byte-identical and updatedAt keeps the seed",
    async (_name, grounding) => {
      const seed = seedTask();
      const fs = makeFs({ [FILE_PATH]: seed });
      const exec = makeExecutor(fs);

      const res = await exec.execute(grounding, TARGET_IRI, FILE_PATH);

      expect(res.success).toBe(true);
      expect(fs.files.get(FILE_PATH)).toBe(seed);
      expect(updatedAtOf(fs.files.get(FILE_PATH) as string)).toBe(SEED_STAMP);
    },
  );

  // ---------------------------------------------------------------------------
  // B8 — no invented frontmatter on a frontmatter-less target.
  // ---------------------------------------------------------------------------
  it("B8 body_template on a plain-markdown target (no frontmatter block) invents no block", async () => {
    const fs = makeFs({ "/vault/raw.md": "just prose" });
    const exec = makeExecutor(fs);

    const res = await exec.execute(
      gnd({ type: GroundingType.BODY_TEMPLATE, bodyTemplate: "# Fresh" }),
      TARGET_IRI,
      "/vault/raw.md",
    );

    expect(res.success).toBe(true);
    expect(fs.files.get("/vault/raw.md")).toBe("# Fresh");
  });
});
