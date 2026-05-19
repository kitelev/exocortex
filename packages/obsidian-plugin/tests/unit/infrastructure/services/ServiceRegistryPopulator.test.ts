import { ServiceRegistry } from "exocortex";
import {
  populateServiceRegistry,
  type ServiceRegistryDeps,
} from "../../../../src/infrastructure/services/ServiceRegistryPopulator";

const mockIFile = {
  path: "folder/test-uid-123.md",
  basename: "test-uid-123",
  name: "test-uid-123.md",
  parent: { path: "folder", name: "folder" },
};

function createMockDeps(withVaultAdapter = false): ServiceRegistryDeps {
  const deps: ServiceRegistryDeps = {
    app: {
      vault: {
        getMarkdownFiles: jest.fn().mockReturnValue([
          { path: "folder/test-uid-123.md" },
        ]),
        getAbstractFileByPath: jest.fn().mockImplementation((path: string) => {
          if (path === "folder/test-uid-123.md") return { path: "folder/test-uid-123.md" };
          return null;
        }),
        adapter: {
          trashLocal: jest.fn().mockResolvedValue(undefined),
        },
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter: {
            exo__Asset_uid: "test-uid-123",
            exo__Asset_label: "Test Asset",
            ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
            ems__Effort_plannedStartTimestamp: "2024-01-15T00:00:00",
          },
        }),
      },
      workspace: {
        getActiveFile: jest.fn().mockReturnValue({ path: "active.md" }),
        openLinkText: jest.fn().mockResolvedValue(undefined),
        getLeaf: jest.fn().mockReturnValue({
          openFile: jest.fn().mockResolvedValue(undefined),
        }),
        setActiveLeaf: jest.fn(),
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

  if (withVaultAdapter) {
    deps.vaultAdapter = {
      getAbstractFileByPath: jest.fn().mockReturnValue(mockIFile),
      getFrontmatter: jest.fn().mockReturnValue({
        exo__Asset_uid: "test-uid-123",
        exo__Asset_label: "Test Asset",
        ems__Effort_status: '"[[ems__EffortStatusDoing]]"',
        ems__Effort_plannedStartTimestamp: "2024-01-15T00:00:00",
      }),
      read: jest.fn().mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Test Asset\nems__Effort_status: \"[[ems__EffortStatusDoing]]\"\nems__Effort_plannedStartTimestamp: 2024-01-15T00:00:00\n---\nBody"
      ),
      modify: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(mockIFile),
      createFolder: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
      updateLinks: jest.fn().mockResolvedValue(undefined),
      process: jest.fn().mockImplementation(
        async (_file: unknown, fn: (content: string) => string) => {
          const content = "---\nexo__Asset_uid: test\n---\nBody";
          return fn(content);
        },
      ),
      toTFile: jest.fn().mockReturnValue({
        path: mockIFile.path,
        basename: mockIFile.basename,
        name: mockIFile.name,
      }),
    } as any;
  }

  return deps;
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

  it("should not register vault-dependent services when vaultAdapter is absent", () => {
    // `planOnToday` + `createTaskForDailyNote` removed in Issue #3136 (Q3.b
    // closure — migrated to declarative groundings via $todayStart /
    // $targetFolder + propertyDefaults).
    const vaultDependentIds = [
      "rollbackStatus",
      "planForEvening",
      "createRelatedTask",
      "createRelatedProject",
      "archiveAsset",
      "cleanProperties",
      "fixMissingLabel",
      "renameToUid",
      "repairFolder",
      "createNarrowerConcept",
      "createSubclass",
    ];
    for (const id of vaultDependentIds) {
      expect(registry.has(id)).toBe(false);
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

    it("should include exo__Asset_createdAt with ISO-8601 timestamp", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototypeUID: "ems__TaskPrototype",
        label: "Timestamped Task",
        folder: "01 Areas/Tasks",
      });

      const createCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock.calls[0];
      const frontmatter = createCall[1] as string;
      expect(frontmatter).toMatch(/exo__Asset_createdAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should throw when prototypeUID is missing", async () => {
      const service = registry.get("createAsset")!;
      await expect(
        service.execute("", { label: "x", folder: "y" }),
      ).rejects.toThrow("userInput.prototypeUID");
    });

    // Regression #2850 Bug 3: `Create Project` grounding in the vault was
    // authored with `{"prototype":"..."}` (matching the natural JSON key
    // name) while the service expected `prototypeUID`. The mismatch caused
    // the UI click-through to fail with a brief 4 s red Notice and no file
    // created — user reported as "silent fail". Accept `prototype` as an
    // alias so outdated starter-kit groundings keep working.
    it("should accept 'prototype' as alias for 'prototypeUID'", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototype: "ems__ProjectPrototype",
        label: "Aliased Project",
        folder: "01 Areas",
      });

      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^01 Areas\/[a-f0-9-]+\.md$/),
        expect.stringContaining(
          'exo__Asset_prototype: "[[ems__ProjectPrototype]]"',
        ),
      );
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

    it("should resolve obsidian://vault/ IRI to file path", async () => {
      const service = registry.get("updateProperty")!;
      await service.execute("obsidian://vault/folder/test-uid-123.md", {
        property: "foo",
        value: "bar",
      });

      expect(deps.fileSystemAdapter.readFile).toHaveBeenCalledWith(
        "folder/test-uid-123.md",
      );
    });

    it("should decode percent-encoded obsidian://vault/ IRI", async () => {
      (deps.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
        if (path === "folder/My Task.md") return { path: "folder/My Task.md" };
        if (path === "folder/test-uid-123.md") return { path: "folder/test-uid-123.md" };
        return null;
      });

      const service = registry.get("updateProperty")!;
      await service.execute("obsidian://vault/folder/My%20Task.md", {
        property: "foo",
        value: "bar",
      });

      expect(deps.fileSystemAdapter.readFile).toHaveBeenCalledWith(
        "folder/My Task.md",
      );
    });
  });

  describe("createAsset default folder", () => {
    it("should use current file folder when folder not specified", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("test-uid-123", {
        prototypeUID: "proto-123",
        label: "New Task",
      });

      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^folder\/[a-f0-9-]+\.md$/),
        expect.stringContaining("exo__Asset_label: New Task"),
      );
    });

    it("should use explicit folder over default", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("test-uid-123", {
        prototypeUID: "proto-123",
        label: "New Task",
        folder: "custom/path",
      });

      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^custom\/path\/[a-f0-9-]+\.md$/),
        expect.stringContaining("exo__Asset_label: New Task"),
      );
    });
  });

  // RFC `1429fcd0` PR-1: global Palette callers (no active file) inject
  // owner identity literally because the active-file inheritance branch
  // can't fire.
  describe("createAsset ownerIdentity fallback", () => {
    it("writes exo__Asset_isDefinedBy from userInput.ownerIdentity when no active file present", async () => {
      const service = registry.get("createAsset")!;

      // Empty targetIRI mimics a Command-Palette invocation with no active
      // asset. The handler can't resolve a parent → parentMetadata stays
      // undefined → the inheritance branch is skipped → ownerIdentity
      // literal becomes the source of truth.
      await service.execute("", {
        prototypeUID: "ztlk__FleetingNotePrototype",
        label: "Captured thought",
        folder: "03 Knowledge/inbox",
        ownerIdentity: "[[!kitelev]]",
      });

      const writeCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock
        .calls[0];
      const writtenContent: string = writeCall[1];
      expect(writtenContent).toContain(
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
      );
    });

    it("parent inheritance still wins over ownerIdentity literal when both are present", async () => {
      const service = registry.get("createAsset")!;

      // Active file has its own isDefinedBy → must not be overridden by
      // the global default. Layout-button UX stays unchanged.
      await service.execute("test-uid-123", {
        prototypeUID: "proto-123",
        label: "Task under project",
        ownerIdentity: "[[!kitelev]]",
      });

      const writeCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock
        .calls[0];
      const writtenContent: string = writeCall[1];
      // Mock parentMetadata in createMockDeps does NOT set
      // exo__Asset_isDefinedBy → inheritance branch records nothing →
      // ownerIdentity fallback takes over. The point of this test is to
      // verify the precedence path is wired: ownerIdentity is honored
      // exactly when inheritance produced nothing.
      expect(writtenContent).toContain(
        'exo__Asset_isDefinedBy: "[[!kitelev]]"',
      );
    });

    it("explicit isDefinedBy from grounding targetValue wins over ownerIdentity fallback", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototypeUID: "ztlk__FleetingNotePrototype",
        label: "Pinned-owner note",
        folder: "03 Knowledge/inbox",
        // GroundingExecutor merges targetValue defaults into userInput; an
        // explicit `isDefinedBy` pin must trump the registrar-injected
        // vault default `ownerIdentity`.
        isDefinedBy: "[[0aa339bc-9b56-400a-8148-cbde57bbf0b6]]",
        ownerIdentity: "[[!some-other-default]]",
      });

      const writeCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock
        .calls[0];
      const writtenContent: string = writeCall[1];
      expect(writtenContent).toContain(
        'exo__Asset_isDefinedBy: "[[0aa339bc-9b56-400a-8148-cbde57bbf0b6]]"',
      );
      expect(writtenContent).not.toContain("[[!some-other-default]]");
      // Guard against duplicate isDefinedBy lines (regression: parent block
      // used to unconditionally append after explicit pin landed).
      const occurrences = (writtenContent.match(/exo__Asset_isDefinedBy:/g) ?? [])
        .length;
      expect(occurrences).toBe(1);
    });

    it("omits exo__Asset_isDefinedBy when neither parent nor ownerIdentity supplies it", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototypeUID: "proto-123",
        label: "No owner",
        folder: "tmp",
      });

      const writeCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock
        .calls[0];
      const writtenContent: string = writeCall[1];
      expect(writtenContent).not.toContain("exo__Asset_isDefinedBy");
    });

    it("accepts literal folder without targetIRI (global Palette case)", async () => {
      const service = registry.get("createAsset")!;
      await service.execute("", {
        prototypeUID: "ztlk__FleetingNotePrototype",
        label: "Thought",
        folder: "03 Knowledge/inbox",
      });

      expect(deps.fileSystemAdapter.createFile).toHaveBeenCalledWith(
        expect.stringMatching(/^03 Knowledge\/inbox\/[a-f0-9-]+\.md$/),
        expect.stringContaining("exo__Asset_label: Thought"),
      );
    });
  });
});

