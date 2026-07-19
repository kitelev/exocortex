/**
 * Unit tests — GroundingExecutor composite rollback deletes orphaned
 * create_instance assets (Issue #3921).
 *
 * When a composite `[create_instance, <later step>]` runs and the LATER step
 * fails, the executor rolls back. Before this fix, `rollback` only restored the
 * click-target source file — files written by an EARLIER SUCCESSFUL
 * create_instance step were left orphaned on disk (partial-composite
 * artifacts). The fix threads the accumulated `createdPaths` into `rollback`
 * and best-effort (fail-soft) deletes each created file.
 *
 * Production-shape: drives the REAL GroundingExecutor.executeComposite over a
 * real create_instance step + a reliably-failing later step (a service_call to
 * an unregistered serviceId), backed by an in-memory IFileSystemWriter that
 * records writes AND deletes and honours the read-after-write contract (no
 * hand-injected create result — createdPaths is populated by the real
 * create_instance step's openPath, mirroring the real #3918 surfacing channel).
 *
 * Revert-verify (Issue #3921): with the delete loop reverted these tests go RED
 * (created files remain / deleteFile never called); with it applied they pass.
 */

import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../../src/services/GroundingExecutor";
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
    id: "gnd-cro",
    label: "composite-rollback-orphan",
    ...overrides,
  } as unknown as GroundingDefinition;
}

const CLICK_TARGET_IRI = "https://exocortex.my/assets/proto-123";
const CLICK_TARGET_PATH = "/vault/protos/proto-123.md";
const CLICK_TARGET_SEED =
  "---\nexo__Asset_uid: proto-123\nexo__Asset_label: Task Prototype\n---\nProto body";

const BACKLOG_VALUE =
  '"[[753a44d5-846c-4b82-9196-4fd9a4d48777|ems__EffortStatusBacklog]]"';

/** Minimal create_instance step — no needsTargetRead, so it never reads the
 * click-target; it writes a fresh `<folder>/<uid>.md` and returns its openPath. */
function createInstanceStep(): GroundingDefinition {
  return gnd({
    id: "step-create",
    type: GroundingType.CREATE_INSTANCE,
    targetClass: "ems__Task",
    targetFolder: "/vault/tasks",
  });
}

/** A service_call to an UNREGISTERED serviceId → returns {success:false}. */
function failingServiceCallStep(): GroundingDefinition {
  return gnd({
    id: "step-fail",
    type: GroundingType.SERVICE_CALL,
    targetProperty: "definitely-not-a-registered-service-3921",
  });
}

/** A property_set on the CLICK-TARGET (succeeds, creates no new file). */
function propertySetOnClickTargetStep(): GroundingDefinition {
  return gnd({
    id: "step-set",
    type: GroundingType.PROPERTY_SET,
    targetProperty: "ems__Effort_status",
    targetValueLiteral: BACKLOG_VALUE,
  });
}

/** The path the create_instance step wrote, captured from the real createFile call. */
function firstCreatedPath(writer: { createFile: jest.Mock }): string {
  const call = writer.createFile.mock.calls[0];
  expect(call).toBeDefined();
  return call[0] as string;
}

