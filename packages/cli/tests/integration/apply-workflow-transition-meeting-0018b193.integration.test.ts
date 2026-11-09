/**
 * Bug 0018b193 — CLI `apply` of the shared `workflow_transition rollback`
 * grounding on an `ems__Meeting` (and its subclass `ems__OfflineMeeting`) must
 * run the postActions of the vault Task workflow, because in the vault TBox
 * `ems__Meeting ⊑ ems__Task` (`exo__Class_superClass`) and the meeting has no
 * workflow of its own.
 *
 * Before the fix the meeting resolved straight to the hardcoded
 * `TASK_DEFAULT_WORKFLOW` copy, whose transitions carry no postActions: `re-open`
 * moved Done → Doing but left the end / resolution timestamps and the
 * partiallyDone flag, `rollback-to-backlog` moved Doing → Backlog but left the
 * start timestamp — while printing "… cleared".
 *
 * PRODUCTION SHAPE: every fixture file copies the frontmatter of its live
 * counterpart in `exoas-public` / `exoas-exocmd` (canonical UIDs, bare
 * `[[uid]]` references, the class files carrying `exo__Class_superClass`), and
 * the store is built by the CLI's own converter — not seeded by hand as in the
 * core unit axes (`WorkflowResolver.builtInInheritance.test.ts`).
 *
 * I1a meeting Done → re-open: Doing; end, resolution, partiallyDone gone; start kept
 * I1b meeting Doing → rollback-to-backlog: Backlog; start gone
 * I2a OfflineMeeting ⊑ Meeting ⊑ Task, Done → re-open: same as I1a
 * I2b OfflineMeeting, Doing → rollback-to-backlog: same as I1b
 * I3a canary — Task Done → re-open: same as I1a (green before and after the fix)
 * I3b canary — Task Doing → rollback-to-backlog: same as I1b (green before and after)
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

// ─── Live UIDs (exoas-public / exoas-exocmd) ────────────────────────────────
const CLASS_EFFORT = "086f71fa-dd30-4284-90cf-e609f2a6c461";
const CLASS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CLASS_MEETING = "1b0a5e34-dd7f-4ead-b43a-6c7c5a5ecaca";
const CLASS_OFFLINE = "07121818-d966-406b-be92-93b25142046c";
const CLASS_META = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class
const CLASS_WORKFLOW = "071172cf-6fc1-4c76-bb21-1407e0bcc986";
const CLASS_TRANSITION = "8eef26d7-4692-4b84-8835-8a0277828b8c";
const CLASS_COMMAND = "790e5b16-251d-4556-96ac-e5c7f1429b2e";
const CLASS_GROUNDING = "11579feb-2e42-491c-af59-b89b1129a539";

const STATUS_DRAFT = "c42245d0-01de-4c35-bfcf-d910445ea28e";
const STATUS_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const STATUS_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const STATUS_DONE = "7b9b3116-7c3c-438c-9618-94fe301320a6";

const TYPE_WORKFLOW_TRANSITION = "5c1a2552-d576-496d-8823-563573dd1e2f";
const TYPE_PROPERTY_DELETE = "4bdf1d0b-e9da-4d96-bafe-c5aaef8c2bd5";

const TASK_WORKFLOW = "39820734-be03-4e7e-abc6-5772e7109fbb";
const TR_DONE_DOING = "98b7ef11-612b-492b-b9ce-8e18aea9e8de"; // "← Doing"
const TR_DOING_BACKLOG = "09e01bb7-071e-4f08-9f0d-30d487245fc2"; // "← Backlog"
const TR_BACKLOG_DRAFT = "54a45984-699c-41d2-a737-030bb273bb98"; // "← Draft" (no postActions)
const GR_DELETE_END = "2c53ea68-8247-4ea8-870e-3bfbf2256b2f";
const GR_DELETE_RESOLUTION = "d08d588c-595b-4248-bd7b-70b2411efb7d";
const GR_DELETE_PARTIAL = "51a639a1-aa68-42de-9ee7-648888df0578";
const GR_DELETE_START = "1a14832c-f657-4816-b2aa-d06f2a80fccf";
const GR_ROLLBACK = "7eb97e7d-dff7-4bd1-a14d-a9509352bb7a"; // "workflow_transition rollback"
const CMD_REOPEN = "96321da8-728f-483b-82ef-db1d7376691e";
const CMD_ROLLBACK_BACKLOG = "0018b193-0000-4000-b000-000000000001"; // fixture: same grounding as live

// ─── Fixture targets ────────────────────────────────────────────────────────
const MEETING_DONE = "0018b193-0000-4000-c000-000000000001";
const MEETING_DOING = "0018b193-0000-4000-c000-000000000002";
const OFFLINE_DONE = "0018b193-0000-4000-c000-000000000003";
const OFFLINE_DOING = "0018b193-0000-4000-c000-000000000004";
const TASK_DONE = "0018b193-0000-4000-c000-000000000005";
const TASK_DOING = "0018b193-0000-4000-c000-000000000006";

const SEED = "99999999-0018-4b19-8000-000000000193";
const FROZEN_CLOCK = "2026-11-09T12:00:00Z";
const START = "2026-08-27T18:32:46";
const END = "2026-08-27T19:00:00";
const RESOLUTION = "2026-11-02T10:54:00";

const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

function classFile(uid: string, label: string, superUid: string | null): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_META}]]"`,
    ...(superUid ? [`exo__Class_superClass:`, `  - "[[${superUid}]]"`] : []),
    `exo__Asset_label: ${label}`,
    `aliases:`,
    `  - ${label}`,
  ]);
}

function stub(uid: string, label: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_META}]]"`,
    `exo__Asset_label: ${label}`,
  ]);
}

function transition(uid: string, label: string, from: string, to: string, post: string[]): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_TRANSITION}]]"`,
    `exo__Asset_label: "Task Default Workflow — ${label}"`,
    `ems__WorkflowTransition_workflow: "[[${TASK_WORKFLOW}]]"`,
    `ems__WorkflowTransition_from: "[[${from}]]"`,
    `ems__WorkflowTransition_to: "[[${to}]]"`,
    `ems__WorkflowTransition_label: "${label}"`,
    `ems__WorkflowTransition_isRollback: true`,
    ...(post.length ? [`ems__WorkflowTransition_postActions:`, ...post.map((p) => `  - "[[${p}]]"`)] : []),
  ]);
}

function deleteGrounding(uid: string, label: string, property: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_GROUNDING}]]"`,
    `exocmd__Grounding_type: "[[${TYPE_PROPERTY_DELETE}]]"`,
    `exocmd__Grounding_targetProperty: "${property}"`,
  ]);
}

function command(uid: string, label: string, success: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class:`,
    `  - "[[${CLASS_COMMAND}]]"`,
    `exocmd__Command_grounding: "[[${GR_ROLLBACK}]]"`,
    `exocmd__Command_successMessage: "${success}"`,
  ]);
}

function effort(uid: string, classUid: string, status: string, extra: string[]): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "effort ${uid.slice(-2)}"`,
    `exo__Instance_class:`,
    `  - "[[${classUid}]]"`,
    `ems__Effort_status: "[[${status}]]"`,
    ...extra,
  ]);
}

const DONE_DATES = [
  `ems__Effort_startTimestamp: ${START}`,
  `ems__Effort_resolutionTimestamp: ${RESOLUTION}`,
  `ems__Effort_endTimestamp: ${END}`,
  `ems__Effort_partiallyDone: true`,
];
const DOING_DATES = [`ems__Effort_startTimestamp: ${START}`];

function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-apply-0018b193-"));
  const files: Record<string, string> = {
    [CLASS_META]: stub(CLASS_META, "exo__Class"),
    [CLASS_EFFORT]: classFile(CLASS_EFFORT, "ems__Effort", null),
    [CLASS_TASK]: classFile(CLASS_TASK, "ems__Task", CLASS_EFFORT),
    [CLASS_MEETING]: classFile(CLASS_MEETING, "ems__Meeting", CLASS_TASK),
    [CLASS_OFFLINE]: classFile(CLASS_OFFLINE, "ems__OfflineMeeting", CLASS_MEETING),
    [CLASS_WORKFLOW]: stub(CLASS_WORKFLOW, "ems__Workflow"),
    [CLASS_TRANSITION]: stub(CLASS_TRANSITION, "ems__WorkflowTransition"),
    [CLASS_COMMAND]: stub(CLASS_COMMAND, "exocmd__Command"),
    [CLASS_GROUNDING]: stub(CLASS_GROUNDING, "exocmd__Grounding"),
    [STATUS_DRAFT]: stub(STATUS_DRAFT, "ems__EffortStatusDraft"),
    [STATUS_BACKLOG]: stub(STATUS_BACKLOG, "ems__EffortStatusBacklog"),
    [STATUS_DOING]: stub(STATUS_DOING, "ems__EffortStatusDoing"),
    [STATUS_DONE]: stub(STATUS_DONE, "ems__EffortStatusDone"),
    [TYPE_WORKFLOW_TRANSITION]: stub(TYPE_WORKFLOW_TRANSITION, "exocmd__GroundingTypeWorkflowTransition"),
    [TYPE_PROPERTY_DELETE]: stub(TYPE_PROPERTY_DELETE, "exocmd__GroundingTypePropertyDelete"),
    [TASK_WORKFLOW]: fm([
      `exo__Asset_uid: ${TASK_WORKFLOW}`,
      `exo__Instance_class:`,
      `  - "[[${CLASS_WORKFLOW}]]"`,
      `exo__Asset_label: "Task Default Workflow"`,
      `ems__Workflow_targetClass: "[[${CLASS_TASK}]]"`,
      `ems__Workflow_initialState: "[[${STATUS_DRAFT}]]"`,
      `ems__Workflow_terminalStates:`,
      `  - "[[${STATUS_DONE}]]"`,
      `ems__Workflow_isDefault: true`,
    ]),
    [TR_DONE_DOING]: transition(TR_DONE_DOING, "← Doing", STATUS_DONE, STATUS_DOING, [
      GR_DELETE_END,
      GR_DELETE_RESOLUTION,
      GR_DELETE_PARTIAL,
    ]),
    [TR_DOING_BACKLOG]: transition(TR_DOING_BACKLOG, "← Backlog", STATUS_DOING, STATUS_BACKLOG, [GR_DELETE_START]),
    [TR_BACKLOG_DRAFT]: transition(TR_BACKLOG_DRAFT, "← Draft", STATUS_BACKLOG, STATUS_DRAFT, []),
    [GR_DELETE_END]: deleteGrounding(GR_DELETE_END, "Delete end timestamp", "ems__Effort_endTimestamp"),
    [GR_DELETE_RESOLUTION]: deleteGrounding(GR_DELETE_RESOLUTION, "Delete resolution timestamp", "ems__Effort_resolutionTimestamp"),
    [GR_DELETE_PARTIAL]: deleteGrounding(GR_DELETE_PARTIAL, "Delete partiallyDone flag", "ems__Effort_partiallyDone"),
    [GR_DELETE_START]: deleteGrounding(GR_DELETE_START, "Delete start timestamp", "ems__Effort_startTimestamp"),
    [GR_ROLLBACK]: fm([
      `exo__Asset_uid: ${GR_ROLLBACK}`,
      `exo__Asset_label: "workflow_transition rollback"`,
      `exo__Instance_class:`,
      `  - "[[${CLASS_GROUNDING}]]"`,
      `exocmd__Grounding_type: "[[${TYPE_WORKFLOW_TRANSITION}]]"`,
      `exocmd__Grounding_direction: rollback`,
    ]),
    [CMD_REOPEN]: command(CMD_REOPEN, "Re-open", "Re-opened — status set to Doing, end/resolution timestamps cleared"),
    [CMD_ROLLBACK_BACKLOG]: command(CMD_ROLLBACK_BACKLOG, "Rollback to Backlog", "Status rolled back to Backlog — start timestamp cleared"),
    [MEETING_DONE]: effort(MEETING_DONE, CLASS_MEETING, STATUS_DONE, DONE_DATES),
    [MEETING_DOING]: effort(MEETING_DOING, CLASS_MEETING, STATUS_DOING, DOING_DATES),
    [OFFLINE_DONE]: effort(OFFLINE_DONE, CLASS_OFFLINE, STATUS_DONE, DONE_DATES),
    [OFFLINE_DOING]: effort(OFFLINE_DOING, CLASS_OFFLINE, STATUS_DOING, DOING_DATES),
    [TASK_DONE]: effort(TASK_DONE, CLASS_TASK, STATUS_DONE, DONE_DATES),
    [TASK_DOING]: effort(TASK_DOING, CLASS_TASK, STATUS_DOING, DOING_DATES),
  };
  for (const [uid, body] of Object.entries(files)) fs.writeFileSync(path.join(root, `${uid}.md`), body);
  return root;
}

describe("bug 0018b193: CLI apply — a meeting inherits the vault Task workflow's rollback postActions", () => {
  let root: string;
  let errors: string[];
  let restore: Array<{ mockRestore: () => void }>;

  beforeEach(() => {
    root = buildVault();
    errors = [];
    restore = [
      jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never),
      jest.spyOn(console, "log").mockImplementation(() => {}),
      jest.spyOn(console, "error").mockImplementation((msg?: unknown) => {
        errors.push(String(msg));
      }),
    ];
  });

  afterEach(() => {
    for (const r of restore) r.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function apply(commandUid: string, targetUid: string): Promise<string> {
    try {
      await applyCommand().parseAsync([
        "node", "apply", commandUid, `${targetUid}.md`,
        "--vault", root, "--seed", SEED, "--frozen-clock", FROZEN_CLOCK,
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
    return fs.readFileSync(path.join(root, `${targetUid}.md`), "utf-8");
  }

  const has = (content: string, key: string): boolean => new RegExp(`^${key}:`, "m").test(content);

  function expectReopened(content: string): void {
    expect(errors.join("\n")).toBe("");
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_DOING}]]"`);
    expect(has(content, "ems__Effort_endTimestamp")).toBe(false);
    expect(has(content, "ems__Effort_resolutionTimestamp")).toBe(false);
    expect(has(content, "ems__Effort_partiallyDone")).toBe(false);
    expect(content).toContain(`ems__Effort_startTimestamp: ${START}`);
  }

  function expectRolledBackToBacklog(content: string): void {
    expect(errors.join("\n")).toBe("");
    expect(content).toContain(`ems__Effort_status: "[[${STATUS_BACKLOG}]]"`);
    expect(has(content, "ems__Effort_startTimestamp")).toBe(false);
  }

  it("I1a meeting Done → re-open: Doing, end/resolution/partiallyDone removed, start kept", async () => {
    expectReopened(await apply(CMD_REOPEN, MEETING_DONE));
  });

  it("I1b meeting Doing → rollback-to-backlog: Backlog, start removed", async () => {
    expectRolledBackToBacklog(await apply(CMD_ROLLBACK_BACKLOG, MEETING_DOING));
  });

  it("I2a OfflineMeeting ⊑ Meeting Done → re-open: same as a meeting", async () => {
    expectReopened(await apply(CMD_REOPEN, OFFLINE_DONE));
  });

  it("I2b OfflineMeeting Doing → rollback-to-backlog: same as a meeting", async () => {
    expectRolledBackToBacklog(await apply(CMD_ROLLBACK_BACKLOG, OFFLINE_DOING));
  });

  it("I3a canary — task Done → re-open: same result before and after the fix", async () => {
    expectReopened(await apply(CMD_REOPEN, TASK_DONE));
  });

  it("I3b canary — task Doing → rollback-to-backlog: same result before and after the fix", async () => {
    expectRolledBackToBacklog(await apply(CMD_ROLLBACK_BACKLOG, TASK_DOING));
  });
});
