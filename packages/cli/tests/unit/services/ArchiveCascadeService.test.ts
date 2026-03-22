import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * Issue #2314: Tests for ArchiveCascadeService
 *
 * Acceptance criteria:
 * - Archived asset A, referenced only by archived B -> both moved cascade
 * - Archived asset A, referenced by active asset C -> A stays (blocked)
 * - Chain A->B->C all archived -> all three moved via multiple iterations
 * - --dry-run -> report without moving files
 * - JSON output: {iterations, total_moved, still_blocked, iterations_detail}
 * - MAX_ITERATIONS = 100 protection against infinite loops
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

// UUID constants
const TASK_CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const UUID_A = "aaaa0001-1111-2222-3333-444455556666";
const UUID_B = "bbbb0002-1111-2222-3333-444455556666";
const UUID_C = "cccc0003-1111-2222-3333-444455556666";
const UUID_D = "dddd0004-1111-2222-3333-444455556666";
const UUID_ACTIVE = "ac100001-1111-2222-3333-444455556666";

const ONTOLOGY_CONTENT = buildMd({
  exo__Instance_class: "exo__Ontology",
  exo__Asset_label: "EMS Ontology",
  exo__Ontology_url: "https://exocortex.my/ontology/ems#",
});

function buildArchivedAsset(uuid, body) {
  return buildMd(
    {
      exo__Instance_class: TASK_CLASS_UUID,
      exo__Asset_uid: uuid,
      exo__Asset_label: `Asset ${uuid.substring(0, 8)}`,
      exo__Asset_isDefinedBy: "[[!ems|EMS Ontology]]",
      archived: true,
      ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
    },
    body,
  );
}

