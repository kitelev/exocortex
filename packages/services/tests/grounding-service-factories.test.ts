import { describe, it, expect } from "@jest/globals";
import {
  createCreateRelatedTaskService,
  createCreateRelatedProjectService,
  createArchiveAssetService,
  createCleanPropertiesService,
  createFixMissingLabelService,
  createRenameToUidService,
  createRepairFolderService,
  createPlanForEveningService,
} from "../src/index";

/**
 * Smoke contract tests for the factories re-housed in
 * `@kitelev/exocortex-services`. The factories are pure adapters: they do not
 * read or write the filesystem themselves, they only call into the injected
 * `IVaultAdapter` and the injected domain service. Behavioural parity tests
 * (real fs, vault-shaped fixtures) continue to live in
 * `packages/cli/tests/unit/services/*.test.ts`, since the factories were
 * previously defined inline there. This suite exists to lock in the contract
 * of the new public API: each factory returns an `IGroundingService` whose
 * `execute` resolves a target file via `getAbstractFileByPath(`${IRI}.md`)`
 * and delegates to the injected domain service.
 */

interface StubFile {
  basename: string;
  parent: { path: string };
}

function stubFile(basename: string, parentPath = "Tasks"): StubFile {
  return { basename, parent: { path: parentPath } };
}

function stubVaultAdapter(file: StubFile, frontmatter: Record<string, unknown> = {}) {
  return {
    getAbstractFileByPath: (_path: string) => file as never,
    getFrontmatter: (_f: unknown) => frontmatter,
  } as never;
}

describe("@kitelev/exocortex-services — factory contract", () => {
  it("createCreateRelatedTaskService delegates to GenericAssetCreationService.createAsset with ems__Task", async () => {
    const calls: unknown[] = [];
    const generic = {
      createAsset: async (args: unknown) => {
        calls.push(args);
      },
    } as never;
    const file = stubFile("parent-uid", "Tasks/Inbox");
    const adapter = stubVaultAdapter(file, { exo__Asset_label: "Parent" });
    const service = createCreateRelatedTaskService(adapter, generic);

    await service.execute("parent-uid", { label: "Child Task" });

    expect(calls).toHaveLength(1);
    const arg = calls[0] as { className: string; label: string; folderPath: string };
    expect(arg.className).toBe("ems__Task");
    expect(arg.label).toBe("Child Task");
    expect(arg.folderPath).toBe("Tasks/Inbox");
  });

  it("createCreateRelatedTaskService throws when label is missing", async () => {
    const generic = { createAsset: async () => {} } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createCreateRelatedTaskService(adapter, generic);

    await expect(service.execute("uid", {})).rejects.toThrow(
      /createRelatedTask requires userInput.label/,
    );
  });

  it("createCreateRelatedProjectService delegates with ems__Project class", async () => {
    const calls: unknown[] = [];
    const generic = {
      createAsset: async (args: unknown) => {
        calls.push(args);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("area-uid", "Areas"));
    const service = createCreateRelatedProjectService(adapter, generic);

    await service.execute("area-uid", { label: "New Project" });

    expect((calls[0] as { className: string }).className).toBe("ems__Project");
  });

  it("createArchiveAssetService delegates to ArchiveAssetService.archiveAsset", async () => {
    const seen: unknown[] = [];
    const archive = {
      archiveAsset: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const file = stubFile("archive-me");
    const adapter = stubVaultAdapter(file);
    const service = createArchiveAssetService(adapter, archive);

    await service.execute("archive-me");

    expect(seen).toHaveLength(1);
  });

  it("createCleanPropertiesService delegates to PropertyCleanupService", async () => {
    const seen: unknown[] = [];
    const cleanup = {
      cleanEmptyProperties: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createCleanPropertiesService(adapter, cleanup);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("createFixMissingLabelService delegates to FixMissingLabelService", async () => {
    const seen: unknown[] = [];
    const fix = {
      fixMissingLabel: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createFixMissingLabelService(adapter, fix);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("createRenameToUidService passes resolved metadata to the domain service", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const rename = {
      renameToUid: async (file: unknown, meta: unknown) => {
        calls.push([file, meta]);
      },
    } as never;
    const meta = { exo__Asset_uid: "abc123" };
    const adapter = stubVaultAdapter(stubFile("name"), meta);
    const service = createRenameToUidService(adapter, rename);

    await service.execute("name");

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(meta);
  });

  it("createRepairFolderService throws when expected folder cannot be derived", async () => {
    const folderRepair = {
      getExpectedFolder: async () => null,
      repairFolder: async () => {
        throw new Error("must not be called");
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Wherever"));
    const service = createRepairFolderService(adapter, folderRepair);

    await expect(service.execute("uid")).rejects.toThrow(/cannot determine expected folder/);
  });

  it("createRepairFolderService no-ops when current folder matches expected", async () => {
    let repaired = false;
    const folderRepair = {
      getExpectedFolder: async () => "Tasks",
      repairFolder: async () => {
        repaired = true;
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Tasks"));
    const service = createRepairFolderService(adapter, folderRepair);

    await service.execute("uid");

    expect(repaired).toBe(false);
  });

  it("createRepairFolderService delegates repair when folders differ", async () => {
    const calls: Array<[unknown, string]> = [];
    const folderRepair = {
      getExpectedFolder: async () => "Tasks",
      repairFolder: async (file: unknown, folder: string) => {
        calls.push([file, folder]);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid", "Misplaced"));
    const service = createRepairFolderService(adapter, folderRepair);

    await service.execute("uid");

    expect(calls).toEqual([[expect.anything(), "Tasks"]]);
  });

  it("createPlanForEveningService delegates to TaskStatusService.planForEvening", async () => {
    const seen: unknown[] = [];
    const taskStatus = {
      planForEvening: async (file: unknown) => {
        seen.push(file);
      },
    } as never;
    const adapter = stubVaultAdapter(stubFile("uid"));
    const service = createPlanForEveningService(adapter, taskStatus);

    await service.execute("uid");

    expect(seen).toHaveLength(1);
  });

  it("factories throw when target file cannot be resolved", async () => {
    const generic = { createAsset: async () => {} } as never;
    const adapter = {
      getAbstractFileByPath: () => null,
      getFrontmatter: () => ({}),
    } as never;
    const service = createCreateRelatedTaskService(adapter, generic);

    await expect(service.execute("missing-uid", { label: "x" })).rejects.toThrow(
      /Cannot resolve target file/,
    );
  });
});
