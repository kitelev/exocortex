import "reflect-metadata";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { PropertyCleanupService } from "../../../src/services/PropertyCleanupService";
import type { IVaultAdapter, IFile } from "../../../src/interfaces/IVaultAdapter";

describe("PropertyCleanupService", () => {
  let service: PropertyCleanupService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;
  let mockLogger: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    mockVault = {
      read: jest.fn<(file: IFile) => Promise<string>>(),
      modify: jest.fn<(file: IFile, content: string) => Promise<void>>(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    mockFile = { path: "test/file.md" } as IFile;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new (PropertyCleanupService as any)(mockVault, mockLogger);
  });

  describe("cleanEmptyProperties", () => {
    it("should remove empty string properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: My Label\nems__Effort_status: \n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("ems__Effort_status:");
      expect(call[1]).toContain("exo__Asset_label: My Label");
    });

    it("should remove null properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: My Label\nems__Field: null\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("ems__Field: null");
      expect(call[1]).toContain("exo__Asset_label: My Label");
    });

    it("should remove undefined properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test\nfield: undefined\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("field: undefined");
    });

    it("should remove empty array properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test\nlist: []\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("list: []");
    });

    it("should remove empty object properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test\nobj: {}\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("obj: {}");
    });

    it("should remove quoted empty string properties", async () => {
      mockVault.read.mockResolvedValue(
        '---\nexo__Asset_label: Test\nfield1: ""\nfield2: \'\'\n---\n\nContent',
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain('field1: ""');
      expect(call[1]).not.toContain("field2: ''");
    });

    it("should keep non-empty properties", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test\nstatus: active\ncount: 42\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toContain("exo__Asset_label: Test");
      expect(call[1]).toContain("status: active");
      expect(call[1]).toContain("count: 42");
    });

    it("should handle content without frontmatter", async () => {
      mockVault.read.mockResolvedValue("No frontmatter here");

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toBe("No frontmatter here");
    });

    it("should handle list properties with all empty items", async () => {
      mockVault.read.mockResolvedValue(
        "---\nkeep: value\nmylist:\n  - \n  - \n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).not.toContain("mylist:");
      expect(call[1]).toContain("keep: value");
    });

    it("should keep list properties with non-empty items", async () => {
      mockVault.read.mockResolvedValue(
        '---\nmylist:\n  - "[[item1]]"\n  - "[[item2]]"\n---\n\nContent',
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toContain("mylist:");
      expect(call[1]).toContain('  - "[[item1]]"');
      expect(call[1]).toContain('  - "[[item2]]"');
    });

    it("should handle empty lines within frontmatter", async () => {
      mockVault.read.mockResolvedValue(
        "---\nexo__Asset_label: Test\n\nstatus: active\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toContain("exo__Asset_label: Test");
      expect(call[1]).toContain("status: active");
    });

    it("should skip orphaned list items", async () => {
      // This is a YAML edge case - list items without parent key
      mockVault.read.mockResolvedValue(
        "---\n  - orphaned_item\nkeep: value\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toContain("keep: value");
    });

    it("should handle non-property non-list continuation lines", async () => {
      mockVault.read.mockResolvedValue(
        "---\nkeep: value\ncontinuation text\n---\n\nContent",
      );

      await service.cleanEmptyProperties(mockFile);

      const call = mockVault.modify.mock.calls[0];
      expect(call[1]).toContain("keep: value");
      expect(call[1]).toContain("continuation text");
    });

    it("should log operations", async () => {
      mockVault.read.mockResolvedValue("---\nkey: value\n---\n");

      await service.cleanEmptyProperties(mockFile);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Cleaning empty properties",
        expect.objectContaining({ path: "test/file.md" }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Empty properties cleaned",
        expect.objectContaining({ path: "test/file.md" }),
      );
    });
  });
});
