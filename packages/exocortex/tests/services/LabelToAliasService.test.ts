import { LabelToAliasService } from "../../src/services/LabelToAliasService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";

describe("LabelToAliasService", () => {
  let service: LabelToAliasService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockFile: IFile;

  beforeEach(() => {
    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
    } as any;

    mockFile = {
      path: "/folder/file.md",
      name: "file.md",
      basename: "file",
    } as IFile;

    service = new LabelToAliasService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("copyLabelToAliases", () => {
    it("should copy label to aliases when label exists", async () => {
      const originalContent = `---
title: Test File
exo__Asset_label: My Label
---

Content here.`;

      const expectedContent = `---
title: Test File
exo__Asset_label: My Label
aliases:
  - "My Label"
---

Content here.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      expect(mockVault.read).toHaveBeenCalledWith(mockFile);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it("should throw error when no label found", async () => {
      const content = `---
title: Test File
---

Content.`;

      mockVault.read.mockResolvedValue(content);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );

      expect(mockVault.modify).not.toHaveBeenCalled();
    });

    it("should throw error when frontmatter has no label", async () => {
      const content = `---
title: Test
someProperty: value
---

Content.`;

      mockVault.read.mockResolvedValue(content);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });

    it("should handle label with quotes", async () => {
      const originalContent = `---
exo__Asset_label: "Quoted Label"
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain('- "Quoted Label"');
    });

    it("should handle label with single quotes", async () => {
      const originalContent = `---
exo__Asset_label: 'Single Quote Label'
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain('- "Single Quote Label"');
    });

    it("should trim whitespace from label", async () => {
      const originalContent = `---
exo__Asset_label:   Trimmed Label
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain('- "Trimmed Label"');
    });
  });

  describe("addLabelToAliases - existing aliases", () => {
    it("should add label to existing aliases", async () => {
      const originalContent = `---
title: Test
exo__Asset_label: New Label
aliases:
  - old-alias
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("aliases:");
      expect(modifiedContent).toContain("  - old-alias");
      expect(modifiedContent).toContain('  - "New Label"');
    });

    it("should add label after all existing aliases", async () => {
      const originalContent = `---
exo__Asset_label: Third Alias
aliases:
  - first-alias
  - second-alias
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("aliases:");
      expect(modifiedContent).toContain("  - first-alias");
      expect(modifiedContent).toContain("  - second-alias");
      expect(modifiedContent).toContain('  - "Third Alias"');
    });
  });

  describe("addLabelToAliases - no aliases", () => {
    it("should create aliases section when missing", async () => {
      const originalContent = `---
title: Test
exo__Asset_label: First Alias
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("aliases:");
      expect(modifiedContent).toContain('  - "First Alias"');
    });

    it("should create frontmatter when missing", async () => {
      const originalContent = "Content without frontmatter.";

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });
  });

  describe("line ending handling", () => {
    it("should preserve Unix line endings (\\n)", async () => {
      const originalContent = "---\nexo__Asset_label: Test Label\n---\n\nContent.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("\n");
      expect(modifiedContent).not.toContain("\r\n");
    });

    it("should preserve Windows line endings (\\r\\n)", async () => {
      const originalContent = "---\r\nexo__Asset_label: Test Label\r\n---\r\n\r\nContent.";

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("\r\n");
    });
  });

  describe("edge cases", () => {
    it("should handle empty label value", async () => {
      const originalContent = `---
exo__Asset_label:
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await expect(service.copyLabelToAliases(mockFile)).rejects.toThrow(
        "No exo__Asset_label found in file",
      );
    });

    it("should handle label at end of frontmatter", async () => {
      const originalContent = `---
title: Test
exo__Asset_label: Last Property
---
Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      expect(mockVault.modify).toHaveBeenCalled();
    });

    it("should handle frontmatter with no other properties", async () => {
      const originalContent = `---
exo__Asset_label: Only Label
---

Content.`;

      mockVault.read.mockResolvedValue(originalContent);

      await service.copyLabelToAliases(mockFile);

      const modifiedContent = mockVault.modify.mock.calls[0][1];
      expect(modifiedContent).toContain("exo__Asset_label: Only Label");
      expect(modifiedContent).toContain('aliases:\n  - "Only Label"');
    });
  });
});
