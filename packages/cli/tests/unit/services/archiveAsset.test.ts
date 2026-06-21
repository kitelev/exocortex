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
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createArchiveAssetService,
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

function writeAsset(
  vaultRoot: string,
  relPath: string,
  frontmatter: Frontmatter,
  body = "",
): string {
  const fullPath = path.join(vaultRoot, relPath);
  fs.ensureDirSync(path.dirname(fullPath));
  const yamlBody = yaml.dump(frontmatter, { quotingType: '"', lineWidth: -1 });
  fs.writeFileSync(fullPath, `---\n${yamlBody.trim()}\n---\n${body}`, "utf-8");
  return fullPath;
}

describe("archiveAsset (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let fixMissingLabelService: FixMissingLabelService;
  let renameToUidService: RenameToUidService;
  let folderRepairService: FolderRepairService;
  let taskStatusService: TaskStatusService;
  let service: ReturnType<typeof createArchiveAssetService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-archiveasset-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    renameToUidService = new RenameToUidService(vaultAdapter);
    folderRepairService = new FolderRepairService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createArchiveAssetService(vaultAdapter, archiveAssetService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("sets archived: true on a Done task", async () => {
    writeAsset(vaultRoot, "tasks/DoneTask.md", {
      exo__Asset_uid: "task-1",
      exo__Asset_label: "Done Task",
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    });

    await service.execute("tasks/DoneTask");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/DoneTask.md"));
    expect(fm.archived).toBe(true);
  });

  it("removes aliases when archiving", async () => {
    writeAsset(vaultRoot, "tasks/WithAliases.md", {
      exo__Asset_uid: "task-2",
      exo__Asset_label: "With Aliases",
      ems__Effort_status: "[[ems__EffortStatusDone]]",
      aliases: ["With Aliases", "Alt Name"],
    });

    await service.execute("tasks/WithAliases");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/WithAliases.md"));
    expect(fm.archived).toBe(true);
    expect(fm.aliases).toBeUndefined();
  });

  it("is idempotent when already archived", async () => {
    writeAsset(vaultRoot, "tasks/Already.md", {
      exo__Asset_uid: "task-3",
      exo__Asset_label: "Already",
      archived: true,
    });
    const before = fs.readFileSync(
      path.join(vaultRoot, "tasks/Already.md"),
      "utf-8",
    );

    await service.execute("tasks/Already");

    const after = fs.readFileSync(
      path.join(vaultRoot, "tasks/Already.md"),
      "utf-8",
    );
    expect(after).toBe(before);
  });

  it("preserves file body content", async () => {
    writeAsset(
      vaultRoot,
      "tasks/WithBody.md",
      {
        exo__Asset_uid: "task-4",
        exo__Asset_label: "With Body",
      },
      "## Notes\n- bullet one\n- bullet two\n",
    );

    await service.execute("tasks/WithBody");

    const content = fs.readFileSync(
      path.join(vaultRoot, "tasks/WithBody.md"),
      "utf-8",
    );
    expect(content).toContain("## Notes\n- bullet one\n- bullet two\n");
    const fm = readFrontmatter(path.join(vaultRoot, "tasks/WithBody.md"));
    expect(fm.archived).toBe(true);
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real archiveAsset (no throw-stub)", async () => {
    writeAsset(vaultRoot, "tasks/Registered.md", {
      exo__Asset_uid: "task-5",
      exo__Asset_label: "Registered",
    });

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

    const registered = registry.get("archiveAsset");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Registered.md"));
    expect(fm.archived).toBe(true);
  });

  it("registry integration: archiveAsset is NOT a CliServiceNotImplementedError stub when deps provided (#2867 regression guard)", async () => {
    writeAsset(vaultRoot, "tasks/Guard.md", {
      exo__Asset_uid: "task-6",
      exo__Asset_label: "Guard",
    });

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
    const registered = registry.get("archiveAsset");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, archiveAsset is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("archiveAsset")).toBe(false);
  });
});
