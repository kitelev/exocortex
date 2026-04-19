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
  createCleanPropertiesService,
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

describe("cleanProperties (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let propertyCleanupService: PropertyCleanupService;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let taskStatusService: TaskStatusService;
  let fixMissingLabelService: FixMissingLabelService;
  let renameToUidService: RenameToUidService;
  let folderRepairService: FolderRepairService;
  let service: ReturnType<typeof createCleanPropertiesService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-cleanproperties-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    renameToUidService = new RenameToUidService(vaultAdapter);
    folderRepairService = new FolderRepairService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createCleanPropertiesService(vaultAdapter, propertyCleanupService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it('removes empty string properties ("")', async () => {
    writeRaw(
      vaultRoot,
      "tasks/Empty.md",
      '---\nexo__Asset_uid: task-1\nexo__Asset_label: "With Empty"\nems__Effort_plannedStartTimestamp: ""\n---\nBody\n',
    );

    await service.execute("tasks/Empty");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Empty.md"));
    expect(fm.exo__Asset_uid).toBe("task-1");
    expect(fm.ems__Effort_plannedStartTimestamp).toBeUndefined();
  });

  it("removes null-valued properties", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Null.md",
      "---\nexo__Asset_uid: task-2\nexo__Asset_label: With Null\nobsolete_field: null\n---\nBody\n",
    );

    await service.execute("tasks/Null");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Null.md"));
    expect(fm.obsolete_field).toBeUndefined();
    expect(fm.exo__Asset_label).toBe("With Null");
  });

  it("removes empty list properties ([])", async () => {
    writeRaw(
      vaultRoot,
      "tasks/EmptyList.md",
      "---\nexo__Asset_uid: task-3\nexo__Asset_label: Empty List\ntags: []\n---\nBody\n",
    );

    await service.execute("tasks/EmptyList");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/EmptyList.md"));
    expect(fm.tags).toBeUndefined();
  });

  it("keeps non-empty properties untouched", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Mixed.md",
      '---\nexo__Asset_uid: task-4\nexo__Asset_label: Mixed\nems__Effort_plannedStartTimestamp: ""\nems__Effort_status: "[[ems__EffortStatusDoing]]"\n---\nBody\n',
    );

    await service.execute("tasks/Mixed");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Mixed.md"));
    expect(fm.ems__Effort_plannedStartTimestamp).toBeUndefined();
    expect(fm.ems__Effort_status).toBe("[[ems__EffortStatusDoing]]");
    expect(fm.exo__Asset_label).toBe("Mixed");
  });

  it("preserves file body content", async () => {
    writeRaw(
      vaultRoot,
      "tasks/WithBody.md",
      '---\nexo__Asset_uid: task-5\nempty_prop: ""\n---\n## Notes\n- bullet one\n- bullet two\n',
    );

    await service.execute("tasks/WithBody");

    const content = fs.readFileSync(
      path.join(vaultRoot, "tasks/WithBody.md"),
      "utf-8",
    );
    expect(content).toContain("## Notes\n- bullet one\n- bullet two\n");
    expect(content).not.toMatch(/empty_prop:\s*""/);
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real cleanProperties (no throw-stub)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Registered.md",
      '---\nexo__Asset_uid: task-6\nexo__Asset_label: Registered\nempty: ""\n---\nBody\n',
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

    const registered = registry.get("cleanProperties");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Registered.md"));
    expect(fm.empty).toBeUndefined();
    expect(fm.exo__Asset_label).toBe("Registered");
  });

  it("registry integration: cleanProperties is NOT a CliServiceNotImplementedError stub when deps provided (#2869 regression guard)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Guard.md",
      '---\nexo__Asset_uid: task-7\nexo__Asset_label: Guard\n---\nBody\n',
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
    const registered = registry.get("cleanProperties");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, cleanProperties is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("cleanProperties")).toBe(false);
  });
});
