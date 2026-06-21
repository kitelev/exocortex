import { AreaCreationService } from "../../src/services/AreaCreationService";
import { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import { DateFormatter } from "../../src/utilities/DateFormatter";
import { MetadataExtractor } from "../../src/utilities/MetadataExtractor";
import { MetadataHelpers } from "../../src/utilities/MetadataHelpers";
import { AssetClass } from "../../src/domain/constants";

jest.mock("../../src/utilities/DateFormatter");
jest.mock("../../src/utilities/MetadataExtractor");
jest.mock("../../src/utilities/MetadataHelpers");
jest.mock("uuid", () => ({ v4: () => "test-uuid-123" }));

describe("AreaCreationService", () => {
  let service: AreaCreationService;
  let mockVault: jest.Mocked<IVaultAdapter>;
  let mockSourceFile: IFile;
  let mockCreatedFile: IFile;

  const mockTimestamp = "2025-01-15T10:30:00+10:00";

  beforeEach(() => {
    mockVault = {
      create: jest.fn().mockResolvedValue({} as IFile),
    } as any;

    mockSourceFile = {
      path: "/folder/source.md",
      name: "source.md",
      basename: "source",
      parent: {
        path: "/folder",
      },
    } as IFile;

    mockCreatedFile = {
      path: "/folder/test-uuid-123.md",
      name: "test-uuid-123.md",
      basename: "test-uuid-123",
      parent: {
        path: "/folder",
      },
    } as IFile;

    (DateFormatter.toLocalTimestamp as jest.Mock).mockReturnValue(mockTimestamp);
    (MetadataExtractor.extractIsDefinedBy as jest.Mock).mockReturnValue("source-ontology");
    (MetadataHelpers.ensureQuoted as jest.Mock).mockImplementation((val) => `"${val}"`);
    (MetadataHelpers.buildFileContent as jest.Mock).mockReturnValue("---\nfrontmatter\n---\n");

    mockVault.create.mockResolvedValue(mockCreatedFile);

    service = new AreaCreationService(mockVault);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createChildArea", () => {
    it("should create child area with label", async () => {
      const sourceMetadata = { someProperty: "value" };
      const label = "Test Area";

      const result = await service.createChildArea(mockSourceFile, sourceMetadata, label);

      expect(mockVault.create).toHaveBeenCalledWith(
        "/folder/test-uuid-123.md",
        "---\nfrontmatter\n---\n",
      );
      expect(result).toBe(mockCreatedFile);
    });

    it("should create child area without label", async () => {
      const sourceMetadata = { someProperty: "value" };

      await service.createChildArea(mockSourceFile, sourceMetadata);

      expect(mockVault.create).toHaveBeenCalledWith(
        "/folder/test-uuid-123.md",
        "---\nfrontmatter\n---\n",
      );
    });

    it("should handle file in root folder", async () => {
      const rootFile: IFile = {
        path: "source.md",
        name: "source.md",
        basename: "source",
        parent: null,
      } as any;

      const sourceMetadata = {};

      await service.createChildArea(rootFile, sourceMetadata, "Root Area");

      expect(mockVault.create).toHaveBeenCalledWith(
        "test-uuid-123.md",
        "---\nfrontmatter\n---\n",
      );
    });

    it("should handle file with undefined parent path", async () => {
      const fileWithUndefinedParent: IFile = {
        path: "source.md",
        name: "source.md",
        basename: "source",
        parent: {
          path: undefined as any,
        },
      } as any;

      const sourceMetadata = {};

      await service.createChildArea(fileWithUndefinedParent, sourceMetadata);

      expect(mockVault.create).toHaveBeenCalledWith(
        "test-uuid-123.md",
        "---\nfrontmatter\n---\n",
      );
    });

    it("should call buildFileContent with generated frontmatter", async () => {
      const sourceMetadata = { key: "value" };
      const label = "My Area";

      await service.createChildArea(mockSourceFile, sourceMetadata, label);

      expect(MetadataHelpers.buildFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          exo__Asset_isDefinedBy: expect.any(String),
          exo__Asset_uid: "test-uuid-123",
          exo__Asset_createdAt: mockTimestamp,
          exo__Instance_class: expect.any(Array),
          ems__Area_parent: expect.any(String),
        }),
      );
    });
  });

  describe("generateChildAreaFrontmatter", () => {
    it("should generate frontmatter with label", () => {
      const sourceMetadata = { key: "value" };
      const sourceName = "parent-area";
      const label = "Child Area";
      const uid = "custom-uid-456";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName, label, uid);

      expect(result).toEqual({
        exo__Asset_isDefinedBy: '"source-ontology"',
        exo__Asset_uid: "custom-uid-456",
        exo__Asset_createdAt: mockTimestamp,
        exo__Instance_class: [`"[[${AssetClass.AREA}]]"`],
        ems__Area_parent: '"[[parent-area]]"',
        exo__Asset_label: "Child Area",
        aliases: ["Child Area"],
      });
    });

    it("should generate frontmatter without label", () => {
      const sourceMetadata = {};
      const sourceName = "parent-area";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(result).toEqual({
        exo__Asset_isDefinedBy: '"source-ontology"',
        exo__Asset_uid: expect.any(String),
        exo__Asset_createdAt: mockTimestamp,
        exo__Instance_class: [`"[[${AssetClass.AREA}]]"`],
        ems__Area_parent: '"[[parent-area]]"',
      });
      expect(result.exo__Asset_label).toBeUndefined();
      expect(result.aliases).toBeUndefined();
    });

    it("should generate UID when not provided", () => {
      const sourceMetadata = {};
      const sourceName = "parent";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(result.exo__Asset_uid).toBe("test-uuid-123");
    });

    it("should trim label and filter whitespace-only labels", () => {
      const sourceMetadata = {};
      const sourceName = "parent";
      const label = "   ";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName, label);

      expect(result.exo__Asset_label).toBeUndefined();
      expect(result.aliases).toBeUndefined();
    });

    it("should preserve non-whitespace trimmed labels", () => {
      const sourceMetadata = {};
      const sourceName = "parent";
      const label = "  Valid Label  ";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName, label);

      expect(result.exo__Asset_label).toBe("Valid Label");
      expect(result.aliases).toEqual(["Valid Label"]);
    });

    it("should call extractIsDefinedBy with source metadata", () => {
      const sourceMetadata = { ontology: "test-ontology" };
      const sourceName = "parent";

      service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(MetadataExtractor.extractIsDefinedBy).toHaveBeenCalledWith(sourceMetadata);
    });

    it("should call ensureQuoted for isDefinedBy", () => {
      const sourceMetadata = {};
      const sourceName = "parent";

      service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(MetadataHelpers.ensureQuoted).toHaveBeenCalledWith("source-ontology");
    });

    it("should format parent wikilink correctly", () => {
      const sourceMetadata = {};
      const sourceName = "my-parent-area";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(result.ems__Area_parent).toBe('"[[my-parent-area]]"');
    });

    it("should use current timestamp", () => {
      const sourceMetadata = {};
      const sourceName = "parent";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(DateFormatter.toLocalTimestamp).toHaveBeenCalledWith(expect.any(Date));
      expect(result.exo__Asset_createdAt).toBe(mockTimestamp);
    });

    it("should set correct instance class", () => {
      const sourceMetadata = {};
      const sourceName = "parent";

      const result = service.generateChildAreaFrontmatter(sourceMetadata, sourceName);

      expect(result.exo__Instance_class).toEqual([`"[[${AssetClass.AREA}]]"`]);
    });
  });
});
