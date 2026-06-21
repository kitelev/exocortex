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
import { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import {
  populateCliServiceRegistry,
  CliServiceNotImplementedError,
} from "../../../src/services/CliServiceRegistryPopulator.js";

/**
 * Phase 3.5 (Issue #3164) — registry-level integration tests for the new
 * `createAsset` handler. Mirrors the registry tests for `createRelatedTask`
 * /`createRelatedProject` so the three handlers share the same regression
 * surface: invoke through the same `populateCliServiceRegistry` entry point,
 * assert byte-level frontmatter on disk.
 *
 * Direct factory tests (parameter validation, branch coverage on parent
 * inheritance + isDefinedBy precedence) live in
 * `packages/services/tests/grounding-service-factories.test.ts` to keep the
 * CLI suite focused on the wiring contract.
 */

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
): string {
  const fullPath = path.join(vaultRoot, relPath);
  fs.ensureDirSync(path.dirname(fullPath));
  const yamlBody = yaml.dump(frontmatter, { quotingType: '"', lineWidth: -1 });
  fs.writeFileSync(fullPath, `---\n${yamlBody.trim()}\n---\n`, "utf-8");
  return fullPath;
}

function newCreatedFile(
  vaultRoot: string,
  folder: string,
  excludeBasenames: Set<string>,
): string {
  const dir = path.join(vaultRoot, folder);
  const entries = fs.readdirSync(dir).filter((e) => e.endsWith(".md"));
  const created = entries.find(
    (e) => !excludeBasenames.has(path.basename(e, ".md")),
  );
  if (!created) {
    throw new Error(
      `No new .md file found in ${dir}. Existing: ${entries.join(", ")}`,
    );
  }
  return path.join(dir, created);
}

describe("createAsset (CLI registry integration, Phase 3.5)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let fsAdapter: NodeFsAdapter;
  let genericAssetCreationService: GenericAssetCreationService;
  let archiveAssetService: ArchiveAssetService;
  let propertyCleanupService: PropertyCleanupService;
  let taskStatusService: TaskStatusService;
  let fixMissingLabelService: FixMissingLabelService;
  let renameToUidService: RenameToUidService;
  let folderRepairService: FolderRepairService;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-createasset-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    fsAdapter = new NodeFsAdapter(vaultRoot);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    renameToUidService = new RenameToUidService(vaultAdapter);
    folderRepairService = new FolderRepairService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  function fullDeps() {
    return {
      vaultAdapter,
      fsAdapter,
      genericAssetCreationService,
      archiveAssetService,
      taskStatusService,
      propertyCleanupService,
      fixMissingLabelService,
      renameToUidService,
      folderRepairService,
    };
  }

  it("registry without fsAdapter keeps createAsset as a fail-loud stub", async () => {
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

    const registered = registry.get("createAsset");
    expect(registered).toBeDefined();

    await expect(
      registered!.execute("any-iri", {
        prototypeUID: "ems__TaskPrototype",
        label: "Stub Task",
      }),
    ).rejects.toBeInstanceOf(CliServiceNotImplementedError);
  });

  it("registry with fsAdapter registers the real createAsset handler", async () => {
    writeAsset(vaultRoot, "areas/Area1.md", {
      exo__Asset_uid: "area-uid-1",
      exo__Asset_label: "Area 1",
      exo__Instance_class: ["[[ems__Area]]"],
    });
    const before = new Set(["Area1"]);

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());

    const registered = registry.get("createAsset");
    expect(registered).toBeDefined();

    await registered!.execute("areas/Area1", {
      prototypeUID: "ems__TaskPrototype",
      label: "Registered CreateAsset",
    });

    const createdPath = newCreatedFile(vaultRoot, "areas", before);
    const fm = readFrontmatter(createdPath);
    expect(fm.exo__Asset_label).toBe("Registered CreateAsset");
    expect(fm.exo__Asset_prototype).toBe("[[ems__TaskPrototype]]");
    expect(fm.exo__Instance_class).toEqual(["[[ems__Task]]"]);
    expect(fm.ems__Effort_area).toBe("[[Area1]]");
    // UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194) — Backlog UID.
    expect(fm.ems__Effort_status).toBe(
      "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]",
    );
  });

  it("registry with fsAdapter: createAsset is NOT a CliServiceNotImplementedError stub", async () => {
    writeAsset(vaultRoot, "areas/Area2.md", {
      exo__Asset_uid: "area-uid-2",
      exo__Instance_class: ["[[ems__Area]]"],
    });

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());
    const registered = registry.get("createAsset");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("areas/Area2", {
        prototypeUID: "ems__TaskPrototype",
        label: "Guard Task",
      });
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("createAsset inherits ems__Effort_parent (not _area) from non-Area parent", async () => {
    writeAsset(vaultRoot, "projects/Project1.md", {
      exo__Asset_uid: "proj-uid-1",
      exo__Asset_label: "Project 1",
      exo__Instance_class: ["[[ems__Project]]"],
    });
    const before = new Set(["Project1"]);

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());

    await registry.get("createAsset")!.execute("projects/Project1", {
      prototypeUID: "ems__TaskPrototype",
      label: "Subtask from Project",
    });

    const createdPath = newCreatedFile(vaultRoot, "projects", before);
    const fm = readFrontmatter(createdPath);
    expect(fm.ems__Effort_parent).toBe("[[Project1]]");
    expect(fm.ems__Effort_area).toBeUndefined();
  });

  it("createAsset inherits exo__Asset_isDefinedBy from parent when not explicitly overridden", async () => {
    writeAsset(vaultRoot, "areas/Area3.md", {
      exo__Asset_uid: "area-uid-3",
      exo__Asset_label: "Area 3",
      exo__Instance_class: ["[[ems__Area]]"],
      exo__Asset_isDefinedBy: "[[OwnerA]]",
    });
    const before = new Set(["Area3"]);

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());

    await registry.get("createAsset")!.execute("areas/Area3", {
      prototypeUID: "ems__TaskPrototype",
      label: "Inherits owner",
    });

    const createdPath = newCreatedFile(vaultRoot, "areas", before);
    const fm = readFrontmatter(createdPath);
    expect(fm.exo__Asset_isDefinedBy).toBe("[[OwnerA]]");
  });

  it("createAsset accepts explicit userInput.folder overriding parent-inferred folder", async () => {
    writeAsset(vaultRoot, "areas/Area4.md", {
      exo__Asset_uid: "area-uid-4",
      exo__Instance_class: ["[[ems__Area]]"],
    });

    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());

    await registry.get("createAsset")!.execute("areas/Area4", {
      prototypeUID: "ems__TaskPrototype",
      label: "Custom folder",
      folder: "inbox",
    });

    expect(fs.existsSync(path.join(vaultRoot, "inbox"))).toBe(true);
    const inboxFiles = fs
      .readdirSync(path.join(vaultRoot, "inbox"))
      .filter((e) => e.endsWith(".md"));
    expect(inboxFiles).toHaveLength(1);
  });

  it("createAsset throws when prototypeUID is missing", async () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());
    await expect(
      registry.get("createAsset")!.execute("any", { label: "x", folder: "x" }),
    ).rejects.toThrow(/createAsset requires userInput.prototypeUID/);
  });

  it("createAsset throws when label is missing", async () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry, fullDeps());
    await expect(
      registry
        .get("createAsset")!
        .execute("any", { prototypeUID: "ems__TaskPrototype", folder: "x" }),
    ).rejects.toThrow(/createAsset requires userInput.label/);
  });
});
