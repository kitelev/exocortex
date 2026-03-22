import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Issue #2306: Tests for ArchiveService
 *
 * Acceptance criteria:
 * - Given --dry-run When candidates exist Then report without writing
 * - Given --class ems__Task --year 2025 When matching assets exist Then only those are candidates
 * - Given candidate referenced by non-archived Then blocked, not moved
 * - Given new isDefinedBy Then archive ontology auto-created
 * - Given transfer Then isDefinedBy updated, archived: true preserved
 * - Given --json Then {moved, blocked, skipped, ontologies_created}
 * - Given completed Then zero broken links in active vault
 */

// Helper to build markdown file with frontmatter (no TS annotations)
// Quotes string values that contain special YAML characters
function yamlQuote(val) {
  const s = String(val);
  // Quote if contains YAML-special chars: [ ] { } | : # > , or leading/trailing spaces
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

// UUID constants for tests (all valid hex UUIDs)
const TASK_CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const MEETING_CLASS_UUID = "aaaa1111-2222-3333-4444-555566667777";
const CANDIDATE_UUID_1 = "ca0d0001-1111-2222-3333-444455556666";
const CANDIDATE_UUID_2 = "ca0d0002-1111-2222-3333-444455556666";
const CANDIDATE_UUID_3 = "ca0d0003-1111-2222-3333-444455556666";
const ACTIVE_ASSET_UUID = "ac100001-1111-2222-3333-444455556666";

// Standard test ontology file
const ONTOLOGY_CONTENT = buildMd({
  exo__Instance_class: "exo__Ontology",
  exo__Asset_label: "EMS Ontology",
  exo__Ontology_url: "https://exocortex.my/ontology/ems#",
});

// Build standard archived task file
function buildArchivedTask(uuid, year, classId) {
  if (classId === undefined) classId = TASK_CLASS_UUID;
  return buildMd({
    exo__Instance_class: classId,
    exo__Asset_uid: uuid,
    exo__Asset_label: `Task ${uuid.substring(0, 8)}`,
    exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
    archived: true,
    ems__Effort_resolutionTimestamp: `${year}-06-15T10:00:00`,
  });
}

// Build standard non-archived active asset
function buildActiveAsset(uuid, body) {
  if (body === undefined) body = "";
  return buildMd(
    {
      exo__Instance_class: TASK_CLASS_UUID,
      exo__Asset_uid: uuid,
      exo__Asset_label: `Active ${uuid.substring(0, 8)}`,
      exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
    },
    body,
  );
}

// Mock adapters
const mockActiveFs = {
  getMarkdownFiles: jest.fn<() => Promise<string[]>>(),
  readFile: jest.fn<() => Promise<string>>(),
  getFileMetadata: jest.fn<() => Promise<Record<string, unknown>>>(),
  fileExists: jest.fn<() => Promise<boolean>>(),
  writeFile: jest.fn<() => Promise<void>>(),
  deleteFile: jest.fn<() => Promise<void>>(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

const mockArchiveFs = {
  getMarkdownFiles: jest.fn<() => Promise<string[]>>(),
  readFile: jest.fn<() => Promise<string>>(),
  getFileMetadata: jest.fn<() => Promise<Record<string, unknown>>>(),
  fileExists: jest.fn<() => Promise<boolean>>(),
  writeFile: jest.fn<() => Promise<void>>(),
  deleteFile: jest.fn<() => Promise<void>>(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

const mockClassResolver = {
  resolve: jest.fn<() => Promise<string>>(),
  listClasses: jest.fn<() => Promise<string[]>>(),
};

// Dynamic import for ESM compatibility
const { ArchiveService } = await import(
  "../../../src/services/ArchiveService.js"
);

describe("Issue #2306: ArchiveService", () => {
  let service;

  const defaultOptions = {
    vaultPath: "/vault",
    archiveVaultPath: "/archive",
    classes: ["ems__Task"],
    year: 2025,
    dryRun: false,
    noReferenced: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClassResolver.resolve.mockImplementation(
      async (_vault, name) => {
        if (name === "ems__Task") return TASK_CLASS_UUID;
        if (name === "ems__Meeting") return MEETING_CLASS_UUID;
        throw new Error(`Class '${name}' not found`);
      },
    );

    service = new ArchiveService(
      mockActiveFs,
      mockArchiveFs,
      mockClassResolver,
    );
  });

  describe("dry-run mode", () => {
    it("should report candidates without writing files when dry-run is true", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockResolvedValue(
        buildArchivedTask(CANDIDATE_UUID_1, "2025"),
      );
      mockArchiveFs.fileExists.mockResolvedValue(false);

      const result = await service.archive({
        ...defaultOptions,
        dryRun: true,
      });

      expect(result.moved).toBe(1);
      expect(result.blocked).toBe(0);
      expect(result.skipped).toBe(0);

      expect(mockArchiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockActiveFs.deleteFile).not.toHaveBeenCalled();
    });

    it("should count ontologies that would be created in dry-run", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(false);

      const result = await service.archive({
        ...defaultOptions,
        dryRun: true,
      });

      expect(result.ontologies_created).toBe(1);
      expect(mockArchiveFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("class and year filtering", () => {
    it("should only include assets matching specified class", async () => {
      const taskFile = buildArchivedTask(CANDIDATE_UUID_1, "2025", TASK_CLASS_UUID);
      const meetingFile = buildArchivedTask(CANDIDATE_UUID_2, "2025", MEETING_CLASS_UUID);

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return taskFile;
        if (p === `${CANDIDATE_UUID_2}.md`) return meetingFile;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive({
        ...defaultOptions,
        classes: ["ems__Task"],
      });

      expect(result.moved).toBe(1);
      const movedDetail = result.details.find((d) => d.status === "moved");
      expect(movedDetail?.uuid).toBe(CANDIDATE_UUID_1);
    });

    it("should support multiple class names", async () => {
      const taskFile = buildArchivedTask(CANDIDATE_UUID_1, "2025", TASK_CLASS_UUID);
      const meetingFile = buildArchivedTask(CANDIDATE_UUID_2, "2025", MEETING_CLASS_UUID);

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return taskFile;
        if (p === `${CANDIDATE_UUID_2}.md`) return meetingFile;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive({
        ...defaultOptions,
        classes: ["ems__Task", "ems__Meeting"],
      });

      expect(result.moved).toBe(2);
    });

    it("should only include assets matching specified year", async () => {
      const task2025 = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const task2024 = buildArchivedTask(CANDIDATE_UUID_2, "2024");

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return task2025;
        if (p === `${CANDIDATE_UUID_2}.md`) return task2024;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive({
        ...defaultOptions,
        year: 2025,
      });

      expect(result.moved).toBe(1);
      const movedDetail = result.details.find((d) => d.status === "moved");
      expect(movedDetail?.uuid).toBe(CANDIDATE_UUID_1);
    });

    it("should skip non-archived assets", async () => {
      const archivedTask = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const activeTask = buildActiveAsset(CANDIDATE_UUID_2);

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask;
        if (p === `${CANDIDATE_UUID_2}.md`) return activeTask;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(1);
    });

    it("should match year via ems__Effort_endTimestamp if resolutionTimestamp is absent", async () => {
      const task = buildMd({
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_uid: CANDIDATE_UUID_1,
        exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
        archived: true,
        ems__Effort_endTimestamp: "2025-12-31T23:59:59",
      });

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return task;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(1);
    });
  });

  describe("reference checking", () => {
    it("should block candidate referenced by non-archived asset", async () => {
      const archivedTask = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const activeWithRef = buildActiveAsset(
        ACTIVE_ASSET_UUID,
        `This task depends on [[${CANDIDATE_UUID_1}|Old Task]]`,
      );

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${ACTIVE_ASSET_UUID}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask;
        if (p === `${ACTIVE_ASSET_UUID}.md`) return activeWithRef;
        throw new Error("File not found");
      });

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(0);
      expect(result.blocked).toBe(1);
      const blockedDetail = result.details.find((d) => d.status === "blocked");
      expect(blockedDetail?.uuid).toBe(CANDIDATE_UUID_1);
      expect(blockedDetail?.reason).toContain("Referenced");
    });

    it("should not block candidate when noReferenced is false", async () => {
      const archivedTask = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const activeWithRef = buildActiveAsset(
        ACTIVE_ASSET_UUID,
        `References [[${CANDIDATE_UUID_1}]]`,
      );

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${ACTIVE_ASSET_UUID}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask;
        if (p === `${ACTIVE_ASSET_UUID}.md`) return activeWithRef;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive({
        ...defaultOptions,
        noReferenced: false,
      });

      expect(result.moved).toBe(1);
      expect(result.blocked).toBe(0);
    });

    it("should not count archived files as referencing sources", async () => {
      const archivedTask1 = buildMd(
        {
          exo__Instance_class: TASK_CLASS_UUID,
          exo__Asset_uid: CANDIDATE_UUID_1,
          exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
          archived: true,
          ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
        },
        `Links to [[${CANDIDATE_UUID_2}|Other task]]`,
      );
      const archivedTask2 = buildArchivedTask(CANDIDATE_UUID_2, "2025");

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask1;
        if (p === `${CANDIDATE_UUID_2}.md`) return archivedTask2;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(2);
      expect(result.blocked).toBe(0);
    });
  });

  describe("archive ontology creation", () => {
    it("should create archive ontology when it does not exist", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(false);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.ontologies_created).toBe(1);
      expect(mockArchiveFs.writeFile).toHaveBeenCalledTimes(2);

      const ontologyCall = mockArchiveFs.writeFile.mock.calls.find(
        (call) => String(call[0]).includes("_archive"),
      );
      expect(ontologyCall).toBeDefined();
      expect(ontologyCall[0]).toBe("!ems_archive.md");

      const ontologyContent = String(ontologyCall[1]);
      expect(ontologyContent).toContain("ems/archive#");
    });

    it("should not recreate existing archive ontology", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.ontologies_created).toBe(0);
      expect(mockArchiveFs.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe("file transfer", () => {
    it("should update isDefinedBy to archive ontology during transfer", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      await service.archive(defaultOptions);

      const assetWriteCall = mockArchiveFs.writeFile.mock.calls.find(
        (call) => String(call[0]) === `${CANDIDATE_UUID_1}.md`,
      );
      expect(assetWriteCall).toBeDefined();
      const writtenContent = String(assetWriteCall[1]);
      expect(writtenContent).toContain("!ems_archive");
      expect(writtenContent).toContain("archived: true");
    });

    it("should delete file from active vault after transfer", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      await service.archive(defaultOptions);

      expect(mockActiveFs.deleteFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID_1}.md`,
      );
    });

    it("should write file to archive vault with UUID filename", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") {
          return ONTOLOGY_CONTENT;
        }
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      await service.archive(defaultOptions);

      expect(mockArchiveFs.writeFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID_1}.md`,
        expect.any(String),
      );
    });
  });

  describe("JSON output structure", () => {
    it("should return result with moved, blocked, skipped, ontologies_created", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
        `${ACTIVE_ASSET_UUID}.md`,
      ]);

      const archivedTask1 = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const archivedTask2 = buildArchivedTask(CANDIDATE_UUID_2, "2025");
      const activeWithRef = buildActiveAsset(
        ACTIVE_ASSET_UUID,
        `Depends on [[${CANDIDATE_UUID_2}]]`,
      );

      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask1;
        if (p === `${CANDIDATE_UUID_2}.md`) return archivedTask2;
        if (p === `${ACTIVE_ASSET_UUID}.md`) return activeWithRef;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result).toHaveProperty("moved");
      expect(result).toHaveProperty("blocked");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("ontologies_created");
      expect(result).toHaveProperty("details");

      expect(result.moved).toBe(1);
      expect(result.blocked).toBe(1);
      expect(typeof result.skipped).toBe("number");
      expect(typeof result.ontologies_created).toBe("number");
    });
  });

  describe("edge cases", () => {
    it("should handle empty vault gracefully", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(0);
      expect(result.blocked).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.ontologies_created).toBe(0);
    });

    it("should handle files without frontmatter", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue(["no-frontmatter.md"]);
      mockActiveFs.readFile.mockResolvedValue("# Just a plain markdown file\nNo frontmatter here.");

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(0);
      expect(result.blocked).toBe(0);
    });

    it("should handle unreadable files without crashing", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        "unreadable.md",
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === "unreadable.md") throw new Error("EACCES");
        if (p === `${CANDIDATE_UUID_1}.md`) {
          return buildArchivedTask(CANDIDATE_UUID_1, "2025");
        }
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(1);
    });

    it("should handle candidate without exo__Asset_uid using filename UUID", async () => {
      const taskWithoutUid = buildMd({
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
        archived: true,
        ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
      });

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return taskWithoutUid;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(1);
      expect(result.details[0].uuid).toBe(CANDIDATE_UUID_1);
    });

    it("should handle files in subdirectories with spaces in path", async () => {
      const filePath = "03 Knowledge/tasks/My Task File.md";
      const task = buildMd({
        exo__Instance_class: TASK_CLASS_UUID,
        exo__Asset_uid: CANDIDATE_UUID_1,
        exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
        archived: true,
        ems__Effort_resolutionTimestamp: "2025-03-10T14:00:00",
      });

      mockActiveFs.getMarkdownFiles.mockResolvedValue([filePath]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === filePath) return task;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(1);
      expect(mockActiveFs.deleteFile).toHaveBeenCalledWith(filePath);
      expect(mockArchiveFs.writeFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID_1}.md`,
        expect.any(String),
      );
    });
  });

  describe("zero broken links guarantee", () => {
    it("should not move referenced assets, ensuring no broken links remain", async () => {
      const archivedTask1 = buildArchivedTask(CANDIDATE_UUID_1, "2025");
      const archivedTask2 = buildArchivedTask(CANDIDATE_UUID_2, "2025");
      const archivedTask3 = buildArchivedTask(CANDIDATE_UUID_3, "2025");
      const activeAsset = buildActiveAsset(
        ACTIVE_ASSET_UUID,
        `Parent: [[${CANDIDATE_UUID_2}|Parent Task]]`,
      );

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${CANDIDATE_UUID_1}.md`,
        `${CANDIDATE_UUID_2}.md`,
        `${CANDIDATE_UUID_3}.md`,
        `${ACTIVE_ASSET_UUID}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${CANDIDATE_UUID_1}.md`) return archivedTask1;
        if (p === `${CANDIDATE_UUID_2}.md`) return archivedTask2;
        if (p === `${CANDIDATE_UUID_3}.md`) return archivedTask3;
        if (p === `${ACTIVE_ASSET_UUID}.md`) return activeAsset;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockArchiveFs.fileExists.mockResolvedValue(true);
      mockArchiveFs.writeFile.mockResolvedValue(undefined);
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      const result = await service.archive(defaultOptions);

      expect(result.moved).toBe(2);
      expect(result.blocked).toBe(1);

      const blocked = result.details.filter((d) => d.status === "blocked");
      expect(blocked.length).toBe(1);
      expect(blocked[0].uuid).toBe(CANDIDATE_UUID_2);

      expect(mockActiveFs.deleteFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID_1}.md`,
      );
      expect(mockActiveFs.deleteFile).toHaveBeenCalledWith(
        `${CANDIDATE_UUID_3}.md`,
      );
      expect(mockActiveFs.deleteFile).not.toHaveBeenCalledWith(
        `${CANDIDATE_UUID_2}.md`,
      );
    });
  });
});
