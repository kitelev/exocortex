/**
 * Obsidian mock helpers for unit tests.
 *
 * @example
 * import { createMockApp, createMockPlugin, createMockTFile } from "@exocortex/test-utils";
 *
 * const mockApp = createMockApp();
 * const mockPlugin = createMockPlugin();
 * const mockFile = createMockTFile("path/to/file.md");
 */

import type { FileInfo, Metadata } from "../types";

/**
 * Create a mock TFile object.
 */
export function createMockTFile(
  path: string,
  overrides: Partial<{
    basename: string;
    name: string;
    extension: string;
    content: string;
    frontmatter: Metadata;
  }> = {}
): FileInfo & { stat: object; vault: null; parent: null; extension: string } {
  const basename = overrides.basename ?? path.split("/").pop()?.replace(/\.md$/, "") ?? "file";
  const name = overrides.name ?? `${basename}.md`;
  const extension = overrides.extension ?? "md";

  return {
    path,
    basename,
    name,
    extension,
    parent: null,
    vault: null,
    stat: {
      ctime: Date.now(),
      mtime: Date.now(),
      size: overrides.content?.length ?? 0,
    },
  };
}

/**
 * Mock element interface with Obsidian-style DOM methods.
 */
export interface MockObsidianElement {
  createDiv: jest.Mock;
  createEl: jest.Mock;
  createSpan: jest.Mock;
  empty: jest.Mock;
  appendChild: (node: Node) => Node;
  innerHTML: string;
  className: string;
  textContent: string | null;
  querySelector: (selector: string) => Element | null;
  querySelectorAll: (selector: string) => NodeListOf<Element>;
}

/**
 * Create a mock HTMLElement with Obsidian-specific methods.
 * Returns an any type for maximum compatibility with various test scenarios.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockElement(): any {
  const el = document.createElement("div");

  const createDivFn = jest.fn((opts?: { cls?: string; text?: string }) => {
    const div = document.createElement("div");
    if (opts?.cls) div.className = opts.cls;
    if (opts?.text) div.textContent = opts.text;
    el.appendChild(div);

    // Add nested methods
    (div as unknown as MockObsidianElement).createDiv = jest.fn(createDivFn);
    (div as unknown as MockObsidianElement).createEl = jest.fn((tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
      const element = document.createElement(tag);
      if (options?.cls) element.className = options.cls;
      if (options?.text) element.textContent = options.text;
      if (options?.attr) {
        Object.entries(options.attr).forEach(([key, value]) => {
          element.setAttribute(key, value);
        });
      }
      div.appendChild(element);
      return element;
    });
    (div as unknown as MockObsidianElement).createSpan = jest.fn((options?: { text?: string; cls?: string }) => {
      const span = document.createElement("span");
      if (options?.text) span.textContent = options.text;
      if (options?.cls) span.className = options.cls;
      div.appendChild(span);
      return span;
    });

    return div;
  });

  (el as unknown as MockObsidianElement).createDiv = createDivFn;

  (el as unknown as MockObsidianElement).createEl = jest.fn((tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) => {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    if (options?.attr) {
      Object.entries(options.attr).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
    }
    el.appendChild(element);
    return element;
  });

  (el as unknown as MockObsidianElement).createSpan = jest.fn((options?: { text?: string; cls?: string }) => {
    const span = document.createElement("span");
    if (options?.text) span.textContent = options.text;
    if (options?.cls) span.className = options.cls;
    el.appendChild(span);
    return span;
  });

  (el as unknown as MockObsidianElement).empty = jest.fn(() => {
    el.innerHTML = "";
  });

  return el;
}

/**
 * Create a mock Obsidian App object.
 */
export function createMockApp(overrides?: Partial<{
  vault: Partial<MockVault>;
  metadataCache: Partial<MockMetadataCache>;
  workspace: Partial<MockWorkspace>;
  fileManager: Partial<MockFileManager>;
}>): MockApp {
  return {
    vault: {
      getMarkdownFiles: jest.fn().mockReturnValue([]),
      getAbstractFileByPath: jest.fn(),
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      getFiles: jest.fn().mockReturnValue([]),
      getName: jest.fn().mockReturnValue("Test Vault"),
      ...overrides?.vault,
    },
    metadataCache: {
      getFileCache: jest.fn().mockReturnValue({ frontmatter: {} }),
      getFirstLinkpathDest: jest.fn(),
      getBacklinksForFile: jest.fn().mockReturnValue({ data: new Map() }),
      on: jest.fn(),
      off: jest.fn(),
      resolvedLinks: {},
      unresolvedLinks: {},
      ...overrides?.metadataCache,
    },
    workspace: {
      getLeaf: jest.fn().mockReturnValue({
        openLinkText: jest.fn(),
        openFile: jest.fn(),
      }),
      openLinkText: jest.fn(),
      setActiveLeaf: jest.fn(),
      getActiveFile: jest.fn(),
      ...overrides?.workspace,
    },
    fileManager: {
      processFrontMatter: jest.fn(),
      ...overrides?.fileManager,
    },
  };
}

