import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Issue #2312: Tests for UnarchiveService
 *
 * Acceptance criteria:
 * - Given UUID in archive vault Then file moved to active vault with updated isDefinedBy
 * - Given UUID not in archive vault Then error message, success: false
 * - Given --dry-run Then preview JSON without moving files
 * - Given unarchive Then file lands in 03 Knowledge/inbox/
 * - Given unarchive Then archived: true preserved in frontmatter
 * - Given asset with _archive ontology Then isDefinedBy updated to active ontology
 * - Given asset found by exo__Asset_uid (not filename) Then correctly restored
 */

// Helper to build markdown file with frontmatter (no TS annotations)
function yamlQuote(val) {
  const s = String(val);
  if (/[\[\]{|}:#>,]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function buildMd(frontmatter, body) {
  if (body === undefined) body = "";
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlQuote(item)}`);
      }
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlQuote(value)}`);
    }
  }
  lines.push("---");
  if (body) {
    lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}

// UUID constants for tests
const TASK_CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const CANDIDATE_UUID = "ca0d0001-1111-2222-3333-444455556666";
const NONEXISTENT_UUID = "deadbeef-0000-0000-0000-000000000000";

// Build archived task in archive vault (with archive ontology)
function buildArchivedInArchive(uuid) {
  return buildMd({
    exo__Instance_class: TASK_CLASS_UUID,
    exo__Asset_uid: uuid,
    exo__Asset_label: `Task ${uuid.substring(0, 8)}`,
    exo__Asset_isDefinedBy: "[[!ems_archive|EMS Ontology (Archive)]]",
    archived: true,
    ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
  });
}

// Build archived task without _archive ontology (edge case)
function buildArchivedWithActiveOntology(uuid) {
  return buildMd({
    exo__Instance_class: TASK_CLASS_UUID,
    exo__Asset_uid: uuid,
    exo__Asset_label: `Task ${uuid.substring(0, 8)}`,
    exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
    archived: true,
  });
}

// Mock adapters
const mockActiveFs = {
  getMarkdownFiles: jest.fn(),
  readFile: jest.fn(),
  fileExists: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  getFileMetadata: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

const mockArchiveFs = {
  getMarkdownFiles: jest.fn(),
  readFile: jest.fn(),
  fileExists: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  getFileMetadata: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

// Import the service (no module mocking needed — we pass adapters directly)
const { UnarchiveService } = await import(
  "../../../src/services/UnarchiveService.js"
);

describe("UnarchiveService", () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UnarchiveService(mockActiveFs, mockArchiveFs);
  });

  describe("successful unarchive", () => {
    it("should find asset by UUID filename and move to active vault inbox", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.uuid).toBe(CANDIDATE_UUID);
      expect(result.movedTo).toBe(`03 Knowledge/inbox/${CANDIDATE_UUID}.md`);
      expect(result.isDefinedBy).toBe("[[!ems|EMS Ontology]]");
    });

    it("should update exo__Asset_isDefinedBy from archive to active ontology", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      // Verify the written content has updated isDefinedBy
      const writtenContent = mockActiveFs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("[[!ems|EMS Ontology]]");
      expect(writtenContent).not.toContain("_archive");
    });

    it("should preserve archived: true in frontmatter after unarchive", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      const writtenContent = mockActiveFs.writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("archived: true");
    });

    it("should delete file from archive vault after moving", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(mockArchiveFs.deleteFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID}.md`,
      );
    });

    it("should find asset by exo__Asset_uid when filename does not match UUID", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      // Direct filename check returns false
      mockArchiveFs.fileExists.mockResolvedValue(false);
      // Scan finds the file by UID
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        "some/nested/old-name.md",
      ]);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.movedTo).toBe("03 Knowledge/inbox/old-name.md");
    });
  });

  describe("UUID not found", () => {
    it("should return error when UUID not found in archive vault", async () => {
      mockArchiveFs.fileExists.mockResolvedValue(false);
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.unarchive({
        uuid: NONEXISTENT_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(NONEXISTENT_UUID);
      expect(result.error).toContain("not found in archive vault");
    });

    it("should not write or delete any files when UUID not found", async () => {
      mockArchiveFs.fileExists.mockResolvedValue(false);
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);

      await service.unarchive({
        uuid: NONEXISTENT_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(mockActiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockArchiveFs.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("dry-run mode", () => {
    it("should return preview without moving files", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.uuid).toBe(CANDIDATE_UUID);
      expect(result.movedTo).toBe(`03 Knowledge/inbox/${CANDIDATE_UUID}.md`);
      expect(result.isDefinedBy).toBe("[[!ems|EMS Ontology]]");
    });

    it("should not write or delete any files in dry-run mode", async () => {
      const content = buildArchivedInArchive(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);

      await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: true,
      });

      expect(mockActiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockArchiveFs.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("ontology handling edge cases", () => {
    it("should handle asset already pointing to active ontology", async () => {
      const content = buildArchivedWithActiveOntology(CANDIDATE_UUID);

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.isDefinedBy).toBe("[[!ems|EMS Ontology]]");
    });

    it("should handle wikilink without label", async () => {
      const content = buildMd({
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_uid: CANDIDATE_UUID,
        exo__Asset_isDefinedBy: "[[!ems_archive]]",
        archived: true,
      });

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.isDefinedBy).toBe("[[!ems]]");
    });

    it("should handle asset without isDefinedBy property", async () => {
      const content = buildMd({
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_uid: CANDIDATE_UUID,
        archived: true,
      });

      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.readFile.mockResolvedValue(content);
      mockActiveFs.writeFile.mockResolvedValue(undefined);
      mockArchiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.unarchive({
        uuid: CANDIDATE_UUID,
        vaultPath: "/active",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.isDefinedBy).toBeUndefined();
    });
  });
});
