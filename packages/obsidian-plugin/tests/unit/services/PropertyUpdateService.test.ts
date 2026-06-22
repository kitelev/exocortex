import { PropertyUpdateService } from "../../../src/application/services/PropertyUpdateService";
import type { App, TFile } from "obsidian";

describe("PropertyUpdateService", () => {
  let service: PropertyUpdateService;
  let mockApp: App;
  let mockFile: TFile;
  let mockProcessFrontMatter: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcessFrontMatter = jest.fn(
      async (file: TFile, callback: (frontmatter: any) => void) => {
        const frontmatter = {};
        callback(frontmatter);
      },
    );

    mockApp = {
      fileManager: {
        processFrontMatter: mockProcessFrontMatter,
      },
    } as unknown as App;

    mockFile = {
      path: "test/file.md",
      basename: "file",
    } as TFile;

    service = new PropertyUpdateService(mockApp);
  });

  describe("initialization", () => {
    it("should create PropertyUpdateService instance", () => {
      expect(service).toBeDefined();
    });

    it("should be an instance of PropertyUpdateService", () => {
      expect(service).toBeInstanceOf(PropertyUpdateService);
    });
  });

  describe("updateProperty", () => {
    it("should update property with new value", async () => {
      await service.updateProperty(mockFile, "testKey", "testValue");

      expect(mockProcessFrontMatter).toHaveBeenCalledWith(
        mockFile,
        expect.any(Function),
      );
    });

    it("should delete property when value is null", async () => {
      await service.updateProperty(mockFile, "testKey", null);

      expect(mockProcessFrontMatter).toHaveBeenCalledWith(
        mockFile,
        expect.any(Function),
      );

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { testKey: "oldValue" };
      callback(frontmatter);

      expect(frontmatter.testKey).toBeUndefined();
    });

    it("should delete property when value is undefined", async () => {
      await service.updateProperty(mockFile, "testKey", undefined);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { testKey: "oldValue" };
      callback(frontmatter);

      expect(frontmatter.testKey).toBeUndefined();
    });

    it("should delete property when value is empty string", async () => {
      await service.updateProperty(mockFile, "testKey", "");

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { testKey: "oldValue" };
      callback(frontmatter);

      expect(frontmatter.testKey).toBeUndefined();
    });

    it("should set property when value is provided", async () => {
      await service.updateProperty(mockFile, "testKey", "newValue");

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.testKey).toBe("newValue");
    });

    it("should handle processFrontMatter errors after retries", async () => {
      // Mock must fail on all retry attempts (default maxRetries = 3, so 4 total attempts)
      mockProcessFrontMatter.mockRejectedValue(
        new Error("File processing failed"),
      );

      await expect(
        service.updateProperty(mockFile, "testKey", "testValue"),
      ).rejects.toThrow("Failed to update property");
    });
  });

  describe("updateTextProperty", () => {
    it("should trim and update text property", async () => {
      await service.updateTextProperty(mockFile, "textKey", "  text value  ");

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.textKey).toBe("text value");
    });

    it("should delete property when text is empty after trim", async () => {
      await service.updateTextProperty(mockFile, "textKey", "   ");

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { textKey: "oldValue" };
      callback(frontmatter);

      expect(frontmatter.textKey).toBeUndefined();
    });

    it("should handle empty string", async () => {
      await service.updateTextProperty(mockFile, "textKey", "");

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { textKey: "oldValue" };
      callback(frontmatter);

      expect(frontmatter.textKey).toBeUndefined();
    });
  });

  describe("updateDateTimeProperty", () => {
    it("should update datetime property with ISO string", async () => {
      const isoDate = "2025-01-15T10:30:00.000Z";
      await service.updateDateTimeProperty(mockFile, "dateKey", isoDate);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.dateKey).toBe(isoDate);
    });

    it("should delete property when value is null", async () => {
      await service.updateDateTimeProperty(mockFile, "dateKey", null);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { dateKey: "2025-01-15T10:30:00.000Z" };
      callback(frontmatter);

      expect(frontmatter.dateKey).toBeUndefined();
    });
  });

  describe("updateNumberProperty", () => {
    it("should update number property", async () => {
      await service.updateNumberProperty(mockFile, "numberKey", 42);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.numberKey).toBe(42);
    });

    it("should handle zero value", async () => {
      await service.updateNumberProperty(mockFile, "numberKey", 0);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.numberKey).toBe(0);
    });

    it("should delete property when value is null", async () => {
      await service.updateNumberProperty(mockFile, "numberKey", null);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = { numberKey: 42 };
      callback(frontmatter);

      expect(frontmatter.numberKey).toBeUndefined();
    });
  });

  describe("updateBooleanProperty", () => {
    it("should update boolean property to true", async () => {
      await service.updateBooleanProperty(mockFile, "boolKey", true);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.boolKey).toBe(true);
    });

    it("should update boolean property to false", async () => {
      await service.updateBooleanProperty(mockFile, "boolKey", false);

      const callback = mockProcessFrontMatter.mock.calls[0][1];
      const frontmatter: any = {};
      callback(frontmatter);

      expect(frontmatter.boolKey).toBe(false);
    });
  });
});
