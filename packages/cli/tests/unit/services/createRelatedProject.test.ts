import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import {
  GenericAssetCreationService,
  ServiceRegistry,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import {
  createCreateRelatedProjectService,
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

function writeAsset(vaultRoot: string, relPath: string, frontmatter: Frontmatter): string {
  const fullPath = path.join(vaultRoot, relPath);
  fs.ensureDirSync(path.dirname(fullPath));
  const yamlBody = yaml.dump(frontmatter, { quotingType: '"', lineWidth: -1 });
  fs.writeFileSync(fullPath, `---\n${yamlBody.trim()}\n---\n`, "utf-8");
  return fullPath;
}

function newCreatedFile(vaultRoot: string, folder: string, excludeBasenames: Set<string>): string {
  const dir = path.join(vaultRoot, folder);
  const entries = fs.readdirSync(dir).filter((e) => e.endsWith(".md"));
  const created = entries.find((e) => !excludeBasenames.has(path.basename(e, ".md")));
  if (!created) {
    throw new Error(`No new .md file found in ${dir}. Existing: ${entries.join(", ")}`);
  }
  return path.join(dir, created);
}

describe("createRelatedProject (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let genericAssetCreationService: GenericAssetCreationService;
  let service: ReturnType<typeof createCreateRelatedProjectService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-createrelatedproject-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    service = createCreateRelatedProjectService(vaultAdapter, genericAssetCreationService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  it("inherits ems__Effort_area when parent is ems__Area", async () => {
    writeAsset(vaultRoot, "areas/Area1.md", {
      exo__Asset_uid: "area-uid-1",
      exo__Asset_label: "Area 1",
      exo__Instance_class: ["[[ems__Area]]"],
    });
    const before = new Set(["Area1"]);

    await service.execute("areas/Area1", { label: "New Project from Area" });

    const createdPath = newCreatedFile(vaultRoot, "areas", before);
    const fm = readFrontmatter(createdPath);

    expect(fm.exo__Instance_class).toEqual(["[[ems__Project]]"]);
    expect(fm.exo__Asset_label).toBe("New Project from Area");
    expect(fm.ems__Effort_area).toBe("[[Area1]]");
    expect(fm.ems__Effort_parent).toBeUndefined();
    expect(fm.ems__Effort_status).toBe("[[ems__EffortStatusDraft]]");
  });

  it("inherits ems__Effort_parent when parent is ems__Project", async () => {
    writeAsset(vaultRoot, "projects/Project1.md", {
      exo__Asset_uid: "proj-uid-1",
      exo__Asset_label: "Project 1",
      exo__Instance_class: ["[[ems__Project]]"],
    });
    const before = new Set(["Project1"]);

    await service.execute("projects/Project1", { label: "Sub Project from Project" });

    const createdPath = newCreatedFile(vaultRoot, "projects", before);
    const fm = readFrontmatter(createdPath);

    expect(fm.exo__Instance_class).toEqual(["[[ems__Project]]"]);
    expect(fm.ems__Effort_parent).toBe("[[Project1]]");
    expect(fm.ems__Effort_area).toBeUndefined();
  });

  it("inherits ems__Effort_parent when parent is ems__Task", async () => {
    writeAsset(vaultRoot, "tasks/Task1.md", {
      exo__Asset_uid: "task-uid-1",
      exo__Asset_label: "Task 1",
      exo__Instance_class: ["[[ems__Task]]"],
    });
    const before = new Set(["Task1"]);

    await service.execute("tasks/Task1", { label: "Project from Task" });

    const createdPath = newCreatedFile(vaultRoot, "tasks", before);
    const fm = readFrontmatter(createdPath);

    expect(fm.exo__Instance_class).toEqual(["[[ems__Project]]"]);
    expect(fm.ems__Effort_parent).toBe("[[Task1]]");
    expect(fm.ems__Effort_area).toBeUndefined();
  });

  it("writes explicit parentProperty in addition to auto-detected inheritance", async () => {
    writeAsset(vaultRoot, "areas/Area2.md", {
      exo__Asset_uid: "area-uid-2",
      exo__Asset_label: "Area 2",
      exo__Instance_class: ["[[ems__Area]]"],
    });
    const before = new Set(["Area2"]);

    await service.execute("areas/Area2", {
      label: "Custom Project",
      parentProperty: "ems__Effort_customParent",
    });

    const createdPath = newCreatedFile(vaultRoot, "areas", before);
    const fm = readFrontmatter(createdPath);

    expect(fm.ems__Effort_customParent).toBe("[[Area2]]");
    expect(fm.ems__Effort_area).toBe("[[Area2]]");
  });

  it("rejects when label is missing", async () => {
    writeAsset(vaultRoot, "areas/Area3.md", {
      exo__Asset_uid: "area-uid-3",
      exo__Instance_class: ["[[ems__Area]]"],
    });

    await expect(service.execute("areas/Area3", {})).rejects.toThrow(/label/i);
  });

  it("rejects when target file does not exist", async () => {
    await expect(
      service.execute("areas/DoesNotExist", { label: "x" }),
    ).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real createRelatedProject (no throw-stub)", async () => {
    writeAsset(vaultRoot, "areas/Area4.md", {
      exo__Asset_uid: "area-uid-4",
      exo__Asset_label: "Area 4",
      exo__Instance_class: ["[[ems__Area]]"],
    });
    const before = new Set(["Area4"]);

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
    });

    const registered = registry.get("createRelatedProject");
    expect(registered).toBeDefined();

    await expect(
      registered!.execute("areas/Area4", { label: "Registered Project" }),
    ).resolves.toBeUndefined();

    const createdPath = newCreatedFile(vaultRoot, "areas", before);
    const fm = readFrontmatter(createdPath);
    expect(fm.exo__Asset_label).toBe("Registered Project");
    expect(fm.ems__Effort_area).toBe("[[Area4]]");
  });

  it("registry integration: createRelatedProject is NOT a CliServiceNotImplementedError stub when deps provided (#2866 regression guard)", async () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, {
      vaultAdapter,
      genericAssetCreationService,
    });
    const registered = registry.get("createRelatedProject");
    expect(registered).toBeDefined();

    writeAsset(vaultRoot, "areas/Area5.md", {
      exo__Asset_uid: "area-uid-5",
      exo__Instance_class: ["[[ems__Area]]"],
    });

    try {
      await registered!.execute("areas/Area5", { label: "Guard Project" });
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, createRelatedProject is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("createRelatedProject")).toBe(false);
  });
});
