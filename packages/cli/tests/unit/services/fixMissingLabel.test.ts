import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import {
  ArchiveAssetService,
  EffortStatusWorkflow,
  FixMissingLabelService,
  GenericAssetCreationService,
  PropertyCleanupService,
  ServiceRegistry,
  StatusTimestampService,
  TaskStatusService,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createFixMissingLabelService,
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

describe("fixMissingLabel (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let fixMissingLabelService: FixMissingLabelService;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let taskStatusService: TaskStatusService;
  let service: ReturnType<typeof createFixMissingLabelService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-fixmissinglabel-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createFixMissingLabelService(vaultAdapter, fixMissingLabelService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("adds exo__Asset_label derived from basename when missing", async () => {
    writeRaw(
      vaultRoot,
      "tasks/7de4ab12-label.md",
      "---\nexo__Asset_uid: 7de4ab12-label\n---\nBody\n",
    );

    await service.execute("tasks/7de4ab12-label");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/7de4ab12-label.md"));
    expect(fm.exo__Asset_label).toBe("7de4ab12-label");
    expect(fm.exo__Asset_uid).toBe("7de4ab12-label");
  });

  it("sets exo__Asset_label when value is empty string", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Empty.md",
      '---\nexo__Asset_uid: 7de4ab12\nexo__Asset_label: ""\n---\nBody\n',
    );

    await service.execute("tasks/Empty");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Empty.md"));
    expect(fm.exo__Asset_label).toBe("Empty");
  });

  it("is a no-op when label already set to non-empty value", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Labeled.md",
      '---\nexo__Asset_uid: 7de4ab12\nexo__Asset_label: "Already Has Label"\n---\nBody\n',
    );

    const originalContent = fs.readFileSync(
      path.join(vaultRoot, "tasks/Labeled.md"),
      "utf-8",
    );

    await service.execute("tasks/Labeled");

    const unchanged = fs.readFileSync(
      path.join(vaultRoot, "tasks/Labeled.md"),
      "utf-8",
    );
    expect(unchanged).toBe(originalContent);
  });

  it("preserves file body content", async () => {
    writeRaw(
      vaultRoot,
      "tasks/WithBody.md",
      "---\nexo__Asset_uid: task-5\n---\n## Notes\n- bullet one\n- bullet two\n",
    );

    await service.execute("tasks/WithBody");

    const content = fs.readFileSync(
      path.join(vaultRoot, "tasks/WithBody.md"),
      "utf-8",
    );
    expect(content).toContain("## Notes\n- bullet one\n- bullet two\n");
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real fixMissingLabel (no throw-stub)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Registered.md",
      "---\nexo__Asset_uid: task-6\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
    });

    const registered = registry.get("fixMissingLabel");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Registered.md"));
    expect(fm.exo__Asset_label).toBe("Registered");
  });

  it("registry integration: fixMissingLabel is NOT a CliServiceNotImplementedError stub when deps provided (#2870 regression guard)", async () => {
    writeRaw(
      vaultRoot,
      "tasks/Guard.md",
      "---\nexo__Asset_uid: task-7\n---\nBody\n",
    );

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
    });
    const registered = registry.get("fixMissingLabel");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, fixMissingLabel is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("fixMissingLabel")).toBe(false);
  });
});
