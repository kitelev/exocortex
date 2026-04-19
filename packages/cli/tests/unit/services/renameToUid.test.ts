import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import {
  ArchiveAssetService,
  EffortStatusWorkflow,
  FixMissingLabelService,
  FolderRepairService,
  GenericAssetCreationService,
  PropertyCleanupService,
  RenameToUidService,
  ServiceRegistry,
  StatusTimestampService,
  TaskStatusService,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createRenameToUidService,
  populateCliServiceRegistry,
  CliServiceNotImplementedError,
} from "../../../src/services/CliServiceRegistryPopulator.js";

type Frontmatter = Record<string, unknown>;

function readFrontmatter(filePath: string): Frontmatter {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`No frontmatter in ${filePath}`);
  return yaml.load(match[1]) as Frontmatter;
}

function writeRaw(vaultRoot: string, relPath: string, content: string): string {
  const fullPath = path.join(vaultRoot, relPath);
  fs.ensureDirSync(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

describe("renameToUid (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let renameToUidService: RenameToUidService;
  let fixMissingLabelService: FixMissingLabelService;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let taskStatusService: TaskStatusService;
  let folderRepairService: FolderRepairService;
  let service: ReturnType<typeof createRenameToUidService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-renametouid-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    renameToUidService = new RenameToUidService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    folderRepairService = new FolderRepairService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createRenameToUidService(vaultAdapter, renameToUidService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("renames file to match exo__Asset_uid when filename differs", async () => {
    writeRaw(
      vaultRoot,
      "tasks/My Task.md",
      "---\nexo__Asset_uid: a1b2c3d4-renamed-uid\nexo__Asset_label: My Task\n---\nBody\n",
    );

    await service.execute("tasks/My Task");

    expect(fs.existsSync(path.join(vaultRoot, "tasks/a1b2c3d4-renamed-uid.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "tasks/My Task.md"))).toBe(false);
  });

  it("preserves frontmatter properties after rename", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Original.md",
      "---\nexo__Asset_uid: xyz-789\nexo__Asset_label: Original\nems__Effort_status: '\"[[ems__EffortStatusDoing]]\"'\n---\nBody\n",
    );

    await service.execute("tasks/Original");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/xyz-789.md"));
    expect(fm.exo__Asset_uid).toBe("xyz-789");
    expect(fm.exo__Asset_label).toBe("Original");
  });

  it("adds exo__Asset_label = original basename when label is missing before rename", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Needs Label.md",
      "---\nexo__Asset_uid: label-fix-uid\n---\nBody\n",
    );

    await service.execute("tasks/Needs Label");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/label-fix-uid.md"));
    expect(fm.exo__Asset_label).toBe("Needs Label");
  });

  it("throws when exo__Asset_uid is missing", async () => {
    writeRaw(
      vaultRoot,
      "tasks/NoUid.md",
      "---\nexo__Asset_label: NoUid\n---\nBody\n",
    );

    await expect(service.execute("tasks/NoUid")).rejects.toThrow(/uid/i);
  });

  it("throws when file is already named according to UID", async () => {
    writeRaw(
      vaultRoot,
      "tasks/already-named.md",
      "---\nexo__Asset_uid: already-named\nexo__Asset_label: Already\n---\nBody\n",
    );

    await expect(service.execute("tasks/already-named")).rejects.toThrow(
      /already named/i,
    );
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real renameToUid (no throw-stub)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Registered.md",
      "---\nexo__Asset_uid: reg-uid-42\nexo__Asset_label: Registered\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
      renameToUidService,
      folderRepairService,
    });

    const registered = registry.get("renameToUid");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(vaultRoot, "tasks/reg-uid-42.md"))).toBe(true);
  });

  it("registry integration: renameToUid is NOT a CliServiceNotImplementedError stub when deps provided (#2871 regression guard)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Guard.md",
      "---\nexo__Asset_uid: guard-uid\nexo__Asset_label: Guard\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
      renameToUidService,
      folderRepairService,
    });
    const registered = registry.get("renameToUid");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, renameToUid is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("renameToUid")).toBe(false);
  });
});