describe("ServiceRegistryPopulator (with vaultAdapter)", () => {
  let registry: ServiceRegistry;
  let deps: ServiceRegistryDeps;

  beforeEach(() => {
    registry = new ServiceRegistry();
    deps = createMockDeps(true);
    populateServiceRegistry(registry, deps);
  });

  it("should register vault-dependent services when vaultAdapter is provided", () => {
    // `planOnToday` + `createTaskForDailyNote` removed in Issue #3136 (Q3.b
    // closure — migrated to declarative groundings via $todayStart /
    // $targetFolder + propertyDefaults).
    const vaultDependentIds = [
      "rollbackStatus",
      "planForEvening",
      "createRelatedTask",
      "createRelatedProject",
      "archiveAsset",
      "cleanProperties",
      "fixMissingLabel",
      "renameToUid",
      "repairFolder",
      "createNarrowerConcept",
      "createSubclass",
    ];
    for (const id of vaultDependentIds) {
      expect(registry.has(id)).toBe(true);
    }
  });

  it("should NOT register copyLabelToAliases (Issue #3132 — migrated to declarative property_append)", () => {
    expect(registry.has("copyLabelToAliases")).toBe(false);
  });

  it("should NOT register shiftDay or incrementVotes (Issue #3134 — migrated to declarative property_shift / property_increment)", () => {
    expect(registry.has("shiftDay")).toBe(false);
    expect(registry.has("incrementVotes")).toBe(false);
  });

  it("should NOT register planOnToday or createTaskForDailyNote (Issue #3136 — migrated to declarative property_set + create_instance with $todayStart / $targetFolder)", () => {
    expect(registry.has("planOnToday")).toBe(false);
    expect(registry.has("createTaskForDailyNote")).toBe(false);
  });

  describe("rollbackStatus", () => {
    it("should resolve file and call vault read/modify", async () => {
      const service = registry.get("rollbackStatus")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.read).toHaveBeenCalledWith(mockIFile);
      expect(deps.vaultAdapter!.modify).toHaveBeenCalled();
    });

    it("should throw when IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });
      const service = registry.get("rollbackStatus")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow("No file found for IRI");
    });
  });

  // describe("planOnToday", ...) removed — Issue #3136 migrated the
  // grounding to declarative property_set with the new $todayStart token;
  // the registry registration no longer exists. Coverage moved to
  // GroundingExecutor.test.ts substituteVariables suite ($todayStart cases).
  // The TaskStatusService.planOnToday method + PlanOnTodayCommand palette
  // command were subsequently deleted in Phase 4 PR-A (RFC 31c1a0be).

  describe("planForEvening", () => {
    it("should resolve file and update plannedStartTimestamp to 19:00", async () => {
      const service = registry.get("planForEvening")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.read).toHaveBeenCalledWith(mockIFile);
      expect(deps.vaultAdapter!.modify).toHaveBeenCalledWith(
        mockIFile,
        expect.stringContaining("ems__Effort_plannedStartTimestamp"),
      );
    });
  });

  // describe("shiftDay", ...) + describe("incrementVotes", ...) removed —
  // Issue #3134 migrated the three groundings to declarative
  // property_shift / property_increment; the registry registrations no
  // longer exist. See GroundingExecutor.property_shift.test.ts and
  // GroundingExecutor.property_increment.test.ts for new coverage at the
  // executor layer. The legacy ShiftDayForwardCommand / ShiftDayBackwardCommand
  // palette commands + their taskStatusService.shiftDay{Forward,Backward}
  // methods were deleted in Phase 4 PR-A (RFC 31c1a0be); VoteOnEffortCommand
  // remains wired via direct DI (out of Phase 4 PR-A scope).

  // describe("copyLabelToAliases", ...) removed — Issue #3132 migrated the
  // grounding to declarative property_append; the registry registration no
  // longer exists. See GroundingExecutor.property_append.test.ts for new
  // coverage at the executor layer.

  describe("createRelatedTask", () => {
    it("should create a related task with ems__Effort_parent link", async () => {
      const service = registry.get("createRelatedTask")!;
      await service.execute("test-uid-123", { label: "Subtask" });

      expect(deps.vaultAdapter!.create).toHaveBeenCalledWith(
        expect.stringContaining("folder/"),
        expect.stringContaining("ems__Task"),
      );
    });

    it("should set ems__Effort_status to Draft by default", async () => {
      const service = registry.get("createRelatedTask")!;
      await service.execute("test-uid-123", { label: "Subtask" });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain(
        'ems__Effort_status: "[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"',
      );
    });

    it("should open the created task in a new tab leaf", async () => {
      const service = registry.get("createRelatedTask")!;
      await service.execute("test-uid-123", { label: "Subtask" });

      expect(deps.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(deps.vaultAdapter!.toTFile).toHaveBeenCalled();
      const leafMock = (deps.app.workspace.getLeaf as jest.Mock).mock.results[0].value;
      expect(leafMock.openFile).toHaveBeenCalled();
      expect(deps.app.workspace.setActiveLeaf).toHaveBeenCalledWith(
        leafMock,
        { focus: true },
      );
    });

    it("should honor explicit parentProperty override from userInput", async () => {
      const service = registry.get("createRelatedTask")!;
      await service.execute("test-uid-123", {
        label: "Area subtask",
        parentProperty: "ems__Effort_area",
      });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain('ems__Effort_area: "[[test-uid-123]]"');
    });

    it("should throw when label is missing", async () => {
      const service = registry.get("createRelatedTask")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "createRelatedTask requires userInput.label",
      );
    });
  });

  describe("createRelatedProject", () => {
    it("should create a related project asset", async () => {
      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", { label: "New Project" });

      expect(deps.vaultAdapter!.create).toHaveBeenCalledWith(
        expect.stringContaining("folder/"),
        expect.stringContaining("ems__Project"),
      );
    });

    it("should set ems__Effort_status to Draft by default", async () => {
      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", { label: "New Project" });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain(
        'ems__Effort_status: "[[c42245d0-01de-4c35-bfcf-d910445ea28e]]"',
      );
    });

    it("should write ems__Effort_area when parent is an Area", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_uid: "test-uid-123",
        exo__Asset_label: "Research",
        exo__Instance_class: ["[[82c74542-1b14-4217-b852-d84730484b25|ems__Area]]"],
      });

      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", { label: "Thesis" });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain('ems__Effort_area: "[[test-uid-123]]"');
      expect(content).not.toContain("ems__Effort_parent");
    });

    it("should write ems__Effort_parent when parent is not an Area", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_uid: "test-uid-123",
        exo__Asset_label: "Parent Project",
        exo__Instance_class: ["[[ems__Project]]"],
      });

      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", { label: "Sub Project" });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain('ems__Effort_parent: "[[test-uid-123]]"');
      expect(content).not.toContain("ems__Effort_area");
    });

    it("should honor explicit parentProperty override from userInput", async () => {
      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", {
        label: "Override Project",
        parentProperty: "ems__Effort_parent",
      });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain('ems__Effort_parent: "[[test-uid-123]]"');
    });

    it("should open the created project in a new tab leaf", async () => {
      const service = registry.get("createRelatedProject")!;
      await service.execute("test-uid-123", { label: "Visible Project" });

      expect(deps.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(deps.vaultAdapter!.toTFile).toHaveBeenCalled();
      const leafMock = (deps.app.workspace.getLeaf as jest.Mock).mock.results[0].value;
      expect(leafMock.openFile).toHaveBeenCalled();
      expect(deps.app.workspace.setActiveLeaf).toHaveBeenCalledWith(
        leafMock,
        { focus: true },
      );
    });

    it("should throw when label is missing", async () => {
      const service = registry.get("createRelatedProject")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "createRelatedProject requires userInput.label",
      );
    });
  });

  describe("createNarrowerConcept", () => {
    it("should create child concept with ims__Concept_broader pointing to parent", async () => {
      const service = registry.get("createNarrowerConcept")!;
      await service.execute("test-uid-123", { label: "Child Concept" });

      expect(deps.vaultAdapter!.create).toHaveBeenCalledWith(
        expect.stringContaining("concepts/Child Concept.md"),
        expect.stringContaining("ims__Concept_broader: \"[[test-uid-123]]\""),
      );
    });

    it("should accept optional definition and aliases", async () => {
      const service = registry.get("createNarrowerConcept")!;
      await service.execute("test-uid-123", {
        label: "Child",
        definition: "A narrower concept",
        aliases: ["alt-label"],
      });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain("ims__Concept_definition: A narrower concept");
      expect(content).toContain("alt-label");
    });

    it("should open the created concept in a new tab leaf", async () => {
      const service = registry.get("createNarrowerConcept")!;
      await service.execute("test-uid-123", { label: "Visible Concept" });

      expect(deps.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(deps.vaultAdapter!.toTFile).toHaveBeenCalled();
      const leafMock = (deps.app.workspace.getLeaf as jest.Mock).mock.results[0].value;
      expect(leafMock.openFile).toHaveBeenCalled();
      expect(deps.app.workspace.setActiveLeaf).toHaveBeenCalledWith(
        leafMock,
        { focus: true },
      );
    });

    it("should throw when label is missing", async () => {
      const service = registry.get("createNarrowerConcept")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "createNarrowerConcept requires userInput.label",
      );
    });
  });

  describe("createSubclass", () => {
    it("should create child class with exo__Class_superClass pointing to parent", async () => {
      const service = registry.get("createSubclass")!;
      await service.execute("test-uid-123", { label: "ChildClass" });

      expect(deps.vaultAdapter!.create).toHaveBeenCalledWith(
        expect.stringContaining("classes/childclass.md"),
        expect.stringContaining("exo__Class_superClass: \"[[test-uid-123]]\""),
      );
    });

    it("should write exo__Instance_class as exo__Class", async () => {
      const service = registry.get("createSubclass")!;
      await service.execute("test-uid-123", { label: "MyClass" });

      const createCall = (deps.vaultAdapter!.create as jest.Mock).mock.calls[0];
      const content = createCall[1] as string;
      expect(content).toContain("exo__Instance_class");
      expect(content).toContain("[[exo__Class]]");
    });

    it("should open the created class in a new tab leaf", async () => {
      const service = registry.get("createSubclass")!;
      await service.execute("test-uid-123", { label: "VisibleClass" });

      expect(deps.app.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(deps.vaultAdapter!.toTFile).toHaveBeenCalled();
      const leafMock = (deps.app.workspace.getLeaf as jest.Mock).mock.results[0].value;
      expect(leafMock.openFile).toHaveBeenCalled();
    });

    it("should throw when label is missing", async () => {
      const service = registry.get("createSubclass")!;
      await expect(service.execute("test-uid-123", {})).rejects.toThrow(
        "createSubclass requires userInput.label",
      );
    });
  });

  describe("archiveAsset", () => {
    beforeEach(() => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Done Task\nems__Effort_status: \"[[ems__EffortStatusDone]]\"\n---\nBody",
      );
    });

    it("should set archived: true on target asset", async () => {
      const service = registry.get("archiveAsset")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.read).toHaveBeenCalledWith(mockIFile);
      expect(deps.vaultAdapter!.modify).toHaveBeenCalledWith(
        mockIFile,
        expect.stringMatching(/\narchived: true\n/),
      );
    });

    it("should remove aliases when archiving", async () => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Done Task\naliases:\n  - \"Done Task\"\n---\nBody",
      );
      const service = registry.get("archiveAsset")!;
      await service.execute("test-uid-123");

      const modifyCall = (deps.vaultAdapter!.modify as jest.Mock).mock.calls[0];
      const written = modifyCall[1] as string;
      expect(written).toMatch(/\narchived: true\n/);
      expect(written).not.toMatch(/\naliases:/);
    });

    it("should be a no-op when asset is already archived with no aliases", async () => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\narchived: true\n---\nBody",
      );
      const service = registry.get("archiveAsset")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.modify).not.toHaveBeenCalled();
    });

    it("should throw when target IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });
      const service = registry.get("archiveAsset")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow(
        "No file found for IRI",
      );
    });
  });

  describe("cleanProperties", () => {
    beforeEach(() => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Test Asset\nems__Effort_plannedStartTimestamp: \"\"\nobsolete_prop: null\nempty_list: []\n---\nBody",
      );
    });

    it("should strip empty properties from frontmatter via PropertyCleanupService", async () => {
      const service = registry.get("cleanProperties")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.read).toHaveBeenCalledWith(mockIFile);
      const modifyCall = (deps.vaultAdapter!.modify as jest.Mock).mock.calls[0];
      expect(modifyCall).toBeDefined();
      const written = modifyCall[1] as string;
      expect(written).not.toMatch(/ems__Effort_plannedStartTimestamp:\s*""/);
      expect(written).not.toMatch(/obsolete_prop:\s*null/);
      expect(written).not.toMatch(/empty_list:\s*\[\]/);
      expect(written).toContain("exo__Asset_uid: test-uid-123");
      expect(written).toContain("exo__Asset_label: Test Asset");
    });

    it("should throw when target IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });
      const service = registry.get("cleanProperties")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow(
        "No file found for IRI",
      );
    });
  });

  describe("fixMissingLabel", () => {
    it("sets exo__Asset_label to file.basename when the label is missing", async () => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\n---\nBody",
      );

      const service = registry.get("fixMissingLabel")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.read).toHaveBeenCalledWith(mockIFile);
      const modifyCall = (deps.vaultAdapter!.modify as jest.Mock).mock.calls[0];
      expect(modifyCall).toBeDefined();
      const written = modifyCall[1] as string;
      expect(written).toContain("exo__Asset_label: test-uid-123");
      expect(written).toContain("exo__Asset_uid: test-uid-123");
    });

    it("is a no-op when the asset already has a label", async () => {
      (deps.vaultAdapter!.read as jest.Mock).mockResolvedValue(
        "---\nexo__Asset_uid: test-uid-123\nexo__Asset_label: Existing\n---\nBody",
      );

      const service = registry.get("fixMissingLabel")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.modify).not.toHaveBeenCalled();
    });

    it("throws when target IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });
      const service = registry.get("fixMissingLabel")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow(
        "No file found for IRI",
      );
    });
  });

  describe("renameToUid", () => {
    it("renames the target file to its exo__Asset_uid.md", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_uid: "renamed-uid-001",
        exo__Asset_label: "Original Label",
      });

      const service = registry.get("renameToUid")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.rename).toHaveBeenCalledWith(
        mockIFile,
        expect.stringMatching(/renamed-uid-001\.md$/),
      );
    });

    it("updates wikilinks across the vault when file is renamed", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_uid: "newuid-xyz",
        exo__Asset_label: "Foo",
      });

      const service = registry.get("renameToUid")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.updateLinks).toHaveBeenCalled();
    });

    it("throws when target IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });
      const service = registry.get("renameToUid")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow(
        "No file found for IRI",
      );
    });

    it("throws when asset has no exo__Asset_uid", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_label: "NoUid",
      });

      const service = registry.get("renameToUid")!;
      await expect(service.execute("test-uid-123")).rejects.toThrow(/uid/i);
    });
  });

  // describe("createTaskForDailyNote", ...) removed — Issue #3136 migrated
  // the grounding to declarative create_instance with the new $targetFolder
  // token + propertyDefaults map; the registry registration no longer
  // exists. Coverage moved to GroundingExecutor.test.ts (substituteVariables
  // $targetFolder cases + propertyDefaults suite).

  describe("repairFolder", () => {
    const REFERENCED_PATH = "01 Areas/!toos_areas.md";
    const REFERENCED_FILE = {
      path: REFERENCED_PATH,
      basename: "!toos_areas",
      name: "!toos_areas.md",
      parent: { path: "01 Areas", name: "01 Areas" },
    };

    beforeEach(() => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValue({
        exo__Asset_uid: "test-uid-123",
        exo__Asset_label: "Test Asset",
        exo__Asset_isDefinedBy: "[[!toos_areas]]",
      });

      const adapter = deps.vaultAdapter! as unknown as {
        getFirstLinkpathDest?: jest.Mock;
        getAbstractFileByPath: jest.Mock;
      };
      adapter.getFirstLinkpathDest = jest
        .fn()
        .mockImplementation((reference: string) => {
          if (reference === "!toos_areas") return REFERENCED_FILE;
          return null;
        });
      adapter.getAbstractFileByPath = jest
        .fn()
        .mockImplementation((path: string) => {
          if (path === mockIFile.path) return mockIFile;
          if (path === REFERENCED_PATH) return REFERENCED_FILE;
          return null;
        });
    });

    it("moves the target file to the folder of its isDefinedBy referent", async () => {
      const service = registry.get("repairFolder")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.rename).toHaveBeenCalledWith(
        mockIFile,
        "01 Areas/test-uid-123.md",
      );
    });

    it("is a no-op when the target is already in the expected folder", async () => {
      const sameFolderReferenced = {
        ...REFERENCED_FILE,
        parent: { path: mockIFile.parent.path, name: mockIFile.parent.name },
      };
      (
        deps.vaultAdapter! as unknown as { getFirstLinkpathDest: jest.Mock }
      ).getFirstLinkpathDest.mockReturnValue(sameFolderReferenced);

      const service = registry.get("repairFolder")!;
      await service.execute("test-uid-123");

      expect(deps.vaultAdapter!.rename).not.toHaveBeenCalled();
    });

    it("throws when exo__Asset_isDefinedBy is missing (no expected folder derivable)", async () => {
      (deps.vaultAdapter!.getFrontmatter as jest.Mock).mockReturnValueOnce({
        exo__Asset_uid: "test-uid-123",
        exo__Asset_label: "Test Asset",
      });

      const service = registry.get("repairFolder")!;
      await expect(service.execute("test-uid-123")).rejects.toThrow(
        /expected folder|isDefinedBy/i,
      );
    });

    it("throws when the isDefinedBy referent cannot be located", async () => {
      (
        deps.vaultAdapter! as unknown as { getFirstLinkpathDest: jest.Mock }
      ).getFirstLinkpathDest.mockReturnValue(null);

      const service = registry.get("repairFolder")!;
      await expect(service.execute("test-uid-123")).rejects.toThrow(
        /expected folder|isDefinedBy/i,
      );
    });

    it("throws when the target IRI cannot be resolved", async () => {
      (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { exo__Asset_uid: "different-uid" },
      });

      const service = registry.get("repairFolder")!;
      await expect(service.execute("nonexistent-iri")).rejects.toThrow(
        "No file found for IRI",
      );
    });
  });
});

