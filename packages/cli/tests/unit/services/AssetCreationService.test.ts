import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock uuid
jest.unstable_mockModule("uuid", () => ({
  v4: jest.fn(() => "generated-uuid-1234-5678-9012-abcdef123456"),
}));

// Mock exocortex
const mockMetadataHelpers = {
  buildFileContent: jest.fn(
    (frontmatter: Record<string, unknown>, body?: string) => {
      const lines = ["---"];
      for (const [key, value] of Object.entries(frontmatter)) {
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
      if (body) {
        lines.push("");
        lines.push(body);
      }
      lines.push("");
      return lines.join("\n");
    },
  ),
};

jest.unstable_mockModule("exocortex", () => ({
  DateFormatter: {
    toLocalTimestamp: jest.fn(() => "2026-03-21T15:30:00"),
  },
  MetadataHelpers: mockMetadataHelpers,
  Namespace: {
    fromPropertyKey: (key: string) => {
      const match = /^([a-z][a-zA-Z0-9]*)__(.+)$/.exec(key);
      if (!match) return null;
      return {
        namespace: {
          term: (localName: string) => ({
            value: `https://exocortex.my/ontology/${match[1]}#${localName}`,
          }),
        },
        localName: match[2],
      };
    },
  },
}));

// Mock services
const mockClassResolver = {
  resolve: jest.fn<(vault: string, name: string) => Promise<string>>(),
  listClasses: jest.fn(),
};

const mockWikilinkValidator = {
  validatePropertyValues: jest.fn<
    (props: Record<string, string>) => Promise<void>
  >(),
  validateValue: jest.fn(),
  extractWikilinks: jest.fn(),
};

const mockFsAdapter = {
  createFile: jest.fn<(path: string, content: string) => Promise<string>>(),
  readFile: jest.fn(),
  fileExists: jest.fn(),
  updateFile: jest.fn(),
  writeFile: jest.fn(),
  deleteFile: jest.fn(),
  renameFile: jest.fn(),
  createDirectory: jest.fn(),
  directoryExists: jest.fn(),
  getMarkdownFiles: jest.fn(),
  getFileMetadata: jest.fn(),
  findFilesByMetadata: jest.fn(),
  findFileByUID: jest.fn(),
};

const { AssetCreationService } = await import(
  "../../../src/services/AssetCreationService.js"
);

describe("AssetCreationService", () => {
  let service: InstanceType<typeof AssetCreationService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClassResolver.resolve.mockResolvedValue("resolved-class-uuid");
    mockWikilinkValidator.validatePropertyValues.mockResolvedValue(undefined);
    mockFsAdapter.createFile.mockResolvedValue("01 Inbox/generated-uuid.md");

    service = new AssetCreationService(
      mockFsAdapter as any,
      mockClassResolver as any,
      mockWikilinkValidator as any,
    );
  });

  describe("create()", () => {
    it("should generate UUID v4 for the asset", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.uuid).toBe("generated-uuid-1234-5678-9012-abcdef123456");
    });

    it("should resolve class short name via ClassResolverService", async () => {
      await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(mockClassResolver.resolve).toHaveBeenCalledWith(
        "/vault",
        "ztlk__PermanentNote",
      );
    });

    it("should set correct frontmatter fields with wikilink [[uuid|className]]", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.frontmatter).toMatchObject({
        exo__Asset_uid: "generated-uuid-1234-5678-9012-abcdef123456",
        exo__Asset_label: "Test Note",
        exo__Instance_class: ['"[[resolved-class-uuid|ztlk__PermanentNote]]"'],
      });
    });

    it("should set exo__Asset_createdBy to ExoAssistant UUID by default", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.frontmatter.exo__Asset_createdBy).toBe(
        '"[[de20a3f1-7483-4714-ab28-b45f5cf02c76]]"',
      );
    });

    it("should allow overriding createdBy", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        createdBy: "custom-creator-uuid",
      });

      expect(result.frontmatter.exo__Asset_createdBy).toBe(
        '"[[custom-creator-uuid]]"',
      );
    });

    it("should set aliases array with label", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.frontmatter.aliases).toEqual(["Test Note"]);
    });

    it("should include additional aliases", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        aliases: ["Alias 1", "Alias 2"],
      });

      expect(result.frontmatter.aliases).toEqual([
        "Test Note",
        "Alias 1",
        "Alias 2",
      ]);
    });

    it("should not duplicate label in aliases", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        aliases: ["Test Note", "Other Alias"],
      });

      const aliases = result.frontmatter.aliases as string[];
      const labelCount = aliases.filter((a) => a === "Test Note").length;
      expect(labelCount).toBe(1);
      expect(aliases).toContain("Other Alias");
    });

    it("should include additional properties in frontmatter", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        properties: {
          "ztlk__Note_developedFrom": "[[some-uuid|Label]]",
          custom_prop: "custom_value",
        },
      });

      // Wikilink values should be quoted and wrapped in array
      expect(result.frontmatter["ztlk__Note_developedFrom"]).toEqual(
        ['"[[some-uuid|Label]]"'],
      );
      // Plain values remain as scalar
      expect(result.frontmatter["custom_prop"]).toBe("custom_value");
    });

    describe("Issue #2293: wikilink property quoting", () => {
      it("should quote wikilink values and wrap in array", async () => {
        const result = await service.create({
          classShortName: "ztlk__PermanentNote",
          label: "Test Note",
          vault: "/vault",
          properties: {
            "exo__Asset_relates": "[[some-uuid|My Asset]]",
          },
        });

        expect(result.frontmatter["exo__Asset_relates"]).toEqual(
          ['"[[some-uuid|My Asset]]"'],
        );
      });

      it("should not quote plain text values", async () => {
        const result = await service.create({
          classShortName: "ztlk__PermanentNote",
          label: "Test Note",
          vault: "/vault",
          properties: {
            "custom_prop": "plain text value",
          },
        });

        expect(result.frontmatter["custom_prop"]).toBe("plain text value");
      });

      it("should handle wikilink without label", async () => {
        const result = await service.create({
          classShortName: "ztlk__PermanentNote",
          label: "Test Note",
          vault: "/vault",
          properties: {
            "exo__Asset_relates": "[[some-uuid]]",
          },
        });

        expect(result.frontmatter["exo__Asset_relates"]).toEqual(
          ['"[[some-uuid]]"'],
        );
      });

      it("should not double-quote already quoted wikilinks", async () => {
        const result = await service.create({
          classShortName: "ztlk__PermanentNote",
          label: "Test Note",
          vault: "/vault",
          properties: {
            "exo__Asset_relates": '"[[some-uuid|Label]]"',
          },
        });

        expect(result.frontmatter["exo__Asset_relates"]).toEqual(
          ['"[[some-uuid|Label]]"'],
        );
      });
    });

    describe("Issue #3099: cardinality-aware wikilink serialization", () => {
      const propertyIRI = (prefix: string, local: string) =>
        `https://exocortex.my/ontology/${prefix}#${local}`;

      const buildRegistry = (
        entries: Array<{ key: string; cardinality: "Single" | "Multiple" }>,
      ) => {
        const map = new Map<string, { cardinality: "Single" | "Multiple" }>();
        for (const { key, cardinality } of entries) {
          const match = /^([a-z][a-zA-Z0-9]*)__(.+)$/.exec(key);
          if (!match) continue;
          map.set(propertyIRI(match[1], match[2]), { cardinality });
        }
        return {
          get: (iri: string) => map.get(iri),
        };
      };

      it("should emit scalar for properties declared PropertyCardinalitySingle", async () => {
        const registry = buildRegistry([
          { key: "ems__Effort_status", cardinality: "Single" },
        ]);
        const singleService = new AssetCreationService(
          mockFsAdapter as any,
          mockClassResolver as any,
          mockWikilinkValidator as any,
          registry as any,
        );

        const result = await singleService.create({
          classShortName: "ems__Task",
          label: "Test Task",
          vault: "/vault",
          properties: {
            "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
          },
        });

        expect(result.frontmatter["ems__Effort_status"]).toBe(
          '"[[ems__EffortStatusBacklog]]"',
        );
      });

      it("should emit array for properties declared PropertyCardinalityMultiple", async () => {
        const registry = buildRegistry([
          { key: "ems__Effort_prototype", cardinality: "Multiple" },
        ]);
        const multiService = new AssetCreationService(
          mockFsAdapter as any,
          mockClassResolver as any,
          mockWikilinkValidator as any,
          registry as any,
        );

        const result = await multiService.create({
          classShortName: "ems__Task",
          label: "Test Task",
          vault: "/vault",
          properties: {
            "ems__Effort_prototype": "[[some-uuid|Proto]]",
          },
        });

        expect(result.frontmatter["ems__Effort_prototype"]).toEqual([
          '"[[some-uuid|Proto]]"',
        ]);
      });

      it("should emit array (legacy default) for properties not in registry", async () => {
        const registry = buildRegistry([]);
        const emptyService = new AssetCreationService(
          mockFsAdapter as any,
          mockClassResolver as any,
          mockWikilinkValidator as any,
          registry as any,
        );

        const result = await emptyService.create({
          classShortName: "ems__Task",
          label: "Test Task",
          vault: "/vault",
          properties: {
            "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
          },
        });

        expect(result.frontmatter["ems__Effort_status"]).toEqual([
          '"[[ems__EffortStatusBacklog]]"',
        ]);
      });

      it("should emit array (legacy default) when no shape registry is provided", async () => {
        // Service constructed without registry (existing behavior)
        const result = await service.create({
          classShortName: "ems__Task",
          label: "Test Task",
          vault: "/vault",
          properties: {
            "ems__Effort_status": "[[ems__EffortStatusBacklog]]",
          },
        });

        expect(result.frontmatter["ems__Effort_status"]).toEqual([
          '"[[ems__EffortStatusBacklog]]"',
        ]);
      });

      it("should leave plain (non-wikilink) values as scalars regardless of cardinality", async () => {
        const registry = buildRegistry([
          { key: "custom_prop", cardinality: "Single" },
        ]);
        const singleService = new AssetCreationService(
          mockFsAdapter as any,
          mockClassResolver as any,
          mockWikilinkValidator as any,
          registry as any,
        );

        const result = await singleService.create({
          classShortName: "ems__Task",
          label: "Test Task",
          vault: "/vault",
          properties: {
            "custom_prop": "plain value",
          },
        });

        expect(result.frontmatter["custom_prop"]).toBe("plain value");
      });
    });

    it("should not override system properties via --property", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        properties: {
          exo__Asset_uid: "hacked-uuid",
          exo__Asset_label: "Hacked Label",
        },
      });

      // System properties should NOT be overridden
      expect(result.frontmatter.exo__Asset_uid).toBe(
        "generated-uuid-1234-5678-9012-abcdef123456",
      );
      expect(result.frontmatter.exo__Asset_label).toBe("Test Note");
    });

    it("should validate wikilinks in properties", async () => {
      const props = {
        "ztlk__Note_developedFrom": "[[some-uuid|Label]]",
      };

      await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        properties: props,
      });

      expect(mockWikilinkValidator.validatePropertyValues).toHaveBeenCalledWith(
        props,
      );
    });

    it("should skip wikilink validation when skipWikilinkValidation is true", async () => {
      await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        properties: { prop: "[[some-uuid|Label]]" },
        skipWikilinkValidation: true,
      });

      expect(
        mockWikilinkValidator.validatePropertyValues,
      ).not.toHaveBeenCalled();
    });

    it("should NOT write file when dryRun is true", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        dryRun: true,
      });

      expect(mockFsAdapter.createFile).not.toHaveBeenCalled();
      // Should still return result
      expect(result.uuid).toBe("generated-uuid-1234-5678-9012-abcdef123456");
      expect(result.label).toBe("Test Note");
    });

    it("should write file when dryRun is false/undefined", async () => {
      await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(mockFsAdapter.createFile).toHaveBeenCalledWith(
        expect.stringContaining("01 Inbox/"),
        expect.stringContaining("---"),
      );
    });

    it("should write file to 01 Inbox/ folder", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.path).toMatch(/^01 Inbox\//);
      expect(result.path).toEndWith(".md");
    });

    it("should include body content in file", async () => {
      await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        body: "# Body content\n\nSome text here.",
      });

      expect(mockMetadataHelpers.buildFileContent).toHaveBeenCalledWith(
        expect.any(Object),
        "# Body content\n\nSome text here.",
      );
    });

    it("should use wikilink with UUID and label for exo__Instance_class", async () => {
      mockClassResolver.resolve.mockResolvedValue("38b234f7-949a-4da0-bab0-c4ca559808d1");

      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
      });

      expect(result.frontmatter.exo__Instance_class).toEqual([
        '"[[38b234f7-949a-4da0-bab0-c4ca559808d1|ztlk__PermanentNote]]"',
      ]);
    });

    // Regression: Issue #3180 — CLI emitted self-aliased [[uid|uid]] when
    // --class <UUID> was passed directly (classShortName === classUuid).
    // Per UID-canon rule (CLAUDE.md 2026-05-17): alias=UID is degenerate;
    // emit bare [[uid]] form.
    describe("Issue #3180: self-aliased class wikilink", () => {
      const CLASS_UUID = "1b20a8f0-d745-4e93-91db-4531b3df120e";

      it("should emit bare [[uid]] when classShortName equals classUuid (UUID passed as --class)", async () => {
        mockClassResolver.resolve.mockResolvedValue(CLASS_UUID);

        const result = await service.create({
          classShortName: CLASS_UUID,
          label: "TEST",
          vault: "/vault",
        });

        expect(result.frontmatter.exo__Instance_class).toEqual([
          `"[[${CLASS_UUID}]]"`,
        ]);
      });

      it("should NOT emit self-aliased [[uid|uid]] form", async () => {
        mockClassResolver.resolve.mockResolvedValue(CLASS_UUID);

        const result = await service.create({
          classShortName: CLASS_UUID,
          label: "TEST",
          vault: "/vault",
        });

        const classRef = (result.frontmatter.exo__Instance_class as string[])[0];
        expect(classRef).not.toContain(`${CLASS_UUID}|${CLASS_UUID}`);
      });

      it("should still emit [[uid|shortName]] when classShortName is human-readable", async () => {
        mockClassResolver.resolve.mockResolvedValue(CLASS_UUID);

        const result = await service.create({
          classShortName: "ems__Task",
          label: "Task label",
          vault: "/vault",
        });

        expect(result.frontmatter.exo__Instance_class).toEqual([
          `"[[${CLASS_UUID}|ems__Task]]"`,
        ]);
      });
    });

    it("should throw error for empty label", async () => {
      await expect(
        service.create({
          classShortName: "ztlk__PermanentNote",
          label: "",
          vault: "/vault",
        }),
      ).rejects.toThrow("Label cannot be empty");
    });

    it("should throw error for whitespace-only label", async () => {
      await expect(
        service.create({
          classShortName: "ztlk__PermanentNote",
          label: "   ",
          vault: "/vault",
        }),
      ).rejects.toThrow("Label cannot be empty");
    });

    it("should trim label whitespace", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "  Trimmed Label  ",
        vault: "/vault",
      });

      expect(result.label).toBe("Trimmed Label");
      expect(result.frontmatter.exo__Asset_label).toBe("Trimmed Label");
    });

    it("should generate timestamp with timezone", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Test Note",
        vault: "/vault",
        timezone: "UTC",
      });

      // Timestamp should be set
      expect(result.frontmatter.exo__Asset_createdAt).toBeDefined();
      expect(typeof result.frontmatter.exo__Asset_createdAt).toBe("string");
    });

    it("should propagate ClassNotFoundError", async () => {
      mockClassResolver.resolve.mockRejectedValue(
        new Error("Class 'xyz__Unknown' not found in vault"),
      );

      await expect(
        service.create({
          classShortName: "xyz__Unknown",
          label: "Test",
          vault: "/vault",
        }),
      ).rejects.toThrow("Class 'xyz__Unknown' not found in vault");
    });

    it("should propagate WikilinkNotFoundError", async () => {
      mockWikilinkValidator.validatePropertyValues.mockRejectedValue(
        new Error(
          "Wikilink [[deadbeef-0000-0000-0000-000000000000|Missing]] \u2014 file not found in vault",
        ),
      );

      await expect(
        service.create({
          classShortName: "ztlk__PermanentNote",
          label: "Test",
          vault: "/vault",
          properties: {
            prop: "[[deadbeef-0000-0000-0000-000000000000|Missing]]",
          },
        }),
      ).rejects.toThrow("file not found in vault");
    });

    it("should return complete result object", async () => {
      const result = await service.create({
        classShortName: "ztlk__PermanentNote",
        label: "Complete Test",
        vault: "/vault",
      });

      expect(result).toHaveProperty("uuid");
      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("label");
      expect(result).toHaveProperty("frontmatter");
      expect(typeof result.uuid).toBe("string");
      expect(typeof result.path).toBe("string");
      expect(result.label).toBe("Complete Test");
      expect(typeof result.frontmatter).toBe("object");
    });
  });
});

// Custom matcher
expect.extend({
  toEndWith(received: string, expected: string) {
    const pass = received.endsWith(expected);
    return {
      message: () =>
        `expected ${received} to end with ${expected}`,
      pass,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toEndWith(expected: string): R;
    }
  }
}
