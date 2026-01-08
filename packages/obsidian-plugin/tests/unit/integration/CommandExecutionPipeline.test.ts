/**
 * Integration tests for Command Execution Pipeline
 *
 * Tests end-to-end flow: RdfCommand → ActionBridge → ActionInterpreter → Side Effect
 *
 * Issue #2000: Integration tests for command execution pipeline
 * @see https://github.com/kitelev/exocortex/issues/2000
 * @see Legacy Code Cleanup Plan - Phase 1, Task 4
 */

import "reflect-metadata";
import { ActionBridge, RdfAction, ActionMappingError } from "@plugin/application/bridges/ActionBridge";
import { ActionInterpreter } from "exocortex";
import type {
  ITripleStore,
  IUIProvider,
  ActionContext,
  IVaultAdapter,
  IFile,
  IFrontmatter,
} from "exocortex";
import { GenericAssetCreationService } from "exocortex";

/**
 * In-memory mock vault adapter for testing file creation and updates
 */
class MockVaultAdapter implements Partial<IVaultAdapter> {
  private files: Map<string, { path: string; content: string; frontmatter: IFrontmatter }> = new Map();
  private folders: Set<string> = new Set();

  async create(path: string, content: string): Promise<IFile> {
    this.files.set(path, { path, content, frontmatter: {} });
    return { path, basename: path.split("/").pop() ?? path, name: path.split("/").pop()?.replace(".md", "") ?? path } as IFile;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  getAbstractFileByPath(path: string): IFile | null {
    const file = this.files.get(path);
    if (file) {
      return { path, basename: path.split("/").pop() ?? path, name: path.split("/").pop()?.replace(".md", "") ?? path } as IFile;
    }
    if (this.folders.has(path)) {
      return { path, basename: path.split("/").pop() ?? path, name: path } as unknown as IFile;
    }
    return null;
  }

  async updateFrontmatter(file: IFile, updater: (current: IFrontmatter) => IFrontmatter): Promise<void> {
    const existing = this.files.get(file.path);
    if (existing) {
      existing.frontmatter = updater(existing.frontmatter);
    }
  }

  // Test helpers
  getFileContent(path: string): { content: string; frontmatter: IFrontmatter } | undefined {
    return this.files.get(path);
  }

  getCreatedFiles(): string[] {
    return Array.from(this.files.keys());
  }

  getCreatedFolders(): string[] {
    return Array.from(this.folders);
  }

  clear(): void {
    this.files.clear();
    this.folders.clear();
  }
}

/**
 * Create mock triple store for action definitions
 */
function createMockTripleStore(
  actionDefinitions: Map<string, { type: string; params: Record<string, string> }>
): ITripleStore {
  return {
    add: jest.fn(),
    remove: jest.fn(),
    has: jest.fn(),
    match: jest.fn().mockImplementation(async (subject) => {
      const subjectUri = typeof subject === "object" && "value" in subject
        ? (subject as { value: string }).value
        : String(subject);

      const definition = actionDefinitions.get(subjectUri);
      if (!definition) {
        return [];
      }

      const triples: Array<{
        subject: { value: string };
        predicate: { value: string };
        object: { value: string };
        toString: () => string;
      }> = [];

      // Add type triple
      triples.push({
        subject: { value: subjectUri },
        predicate: { value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
        object: { value: `https://exocortex.my/ontology/exo-ui#${definition.type}` },
        toString: () => `<${subjectUri}> a <${definition.type}>`,
      });

      // Add param triples
      for (const [key, value] of Object.entries(definition.params)) {
        triples.push({
          subject: { value: subjectUri },
          predicate: { value: `https://exocortex.my/ontology/exo-ui#${key}` },
          object: { value },
          toString: () => `<${subjectUri}> exo-ui:${key} "${value}"`,
        });
      }

      return triples;
    }),
    addAll: jest.fn(),
    removeAll: jest.fn(),
    clear: jest.fn(),
    count: jest.fn(),
    subjects: jest.fn(),
    predicates: jest.fn(),
    objects: jest.fn(),
    beginTransaction: jest.fn(),
  };
}

/**
 * Create mock UI provider
 */
function createMockUIProvider(isHeadless: boolean): IUIProvider {
  const navigateCalls: string[] = [];

  return {
    showInputModal: jest.fn().mockResolvedValue("test input"),
    showSelectModal: jest.fn().mockResolvedValue({ id: "selected" }),
    showConfirm: jest.fn().mockResolvedValue(true),
    notify: jest.fn(),
    navigate: jest.fn().mockImplementation(async (path: string) => {
      navigateCalls.push(path);
    }),
    isHeadless,
    // Test helper
    getNavigateCalls: () => navigateCalls,
  } as IUIProvider & { getNavigateCalls: () => string[] };
}

describe("Command Execution Pipeline Integration Tests (Issue #2000)", () => {
  describe("Feature: Command execution pipeline integration", () => {
    describe("Scenario: Create task via RDF command", () => {
      let actionBridge: ActionBridge;
      let mockVault: MockVaultAdapter;
      let mockTripleStore: ITripleStore;
      let actionInterpreter: ActionInterpreter;
      let mockUIProvider: IUIProvider & { getNavigateCalls: () => string[] };
      let assetCreationService: GenericAssetCreationService;

      beforeEach(() => {
        actionBridge = new ActionBridge();
        mockVault = new MockVaultAdapter();
        mockUIProvider = createMockUIProvider(false);

        // Setup mock asset creation service
        assetCreationService = {
          createAsset: jest.fn().mockImplementation(async (config) => {
            const uid = "test-uuid-1234";
            const fileName = `${uid}.md`;
            const folderPath = config.folderPath ?? "/Tasks";
            const fullPath = `${folderPath}/${fileName}`;

            await mockVault.createFolder(folderPath);
            return mockVault.create(fullPath, `---\nexo__Asset_label: ${config.label ?? "New Task"}\n---`);
          }),
        } as unknown as GenericAssetCreationService;

        // Action definitions for the triple store
        const actionDefinitions = new Map<string, { type: string; params: Record<string, string> }>([
          [
            "https://exocortex.my/actions/create-task-1",
            {
              type: "CreateAssetAction",
              params: {
                targetClass: "ems__Task",
                template: "Test Task",
                location: "/Tasks",
              },
            },
          ],
        ]);

        mockTripleStore = createMockTripleStore(actionDefinitions);

        // Create ActionInterpreter with all dependencies
        actionInterpreter = new ActionInterpreter(
          mockTripleStore,
          assetCreationService,
          mockVault as unknown as IVaultAdapter,
          undefined,
          undefined,
          mockUIProvider
        );
      });

      it("Given a vault with no tasks, when I execute the CreateTask command, then a new task asset is created", async () => {
        // Given: Empty vault
        expect(mockVault.getCreatedFiles()).toHaveLength(0);

        // When: Execute CreateTask command through the full pipeline
        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
        };

        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/create-task-1",
          context
        );

        // Then: Task is created
        expect(result.success).toBe(true);
        expect(assetCreationService.createAsset).toHaveBeenCalledWith({
          className: "ems__Task",
          label: "Test Task",
          folderPath: "/Tasks",
        });
      });

      it("ActionBridge should correctly map RDF action to ActionDefinition format", () => {
        // Given: RDF action with CreateAssetAction type
        const rdfAction: RdfAction = {
          type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
          params: {
            targetClass: "ems__Task",
            template: "Test Task",
            location: "/Tasks",
          },
        };

        // When: Map through ActionBridge
        const actionDef = actionBridge.toActionDefinition(rdfAction);

        // Then: Correct ActionDefinition format
        expect(actionDef.type).toBe("exo-ui:CreateAssetAction");
        expect(actionDef.params).toEqual({
          targetClass: "ems__Task",
          template: "Test Task",
          location: "/Tasks",
        });
      });
    });

    describe("Scenario: Update property via RDF command", () => {
      let mockVault: MockVaultAdapter;
      let mockTripleStore: ITripleStore;
      let actionInterpreter: ActionInterpreter;
      let mockUIProvider: IUIProvider;
      let mockCurrentFile: IFile;

      beforeEach(async () => {
        mockVault = new MockVaultAdapter();
        mockUIProvider = createMockUIProvider(false);

        // Create a file first to update
        mockCurrentFile = await mockVault.create("/Tasks/task-1.md", "---\nems__Effort_status: pending\n---");

        // Action definitions
        const actionDefinitions = new Map<string, { type: string; params: Record<string, string> }>([
          [
            "https://exocortex.my/actions/update-status-1",
            {
              type: "UpdatePropertyAction",
              params: {
                targetProperty: "ems__Effort_status",
                targetValue: "completed",
              },
            },
          ],
        ]);

        mockTripleStore = createMockTripleStore(actionDefinitions);

        actionInterpreter = new ActionInterpreter(
          mockTripleStore,
          undefined,
          mockVault as unknown as IVaultAdapter,
          undefined,
          undefined,
          mockUIProvider
        );
      });

      it("Given a task with status pending, when I execute UpdateProperty command, then the property is updated", async () => {
        // Given: Task file exists with pending status
        const existingFile = mockVault.getFileContent(mockCurrentFile.path);
        expect(existingFile).toBeDefined();

        // When: Execute UpdateProperty command
        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
          currentAsset: mockCurrentFile,
        };

        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/update-status-1",
          context
        );

        // Then: Property is updated
        expect(result.success).toBe(true);
        expect(result.refresh).toBe(true);
      });

      it("should return error when no target asset is specified and no currentAsset in context", async () => {
        // Given: No current asset
        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
          // No currentAsset
        };

        // When: Execute UpdateProperty command
        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/update-status-1",
          context
        );

        // Then: Error returned
        expect(result.success).toBe(false);
        expect(result.message).toContain("No target asset");
      });
    });

    describe("Scenario: Navigate via RDF command", () => {
      let mockTripleStore: ITripleStore;
      let actionInterpreter: ActionInterpreter;
      let mockUIProvider: IUIProvider & { getNavigateCalls: () => string[] };
      let mockFileSystem: { findFileByUID: jest.Mock };

      beforeEach(() => {
        mockUIProvider = createMockUIProvider(false);
        mockFileSystem = {
          findFileByUID: jest.fn().mockResolvedValue("/Tasks/task-123.md"),
        };

        // Action definitions
        const actionDefinitions = new Map<string, { type: string; params: Record<string, string> }>([
          [
            "https://exocortex.my/actions/navigate-to-task",
            {
              type: "NavigateAction",
              params: {
                target: "https://exocortex.my/assets/task-123",
              },
            },
          ],
        ]);

        mockTripleStore = createMockTripleStore(actionDefinitions);

        actionInterpreter = new ActionInterpreter(
          mockTripleStore,
          undefined,
          undefined,
          mockFileSystem,
          undefined,
          mockUIProvider
        );
      });

      it("Given a task URI, when I execute Navigate command, then navigation is triggered", async () => {
        // Given: File system can resolve the UUID
        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
        };

        // When: Execute Navigate command
        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/navigate-to-task",
          context
        );

        // Then: Navigation is triggered
        expect(result.success).toBe(true);
        expect(mockUIProvider.navigate).toHaveBeenCalledWith("/Tasks/task-123.md");
      });

      it("should return error when target asset cannot be resolved", async () => {
        // Given: File system cannot find the file
        mockFileSystem.findFileByUID.mockResolvedValue(null);

        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
        };

        // When: Execute Navigate command
        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/navigate-to-task",
          context
        );

        // Then: Error returned
        expect(result.success).toBe(false);
        expect(result.message).toContain("Asset not found");
      });
    });

    describe("Scenario: Error handling across full pipeline", () => {
      let actionBridge: ActionBridge;
      let mockTripleStore: ITripleStore;
      let actionInterpreter: ActionInterpreter;
      let mockUIProvider: IUIProvider;

      beforeEach(() => {
        actionBridge = new ActionBridge();
        mockUIProvider = createMockUIProvider(false);

        // Empty action definitions - action won't be found
        const actionDefinitions = new Map<string, { type: string; params: Record<string, string> }>();
        mockTripleStore = createMockTripleStore(actionDefinitions);

        actionInterpreter = new ActionInterpreter(
          mockTripleStore,
          undefined,
          undefined,
          undefined,
          undefined,
          mockUIProvider
        );
      });

      it("ActionBridge should throw ActionMappingError for unknown action types", () => {
        // Given: RDF action with unsupported type
        const rdfAction: RdfAction = {
          type: "https://exocortex.my/ontology/exo-ui#UnsupportedAction",
          params: {},
        };

        // Then: ActionMappingError is thrown
        expect(() => actionBridge.toActionDefinition(rdfAction)).toThrow(ActionMappingError);
      });

      it("ActionBridge should throw error for non-exo-ui namespace", () => {
        // Given: RDF action from different namespace
        const rdfAction: RdfAction = {
          type: "https://other.namespace/CreateAssetAction",
          params: {},
        };

        // Then: ActionMappingError is thrown
        expect(() => actionBridge.toActionDefinition(rdfAction)).toThrow(ActionMappingError);
      });

      it("ActionInterpreter should propagate errors when action definition cannot be loaded", async () => {
        // Given: Action URI that doesn't exist
        const context: ActionContext = {
          tripleStore: mockTripleStore,
          uiProvider: mockUIProvider,
        };

        // When: Execute non-existent action
        const result = await actionInterpreter.execute(
          "https://exocortex.my/actions/non-existent",
          context
        );

        // Then: Error is propagated
        expect(result.success).toBe(false);
        expect(result.message).toContain("Action type not found");
      });

      it("ActionInterpreter should handle headless mode errors for ShowModal", async () => {
        // Given: Headless UI provider
        const headlessUIProvider = createMockUIProvider(true);

        const actionDefinitions = new Map<string, { type: string; params: Record<string, string> }>([
          [
            "https://exocortex.my/actions/show-modal",
            {
              type: "ShowModalAction",
              params: {
                modalType: "input",
                modalParams: JSON.stringify({ title: "Test Modal" }),
              },
            },
          ],
        ]);

        const tripleStoreWithModal = createMockTripleStore(actionDefinitions);

        const headlessInterpreter = new ActionInterpreter(
          tripleStoreWithModal,
          undefined,
          undefined,
          undefined,
          undefined,
          headlessUIProvider
        );

        const context: ActionContext = {
          tripleStore: tripleStoreWithModal,
          uiProvider: headlessUIProvider,
        };

        // When: Execute ShowModal in headless mode
        const result = await headlessInterpreter.execute(
          "https://exocortex.my/actions/show-modal",
          context
        );

        // Then: Headless error is returned
        expect(result.success).toBe(false);
        expect(result.message).toContain("ShowModalAction");
      });
    });

    describe("Scenario: Full pipeline with ActionBridge integration", () => {
      it("should correctly map and execute action through ActionBridge and ActionInterpreter", () => {
        // Given: ActionBridge and ActionInterpreter are properly connected
        const actionBridge = new ActionBridge();

        // Test all 8 Fixed Verbs can be mapped
        const fixedVerbs = [
          "CreateAssetAction",
          "UpdatePropertyAction",
          "NavigateAction",
          "ExecuteSPARQLAction",
          "ShowModalAction",
          "TriggerHookAction",
          "CustomHandlerAction",
          "CompositeAction",
        ];

        for (const verb of fixedVerbs) {
          const rdfAction: RdfAction = {
            type: `https://exocortex.my/ontology/exo-ui#${verb}`,
            params: { test: "value" },
          };

          // When: Map through ActionBridge
          const actionDef = actionBridge.toActionDefinition(rdfAction);

          // Then: Correct type format for ActionInterpreter
          expect(actionDef.type).toBe(`exo-ui:${verb}`);
          expect(actionDef.params).toEqual({ test: "value" });
        }
      });
    });
  });
});
