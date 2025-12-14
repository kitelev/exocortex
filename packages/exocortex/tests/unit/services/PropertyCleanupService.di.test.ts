import "reflect-metadata";
import { container } from "tsyringe";
import { PropertyCleanupService, DI_TOKENS, IVaultAdapter, ILogger, IFile } from "../../../src";

describe("PropertyCleanupService with DI", () => {
  let mockVaultAdapter: jest.Mocked<IVaultAdapter>;
  let mockLogger: jest.Mocked<ILogger>;
  let service: PropertyCleanupService;

  beforeEach(() => {
    container.clearInstances();

    mockVaultAdapter = {
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getAllFiles: jest.fn(),
      getFrontmatter: jest.fn(),
      getBacklinksForFile: jest.fn(),
      rename: jest.fn(),
    } as any;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    container.register(DI_TOKENS.IVaultAdapter, { useValue: mockVaultAdapter });
    container.register(DI_TOKENS.ILogger, { useValue: mockLogger });

    service = container.resolve(PropertyCleanupService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it("should be instantiated via DI container", () => {
    expect(service).toBeInstanceOf(PropertyCleanupService);
  });

  it("should log debug message on instantiation", () => {
    expect(mockLogger.debug).toHaveBeenCalledWith("PropertyCleanupService initialized");
  });

  it("should use injected logger when cleaning properties", async () => {
    const mockFile: IFile = {
      path: "test.md",
      name: "test.md",
      basename: "test",
      extension: "md",
    };

    mockVaultAdapter.read.mockResolvedValue(`---
title: Test
emptyProp:
---
Content`);

    await service.cleanEmptyProperties(mockFile);

    expect(mockLogger.debug).toHaveBeenCalledWith("Cleaning empty properties", { path: "test.md" });
    expect(mockLogger.info).toHaveBeenCalledWith("Empty properties cleaned", { path: "test.md" });
  });

  it("should use injected vault adapter for file operations", async () => {
    const mockFile: IFile = {
      path: "test.md",
      name: "test.md",
      basename: "test",
      extension: "md",
    };

    const fileContent = `---
title: Test
emptyProp:
---
Content`;

    mockVaultAdapter.read.mockResolvedValue(fileContent);

    await service.cleanEmptyProperties(mockFile);

    expect(mockVaultAdapter.read).toHaveBeenCalledWith(mockFile);
    expect(mockVaultAdapter.modify).toHaveBeenCalled();
  });

  it("should resolve service singleton from container", () => {
    const service1 = container.resolve(PropertyCleanupService);
    const service2 = container.resolve(PropertyCleanupService);

    expect(service1).toBe(service2);
  });
});
