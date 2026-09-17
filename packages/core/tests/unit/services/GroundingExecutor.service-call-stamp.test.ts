/**
 * req 8d27f21d-4673-4490-866e-dfe4078c03a6 (ticket 8421b014, sibling of
 * 454ccedf, techbacklog bbac67ce) — GroundingExecutor stamps
 * `exo__Asset_updatedAt` after a `service_call` service changed its target.
 *
 * Mechanism under test (`GroundingExecutor.executeServiceCall` →
 * `readServiceCallSnapshot` / `stampServiceCallTarget` /
 * `locateServiceCallTarget`): the executor snapshots the target's bytes
 * BEFORE `service.execute`, re-reads them after the service returned, and when
 * they differ passes (before, after, mergedInput.property) through the same
 * `stampUpdatedAt` helper req 454ccedf added for the executor's own writes.
 * The service's write channel is irrelevant — the 17 service_call commands
 * write through IVaultAdapter.modify / process / IFileSystemWriter.updateFile /
 * vault.rename, and `packages/services` never calls the executor's writer for
 * its own mutation. Before this requirement `apply set-planned-start`,
 * `plan-for-evening`, `clean-properties` and `rename-to-uid` each changed the
 * file and left `exo__Asset_updatedAt` at the seeded value (published CLI
 * 16.240.10, n = 4).
 *
 * Axes (mutants M1–M8 in the PR body):
 *   S1  a service writing the target THROUGH the executor's writer is stamped
 *   S1b a service writing through a channel the executor never sees (the
 *       in-memory fs directly = IVaultAdapter.modify shape) is stamped too
 *   S2  a no-op service leaves the file byte-identical, no write at all
 *   S3  a satellite-only service: target byte-identical, satellite untouched
 *   S4  rename-to-uid shape (content changed + file renamed to <uid>.md):
 *       stamped at the NEW path, old path gone
 *   S4b a uid that is not a well-formed UUID (`../../x`) never becomes a
 *       re-locate path: nothing written (review LOW-1)
 *   S4c the UUID-canon candidate ALREADY existed before the call (duplicate
 *       uid in the folder) + a move-only service: the neighbour is not
 *       mistaken for the moved file — no stamp on it (review observation)
 *   S5  move-only service (repair-folder shape): nothing written
 *   S6  a service that owns exo__Asset_updatedAt (updateProperty shape with
 *       property = exo__Asset_updatedAt): exactly one key, the service's value
 *   S7  a target WITHOUT the key gets it
 *   S8  a throwing service: { success: false }, target = what the service left
 *   S8b a failure while writing the stamp: { success: false } with the error
 *       named — never a silent half-stamp
 *   S9  composite: service_call step + explicit bump step 49e00287 → ONE key
 *   S10 composite with targetsCreatedInstance: the stamp lands on the created
 *       instance, the click-target is byte-identical
 */

import {
  GroundingExecutor,
  ServiceRegistry,
  type IGroundingService,
  type UserInput,
} from "../../../src/services/GroundingExecutor";
import {
  clearResolvers,
  installDefaultResolvers,
} from "../../../src/services/SubstitutionResolverRegistry";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import type { GroundingDefinition } from "../../../src/domain/models/CommandDefinition";
import { frozenClock } from "../../../src/services/IClock";

const REQ = "@req:8d27f21d-4673-4490-866e-dfe4078c03a6";

const SEED_STAMP = "2020-01-01T00:00:00";
const CLOCK_ISO = "2026-06-20T12:34:56";
const CLOCK = frozenClock(CLOCK_ISO);
const STAMP_LINE = `exo__Asset_updatedAt: ${CLOCK_ISO}`;

const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ASSET_UID = "6f1c2a3b-0000-4000-8000-00000000abcd";
const TARGET_IRI = `obsidian://vault/tasks/${ASSET_UID}.md`;
const FILE_PATH = `tasks/${ASSET_UID}.md`;
/** Label-named target (rename-to-uid shape). */
const LABEL_PATH = "tasks/Label Named Task.md";
const LABEL_IRI = "obsidian://vault/tasks/Label%20Named%20Task.md";

