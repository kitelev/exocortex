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
  createRepairFolderService,
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

describe("repairFolder (CLI)", () => {
  let vaultRoot: string;
  let vaultAdapter: FileSystemVaultAdapter;
  let folderRepairService: FolderRepairService;
  let renameToUidService: RenameToUidService;
  let fixMissingLabelService: FixMissingLabelService;
  let archiveAssetService: ArchiveAssetService;
  let genericAssetCreationService: GenericAssetCreationService;
  let propertyCleanupService: PropertyCleanupService;
  let taskStatusService: TaskStatusService;
  let service: ReturnType<typeof createRepairFolderService>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-repairfolder-"));
    vaultAdapter = new FileSystemVaultAdapter(vaultRoot);
    folderRepairService = new FolderRepairService(vaultAdapter);
    renameToUidService = new RenameToUidService(vaultAdapter);
    fixMissingLabelService = new FixMissingLabelService(vaultAdapter);
    archiveAssetService = new ArchiveAssetService(vaultAdapter);
    genericAssetCreationService = new GenericAssetCreationService(vaultAdapter);
    propertyCleanupService = new PropertyCleanupService(vaultAdapter);
    taskStatusService = new TaskStatusService(
      vaultAdapter,
      new EffortStatusWorkflow(),
      new StatusTimestampService(vaultAdapter),
    );
    service = createRepairFolderService(vaultAdapter, folderRepairService);
  });

  afterEach(() => {
    fs.removeSync(vaultRoot);
  });

  // CLI FileSystemVaultAdapter.getFirstLinkpathDest only resolves non-UUID
  // linkpaths relative to the source file's directory. For cross-folder
  // resolution we use UUID-named referent files so the adapter's lazy UUID
  // index picks them up from anywhere in the vault.
  const AREA_REFERENT = "60967c6a-4e8a-4ee3-8922-db98b981e4f4";
  const MISSING_REFERENT = "00000000-0000-0000-0000-ffffffffffff";

  it("moves a misplaced asset into the folder of its isDefinedBy referent", async () => {
    writeRaw(
      vaultRoot,
      `01 Areas/${AREA_REFERENT}.md`,
      `---\nexo__Asset_uid: ${AREA_REFERENT}\nexo__Asset_label: Areas\n---\nBody\n`,
    );
    writeRaw(
      vaultRoot,
      "02 Misplaced/target-uid.md",
      `---\nexo__Asset_uid: target-uid\nexo__Asset_label: Target\nexo__Asset_isDefinedBy: "[[${AREA_REFERENT}]]"\n---\nBody\n`,
    );

    await service.execute("02 Misplaced/target-uid");

    expect(fs.existsSync(path.join(vaultRoot, "01 Areas/target-uid.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "02 Misplaced/target-uid.md"))).toBe(false);
  });

  it("is a no-op when asset is already in the expected folder (idempotent)", async () => {
    writeRaw(
      vaultRoot,
      `01 Areas/${AREA_REFERENT}.md`,
      `---\nexo__Asset_uid: ${AREA_REFERENT}\nexo__Asset_label: Areas\n---\nBody\n`,
    );
    writeRaw(
      vaultRoot,
      "01 Areas/already-correct.md",
      `---\nexo__Asset_uid: already-correct\nexo__Asset_label: Correct\nexo__Asset_isDefinedBy: "[[${AREA_REFERENT}]]"\n---\nBody\n`,
    );

    await expect(service.execute("01 Areas/already-correct")).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(vaultRoot, "01 Areas/already-correct.md"))).toBe(true);
    const fm = readFrontmatter(path.join(vaultRoot, "01 Areas/already-correct.md"));
    expect(fm.exo__Asset_uid).toBe("already-correct");
  });

  it("throws when exo__Asset_isDefinedBy is missing (no expected folder derivable)", async () => {
    writeRaw(
      vaultRoot,
      "02 Misplaced/no-isdefined.md",
      "---\nexo__Asset_uid: no-isdefined\nexo__Asset_label: NoIsDefined\n---\nBody\n",
    );

    await expect(service.execute("02 Misplaced/no-isdefined")).rejects.toThrow(
      /expected folder|isDefinedBy/i,
    );
  });

  it("throws when the isDefinedBy referent cannot be located in the vault", async () => {
    writeRaw(
      vaultRoot,
      "02 Misplaced/orphan.md",
      `---\nexo__Asset_uid: orphan\nexo__Asset_label: Orphan\nexo__Asset_isDefinedBy: "[[${MISSING_REFERENT}]]"\n---\nBody\n`,
    );

    await expect(service.execute("02 Misplaced/orphan")).rejects.toThrow(
      /expected folder|isDefinedBy/i,
    );
  });

  it("throws when the target file does not exist", async () => {
    await expect(service.execute("02 Misplaced/does-not-exist")).rejects.toThrow();
  });

  it("registry integration: populateCliServiceRegistry with deps registers real repairFolder (no throw-stub)", async () => {
    writeRaw(
      vaultRoot,
      `01 Areas/${AREA_REFERENT}.md`,
      `---\nexo__Asset_uid: ${AREA_REFERENT}\nexo__Asset_label: Areas\n---\nBody\n`,
    );
    writeRaw(
      vaultRoot,
      "02 Misplaced/registered-uid.md",
      `---\nexo__Asset_uid: registered-uid\nexo__Asset_label: Registered\nexo__Asset_isDefinedBy: "[[${AREA_REFERENT}]]"\n---\nBody\n`,
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

    const registered = registry.get("repairFolder");
    expect(registered).toBeDefined();
    await expect(
      registered!.execute("02 Misplaced/registered-uid"),
    ).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(vaultRoot, "01 Areas/registered-uid.md"))).toBe(true);
  });

  it("registry integration: repairFolder is NOT a CliServiceNotImplementedError stub when deps provided (#2872 regression guard)", async () => {
    writeRaw(
      vaultRoot,
      `01 Areas/${AREA_REFERENT}.md`,
      `---\nexo__Asset_uid: ${AREA_REFERENT}\nexo__Asset_label: Areas\n---\nBody\n`,
    );
    writeRaw(
      vaultRoot,
      "02 Misplaced/guard.md",
      `---\nexo__Asset_uid: guard\nexo__Asset_label: Guard\nexo__Asset_isDefinedBy: "[[${AREA_REFERENT}]]"\n---\nBody\n`,
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
    const registered = registry.get("repairFolder");
    expect(registered).toBeDefined();

    try {
      await registered!.execute("02 Misplaced/guard");
    } catch (err) {
      expect(err).not.toBeInstanceOf(CliServiceNotImplementedError);
    }
  });

  it("registry integration: when deps are NOT provided, repairFolder is absent (backwards-compat)", () => {
    const registry = new ServiceRegistry();
    populateCliServiceRegistry(registry);
    expect(registry.has("repairFolder")).toBe(false);
  });
});
