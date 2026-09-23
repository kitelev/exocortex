/**
 * `@req:f56eef78-61d8-4d12-ac28-886aecefd633` — the legacy daily table must
 * DROP the day's `ems__Action` instances when a `daily-efforts-by-class`
 * Layout block has claimed the `actions` partition, and keep them otherwise.
 *
 * ⛔ These axes exist because the suppression suite alone CANNOT cover the
 * filter: there `dailyTasksRenderer` is a full jest mock, so `getDailyTasks`
 * never executes and a mutant disabling the skip left the whole plugin suite
 * green. They drive the REAL `DailyTasksRenderer.getDailyTasks` over real
 * fixtures, so the mutant `if (false && options?.excludeActions === true)`
 * turns E1/E2 RED.
 *
 * E2 is the dual-form axis: `exo__Instance_class` is written UID-canon
 * (`[[<uid>]]`) by `exocortex-cli`, and a symbolic-substring-only predicate
 * misses exactly those refs — the form the vault actually carries.
 */
import {
  setupDailyTasksRendererTest,
  createMockElement,
  DailyTasksRendererTestContext,
  TFile,
} from "./DailyTasksRenderer.fixtures";
import type { IFile } from "@kitelev/exocortex-core";

/** TBox UID of `ems__Action` — the UID-canon form of the class ref. */
const EMS_ACTION_UID = "6a99d2ca-d402-4734-a10b-33f5f1a1aa42";

const DAY = "2026-09-22";

const dailyNoteFile = {
  path: "daily.md",
  parent: { path: "DailyNotes" },
  basename: DAY,
} as TFile;

const dailyNoteMetadata = {
  exo__Instance_class: "[[pn__DailyNote]]",
  pn__DailyNote_day: `[[${DAY}]]`,
};

const effort = (path: string, instanceClass: string) => ({
  file: { path, basename: path.replace(/\.md$/, "") } as TFile,
  metadata: {
    exo__Instance_class: instanceClass,
    ems__Effort_day: `[[${DAY}]]`,
    ems__Effort_startTimestamp: `${DAY}T09:00:00`,
    ems__Effort_status: "[[ems__EffortStatusToDo]]",
  },
});

/** TBox UID of `ems__Project` — the UID-canon form of the class ref. */
const EMS_PROJECT_UID = "7db5eeff-718a-49b0-8d2b-39b084a356e3";

const TASK = effort("task.md", "[[ems__Task]]");
const ACTION_SYMBOLIC = effort("action-symbolic.md", "[[ems__Action]]");
const ACTION_UID = effort("action-uid.md", `[[${EMS_ACTION_UID}]]`);
const EFFORTS = [TASK, ACTION_SYMBOLIC, ACTION_UID];

/** Render the daily note and return the paths that reached the table. */
const renderedPaths = async (
  ctx: DailyTasksRendererTestContext,
  options?: { excludeActions?: boolean },
  efforts: ReadonlyArray<{ file: TFile; metadata: Record<string, unknown> }> = EFFORTS,
): Promise<string[]> => {
  const byPath = new Map<string, Record<string, unknown>>([
    [dailyNoteFile.path, dailyNoteMetadata],
    ...efforts.map(
      (e) => [e.file.path, e.metadata] as [string, Record<string, unknown>],
    ),
  ]);

  ctx.mockMetadataExtractor.extractMetadata.mockImplementation(
    (f: IFile | null) => (f ? (byPath.get(f.path) ?? {}) : {}),
  );
  ctx.mockMetadataExtractor.extractInstanceClass.mockReturnValue(
    "[[pn__DailyNote]]",
  );
  ctx.mockVaultAdapter.getAllFiles.mockReturnValue(efforts.map((e) => e.file));

  await ctx.renderer.render(
    createMockElement(),
    dailyNoteFile,
    undefined,
    false,
    options,
  );

  expect(ctx.mockReactRenderer.render).toHaveBeenCalled();
  const element = ctx.mockReactRenderer.render.mock.calls[0][1] as {
    props: { tasks: ReadonlyArray<{ path: string }> };
  };
  return element.props.tasks.map((t) => t.path);
};

describe("DailyTasksRenderer — excludeActions (@req:f56eef78-61d8-4d12-ac28-886aecefd633)", () => {
  let ctx: DailyTasksRendererTestContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setupDailyTasksRendererTest();
  });

  it("E0: without the option every effort of the day reaches the table", async () => {
    const paths = await renderedPaths(ctx);
    expect(paths).toEqual(
      expect.arrayContaining([
        TASK.file.path,
        ACTION_SYMBOLIC.file.path,
        ACTION_UID.file.path,
      ]),
    );
    expect(paths).toHaveLength(3);
  });

  it("E1: excludeActions drops a SYMBOLIC `[[ems__Action]]` effort", async () => {
    const paths = await renderedPaths(ctx, { excludeActions: true });
    expect(paths).not.toContain(ACTION_SYMBOLIC.file.path);
  });

  it("E2: excludeActions drops a UID-canon `[[<uid>]]` Action — the form the vault actually writes", async () => {
    const paths = await renderedPaths(ctx, { excludeActions: true });
    expect(paths).not.toContain(ACTION_UID.file.path);
  });

  it("E3: excludeActions drops ONLY Actions — a plain task still renders", async () => {
    const paths = await renderedPaths(ctx, { excludeActions: true });
    expect(paths).toEqual([TASK.file.path]);
  });

  it("E4: excludeActions:false is not the same as true — both Actions survive", async () => {
    const paths = await renderedPaths(ctx, { excludeActions: false });
    expect(paths).toHaveLength(3);
  });

  /**
   * Issue #4330 — the Project skip must be dual-form too. The table's set is
   * «the day's efforts EXCEPT Project», and a symbolic-substring-only test
   * misses the UID-canon refs the vault actually carries: measured on
   * vault-my, 191 of 208 `ems__Project` assets are written `[[<uid>]]`, so the
   * skip was inert for 92% of them and Projects showed up as ordinary tasks.
   */
  describe("Project skip is dual-form (#4330)", () => {
    const PROJECT_SYMBOLIC = effort("project-symbolic.md", "[[ems__Project]]");
    const PROJECT_UID = effort("project-uid.md", `[[${EMS_PROJECT_UID}]]`);
    const WITH_PROJECTS = [TASK, PROJECT_SYMBOLIC, PROJECT_UID];

    it("P1: a UID-canon `[[<uid>]]` Project never reaches the table", async () => {
      const paths = await renderedPaths(ctx, undefined, WITH_PROJECTS);
      expect(paths).not.toContain(PROJECT_UID.file.path);
    });

    it("P2: a symbolic `[[ems__Project]]` Project never reaches the table", async () => {
      const paths = await renderedPaths(ctx, undefined, WITH_PROJECTS);
      expect(paths).not.toContain(PROJECT_SYMBOLIC.file.path);
    });

    it("P3: only the Projects are removed — the plain task still renders", async () => {
      const paths = await renderedPaths(ctx, undefined, WITH_PROJECTS);
      expect(paths).toEqual([TASK.file.path]);
    });
  });
});