/** In-memory fs honouring read-after-write (the executor re-reads the target). */
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

type Fs = ReturnType<typeof makeFs>;

function gnd(overrides: Record<string, unknown>): GroundingDefinition {
  return {
    id: "gnd-service-stamp",
    label: "service_call updatedAt stamp axis",
    ...overrides,
  } as unknown as GroundingDefinition;
}

function serviceCall(
  serviceId: string,
  extra: Record<string, unknown> = {},
): GroundingDefinition {
  return gnd({
    type: GroundingType.SERVICE_CALL,
    targetProperty: serviceId,
    ...extra,
  });
}

function seedTask(
  updatedAt: string | null = SEED_STAMP,
  uid = ASSET_UID,
  label = "Seed task",
): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Instance_class:\n  - "[[${TASK_UID}|ems__Task]]"`,
    `exo__Asset_label: ${label}`,
    'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
    "ems__Effort_plannedStartTimestamp: 2026-06-01T09:00:00",
  ];
  if (updatedAt !== null) lines.push(`exo__Asset_updatedAt: ${updatedAt}`);
  return `---\n${lines.join("\n")}\n---\nBody`;
}

function updatedAtOf(content: string): string | undefined {
  return /^exo__Asset_updatedAt: (\S+)$/m.exec(content)?.[1];
}

function countKey(content: string, key: string): number {
  return (content.match(new RegExp(`^${key}:`, "gm")) ?? []).length;
}

function makeExecutor(
  fs: Fs,
  services: Record<string, IGroundingService>,
  clock: { now: () => Date } = CLOCK,
) {
  const registry = new ServiceRegistry();
  for (const [id, svc] of Object.entries(services)) registry.register(id, svc);
  return new GroundingExecutor(fs.reader, fs.writer, registry, undefined, {
    clock,
  });
}

/**
 * The `updateProperty` factory shape (packages/services): read the target via
 * the executor's reader, rewrite ONE frontmatter line, write via the
 * executor's writer. `property` / `value` come from mergedInput.
 */
function updatePropertyService(fs: Fs): IGroundingService {
  return {
    async execute(_iri: string, input?: UserInput) {
      const property = input?.property as string;
      const value = input?.value as string;
      const content = await fs.reader.readFile(FILE_PATH);
      const re = new RegExp(`^${property}: .*$`, "m");
      const next = re.test(content)
        ? content.replace(re, () => `${property}: ${value}`)
        : content.replace(/\n---\n/, `\n${property}: ${value}\n---\n`);
      await fs.writer.updateFile(FILE_PATH, next);
    },
  };
}

/**
 * The IVaultAdapter.modify shape (TaskStatusService / PropertyCleanupService /
 * FixMissingLabelService): the service mutates the file through ITS OWN
 * adapter — here the in-memory map directly — so the executor's writer never
 * sees the write. `mutate` returns the new content (or the same string for a
 * no-op).
 */
function ownChannelService(
  fs: Fs,
  path: string,
  mutate: (content: string) => string,
): IGroundingService {
  return {
    async execute() {
      const current = fs.files.get(path) as string;
      const next = mutate(current);
      if (next !== current) fs.files.set(path, next);
    },
  };
}

describe(`${REQ} GroundingExecutor stamps exo__Asset_updatedAt after a service_call service changed its target (ticket 8421b014)`, () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  // ---------------------------------------------------------------------------
  // S1 — the updateProperty factory shape: set-planned-start / set-result /
  // set-scheduled-date / set-start-timestamp / set-end-timestamp / set-planned-end.
  // ---------------------------------------------------------------------------
  it("S1 a service writing its target through the executor's writer (updateProperty shape) is stamped from the clock", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs, {
      updateProperty: updatePropertyService(fs),
    });

    const res = await exec.execute(
      serviceCall("updateProperty", {
        serviceCallPayload: '{"property":"ems__Effort_plannedStartTimestamp"}',
      }),
      TARGET_IRI,
      FILE_PATH,
      { value: "2026-07-25T09:00:00" },
    );

    expect(res).toEqual({ success: true });
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain(
      "ems__Effort_plannedStartTimestamp: 2026-07-25T09:00:00",
    );
    expect(written).toContain(STAMP_LINE);
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
    expect(countKey(written, "exo__Asset_updatedAt")).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // S1b — the IVaultAdapter.modify shape (plan-for-evening / clean-properties /
  // fix-missing-label): the executor's writer is NOT on the service's path, so
  // a writer hook would miss it; the byte comparison does not.
  // ---------------------------------------------------------------------------
  it("S1b a service writing its target through a channel the executor never sees (IVaultAdapter.modify shape) is stamped too", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs, {
      planForEvening: ownChannelService(fs, FILE_PATH, (c) =>
        c.replace(
          "ems__Effort_plannedStartTimestamp: 2026-06-01T09:00:00",
          "ems__Effort_plannedStartTimestamp: 2026-06-01T19:00:00",
        ),
      ),
    });

    const res = await exec.execute(
      serviceCall("planForEvening"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res).toEqual({ success: true });
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain(
      "ems__Effort_plannedStartTimestamp: 2026-06-01T19:00:00",
    );
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
    // The ONLY executor write is the stamp — the service wrote past the writer.
    expect(fs.writer.updateFile).toHaveBeenCalledTimes(1);
    expect(fs.writer.updateFile.mock.calls[0][0]).toBe(FILE_PATH);
  });

  // ---------------------------------------------------------------------------
  // S2 — no-op: clean-properties on an asset without empty properties,
  // set-planned-start to the value already on disk. Byte-identical, no write.
  // ---------------------------------------------------------------------------
  it("S2 a no-op service leaves the file byte-identical: updatedAt untouched and NO executor write", async () => {
    const seed = seedTask();
    const fs = makeFs({ [FILE_PATH]: seed });
    const exec = makeExecutor(fs, {
      cleanProperties: ownChannelService(fs, FILE_PATH, (c) => c),
    });

    const res = await exec.execute(
      serviceCall("cleanProperties"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.get(FILE_PATH)).toBe(seed);
    expect(updatedAtOf(fs.files.get(FILE_PATH) as string)).toBe(SEED_STAMP);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S3 — satellite-only (create-note / duplicate-asset / create-related-task):
  // the target is never written; the satellite is the CREATE side and the
  // executor invents nothing on it.
  // ---------------------------------------------------------------------------
  it("S3 a satellite-creating service leaves the target byte-identical and the executor writes nothing to the satellite", async () => {
    const seed = seedTask();
    const fs = makeFs({ [FILE_PATH]: seed });
    const SATELLITE = "tasks/11111111-2222-4333-8444-555555555555.md";
    const satelliteContent = seedTask(
      null,
      "11111111-2222-4333-8444-555555555555",
      "Child",
    );
    const exec = makeExecutor(fs, {
      createAsset: {
        async execute() {
          await fs.writer.createFile(SATELLITE, satelliteContent);
        },
      },
    });

    const res = await exec.execute(
      serviceCall("createAsset"),
      TARGET_IRI,
      FILE_PATH,
      { label: "Child" },
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.get(FILE_PATH)).toBe(seed);
    expect(fs.files.get(SATELLITE)).toBe(satelliteContent);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S4 — rename-to-uid shape: the service lifts the basename into the
  // frontmatter (content change) AND renames the file to <folder>/<uid>.md.
  // The snapshot path is gone; the executor re-locates by the uid it read
  // BEFORE the call and stamps there.
  // ---------------------------------------------------------------------------
  it("S4 rename-to-uid shape (content changed + renamed to <uid>.md): the stamp lands at the NEW path; the old path is gone", async () => {
    const seed = seedTask(SEED_STAMP, ASSET_UID, "Label Named Task");
    const fs = makeFs({ [LABEL_PATH]: seed });
    const exec = makeExecutor(fs, {
      renameToUid: {
        async execute() {
          const current = fs.files.get(LABEL_PATH) as string;
          const next = current.replace(
            "\n---\nBody",
            '\naliases:\n  - "Label Named Task"\n---\nBody',
          );
          fs.files.delete(LABEL_PATH);
          fs.files.set(FILE_PATH, next);
        },
      },
    });

    const res = await exec.execute(
      serviceCall("renameToUid"),
      LABEL_IRI,
      LABEL_PATH,
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.has(LABEL_PATH)).toBe(false);
    const written = fs.files.get(FILE_PATH) as string;
    expect(written).toContain('aliases:\n  - "Label Named Task"');
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
    expect(fs.writer.updateFile).toHaveBeenCalledTimes(1);
    expect(fs.writer.updateFile.mock.calls[0][0]).toBe(FILE_PATH);
  });

  // ---------------------------------------------------------------------------
  // S4b — the uid comes from user data and would become a WRITE path: only a
  // well-formed UUID may (review LOW-1). A traversal-shaped uid yields no
  // candidate at all, so even a file that happens to exist at the derived
  // path is left alone.
  // ---------------------------------------------------------------------------
  it("S4b a uid that is not a well-formed UUID never becomes a re-locate path: nothing written", async () => {
    const seed = seedTask(SEED_STAMP, "../../x", "Label Named Task");
    const fs = makeFs({ [LABEL_PATH]: seed });
    const DERIVED = "tasks/../../x.md";
    const exec = makeExecutor(fs, {
      renameToUid: {
        async execute() {
          // A rogue service: rewrites the content and "renames" the file to
          // the traversal-shaped derived path.
          const next = (fs.files.get(LABEL_PATH) as string).replace(
            "exo__Asset_label: Label Named Task",
            "exo__Asset_label: Renamed Task",
          );
          expect(next).not.toBe(fs.files.get(LABEL_PATH));
          fs.files.delete(LABEL_PATH);
          fs.files.set(DERIVED, next);
        },
      },
    });

    const res = await exec.execute(
      serviceCall("renameToUid"),
      LABEL_IRI,
      LABEL_PATH,
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.get(DERIVED)).toContain("exo__Asset_label: Renamed Task");
    expect(updatedAtOf(fs.files.get(DERIVED) as string)).toBe(SEED_STAMP);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S4c — the UUID-canon candidate is only a RENAME target if nothing lived
  // there before the call. A duplicate uid in the folder + a move-only
  // service (repair-folder) must not get the neighbour stamped (review
  // observation).
  // ---------------------------------------------------------------------------
  it("S4c a UUID-canon candidate that ALREADY existed before the call is not mistaken for the moved file: no stamp on the neighbour", async () => {
    const seed = seedTask(SEED_STAMP, ASSET_UID, "Label Named Task");
    const neighbour = seedTask(
      SEED_STAMP,
      ASSET_UID,
      "Neighbour with the same uid",
    );
    const fs = makeFs({ [LABEL_PATH]: seed, [FILE_PATH]: neighbour });
    const MOVED = `archive/${ASSET_UID}.md`;
    const exec = makeExecutor(fs, {
      repairFolder: {
        async execute() {
          fs.files.delete(LABEL_PATH);
          fs.files.set(MOVED, seed);
        },
      },
    });

    const res = await exec.execute(
      serviceCall("repairFolder"),
      LABEL_IRI,
      LABEL_PATH,
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.get(FILE_PATH)).toBe(neighbour);
    expect(fs.files.get(MOVED)).toBe(seed);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S5 — move-only (repair-folder shape): the file goes to ANOTHER folder with
  // its content untouched. Nothing to stamp, nothing written.
  // ---------------------------------------------------------------------------
  it("S5 a move-only service (repair-folder shape, content unchanged, other folder) writes nothing", async () => {
    const seed = seedTask();
    const fs = makeFs({ [FILE_PATH]: seed });
    const MOVED = `archive/${ASSET_UID}.md`;
    const exec = makeExecutor(fs, {
      repairFolder: {
        async execute() {
          fs.files.delete(FILE_PATH);
          fs.files.set(MOVED, seed);
        },
      },
    });

    const res = await exec.execute(
      serviceCall("repairFolder"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res).toEqual({ success: true });
    expect(fs.files.get(MOVED)).toBe(seed);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S6 — the service OWNS the key: updateProperty with property =
  // exo__Asset_updatedAt (the `property` input is the own-target guard input).
  // Exactly one key line, the service's value survives.
  // ---------------------------------------------------------------------------
  it("S6 a service told to write exo__Asset_updatedAt itself owns the key: exactly ONE key, the service's value (no second stamp)", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs, {
      updateProperty: updatePropertyService(fs),
    });

    const res = await exec.execute(
      serviceCall("updateProperty", {
        serviceCallPayload: '{"property":"exo__Asset_updatedAt"}',
      }),
      TARGET_IRI,
      FILE_PATH,
      { value: "2031-12-31T23:59:59" },
    );

    expect(res).toEqual({ success: true });
    const written = fs.files.get(FILE_PATH) as string;
    expect(countKey(written, "exo__Asset_updatedAt")).toBe(1);
    expect(updatedAtOf(written)).toBe("2031-12-31T23:59:59");
    // One write only — the service's own; the executor added none.
    expect(fs.writer.updateFile).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // S7 — a target without the key gets it.
  // ---------------------------------------------------------------------------
  it("S7 a target WITHOUT exo__Asset_updatedAt gets the key added", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask(null) });
    const exec = makeExecutor(fs, {
      planForEvening: ownChannelService(fs, FILE_PATH, (c) =>
        c.replace("Seed task", "Seed task (evening)"),
      ),
    });

    const res = await exec.execute(
      serviceCall("planForEvening"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res).toEqual({ success: true });
    const written = fs.files.get(FILE_PATH) as string;
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
    expect(countKey(written, "exo__Asset_updatedAt")).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // S8 — a throwing service: the stamp lives on the success path only.
  // The service wrote a partial change THEN threw; the executor must leave
  // the file exactly as the service left it (no stamp) and report failure.
  // ---------------------------------------------------------------------------
  it("S8 a throwing service yields { success: false } and the executor stamps nothing (file = what the service left)", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const partial = seedTask().replace("Seed task", "Half done");
    const exec = makeExecutor(fs, {
      planForEvening: {
        async execute() {
          fs.files.set(FILE_PATH, partial);
          throw new Error("planForEvening: boom after a partial write");
        },
      },
    });

    const res = await exec.execute(
      serviceCall("planForEvening"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("boom after a partial write");
    expect(fs.files.get(FILE_PATH)).toBe(partial);
    expect(updatedAtOf(fs.files.get(FILE_PATH) as string)).toBe(SEED_STAMP);
    expect(fs.writer.updateFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // S8b — the stamp write itself fails: named failure, never a silent
  // half-stamp reported as success.
  // ---------------------------------------------------------------------------
  it("S8b a failure while writing the stamp is { success: false } with the error named", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    fs.writer.updateFile.mockRejectedValueOnce(
      new Error("EACCES: stamp write refused"),
    );
    const exec = makeExecutor(fs, {
      planForEvening: ownChannelService(fs, FILE_PATH, (c) =>
        c.replace("Seed task", "Seed task (evening)"),
      ),
    });

    const res = await exec.execute(
      serviceCall("planForEvening"),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("EACCES: stamp write refused");
  });

  // ---------------------------------------------------------------------------
  // S9 — composite [service_call → explicit "Bump updatedAt" step 49e00287]:
  // the executor stamp and the data step must not leave two keys.
  // ---------------------------------------------------------------------------
  it("S9 a composite with a service_call step followed by the explicit $nowLocal bump step ends with exactly ONE exo__Asset_updatedAt key", async () => {
    const fs = makeFs({ [FILE_PATH]: seedTask() });
    const exec = makeExecutor(fs, {
      planForEvening: ownChannelService(fs, FILE_PATH, (c) =>
        c.replace("Seed task", "Seed task (evening)"),
      ),
    });

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        serviceCall("planForEvening", { id: "s-service" }),
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
    expect(written).toContain("Seed task (evening)");
    expect(countKey(written, "exo__Asset_updatedAt")).toBe(1);
    expect(updatedAtOf(written)).toBe(CLOCK_ISO);
  });

  // ---------------------------------------------------------------------------
  // S10 — composite [create_instance → service_call(targetsCreatedInstance)]:
  // the service mutates the CREATED instance (Issue #4046 re-points filePath),
  // so the stamp lands there and the click-target stays byte-identical.
  // ---------------------------------------------------------------------------
  it("S10 with targetsCreatedInstance the stamp lands on the CREATED instance; the click-target is byte-identical", async () => {
    const CLICK_PATH = "protos/proto-1.md";
    const clickSeed =
      "---\nexo__Asset_uid: proto-1\nexo__Asset_label: Task Prototype\nexo__Asset_updatedAt: 2020-01-01T00:00:00\n---\nProto body";
    const fs = makeFs({ [CLICK_PATH]: clickSeed });
    // A TICKING clock: create_instance writes createdAt = updatedAt from the
    // first tick(s); the service_call stamp is a LATER tick, so the two are
    // distinguishable (a frozen clock would let the create-side value pass
    // for the stamp).
    let tick = 0;
    const ticking = {
      now: () => new Date(Date.UTC(2026, 5, 20, 12, 0, tick++)),
    };
    const exec = makeExecutor(
      fs,
      {
        planForEvening: {
          async execute(iri: string) {
            // The service resolves its file from the IRI it is handed —
            // `obsidian://vault/<path>` (Issue #4046).
            const path = decodeURIComponent(
              iri.replace(/^obsidian:\/\/vault\//, ""),
            );
            const current = fs.files.get(path) as string;
            fs.files.set(
              path,
              current.replace(
                /\n---\n/,
                "\nems__Effort_plannedStartTimestamp: 2026-06-01T19:00:00\n---\n",
              ),
            );
          },
        },
      },
      ticking,
    );

    const composite = gnd({
      type: GroundingType.COMPOSITE,
      steps: [
        gnd({
          id: "s-create",
          type: GroundingType.CREATE_INSTANCE,
          targetClass: "ems__Task",
          targetFolder: "tasks",
        }),
        serviceCall("planForEvening", {
          id: "s-service",
          targetsCreatedInstance: true,
        }),
      ],
    });

    const res = await exec.execute(
      composite,
      "obsidian://vault/protos/proto-1.md",
      CLICK_PATH,
    );

    expect(res.success).toBe(true);
    const created = [...fs.files.entries()].find(
      ([p]) => p.startsWith("tasks/") && p !== CLICK_PATH,
    );
    expect(created).toBeDefined();
    const [createdPath, createdContent] = created as [string, string];
    expect(createdContent).toContain(
      "ems__Effort_plannedStartTimestamp: 2026-06-01T19:00:00",
    );
    // The stamp is a LATER tick than the createdAt the create step wrote.
    const createdAt = /^exo__Asset_createdAt: (\S+)$/m.exec(
      createdContent,
    )?.[1];
    expect(createdAt).toBeDefined();
    expect(updatedAtOf(createdContent)).toBeDefined();
    expect(updatedAtOf(createdContent)).not.toBe(createdAt);
    expect(
      (updatedAtOf(createdContent) as string) > (createdAt as string),
    ).toBe(true);
    expect(countKey(createdContent, "exo__Asset_updatedAt")).toBe(1);
    // The executor's ONLY updateFile is the stamp, on the created path.
    expect(fs.writer.updateFile).toHaveBeenCalledTimes(1);
    expect(fs.writer.updateFile.mock.calls[0][0]).toBe(createdPath);
    expect(fs.files.get(CLICK_PATH)).toBe(clickSeed);
  });
});
