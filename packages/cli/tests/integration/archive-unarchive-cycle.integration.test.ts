/**
 * Issue #2337: Integration test for full archive → unarchive → verify cycle.
 *
 * Tests the complete asset lifecycle:
 * 1. Create active vault with archived task + ontology
 * 2. Archive: move task to archive vault
 * 3. Verify: 0 broken links
 * 4. Unarchive: restore task to active vault inbox
 * 5. Verify: frontmatter integrity, 0 broken links
 *
 * Uses real filesystem (temp directories), not mocks.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Dynamic imports for ESM services
const { NodeFsAdapter } = await import("../../src/adapters/NodeFsAdapter.js");
const { ArchiveService } = await import("../../src/services/ArchiveService.js");
const { ArchiveVerifyService } = await import(
  "../../src/services/ArchiveVerifyService.js"
);
const { UnarchiveService } = await import(
  "../../src/services/UnarchiveService.js"
);
const { ClassResolverService } = await import(
  "../../src/services/ClassResolverService.js"
);

// Constants
const TASK_CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const ASSET_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function buildMd(frontmatter, body?) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "string" && /[\[\]{|}:#>,]/.test(value)) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  if (body) {
    lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}

describe("Archive → Unarchive full lifecycle", () => {
  let activeVaultPath: string;
  let archiveVaultPath: string;

  beforeEach(() => {
    // Create temp directories for active and archive vaults
    activeVaultPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "exo-active-"),
    );
    archiveVaultPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "exo-archive-"),
    );

    // Create vault structure
    fs.mkdirSync(path.join(activeVaultPath, "03 Knowledge", "tasks"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(activeVaultPath, "03 Knowledge", "inbox"), {
      recursive: true,
    });

    // Create ontology file in active vault
    const ontologyContent = buildMd({
      exo__Instance_class: ["[[exo__Ontology]]"],
      exo__Asset_label: "EMS Ontology",
      "exo__Ontology_url": "https://exocortex.my/ontology/ems#",
    });
    fs.writeFileSync(
      path.join(activeVaultPath, "!ems.md"),
      ontologyContent,
    );

    // Create class definition file (for ClassResolverService)
    const classContent = buildMd({
      exo__Instance_class: ["[[ims__Class]]"],
      exo__Asset_uid: TASK_CLASS_UUID,
      exo__Asset_label: "ems__Task",
    });
    fs.writeFileSync(
      path.join(activeVaultPath, `${TASK_CLASS_UUID}.md`),
      classContent,
    );

    // Create archived task in active vault (ready for archive)
    const taskContent = buildMd(
      {
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_uid: ASSET_UUID,
        exo__Asset_label: "Test Task for Lifecycle",
        "exo__Asset_isDefinedBy": "[[!ems|EMS Ontology]]",
        archived: true,
        ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
      },
      "# Test Task\n\nThis is a test task for the archive/unarchive lifecycle.",
    );
    fs.writeFileSync(
      path.join(activeVaultPath, "03 Knowledge", "tasks", `${ASSET_UUID}.md`),
      taskContent,
    );
  });

  afterEach(() => {
    // Cleanup temp directories
    fs.rmSync(activeVaultPath, { recursive: true, force: true });
    fs.rmSync(archiveVaultPath, { recursive: true, force: true });
  });

  it("should complete full archive → verify → unarchive → verify cycle", async () => {
    const activeFs = new NodeFsAdapter(activeVaultPath);
    const archiveFs = new NodeFsAdapter(archiveVaultPath);
    const classResolver = new ClassResolverService(activeFs);

    // === PHASE 1: Archive ===
    const archiveService = new ArchiveService(
      activeFs,
      archiveFs,
      classResolver,
    );

    const archiveResult = await archiveService.archive({
      vaultPath: activeVaultPath,
      archiveVaultPath: archiveVaultPath,
      classes: ["ems__Task"],
      year: 2025,
      dryRun: false,
      noReferenced: true,
    });

    // Verify archive moved the file
    expect(archiveResult.moved).toBe(1);
    expect(archiveResult.blocked).toBe(0);

    // Verify file exists in archive vault
    const archiveFileExists = await archiveFs.fileExists(`${ASSET_UUID}.md`);
    expect(archiveFileExists).toBe(true);

    // Verify file removed from active vault
    const activeFileExists = fs.existsSync(
      path.join(activeVaultPath, "03 Knowledge", "tasks", `${ASSET_UUID}.md`),
    );
    expect(activeFileExists).toBe(false);

    // Verify archive file has archive ontology
    const archivedContent = await archiveFs.readFile(`${ASSET_UUID}.md`);
    expect(archivedContent).toContain("!ems_archive");
    expect(archivedContent).toContain("archived: true");

    // === PHASE 2: Verify after archive ===
    const verifyService = new ArchiveVerifyService(activeFs, archiveFs);
    const verifyResult1 = await verifyService.verify();

    expect(verifyResult1.broken_links).toBe(0);

    // === PHASE 3: Unarchive ===
    const unarchiveService = new UnarchiveService(activeFs, archiveFs);

    const unarchiveResult = await unarchiveService.unarchive({
      uuid: ASSET_UUID,
      vaultPath: activeVaultPath,
      archiveVaultPath: archiveVaultPath,
      dryRun: false,
    });

    expect(unarchiveResult.success).toBe(true);
    expect(unarchiveResult.movedTo).toContain("03 Knowledge/inbox/");
    expect(unarchiveResult.isDefinedBy).toBe("[[!ems|EMS Ontology]]");

    // Verify file exists in active vault inbox
    const restoredPath = path.join(
      activeVaultPath,
      "03 Knowledge",
      "inbox",
      `${ASSET_UUID}.md`,
    );
    expect(fs.existsSync(restoredPath)).toBe(true);

    // Verify file removed from archive vault
    const archiveFileAfter = await archiveFs.fileExists(`${ASSET_UUID}.md`);
    expect(archiveFileAfter).toBe(false);

    // === PHASE 4: Verify frontmatter integrity ===
    const restoredContent = fs.readFileSync(restoredPath, "utf-8");

    // isDefinedBy should point back to active ontology
    expect(restoredContent).toContain("[[!ems|EMS Ontology]]");
    expect(restoredContent).not.toContain("_archive");

    // archived: true should be preserved
    expect(restoredContent).toContain("archived: true");

    // Body content should be preserved
    expect(restoredContent).toContain("This is a test task");

    // UUID should be preserved
    expect(restoredContent).toContain(ASSET_UUID);

    // === PHASE 5: Verify after unarchive ===
    const verifyResult2 = await verifyService.verify();
    expect(verifyResult2.broken_links).toBe(0);
  });

  it("should handle dry-run for both archive and unarchive", async () => {
    const activeFs = new NodeFsAdapter(activeVaultPath);
    const archiveFs = new NodeFsAdapter(archiveVaultPath);
    const classResolver = new ClassResolverService(activeFs);

    // Archive with dry-run
    const archiveService = new ArchiveService(
      activeFs,
      archiveFs,
      classResolver,
    );

    const archiveDryRun = await archiveService.archive({
      vaultPath: activeVaultPath,
      archiveVaultPath: archiveVaultPath,
      classes: ["ems__Task"],
      year: 2025,
      dryRun: true,
      noReferenced: true,
    });

    // Dry-run reports what would be moved but doesn't move
    expect(archiveDryRun.moved).toBe(1);

    // File should still be in active vault
    const stillActive = fs.existsSync(
      path.join(activeVaultPath, "03 Knowledge", "tasks", `${ASSET_UUID}.md`),
    );
    expect(stillActive).toBe(true);

    // No file in archive vault
    const notInArchive = await archiveFs.fileExists(`${ASSET_UUID}.md`);
    expect(notInArchive).toBe(false);

    // Now actually archive it
    await archiveService.archive({
      vaultPath: activeVaultPath,
      archiveVaultPath: archiveVaultPath,
      classes: ["ems__Task"],
      year: 2025,
      dryRun: false,
      noReferenced: true,
    });

    // Unarchive with dry-run
    const unarchiveService = new UnarchiveService(activeFs, archiveFs);

    const unarchiveDryRun = await unarchiveService.unarchive({
      uuid: ASSET_UUID,
      vaultPath: activeVaultPath,
      archiveVaultPath: archiveVaultPath,
      dryRun: true,
    });

    expect(unarchiveDryRun.success).toBe(true);
    expect(unarchiveDryRun.movedTo).toContain("03 Knowledge/inbox/");

    // File should still be in archive vault (dry-run doesn't move)
    const stillInArchive = await archiveFs.fileExists(`${ASSET_UUID}.md`);
    expect(stillInArchive).toBe(true);

    // No file in active vault inbox
    const notInInbox = fs.existsSync(
      path.join(activeVaultPath, "03 Knowledge", "inbox", `${ASSET_UUID}.md`),
    );
    expect(notInInbox).toBe(false);
  });
});
