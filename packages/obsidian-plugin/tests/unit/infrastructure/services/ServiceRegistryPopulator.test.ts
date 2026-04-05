import { ServiceRegistry } from "exocortex";
import {
  populateServiceRegistry,
  type ServiceRegistryDeps,
} from "../../../../src/infrastructure/services/ServiceRegistryPopulator";

function createMockDeps(): ServiceRegistryDeps {
  return {
    app: {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([
          { path: "folder/test-uid-123.md" },
        ]),
        adapter: {
          trashLocal: jest.fn().mockResolvedValue(undefined),
        },
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: {
            exo__Asset_uid: "test-uid-123",
            exo__Asset_label: "Test Asset",
          },
        }),
      },
      workspace: {
        getActiveFile: jest.fn().mockReturnValue({ path: "active.md" }),
        openLinkText: jest.fn().mockResolvedValue(undefined),
      },
    } as any,
    fileSystemAdapter: {
      readFile: jest.fn().mockResolvedValue("---\nfoo: bar\n---\nBody"),
      updateFile: jest.fn().mockResolvedValue(undefined),
      createFile: jest.fn().mockResolvedValue("new-file.md"),
    } as any,
    sparqlApi: {
      query: jest.fn().mockResolvedValue({ bindings: [], count: 0 }),
    } as any,
  };
}