/**
 * Create a mock Exocortex plugin object.
 */
export function createMockPlugin(overrides?: Partial<{
  settings: Partial<MockSettings>;
  app: MockApp;
}>): MockPlugin {
  return {
    settings: {
      currentOntology: null,
      showLayoutSection: true,
      showPropertiesSection: true,
      showArchivedAssets: false,
      votesColumnVisible: true,
      showEffortArea: true,
      showEffortVotes: true,
      ...overrides?.settings,
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    refreshLayout: jest.fn(),
    app: overrides?.app ?? createMockApp(),
  };
}

/**
 * Create a mock metadata record.
 */
export function createMockMetadata(overrides?: Metadata): Metadata {
  return {
    exo__Asset_label: "Test Asset",
    exo__Instance_class: "ems__Task",
    created: "2024-01-01",
    modified: "2024-01-01",
    ...overrides,
  };
}

/**
 * Create a mock Logger.
 */
export function createMockLogger(): MockLogger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

/**
 * Create a mock ReactRenderer.
 */
export function createMockReactRenderer(): MockReactRenderer {
  return {
    render: jest.fn(),
    unmount: jest.fn(),
  };
}

/**
 * Create a mock VaultAdapter.
 */
export function createMockVaultAdapter(overrides?: Partial<MockVaultAdapter>): MockVaultAdapter {
  return {
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
    ...overrides,
  };
}

/**
 * Create a mock MetadataExtractor.
 */
export function createMockMetadataExtractor(overrides?: Partial<MockMetadataExtractor>): MockMetadataExtractor {
  return {
    extractMetadata: jest.fn().mockReturnValue({}),
    extractInstanceClass: jest.fn(),
    extractStatus: jest.fn(),
    extractIsArchived: jest.fn(),
    ...overrides,
  };
}

/**
 * Create a mock BacklinksCacheManager.
 */
export function createMockBacklinksCacheManager(overrides?: Partial<MockBacklinksCacheManager>): MockBacklinksCacheManager {
  return {
    getBacklinks: jest.fn().mockReturnValue([]),
    ...overrides,
  };
}

// Type definitions for mocks

export interface MockVault {
  getMarkdownFiles: jest.Mock;
  getAbstractFileByPath: jest.Mock;
  read: jest.Mock;
  modify: jest.Mock;
  create: jest.Mock;
  delete: jest.Mock;
  rename: jest.Mock;
  getFiles: jest.Mock;
  getName: jest.Mock;
}

export interface MockMetadataCache {
  getFileCache: jest.Mock;
  getFirstLinkpathDest: jest.Mock;
  getBacklinksForFile: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  resolvedLinks: Record<string, unknown>;
  unresolvedLinks: Record<string, unknown>;
}

export interface MockWorkspace {
  getLeaf: jest.Mock;
  openLinkText: jest.Mock;
  setActiveLeaf: jest.Mock;
  getActiveFile: jest.Mock;
}

export interface MockFileManager {
  processFrontMatter: jest.Mock;
}

export interface MockApp {
  vault: MockVault;
  metadataCache: MockMetadataCache;
  workspace: MockWorkspace;
  fileManager: MockFileManager;
}

export interface MockSettings {
  currentOntology: string | null;
  showLayoutSection: boolean;
  showPropertiesSection: boolean;
  showArchivedAssets: boolean;
  votesColumnVisible: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
}

export interface MockPlugin {
  settings: MockSettings;
  saveSettings: jest.Mock;
  refreshLayout: jest.Mock;
  app: MockApp;
}

export interface MockLogger {
  info: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
}

export interface MockReactRenderer {
  render: jest.Mock;
  unmount: jest.Mock;
}

export interface MockVaultAdapter {
  getAllFiles: jest.Mock;
  read: jest.Mock;
  create: jest.Mock;
  modify: jest.Mock;
  delete: jest.Mock;
  exists: jest.Mock;
  getAbstractFileByPath: jest.Mock;
  getFrontmatter: jest.Mock;
  updateFrontmatter: jest.Mock;
  rename: jest.Mock;
  createFolder: jest.Mock;
  getFirstLinkpathDest: jest.Mock;
  process: jest.Mock;
  getDefaultNewFileParent: jest.Mock;
  updateLinks: jest.Mock;
}

export interface MockMetadataExtractor {
  extractMetadata: jest.Mock;
  extractInstanceClass: jest.Mock;
  extractStatus: jest.Mock;
  extractIsArchived: jest.Mock;
}

export interface MockBacklinksCacheManager {
  getBacklinks: jest.Mock;
}
