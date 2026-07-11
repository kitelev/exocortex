/**
 * Unit tests — GroundingExecutor composite-step `targetsCreatedInstance` opt-in
 * (Issue #3867 / req b00acde4-e796-4bb0-8136-8bac8ca9cf9e).
 *
 * A composite `[create_instance, property_set]` can now mutate the NEWLY-created
 * asset from the property_set step by opting in via
 * `exocmd__Grounding_targetsCreatedInstance: true` on that step. This is the
 * general form of the pre-existing `body_template`-only threading (Веха 3): the
 * created asset's path (`lastCreatedPath`, from the create_instance step's
 * openPath) is passed to the opted-in step as its `filePath`, so the mutation
 * lands in the created file, not the composite click-target.
 *
 * Opt-in ⇒ zero-regression: with the flag absent the step operates on the
 * click-target exactly as before (the ems__WaitingCheckTask «Следующая
 * итерация» composite depends on this default).
 *
 * Production-shape: drives the real GroundingExecutor.executeComposite over a
 * real create_instance step + a real property_set step, with an in-memory fs
 * honouring the read-after-write contract (no hand-injected create result).
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";

/** In-memory fs that honours read-after-write (mirrors the real contract). */
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
    id: "gnd-tci",
    label: "targets-created-instance",
    ...overrides,
  } as unknown as GroundingDefinition;
}

const CLICK_TARGET_IRI = "https://exocortex.my/assets/proto-123";
const CLICK_TARGET_PATH = "/vault/protos/proto-123.md";
const CLICK_TARGET_SEED =
  "---\nexo__Asset_uid: proto-123\nexo__Asset_label: Task Prototype\n---\nProto body";

/** Status value the property_set writes — the concrete "move to backlog" case. */
const BACKLOG_VALUE =
  '"[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]"';

function createInstanceStep(): GroundingDefinition {
  return gnd({
    id: "step-create",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ems__Task",
    targetFolder: "/vault/tasks",
  });
}

function moveToBacklogStep(opts: {
  targetsCreatedInstance?: boolean;
}): GroundingDefinition {
  return gnd({
    id: "step-move-backlog",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "ems__Effort_status",
    targetValueLiteral: BACKLOG_VALUE,
    ...(opts.targetsCreatedInstance
      ? { targetsCreatedInstance: true }
      : {}),
  });
}

/** Find the single created task file (the only non-click-target entry). */
function findCreatedFile(files: Map<string, string>): [string, string] {
  const created = [...files.entries()].find(
    ([p]) => p.startsWith("/vault/tasks/") && p !== CLICK_TARGET_PATH,
  );
  expect(created).toBeDefined();
  return created as [string, string];
}

describe("GroundingExecutor — composite targetsCreatedInstance (Issue #3867)", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("opts in: a property_set step with targetsCreatedInstance mutates the CREATED asset, not the click-target @req:b00acde4-e796-4bb0-8136-8bac8ca9cf9e", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        createInstanceStep(),
        moveToBacklogStep({ targetsCreatedInstance: true }),
      ],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    // The property landed in the CREATED task file.
    const [, createdContent] = findCreatedFile(files);
    expect(createdContent).toContain("ems__Effort_status");
    expect(createdContent).toContain("ems__EffortStatusBacklog");

    // The click-target (prototype) was NOT touched by the property_set step.
    const clickTarget = files.get(CLICK_TARGET_PATH) as string;
    expect(clickTarget).not.toContain("ems__Effort_status");
    expect(clickTarget).toContain("Proto body");
  });

  it("default (no flag): a property_set step mutates the CLICK-TARGET — the backward-compat behavior WaitingCheckTask «Следующая итерация» relies on @req:b00acde4-e796-4bb0-8136-8bac8ca9cf9e", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        createInstanceStep(),
        moveToBacklogStep({ targetsCreatedInstance: false }),
      ],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    // The property landed in the CLICK-TARGET (unchanged default).
    const clickTarget = files.get(CLICK_TARGET_PATH) as string;
    expect(clickTarget).toContain("ems__Effort_status");
    expect(clickTarget).toContain("ems__EffortStatusBacklog");

    // The created task file did NOT receive the property.
    const [, createdContent] = findCreatedFile(files);
    expect(createdContent).not.toContain("ems__Effort_status");
  });

  it("no-op without a create_instance: targetsCreatedInstance falls back to the click-target when no asset was created", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    // A composite whose only step opts in, but with NO prior create_instance:
    // lastCreatedPath is undefined → the step must target the click-target.
    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [moveToBacklogStep({ targetsCreatedInstance: true })],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(true);

    const clickTarget = files.get(CLICK_TARGET_PATH) as string;
    expect(clickTarget).toContain("ems__Effort_status");
  });
});