describe("ServiceRegistryPopulator", () => {
  let registry: ServiceRegistry;
  let deps: ServiceRegistryDeps;

  beforeEach(() => {
    registry = new ServiceRegistry();
    deps = createMockDeps();
    populateServiceRegistry(registry, deps);
  });

  it("should register 10 services", () => {
    const ids = registry.getRegisteredIds();
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it("should register all expected service IDs", () => {
    const expectedIds = [
      "updateProperty",
      "removeProperty",
      "setStatus",
      "createAsset",
      "openFile",
      "sparqlSelect",
      "getActiveFileIRI",
      "getActiveFilePath",
      "trashFile",
      "duplicateFile",
    ];
    for (const id of expectedIds) {
      expect(registry.has(id)).toBe(true);
    }
  });

  describe("updateProperty", () => {
    it("should read file, update property, and write back", async () => {
      const service = registry.get("updateProperty")!;
      await service.execute("test-uid-123", {
        property: "ems__Effort_status",
        value: "Done",
      });

      expect(deps.fileSystemAdapter.readFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
      );
      expect(deps.fileSystemAdapter.updateFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
        expect.stringContaining("ems__Effort_status: Done"),
      );
    });

    it("should throw when property is missing", async () => {
      const service = registry.get("updateProperty")!;
      await expect(
        service.execute("test-uid-123", { value: "x" }),
      ).rejects.toThrow("userInput.property");
    });

    it("should throw when value is missing", async () => {
      const service = registry.get("updateProperty")!;
      await expect(
        service.execute("test-uid-123", { property: "foo" }),
      ).rejects.toThrow("userInput.value");
    });
  });

  describe("removeProperty", () => {
    it("should read file, remove property, and write back", async () => {
      (deps.fileSystemAdapter.readFile as jest.Mock).mockResolvedValue(
        "---\nfoo: bar\nremove_me: yes\n---\nBody",
      );

      const service = registry.get("removeProperty")!;
      await service.execute("test-uid-123", { property: "remove_me" });

      expect(deps.fileSystemAdapter.updateFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
        expect.not.stringContaining("remove_me"),
      );
    });

    it("should throw when property is missing", async () => {
      const service = registry.get("removeProperty")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "userInput.property",
      );
    });
  });

  describe("setStatus", () => {
    it("should update ems__Effort_status with wikilink format", async () => {
      const service = registry.get("setStatus")!;
      await service.execute("test-uid-123", {
        statusUID: "ems__EffortStatusDoing",
      });

      expect(deps.fileSystemAdapter.updateFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
        expect.stringContaining('"[[ems__EffortStatusDoing]]"'),
      );
    });

    it("should throw when statusUID is missing", async () => {
      const service = registry.get("setStatus")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "userInput.statusUID",
      );
    });
  });

  describe("createAsset", () => {
    it("should create file with frontmatter", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototypeUID: "ems__TaskPrototype",
        label: "My New Task",
        folder: "01 Areas/Tasks",
      });

      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^01 Areas\/Tasks\/[a-f0-9-]+\.md$/),
        expect.stringContaining("exo__Asset_label: My New Task"),
      );
    });

    it("should throw when prototypeUID is missing", async () => {
      const service = registry.get("createAsset")!;
      await expect(
        service.execute("", { label: "x", folder: "y" }),
      ).rejects.toThrow("userInput.prototypeUID");
    });
  });

  describe("openFile", () => {
    it("should call app.workspace.openLinkText", async () => {
      const service = registry.get("openFile")!;
      await service.execute("", { path: "some/path.md" });

      expect(deps.app.workspace.openLinkText).toHaveBeenCalledWith(
        "some/path.md",
        "",
      );
    });

    it("should throw when path is missing", async () => {
      const service = registry.get("openFile")!;
      await expect(service.execute("", {})).rejects.toThrow("userInput.path");
    });
  });

  describe("sparqlSelect", () => {
    it("should execute query via SPARQLApi", async () => {
      const service = registry.get("sparqlSelect")!;
      await service.execute("", { query: "SELECT ?s WHERE { ?s ?p ?o }" });

      expect(deps.sparqlApi.query).toHaveBeenCalledWith(
        "SELECT ?s WHERE { ?s ?p ?o }",
      );
    });

    it("should throw when query is missing", async () => {
      const service = registry.get("sparqlSelect")!;
      await expect(service.execute("", {})).rejects.toThrow("userInput.query");
    });
  });

  describe("getActiveFileIRI", () => {
    it("should not throw when active file exists", async () => {
      const service = registry.get("getActiveFileIRI")!;
      await expect(service.execute("")).resolves.toBeUndefined();
      expect(deps.app.workspace.getActiveFile).toHaveBeenCalled();
    });

    it("should handle no active file gracefully", async () => {
      (deps.app.workspace.getActiveFile as jest.Mock).mockReturnValue(null);
      const service = registry.get("getActiveFileIRI")!;
      await expect(service.execute("")).resolves.toBeUndefined();
    });
  });

  describe("getActiveFilePath", () => {
    it("should call getActiveFile", async () => {
      const service = registry.get("getActiveFilePath")!;
      await service.execute("");
      expect(deps.app.workspace.getActiveFile).toHaveBeenCalled();
    });
  });

  describe("trashFile", () => {
    it("should call trashLocal with resolved path", async () => {
      const service = registry.get("trashFile")!;
      await service.execute("test-uid-123");

      expect(deps.app.vault.adapter.trashLocal).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
      );
    });
  });

  describe("duplicateFile", () => {
    it("should create a new file with new UID and label", async () => {
      const service = registry.get("duplicateFile")!;
      await service.execute("test-uid-123", { label: "Copy of Asset" });

      expect(deps.fileSystemAdapter.readFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
      );
      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^folder\/[a-f0-9-]+\.md$/),
        expect.stringContaining("exo__Asset_label: Copy of Asset"),
      );
    });

    it("should throw when label is missing", async () => {
      const service = registry.get("duplicateFile")!;
      await expect(
        service.execute("test-uid-123", {}),
      ).rejects.toThrow("userInput.label");
    });
  });

  describe("resolveFilePath (via services)", () => {
    it("should throw when IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });

      const service = registry.get("updateProperty")!;
      await expect(
        service.execute("nonexistent-iri", {
          property: "foo",
          value: "bar",
        }),
      ).rejects.toThrow("No file found for IRI");
    });
  });
});
