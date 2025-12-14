import { DailyTasksRenderer } from "../../../../src/presentation/renderers/DailyTasksRenderer";
import { TFile, Keymap } from "obsidian";
import { ExocortexSettings } from "../../../../src/domain/settings/ExocortexSettings";
import { ILogger } from "../../../../src/infrastructure/logging/ILogger";
import { MetadataExtractor, IVaultAdapter } from "exocortex";
import { ReactRenderer } from "../../../../src/presentation/utils/ReactRenderer";
import { AssetMetadataService } from "../../../../src/presentation/renderers/layout/helpers/AssetMetadataService";

jest.mock("obsidian", () => ({
  ...jest.requireActual("obsidian"),
  Keymap: {
    isModEvent: jest.fn(),
  },
}));

export { Keymap };

export interface DailyTasksRendererTestContext {
  renderer: DailyTasksRenderer;
  mockApp: any;
  mockSettings: ExocortexSettings;
  mockPlugin: any;
  mockLogger: jest.Mocked<ILogger>;
  mockMetadataExtractor: jest.Mocked<MetadataExtractor>;
  mockReactRenderer: jest.Mocked<ReactRenderer>;
  mockRefresh: jest.Mock;
  mockMetadataService: jest.Mocked<AssetMetadataService>;
  mockVaultAdapter: jest.Mocked<IVaultAdapter>;
}

export const createMockElement = (): any => {
  const el: any = document.createElement("div");
  el.createDiv = (opts?: any) => {
    const div: any = document.createElement("div");
    if (opts?.cls) div.className = opts.cls;
    el.appendChild(div);
    div.createEl = (tag: string, opts?: any) => {
      const element = document.createElement(tag);
      if (opts?.cls) element.className = opts.cls;
      if (opts?.text) element.textContent = opts.text;
      div.appendChild(element);
      return element;
    };
    div.createDiv = el.createDiv;
    div.createSpan = (opts?: any) => {
      const span = document.createElement("span");
      if (opts?.text) span.textContent = opts.text;
      div.appendChild(span);
      return span;
    };
    return div;
  };
  return el;
};

export const setupDailyTasksRendererTest = (): DailyTasksRendererTestContext => {
  const mockApp: any = {
    vault: {
      getMarkdownFiles: jest.fn().mockReturnValue([]),
    },
    metadataCache: {
      getFileCache: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
    },
    workspace: {
      getLeaf: jest.fn().mockReturnValue({
        openLinkText: jest.fn(),
      }),
      openLinkText: jest.fn(),
    },
  };

  const mockSettings = {
    activeFocusArea: null,
    showEffortArea: true,
    showEffortVotes: true,
  } as ExocortexSettings;

  const mockPlugin = {
    saveSettings: jest.fn(),
  };

  const mockLogger: jest.Mocked<ILogger> = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as any;

  const mockMetadataExtractor: jest.Mocked<MetadataExtractor> = {
    extractMetadata: jest.fn(),
    extractInstanceClass: jest.fn(),
    extractStatus: jest.fn(),
    extractIsArchived: jest.fn(),
  } as any;

  const mockReactRenderer: jest.Mocked<ReactRenderer> = {
    render: jest.fn(),
    unmount: jest.fn(),
  } as any;

  const mockRefresh = jest.fn();

  const realMetadataService = new AssetMetadataService(mockApp);

  const mockMetadataService: jest.Mocked<AssetMetadataService> = {
    getAssetLabel: jest.fn((path) => realMetadataService.getAssetLabel(path)),
    extractFirstValue: jest.fn((value) =>
      realMetadataService.extractFirstValue(value),
    ),
    getEffortArea: jest.fn((metadata, visited) =>
      realMetadataService.getEffortArea(metadata, visited),
    ),
    extractInstanceClass: jest.fn((metadata) =>
      realMetadataService.extractInstanceClass(metadata),
    ),
  } as any;

  const mockVaultAdapter: jest.Mocked<IVaultAdapter> = {
    getAllFiles: jest.fn().mockReturnValue([]),
    read: jest.fn(),
    create: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    getFrontmatter: jest.fn().mockReturnValue({}),
    updateFrontmatter: jest.fn(),
    rename: jest.fn(),
    createFolder: jest.fn(),
    getFirstLinkpathDest: jest.fn(),
    process: jest.fn(),
    getDefaultNewFileParent: jest.fn(),
    updateLinks: jest.fn(),
  } as any;

  const renderer = new DailyTasksRenderer(
    mockApp,
    mockSettings,
    mockPlugin,
    mockLogger,
    mockMetadataExtractor,
    mockReactRenderer,
    mockRefresh,
    mockMetadataService,
    mockVaultAdapter,
  );

  return {
    renderer,
    mockApp,
    mockSettings,
    mockPlugin,
    mockLogger,
    mockMetadataExtractor,
    mockReactRenderer,
    mockRefresh,
    mockMetadataService,
    mockVaultAdapter,
  };
};

export { TFile };