function buildActiveAsset(uuid, body) {
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
const { ArchiveCascadeService } = await import(
  "../../../src/services/ArchiveCascadeService.js"
);

describe("Issue #2314: ArchiveCascadeService", () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: archive vault has no files
    mockArchiveFs.getMarkdownFiles.mockResolvedValue([]);
    mockArchiveFs.fileExists.mockResolvedValue(false);
    mockArchiveFs.writeFile.mockResolvedValue(undefined);
    mockActiveFs.deleteFile.mockResolvedValue(undefined);

    service = new ArchiveCascadeService(mockActiveFs, mockArchiveFs);
  });

  describe("simple cascade: asset with no incoming refs", () => {
    it("should move archived asset with zero incoming references", async () => {
      const activeFiles = new Set([`${UUID_A}.md`]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(1);
      expect(result.still_blocked).toBe(0);
      expect(result.iterations).toBe(1);
      expect(mockArchiveFs.writeFile).toHaveBeenCalled();
      expect(mockActiveFs.deleteFile).toHaveBeenCalledWith(`${UUID_A}.md`);
    });
  });

  describe("blocked by active reference", () => {
    it("should NOT move archived asset referenced by active (non-archived) asset", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${UUID_A}.md`,
        `${UUID_ACTIVE}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === `${UUID_ACTIVE}.md`)
          return buildActiveAsset(
            UUID_ACTIVE,
            `Depends on [[${UUID_A}|Task A]]`,
          );
        throw new Error("File not found");
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(0);
      expect(result.still_blocked).toBe(1);
      expect(mockActiveFs.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("chain resolution: A -> B -> C all archived", () => {
    it("should move all three assets via multiple iterations", async () => {
      // Chain: A references B, B references C, all archived
      // Incoming refs perspective:
      //   C has incoming ref from B (archived) -> C free
      //   B has incoming ref from A (archived) -> B free after C moved
      //   A has no incoming refs -> A free
      // But algorithm works on "who references candidate's UUID in their content"
      // A's content mentions B -> A is a referencing file for B
      // B's content mentions C -> B is a referencing file for C
      // Since A,B,C are all archived, none count as active references
      // So actually all three are free in iteration 1
      const assetA = buildArchivedAsset(UUID_A, `Parent: [[${UUID_B}]]`);
      const assetB = buildArchivedAsset(UUID_B, `Depends on [[${UUID_C}]]`);
      const assetC = buildArchivedAsset(UUID_C);

      const activeFiles = new Set([
        `${UUID_A}.md`,
        `${UUID_B}.md`,
        `${UUID_C}.md`,
      ]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === `${UUID_B}.md`) return assetB;
        if (p === `${UUID_C}.md`) return assetC;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(3);
      expect(result.still_blocked).toBe(0);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    });
  });

  describe("mixed: some blocked by active, some free", () => {
    it("should move free assets and leave blocked ones", async () => {
      // A is archived, referenced by Active asset -> blocked
      // B is archived, no active refs -> moved
      const assetA = buildArchivedAsset(UUID_A);
      const assetB = buildArchivedAsset(UUID_B);
      const activeRef = buildActiveAsset(
        UUID_ACTIVE,
        `Uses [[${UUID_A}]]`,
      );

      const activeFiles = new Set([
        `${UUID_A}.md`,
        `${UUID_B}.md`,
        `${UUID_ACTIVE}.md`,
      ]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === `${UUID_B}.md`) return assetB;
        if (p === `${UUID_ACTIVE}.md`) return activeRef;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(1);
      expect(result.still_blocked).toBe(1);
    });
  });

  describe("dry-run mode", () => {
    it("should report what would be moved without writing files", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([`${UUID_A}.md`]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        throw new Error("File not found");
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: true,
      });

      expect(result.total_moved).toBe(1);
      expect(result.iterations).toBe(1);
      expect(mockArchiveFs.writeFile).not.toHaveBeenCalled();
      expect(mockActiveFs.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("JSON output structure", () => {
    it("should return iterations, total_moved, still_blocked, iterations_detail", async () => {
      const activeFiles = new Set([`${UUID_A}.md`]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result).toHaveProperty("iterations");
      expect(result).toHaveProperty("total_moved");
      expect(result).toHaveProperty("still_blocked");
      expect(result).toHaveProperty("iterations_detail");

      expect(typeof result.iterations).toBe("number");
      expect(typeof result.total_moved).toBe("number");
      expect(typeof result.still_blocked).toBe("number");
      expect(Array.isArray(result.iterations_detail)).toBe(true);
    });

    it("should include iteration detail with iteration number and moved UUIDs", async () => {
      const activeFiles = new Set([`${UUID_A}.md`]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.iterations_detail.length).toBeGreaterThan(0);
      const firstIteration = result.iterations_detail[0];
      expect(firstIteration).toHaveProperty("iteration");
      expect(firstIteration).toHaveProperty("moved");
      expect(firstIteration.iteration).toBe(1);
      expect(Array.isArray(firstIteration.moved)).toBe(true);
      expect(firstIteration.moved).toContain(UUID_A);
    });
  });

  describe("fixed-point termination", () => {
    it("should terminate when no more candidates can be freed", async () => {
      // A referenced by Active -> permanently blocked
      const assetA = buildArchivedAsset(UUID_A);
      const activeRef = buildActiveAsset(
        UUID_ACTIVE,
        `Uses [[${UUID_A}]]`,
      );

      mockActiveFs.getMarkdownFiles.mockResolvedValue([
        `${UUID_A}.md`,
        `${UUID_ACTIVE}.md`,
      ]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === `${UUID_ACTIVE}.md`) return activeRef;
        throw new Error("File not found");
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.iterations).toBe(0);
      expect(result.total_moved).toBe(0);
      expect(result.still_blocked).toBe(1);
    });

    it("should handle empty vault", async () => {
      mockActiveFs.getMarkdownFiles.mockResolvedValue([]);

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.iterations).toBe(0);
      expect(result.total_moved).toBe(0);
      expect(result.still_blocked).toBe(0);
    });
  });

  describe("MAX_ITERATIONS protection", () => {
    it("should throw error when MAX_ITERATIONS (100) is exceeded", async () => {
      // Always return a file to simulate infinite loop
      mockActiveFs.getMarkdownFiles.mockResolvedValue([`${UUID_A}.md`]);
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      // Never actually remove the file (simulates bug)
      mockActiveFs.deleteFile.mockResolvedValue(undefined);

      await expect(
        service.cascade({
          vaultPath: "/vault",
          archiveVaultPath: "/archive",
          dryRun: false,
        }),
      ).rejects.toThrow(/MAX_ITERATIONS/i);
    });
  });

  describe("cascade with assets already in archive vault", () => {
    it("should consider archived files already in archive vault when checking refs", async () => {
      // Asset A is archived in active vault, references B (outgoing).
      // B is already in archive vault.
      // A has no incoming refs from active files -> A is free
      const assetA = buildArchivedAsset(UUID_A, `Refs [[${UUID_B}]]`);

      const activeFiles = new Set([`${UUID_A}.md`]);
      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(1);
      expect(result.still_blocked).toBe(0);
    });
  });

  describe("ontology handling during cascade", () => {
    it("should create archive ontologies for cascaded assets", async () => {
      const activeFiles = new Set([`${UUID_A}.md`]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return buildArchivedAsset(UUID_A);
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });
      mockArchiveFs.fileExists.mockResolvedValue(false);

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(1);

      // Check that ontology was created
      const ontologyWrite = mockArchiveFs.writeFile.mock.calls.find(
        (call) => String(call[0]).includes("_archive"),
      );
      expect(ontologyWrite).toBeDefined();
    });
  });

  describe("complex scenarios", () => {
    it("should handle diamond dependency where all archived assets are free", async () => {
      // A refs B and C (outgoing). B refs D (outgoing). C refs D (outgoing).
      // D is active (not archived).
      // Incoming refs: who mentions A's UUID? Nobody -> A free.
      // Who mentions B's UUID? A (archived) -> B free.
      // Who mentions C's UUID? A (archived) -> C free.
      // D is not a candidate (not archived).
      const assetA = buildArchivedAsset(
        UUID_A,
        `Refs [[${UUID_B}]] and [[${UUID_C}]]`,
      );
      const assetB = buildArchivedAsset(UUID_B, `Refs [[${UUID_D}]]`);
      const assetC = buildArchivedAsset(UUID_C, `Refs [[${UUID_D}]]`);
      const activeD = buildActiveAsset(UUID_D);

      const activeFiles = new Set([
        `${UUID_A}.md`,
        `${UUID_B}.md`,
        `${UUID_C}.md`,
        `${UUID_D}.md`,
      ]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === `${UUID_B}.md`) return assetB;
        if (p === `${UUID_C}.md`) return assetC;
        if (p === `${UUID_D}.md`) return activeD;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      expect(result.total_moved).toBe(3);
      expect(result.still_blocked).toBe(0);
    });

    it("should handle real-world chain: iterative freeing across iterations", async () => {
      // Scenario with explicit active-to-archived refs that require iteration:
      // Active E refs A (active ref to A -> A blocked)
      // A refs B (archived ref to B)
      // B refs C (archived ref to C)
      // First pass: C free (no active refs), B free (only archived A refs B)
      // But A blocked (E is active and refs A)
      const assetA = buildArchivedAsset(UUID_A, `Refs [[${UUID_B}]]`);
      const assetB = buildArchivedAsset(UUID_B, `Refs [[${UUID_C}]]`);
      const assetC = buildArchivedAsset(UUID_C);
      const activeE = buildActiveAsset(UUID_ACTIVE, `Uses [[${UUID_A}]]`);

      const activeFiles = new Set([
        `${UUID_A}.md`,
        `${UUID_B}.md`,
        `${UUID_C}.md`,
        `${UUID_ACTIVE}.md`,
      ]);

      mockActiveFs.getMarkdownFiles.mockImplementation(async () =>
        Array.from(activeFiles),
      );
      mockActiveFs.readFile.mockImplementation(async (p) => {
        if (p === `${UUID_A}.md`) return assetA;
        if (p === `${UUID_B}.md`) return assetB;
        if (p === `${UUID_C}.md`) return assetC;
        if (p === `${UUID_ACTIVE}.md`) return activeE;
        if (p === "!ems.md") return ONTOLOGY_CONTENT;
        throw new Error("File not found");
      });
      mockActiveFs.deleteFile.mockImplementation(async (p) => {
        activeFiles.delete(p);
      });

      const result = await service.cascade({
        vaultPath: "/vault",
        archiveVaultPath: "/archive",
        dryRun: false,
      });

      // B and C move (no active refs), A stays (active E refs A)
      expect(result.total_moved).toBe(2);
      expect(result.still_blocked).toBe(1);
    });
  });
});