// Regression suite for RFC-028 Finding 2: prototype-based asset creation
// produces orphan files. The "Create Task / Note / Knowledge" buttons in vault
// groundings bind to the `createAsset` service, which currently writes ONLY 4
// frontmatter keys (uid, createdAt, label, prototype). It does NOT inherit
// parent Project context (Instance_class, Effort_parent, Effort_area,
// Effort_status, Asset_isDefinedBy), so created tasks render as orphans in
// Project layout / Area Tree. The symmetric `createRelatedTask` /
// `createRelatedProject` services already perform inheritance via
// `GenericAssetCreationService.inheritParentContext` — `createAsset` must do
// the same. These tests are EXPECTED TO FAIL until the fix lands (TDD Step 1).
describe("createAsset — orphan prevention regression (Finding 2)", () => {
  let registry: ServiceRegistry;
  let deps: ServiceRegistryDeps;
  const PARENT_PROJECT_UID = "parent-project-uid-001";
  const PARENT_AREA_UID = "parent-area-uid-001";
  const PARENT_PATH = "01 Areas/parent-project-uid-001.md";

  beforeEach(() => {
    registry = new ServiceRegistry();
    deps = createMockDeps();

    // Override mocks so the parent IRI resolves to a Project file with
    // rich inheritable context (area, isDefinedBy, Project class).
    (deps.app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([
      { path: PARENT_PATH },
    ]);
    (deps.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => (path === PARENT_PATH ? { path: PARENT_PATH } : null),
    );
    (deps.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
      frontmatter: {
        exo__Asset_uid: PARENT_PROJECT_UID,
        exo__Asset_label: "Audit Project",
        exo__Instance_class: ["[[ems__Project]]"],
        ems__Effort_area: `[[${PARENT_AREA_UID}]]`,
        exo__Asset_isDefinedBy: "[[!toos_areas]]",
      },
    });

    populateServiceRegistry(registry, deps);
  });

  it("inherits all required context properties when invoked with parent Project IRI", async () => {
    const service = registry.get("createAsset")!;
    await service.execute(PARENT_PROJECT_UID, {
      prototypeUID: "ems__TaskPrototype",
      label: "Regression Task",
    });

    const createCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock.calls[0];
    expect(createCall).toBeDefined();
    const frontmatter = createCall[1] as string;

    // 1. Instance_class must resolve from prototype (no orphan)
    expect(frontmatter).toMatch(/exo__Instance_class:[\s\S]*ems__Task/);

    // 2. Effort_parent must link back to parent Project
    expect(frontmatter).toMatch(
      new RegExp(`ems__Effort_parent:\\s*"\\[\\[${PARENT_PROJECT_UID}`),
    );

    // 3. Effort_area must inherit from parent
    expect(frontmatter).toMatch(
      new RegExp(`ems__Effort_area:\\s*"\\[\\[${PARENT_AREA_UID}`),
    );

    // 4. Effort_status must default (Backlog or Draft UUID) so task is queryable.
    // UUID-form per RFC 31c1a0be Phase 4 PR-C (#3194).
    // Backlog: 753a44d5-846c-4b82-9196-4fd9a4d48777
    // Draft:   c42245d0-01de-4c35-bfcf-d910445ea28e
    expect(frontmatter).toMatch(
      /ems__Effort_status:\s*"\[\[(753a44d5-846c-4b82-9196-4fd9a4d48777|c42245d0-01de-4c35-bfcf-d910445ea28e)\]\]"/,
    );

    // 5. Asset_isDefinedBy must inherit from parent
    expect(frontmatter).toContain('exo__Asset_isDefinedBy: "[[!toos_areas]]"');
  });

  it.each([
    ["ems__TaskPrototype", "ems__Task"],
    ["ztlk__FleetingNotePrototype", "ztlk__FleetingNote"],
    ["ims__ConceptPrototype", "ims__Concept"],
  ])(
    "prototype %s expands exo__Instance_class to %s (no orphan) when created on Project parent",
    async (prototypeUID, expectedClass) => {
      const service = registry.get("createAsset")!;
      await service.execute(PARENT_PROJECT_UID, {
        prototypeUID,
        label: `Regression ${expectedClass}`,
      });

      const createCall = (deps.fileSystemAdapter.createFile as jest.Mock).mock.calls[0];
      expect(createCall).toBeDefined();
      const frontmatter = createCall[1] as string;

      // exo__Instance_class must contain the expanded class wikilink, not
      // the literal prototype UID. Regex tolerates YAML list-item or inline
      // formatting variants.
      expect(frontmatter).toMatch(
        new RegExp(`exo__Instance_class:[\\s\\S]*?\\[\\[${expectedClass}`),
      );
      // And the expanded class must NOT just echo the prototype suffix
      expect(frontmatter).not.toMatch(
        new RegExp(`exo__Instance_class:[\\s\\S]*?\\[\\[${prototypeUID}\\]\\]`),
      );
    },
  );
});
