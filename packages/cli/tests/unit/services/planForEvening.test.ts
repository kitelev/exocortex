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
  RenameToUidService,
  ServiceRegistry,
  StatusTimestampService,
  TaskStatusService,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createPlanForEveningService,
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

/**
 * Returns the raw YAML string value for a frontmatter key — bypasses
 * js-yaml's implicit timestamp coercion so assertions can verify the
 * exact on-disk format (`YYYY-MM-DDTHH:MM:SS` with no ms/tz).
 */
function readRawProperty(filePath: string, key: string): string | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const lineRe = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const line = fmMatch[1].match(lineRe);
  if (!line) return null;
  return line[1].trim();
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

function todayYYYYMMDD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("planForEvening (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let workflow: EffortStatusWorkflow;
  let timestampService: StatusTimestampService;
  let taskStatusService: TaskStatusService;
  let fixMissingLabelService: FixMissingLabelService;
  let renameToUidService: RenameToUidService;
  let service: ReturnType<typeof createPlanForEveningService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-planforevening-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    renameToUidService = new RenameToUidService(vaultAdapter);
    workflow = new EffortStatusWorkflow();
    timestampService = new StatusTimestampService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      workflow,
      timestampService,
    );
    service = createPlanForEveningService(vaultAdapter, taskStatusService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("sets ems__Effort_plannedStartTimestamp to <TODAY>T19:00:00 on a Backlog task", async () => {
    writeAsset(vaultRoot, "tasks/Backlog.md", {
      exo__Asset_uid: "task-1",
      exo__Asset_label: "Backlog Task",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    });

    await service.execute("tasks/Backlog");

    const raw = readRawProperty(
      path.join(vaultRoot, "tasks/Backlog.md"),
      "ems__Effort_plannedStartTimestamp",
    );
    expect(raw).toBe(`${todayYYYYMMDD()}T19:00:00`);
  });

  it("timestamp matches /^\\d{4}-\\d{2}-\\d{2}T19:00:00$/ format (no ms, no Z, no tz)", async () => {
    writeAsset(vaultRoot, "tasks/FormatCheck.md", {
      exo__Asset_uid: "task-2",
      exo__Asset_label: "Format Check",
    });

    await service.execute("tasks/FormatCheck");

    const raw = readRawProperty(
      path.join(vaultRoot, "tasks/FormatCheck.md"),
      "ems__Effort_plannedStartTimestamp",
    );
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2}T19:00:00$/);
  });

  it("preserves unrelated frontmatter keys", async () => {
    writeAsset(vaultRoot, "tasks/Preserve.md", {
      exo__Asset_uid: "task-3",
      exo__Asset_label: "Preserve Me",
      exo__Instance_class: ["[[ems__Task]]"],
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
      aliases: ["PM"],
    });

    await service.execute("tasks/Preserve");

    const fm = readFrontmatter(path.join(vaultRoot, "tasks/Preserve.md"));
    expect(fm.exo__Asset_uid).toBe("task-3");
    expect(fm.exo__Asset_label).toBe("Preserve Me");
    expect(fm.exo__Instance_class).toEqual(["[[ems__Task]]"]);
    expect(fm.ems__Effort_status).toBe("[[ems__EffortStatusBacklog]]");
    expect(fm.aliases).toEqual(["PM"]);
  });

  it("overwrites existing plannedStartTimestamp with new 19:00 value", async () => {
    writeAsset(vaultRoot, "tasks/Overwrite.md", {
      exo__Asset_uid: "task-4",
      exo__Asset_label: "Overwrite",
      ems__Effort_plannedStartTimestamp: "2025-01-01T08:00:00",
    });

    await service.execute("tasks/Overwrite");

    const raw = readRawProperty(
      path.join(vaultRoot, "tasks/Overwrite.md"),
      "ems__Effort_plannedStartTimestamp",
    );
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2}T19:00:00$/);
    expect(raw).not.toBe("2025-01-01T08:00:00");
  });

  it("preserves file body content", async () => {
    writeAsset(
      vaultRoot,
      "tasks/WithBody.md",
      {
        exo__Asset_uid: "task-5",
        exo__Asset_label: "With Body",
      },
      "## Notes\n- alpha\n- beta\n",
    );

    await service.execute("tasks/WithBody");

    const content = fs.readFileSync(
      path.join(vaultRoot, "tasks/WithBody.md"),
      "utf-8",
    );
    expect(content).toContain("## Notes\n- alpha\n- beta\n");
  });

  it("rejects when target file does not exist", async () => {
    await expect(service.execute("tasks/Missing")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real planForEvening (no throw-stub)", async () => {
    writeAsset(vaultRoot, "tasks/Registered.md", {
      exo__Asset_uid: "task-6",
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
    });

    const registered = registry.get("planForEvening");
    expect(registered).toBeDefined();
    await expect(registered!.execute("tasks/Registered")).resolves.toBeUndefined();

    const raw = readRawProperty(
      path.join(vaultRoot, "tasks/Registered.md"),
      "ems__Effort_plannedStartTimestamp",
    );
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2}T19:00:00$/);
  });

  it("registry integration: planForEvening is NOT a CliServiceNotImplementedError stub when deps provided (#2868 regression guard)", async () => {
    writeAsset(vaultRoot, "tasks/Guard.md", {
      exo__Asset_uid: "task-7",
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
    });
    const registered = registry.get("planForEvening");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("tasks/Guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, planForEvening is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("planForEvening")).toBe(false);
  });
});
