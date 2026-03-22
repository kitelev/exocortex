import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Issue #2311: Tests for ArchiveVerifyService
 *
 * Acceptance criteria:
 * - `archive --verify` when broken links exist -> report with UUID and referencing files
 * - `archive --verify` when all clean -> {broken_links: 0} and exit code 0
 * - Missing archive ontology -> missing_ontologies contains its name
 * - Read-only operation (no writes to either vault)
 * - Correct file count statistics
 */

// Quotes string values that contain special YAML characters
function yamlQuote(val) {
  const s = String(val);
  if (/[\[\]{|}:#>,]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

// Helper to build markdown file with frontmatter (no TS annotations for jest compatibility)
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

// UUID constants
const ARCHIVE_UUID_1 = "aa000001-1111-2222-3333-444455556666";
const ARCHIVE_UUID_2 = "aa000002-1111-2222-3333-444455556666";
const ACTIVE_UUID_1 = "bb000001-1111-2222-3333-444455556666";
const ACTIVE_UUID_2 = "bb000002-1111-2222-3333-444455556666";

// Mock adapters
const mockActiveFs = {
  getMarkdownFiles: jest.fn(),
  readFile: jest.fn(),
  getFileMetadata: jest.fn(),
  fileExists: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
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
  getFileMetadata: jest.fn(),
  fileExists: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

// Dynamic import for ESM compatibility
const { ArchiveVerifyService } = await import(
  "../../../src/services/ArchiveVerifyService.js"
);

describe("Issue #2311: ArchiveVerifyService", () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ArchiveVerifyService(mockActiveFs, mockArchiveFs);
  });

  describe("clean archive — no broken links", () => {
    it("should return ok: true and broken_links: 0 when no active file references archive UUIDs", async () => {
      // Active vault: 2 files, no references to archive UUIDs
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
        `${ACTIVE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ACTIVE_UUID_1}.md`) {
          return buildMd({
            exo__Instance_class: "ems__Task",
            exo__Asset_uid: ACTIVE_UUID_1,
          });
        }
        if (p === `${ACTIVE_UUID_2}.md`) {
          return buildMd(
            {
              exo__Instance_class: "ems__Task",
              exo__Asset_uid: ACTIVE_UUID_2,
            },
            `References [[${ACTIVE_UUID_1}|Other active task]]`,
          );
        }
        throw new Error("File not found");
      });

      // Archive vault: 2 files with ontology
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(true);
      expect(result.broken_links).toBe(0);
      expect(result.broken_link_details).toEqual([]);
      expect(result.missing_ontologies).toEqual([]);
    });

    it("should return correct vault stats", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        "file1.md",
        "file2.md",
        "file3.md",
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd({ exo__Instance_class: "ems__Task" }),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        `${ARCHIVE_UUID_2}.md`,
      ]);
      mockArchiveFs.readFile.mockResolvedValue(
        buildMd({ exo__Asset_isDefinedBy: "[[!ems_archive|EMS]]" }),
      );
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.stats.active_files).toBe(3);
      expect(result.stats.archive_files).toBe(2);
    });
  });

  describe("broken links detected", () => {
    it("should detect broken link when active file references archive UUID", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd(
          {
            exo__Instance_class: "ems__Task",
            exo__Asset_uid: ACTIVE_UUID_1,
          },
          `Depends on [[${ARCHIVE_UUID_1}|Old archived task]]`,
        ),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(false);
      expect(result.broken_links).toBe(1);
      expect(result.broken_link_details).toEqual([
        {
          uuid: ARCHIVE_UUID_1,
          referenced_from: `${ACTIVE_UUID_1}.md`,
        },
      ]);
    });

    it("should detect multiple broken links from different files", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
        `${ACTIVE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ACTIVE_UUID_1}.md`) {
          return buildMd(
            {
              exo__Instance_class: "ems__Task",
              exo__Asset_uid: ACTIVE_UUID_1,
            },
            `Links to [[${ARCHIVE_UUID_1}]]`,
          );
        }
        if (p === `${ACTIVE_UUID_2}.md`) {
          return buildMd(
            {
              exo__Instance_class: "ems__Task",
              exo__Asset_uid: ACTIVE_UUID_2,
            },
            `Links to [[${ARCHIVE_UUID_2}]]`,
          );
        }
        throw new Error("File not found");
      });

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        `${ARCHIVE_UUID_2}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (
          p === `${ARCHIVE_UUID_1}.md` ||
          p === `${ARCHIVE_UUID_2}.md`
        ) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(false);
      expect(result.broken_links).toBe(2);
      expect(result.broken_link_details).toHaveLength(2);
    });

    it("should not count the same UUID twice from the same file", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd(
          {
            exo__Instance_class: "ems__Task",
            exo__Asset_uid: ACTIVE_UUID_1,
          },
          `First ref [[${ARCHIVE_UUID_1}]] and second ref [[${ARCHIVE_UUID_1}|again]]`,
        ),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.broken_links).toBe(1);
    });

    it("should skip archived files in active vault when checking for broken links", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd(
          {
            exo__Instance_class: "ems__Task",
            exo__Asset_uid: ACTIVE_UUID_1,
            archived: true,
          },
          `Links to [[${ARCHIVE_UUID_1}]]`,
        ),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(true);
      expect(result.broken_links).toBe(0);
    });
  });

  describe("missing archive ontologies", () => {
    it("should detect missing archive ontology", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(false);

      const result = await service.verify();

      expect(result.ok).toBe(false);
      expect(result.missing_ontologies).toEqual(["!ems_archive"]);
    });

    it("should detect missing ontology when archive file references non-archive ontology name", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(false);

      const result = await service.verify();

      expect(result.ok).toBe(false);
      expect(result.missing_ontologies).toEqual(["!ems_archive"]);
    });

    it("should not report existing archive ontology as missing", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.missing_ontologies).toEqual([]);
    });

    it("should handle multiple ontologies, reporting only missing ones", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        `${ARCHIVE_UUID_2}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        if (p === `${ARCHIVE_UUID_2}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ims|IMS Ontology]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockImplementation(async (p) => {
        if (p === "!ems_archive.md") return true;
        if (p === "!ims_archive.md") return false;
        return false;
      });

      const result = await service.verify();

      expect(result.ok).toBe(false);
      expect(result.missing_ontologies).toEqual(["!ims_archive"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty vaults gracefully", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.verify();

      expect(result.ok).toBe(true);
      expect(result.broken_links).toBe(0);
      expect(result.broken_link_details).toEqual([]);
      expect(result.missing_ontologies).toEqual([]);
      expect(result.stats).toEqual({ active_files: 0, archive_files: 0 });
    });

    it("should handle unreadable files without crashing", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        "unreadable.md",
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === "unreadable.md") throw new Error("EACCES");
        if (p === `${ACTIVE_UUID_1}.md`) {
          return buildMd({
            exo__Instance_class: "ems__Task",
            exo__Asset_uid: ACTIVE_UUID_1,
          });
        }
        throw new Error("File not found");
      });

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.verify();

      expect(result.ok).toBe(true);
      expect(result.stats.active_files).toBe(2);
    });

    it("should handle files without frontmatter", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue(["plain.md"]);
      mockActiveFs.readFile.mockResolvedValue(
        "# Just a plain markdown file\nNo frontmatter here.",
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(true);
    });

    it("should not count non-UUID filenames in archive vault", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd(
          {
            exo__Instance_class: "ems__Task",
          },
          "References [[some-note|My Note]]",
        ),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        "some-note.md",
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      const result = await service.verify();

      expect(result.ok).toBe(true);
      expect(result.broken_links).toBe(0);
    });
  });

  describe("read-only guarantee", () => {
    it("should never call writeFile or deleteFile on either vault", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${ACTIVE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildMd(
          {
            exo__Instance_class: "ems__Task",
          },
          `Broken ref [[${ARCHIVE_UUID_1}]]`,
        ),
      );

      mockArchiveFs.getMarkdownFiles.mockResolvedValue([
        `${ARCHIVE_UUID_1}.md`,
        "!ems_archive.md",
      ]);
      mockArchiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${ARCHIVE_UUID_1}.md`) {
          return buildMd({
            exo__Asset_isDefinedBy: "[[!ems_archive|EMS (Archive)]]",
          });
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);

      await service.verify();

      expect(mockActiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockActiveFs.deleteFile).not.toHaveBeenCalled();
      expect(mockArchiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockArchiveFs.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("JSON output structure", () => {
    it("should return result with all required fields", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);
      mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.verify();

      expect(result).toHaveProperty("broken_links");
      expect(result).toHaveProperty("broken_link_details");
      expect(result).toHaveProperty("missing_ontologies");
      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("ok");
      expect(result.stats).toHaveProperty("active_files");
      expect(result.stats).toHaveProperty("archive_files");

      // Verify JSON serialization works
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual(result);
    });
  });
});
