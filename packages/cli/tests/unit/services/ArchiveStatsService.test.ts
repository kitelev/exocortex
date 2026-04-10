import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFsAdapter = {
  getMarkdownFiles: jest.fn<() => Promise<string[]>>(),
  readFile: jest.fn<(path: string) => Promise<string>>(),
  fileExists: jest.fn(),
  createFile: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  getFileMetadata: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

jest.unstable_mockModule("../../../src/adapters/NodeFsAdapter.js", () => ({
  NodeFsAdapter: jest.fn(() => mockFsAdapter),
}));

const { ArchiveStatsService } = await import(
  "../../../src/services/ArchiveStatsService.js"
);

/**
 * Helper to create markdown file content with frontmatter.
 */
function makeMd(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

describe("ArchiveStatsService", () => {
  let service: InstanceType<typeof ArchiveStatsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ArchiveStatsService(mockFsAdapter as any);
  });

  it("should return zeros for empty vault", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue([]);

    const stats = await service.collect();

    expect(stats.total).toBe(0);
    expect(stats.by_class).toEqual({});
    expect(stats.by_year).toEqual({});
    expect(stats.cross).toEqual({});
  });

  it("should count total files correctly", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue([
      "a.md",
      "b.md",
      "c.md",
    ]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({ exo__Instance_class: '"[[uuid|ems__Task]]"' }),
    );

    const stats = await service.collect();

    expect(stats.total).toBe(3);
  });

  it("should aggregate by class correctly", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue([
      "a.md",
      "b.md",
      "c.md",
    ]);
    mockFsAdapter.readFile
      .mockResolvedValueOnce(
        makeMd({ exo__Instance_class: '"[[uuid1|ems__Task]]"' }),
      )
      .mockResolvedValueOnce(
        makeMd({ exo__Instance_class: '"[[uuid2|ems__Meeting]]"' }),
      )
      .mockResolvedValueOnce(
        makeMd({ exo__Instance_class: '"[[uuid1|ems__Task]]"' }),
      );

    const stats = await service.collect();

    expect(stats.by_class).toEqual({
      ems__Task: 2,
      ems__Meeting: 1,
    });
  });

  it("should use resolutionTimestamp for year when present", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({
        exo__Instance_class: '"[[uuid|ems__Task]]"',
        ems__Effort_resolutionTimestamp: "2025-06-15T10:00:00",
        ems__Effort_endTimestamp: "2024-12-31T23:59:59",
      }),
    );

    const stats = await service.collect();

    expect(stats.by_year).toEqual({ "2025": 1 });
  });

  it("should fall back to endTimestamp when resolutionTimestamp is absent", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({
        exo__Instance_class: '"[[uuid|ems__Task]]"',
        ems__Effort_endTimestamp: "2024-03-20T15:30:00",
      }),
    );

    const stats = await service.collect();

    expect(stats.by_year).toEqual({ "2024": 1 });
  });

  it("should assign year 'unknown' when both timestamps are absent", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({ exo__Instance_class: '"[[uuid|ems__Task]]"' }),
    );

    const stats = await service.collect();

    expect(stats.by_year).toEqual({ unknown: 1 });
  });

  it("should assign class 'unknown' when exo__Instance_class is absent", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({ exo__Asset_label: "Some Asset" }),
    );

    const stats = await service.collect();

    expect(stats.by_class).toEqual({ unknown: 1 });
  });

  it("should build correct cross-tabulation", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue([
      "a.md",
      "b.md",
      "c.md",
    ]);
    mockFsAdapter.readFile
      .mockResolvedValueOnce(
        makeMd({
          exo__Instance_class: '"[[u|ems__Task]]"',
          ems__Effort_endTimestamp: "2025-01-01T00:00:00",
        }),
      )
      .mockResolvedValueOnce(
        makeMd({
          exo__Instance_class: '"[[u|ems__Task]]"',
          ems__Effort_endTimestamp: "2025-06-15T00:00:00",
        }),
      )
      .mockResolvedValueOnce(
        makeMd({
          exo__Instance_class: '"[[u|ems__Meeting]]"',
          ems__Effort_endTimestamp: "2025-03-20T00:00:00",
        }),
      );

    const stats = await service.collect();

    expect(stats.cross).toEqual({
      ems__Task: { "2025": 2 },
      ems__Meeting: { "2025": 1 },
    });
  });

  it("should handle exo__Instance_class as array", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({
        exo__Instance_class: ['"[[uuid|ems__Project]]"'],
      }),
    );

    const stats = await service.collect();

    expect(stats.by_class).toEqual({ ems__Project: 1 });
  });

  it("should handle plain class name without wikilink", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({ exo__Instance_class: ["[[ems__Task]]"] }),
    );

    const stats = await service.collect();

    expect(stats.by_class).toEqual({ ems__Task: 1 });
  });

  it("should handle class as plain wikilink without label", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["a.md"]);
    mockFsAdapter.readFile.mockResolvedValue(
      makeMd({ exo__Instance_class: '"[[ems__Task]]"' }),
    );

    const stats = await service.collect();

    expect(stats.by_class).toEqual({ ems__Task: 1 });
  });

  it("should skip unreadable files without crashing", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue([
      "good.md",
      "broken.md",
    ]);
    mockFsAdapter.readFile
      .mockResolvedValueOnce(
        makeMd({ exo__Instance_class: '"[[u|ems__Task]]"' }),
      )
      .mockRejectedValueOnce(new Error("EPERM: permission denied"));

    const stats = await service.collect();

    expect(stats.total).toBe(1);
    expect(stats.by_class).toEqual({ ems__Task: 1 });
  });

  it("should handle files without frontmatter", async () => {
    mockFsAdapter.getMarkdownFiles.mockResolvedValue(["no-fm.md"]);
    mockFsAdapter.readFile.mockResolvedValue("# Just a heading\n\nNo frontmatter here.");

    const stats = await service.collect();

    expect(stats.total).toBe(1);
    expect(stats.by_class).toEqual({ unknown: 1 });
    expect(stats.by_year).toEqual({ unknown: 1 });
  });
});