describe("GroundingExecutor — composite rollback deletes orphaned created assets (Issue #3921)", () => {
  it("deletes the earlier create_instance file when a later step fails (RED→GREEN core case)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createInstanceStep(), failingServiceCallStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );

    // Composite failed on the later step.
    expect(res.success).toBe(false);

    const createdPath = firstCreatedPath(writer);
    // The earlier-created instance file MUST be removed (not orphaned).
    expect(writer.deleteFile).toHaveBeenCalledWith(createdPath);
    expect(files.has(createdPath)).toBe(false);

    // The click-target source is restored to its original content.
    expect(files.get(CLICK_TARGET_PATH)).toBe(CLICK_TARGET_SEED);
  });

  it("deletes the created file even when the click-target had no on-disk content (originalContent === undefined)", async () => {
    // Click-target NOT seeded → executeComposite's originalContent is undefined.
    // The minimal create_instance step still creates a file (no needsTargetRead).
    const { files, reader, writer } = makeFs({});
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createInstanceStep(), failingServiceCallStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );

    expect(res.success).toBe(false);
    const createdPath = firstCreatedPath(writer);
    // Early-return-on-undefined must NOT skip the created-file cleanup.
    expect(writer.deleteFile).toHaveBeenCalledWith(createdPath);
    expect(files.has(createdPath)).toBe(false);
  });

  it("deletes ALL created files when a composite created several before failing (edge b)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        createInstanceStep(),
        createInstanceStep(),
        failingServiceCallStep(),
      ],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(false);

    // Both create_instance steps wrote a distinct fresh-UID file.
    const paths = writer.createFile.mock.calls.map((c) => c[0] as string);
    expect(paths.length).toBe(2);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) {
      expect(writer.deleteFile).toHaveBeenCalledWith(p);
      expect(files.has(p)).toBe(false);
    }
  });

  it("is fail-soft: a deleteFile failure never masks the step error nor blocks source-restore (edge a)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    // Make delete throw — the rollback delete-loop must swallow it.
    writer.deleteFile.mockRejectedValue(new Error("disk gone"));
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createInstanceStep(), failingServiceCallStep()],
    });

    // Must resolve (no throw) despite the deleteFile rejection.
    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );

    expect(res.success).toBe(false);
    const createdPath = firstCreatedPath(writer);
    // Delete WAS attempted (proves the new path ran)…
    expect(writer.deleteFile).toHaveBeenCalledWith(createdPath);
    // …and the source-restore still happened despite the delete failure.
    expect(files.get(CLICK_TARGET_PATH)).toBe(CLICK_TARGET_SEED);
  });

  it("no created files → rollback is unchanged (source-restore only, no delete) (edge c, regression-lock)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [propertySetOnClickTargetStep(), failingServiceCallStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );
    expect(res.success).toBe(false);

    // No create_instance step ran → nothing to delete.
    expect(writer.createFile).not.toHaveBeenCalled();
    expect(writer.deleteFile).not.toHaveBeenCalled();
    // Source restored to original.
    expect(files.get(CLICK_TARGET_PATH)).toBe(CLICK_TARGET_SEED);
  });

  it("catch-branch: a composite step that THROWS also deletes the created file (revert-locks the L799 rollback call)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    // executeComposite has TWO rollback call sites: the step-returned-
    // {success:false} branch (covered by the cases above) AND the catch branch
    // (a genuine throw in the loop body). `execute()` wraps every step throw
    // into {success:false} (→ the step-failure branch), so the ONLY way to
    // reach the catch branch is a real throw from executeStep. Force the SECOND
    // step to throw; the FIRST (create_instance) runs for real so createdPaths
    // is populated before the throw. This locks the catch-branch rollback so a
    // future revert of its `createdPaths` argument fails RED.
    type WithStep = {
      executeStep: (...args: unknown[]) => Promise<unknown>;
    };
    const realStep = (exec as unknown as WithStep).executeStep.bind(exec);
    let stepCall = 0;
    (exec as unknown as WithStep).executeStep = async (...args: unknown[]) => {
      stepCall += 1;
      if (stepCall === 1) return realStep(...args); // real create_instance
      throw new Error("boom: composite step 2 threw");
    };

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createInstanceStep(), failingServiceCallStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );

    expect(res.success).toBe(false);
    // Proves we hit the catch branch (L799), not the step-failure branch (L769).
    expect(res.error).toContain("Composite execution failed");

    const createdPath = firstCreatedPath(writer);
    expect(writer.deleteFile).toHaveBeenCalledWith(createdPath);
    expect(files.has(createdPath)).toBe(false);
    // Source-restore still ran on the catch path.
    expect(files.get(CLICK_TARGET_PATH)).toBe(CLICK_TARGET_SEED);
  });

  it("success case is byte-identical: no delete, createdPaths still surfaced for apply --json #3918 (regression-lock)", async () => {
    const { files, reader, writer } = makeFs({
      [CLICK_TARGET_PATH]: CLICK_TARGET_SEED,
    });
    const exec = new GroundingExecutor(reader, writer, new ServiceRegistry());

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [createInstanceStep(), propertySetOnClickTargetStep()],
    });

    const res = await exec.execute(
      composite,
      CLICK_TARGET_IRI,
      CLICK_TARGET_PATH,
    );

    expect(res.success).toBe(true);
    // Successful composite must NOT delete anything.
    expect(writer.deleteFile).not.toHaveBeenCalled();
    // The created file remains on disk.
    const createdPath = firstCreatedPath(writer);
    expect(files.has(createdPath)).toBe(true);
    // #3918 surfacing channel is intact.
    expect(res.createdPaths).toContain(createdPath);
  });
});
