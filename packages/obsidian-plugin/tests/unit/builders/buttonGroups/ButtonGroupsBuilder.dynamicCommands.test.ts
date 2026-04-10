import {
  ButtonGroupsBuilder,
  ButtonGroupsBuilderConfig,
} from "../../../../src/presentation/builders/ButtonGroupsBuilder";
import { TFile } from "obsidian";
import { ExocortexSettings } from "../../../../src/domain/settings/ExocortexSettings";
import {
  FolderRepairService,
  MetadataExtractor,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
} from "exocortex";
import { ILogger } from "../../../../src/infrastructure/logging/ILogger";

function createMinimalConfig(
  overrides?: Partial<ButtonGroupsBuilderConfig>,
): ButtonGroupsBuilderConfig {
  const mockApp = {
    workspace: { getLeaf: jest.fn().mockReturnValue({ openFile: jest.fn() }) },
    vault: { read: jest.fn().mockResolvedValue("---\n---\n") },
  } as any;

  return {
    app: mockApp,
    settings: {} as ExocortexSettings,
    plugin: { saveSettings: jest.fn() } as any,
    folderRepairService: { getExpectedFolder: jest.fn(), repairFolder: jest.fn() } as any,
    metadataExtractor: {
      extractMetadata: jest.fn(),
      extractInstanceClass: jest.fn(),
      extractStatus: jest.fn(),
      extractIsArchived: jest.fn(),
    } as any,
    logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
    refresh: jest.fn(),
    ...overrides,
  };
}

describe("ButtonGroupsBuilder - dynamic commands (RFC-009)", () => {
  it("should NOT include dynamic-commands builder when services are omitted", async () => {
    const config = createMinimalConfig();
    const builder = new ButtonGroupsBuilder(config);

    const mockFile = { path: "test.md", parent: { path: "folder" }, basename: "test" } as TFile;
    config.metadataExtractor.extractMetadata = jest.fn().mockReturnValue({
      exo__Instance_class: "[[ems__Task]]",
    });
    config.metadataExtractor.extractInstanceClass = jest.fn().mockReturnValue("[[ems__Task]]");
    config.metadataExtractor.extractStatus = jest.fn().mockReturnValue(null);
    config.metadataExtractor.extractIsArchived = jest.fn().mockReturnValue(false);
    (config.folderRepairService.getExpectedFolder as jest.Mock).mockResolvedValue(null);

    const groups = await builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    expect(dynamicGroup).toBeUndefined();
  });

  it("should include dynamic-commands builder when RFC-009 services are provided", async () => {
    const mockCommandResolver = {
      resolveForAsset: jest.fn().mockResolvedValue([
        {
          command: {
            id: "test-cmd",
            name: "Test Command",
            precondition: { type: "always_true" },
            grounding: { type: "set_frontmatter_value", property: "status", value: "done" },
          },
          binding: {
            order: 0,
            group: "default",
          },
        },
      ]),
    };

    const mockPreconditionEvaluator = {
      evaluate: jest.fn().mockResolvedValue(true),
    };

    const mockGroundingExecutor = {
      execute: jest.fn().mockResolvedValue({ success: true }),
    };

    const config = createMinimalConfig({
      commandResolver: mockCommandResolver as unknown as CommandResolver,
      preconditionEvaluator: mockPreconditionEvaluator as unknown as PreconditionEvaluator,
      groundingExecutor: mockGroundingExecutor as unknown as GroundingExecutor,
      notificationService: { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), confirm: jest.fn() } as any,
    });

    const builder = new ButtonGroupsBuilder(config);

    const mockFile = { path: "test.md", parent: { path: "folder" }, basename: "test" } as TFile;
    config.metadataExtractor.extractMetadata = jest.fn().mockReturnValue({
      exo__Instance_class: "[[ems__Task]]",
      exo__Asset_uid: "urn:uuid:12345",
    });
    config.metadataExtractor.extractInstanceClass = jest.fn().mockReturnValue("[[ems__Task]]");
    config.metadataExtractor.extractStatus = jest.fn().mockReturnValue(null);
    config.metadataExtractor.extractIsArchived = jest.fn().mockReturnValue(false);
    (config.folderRepairService.getExpectedFolder as jest.Mock).mockResolvedValue(null);

    const groups = await builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    expect(dynamicGroup).toBeDefined();
    expect(dynamicGroup!.title).toBe("Commands");
  });

  it("should NOT include dynamic-commands builder when only partial services provided", async () => {
    const config = createMinimalConfig({
      commandResolver: { resolveForAsset: jest.fn() } as unknown as CommandResolver,
    });
    const builder = new ButtonGroupsBuilder(config);

    const mockFile = { path: "test.md", parent: { path: "folder" }, basename: "test" } as TFile;
    config.metadataExtractor.extractMetadata = jest.fn().mockReturnValue({
      exo__Instance_class: "[[ems__Task]]",
    });
    config.metadataExtractor.extractInstanceClass = jest.fn().mockReturnValue("[[ems__Task]]");
    config.metadataExtractor.extractStatus = jest.fn().mockReturnValue(null);
    config.metadataExtractor.extractIsArchived = jest.fn().mockReturnValue(false);
    (config.folderRepairService.getExpectedFolder as jest.Mock).mockResolvedValue(null);

    const groups = await builder.build(mockFile);
    const dynamicGroup = groups.find((g) => g.id === "dynamic-commands");
    expect(dynamicGroup).toBeUndefined();
  });
});
