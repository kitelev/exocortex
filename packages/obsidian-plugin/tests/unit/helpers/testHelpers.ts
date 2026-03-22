import { TFile } from "obsidian";

export * from "./TestFixtureBuilder";

export function createMockTFile(
  path: string,
  metadata: Record<string, any> = {},
  content = ""
): TFile {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") || "";
  return {
    path,
    name: basename + ".md",
    basename,
    extension: "md",
    parent: null,
    vault: null,
    stat: {
      ctime: Date.now(),
      mtime: Date.now(),
      size: content.length,
    },
  } as TFile;
}

export function createMockElement(): any {
  const el: any = document.createElement("div");

  // Make createDiv a jest mock that also creates real DOM elements
  el.createDiv = jest.fn((opts?: any) => {
    const div: any = document.createElement("div");
    if (opts?.cls) div.className = opts.cls;
    if (opts?.text) div.textContent = opts.text;
    el.appendChild(div);

    // Add nested createDiv and createEl methods (also as mocks)
    div.createDiv = jest.fn(el.createDiv);
    div.createEl = jest.fn((tag: string, options?: any) => {
      const element = document.createElement(tag);
      if (options?.cls) element.className = options.cls;
      if (options?.text) element.textContent = options.text;
      if (options?.attr) {
        Object.entries(options.attr).forEach(([key, value]) => {
          element.setAttribute(key, String(value));
        });
      }
      div.appendChild(element);
      return element;
    });

    return div;
  });

  el.createEl = jest.fn((tag: string, options?: any) => {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    if (options?.attr) {
      Object.entries(options.attr).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
      });
    }
    el.appendChild(element);
    return element;
  });

  el.empty = jest.fn(() => {
    el.innerHTML = "";
  });

  return el;
}

export function createMockApp(overrides?: any): any {
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
    },
    metadataCache: {
      getFileCache: jest.fn().mockReturnValue({ frontmatter: {} }),
      getFirstLinkpathDest: jest.fn(),
      getBacklinksForFile: jest.fn().mockReturnValue({
        data: new Map(),
      }),
      on: jest.fn(),
      off: jest.fn(),
      resolvedLinks: {},
      unresolvedLinks: {},
    },
    workspace: {
      getLeaf: jest.fn().mockReturnValue({
        openLinkText: jest.fn(),
        openFile: jest.fn(),
      }),
      openLinkText: jest.fn(),
      setActiveLeaf: jest.fn(),
      getActiveFile: jest.fn(),
    },
    fileManager: {
      processFrontMatter: jest.fn(),
    },
    ...overrides,
  };
}

export function createMockPlugin(overrides?: any): any {
  return {
    settings: {
      currentOntology: null,
      showLayoutSection: true,
      showArchivedAssets: false,
      votesColumnVisible: true,
    },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    refreshLayout: jest.fn(),
    app: createMockApp(),
    ...overrides,
  };
}

export function createMockMetadata(overrides?: Record<string, any>): Record<string, any> {
  return {
    exo__Asset_label: "Test Asset",
    exo__Instance_class: "ems__Task",
    created: "2024-01-01",
    modified: "2024-01-01",
    ...overrides,
  };
}

export function createMockAssetRelation(overrides?: any): any {
  const file = createMockTFile(overrides?.path || "test/file.md");
  return {
    file,
    path: file.path,
    title: overrides?.title || "Test Title",
    metadata: createMockMetadata(overrides?.metadata),
    propertyName: overrides?.propertyName || "ems__Effort_parent",
    isBodyLink: overrides?.isBodyLink || false,
    isArchived: overrides?.isArchived || false,
    isBlocked: overrides?.isBlocked || false,
    created: overrides?.created || Date.now(),
    modified: overrides?.modified || Date.now(),
    ...overrides,
  };
}

export function createMockBacklinksCacheManager(overrides?: any): any {
  return {
    getBacklinks: jest.fn().mockReturnValue([]),
    ...overrides,
  };
}

export function createMockMetadataService(overrides?: any): any {
  return {
    getAssetLabel: jest.fn().mockReturnValue("Test Label"),
    extractMetadata: jest.fn().mockReturnValue(createMockMetadata()),
    ...overrides,
  };
}

export function createMockReactRenderer(): any {
  return {
    render: jest.fn(),
    unmount: jest.fn(),
  };
}

export function createMockMetadataExtractor(metadata?: Record<string, any>): any {
  return {
    extractMetadata: jest.fn().mockReturnValue(
      createMockMetadata(metadata)
    ),
  };
}

/**
 * Flushes the microtask queue by waiting for all pending promises to resolve.
 * Use this instead of `await new Promise(resolve => setTimeout(resolve, 0))`.
 *
 * @example
 * // ❌ WRONG - Fixed timeout
 * await new Promise(resolve => setTimeout(resolve, 50));
 *
 * // ✅ CORRECT - Flush microtasks
 * await flushPromises();
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Waits for React to complete rendering by running multiple microtask cycles.
 * Use this for UI tests where React components need time to render.
 *
 * @param cycles - Number of microtask cycles to wait (default: 10)
 * @returns Promise that resolves after React has had time to render
 *
 * @example
 * // ❌ WRONG - Single flush may not be enough for React
 * await flushPromises();
 *
 * // ✅ CORRECT - Multiple cycles for React rendering
 * await waitForReact();
 */
export async function waitForReact(cycles: number = 10): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await flushPromises();
  }
}

/**
 * Waits until a condition function returns true, with configurable timeout and interval.
 * Use this instead of fixed `setTimeout` delays when waiting for async state changes.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Configuration options
 * @param options.timeout - Maximum time to wait in ms (default: 5000)
 * @param options.interval - Polling interval in ms (default: 50)
 * @param options.message - Custom error message on timeout
 * @throws Error if condition is not met within timeout
 *
 * @example
 * // ❌ WRONG - Fixed timeout that may be too short or too long
 * await new Promise(resolve => setTimeout(resolve, 200));
 * expect(service.isReady).toBe(true);
 *
 * // ✅ CORRECT - Wait for actual condition
 * await waitForCondition(() => service.isReady);
 * expect(service.isReady).toBe(true);
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = "Condition not met within timeout" } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`${message} (waited ${timeout}ms)`);
}

/**
 * Waits for a DOM element to appear, with configurable timeout.
 * Use this instead of fixed delays when waiting for React to render.
 *
 * @param container - The container element to search in
 * @param selector - CSS selector for the element to wait for
 * @param options - Configuration options
 * @param options.timeout - Maximum time to wait in ms (default: 5000)
 * @param options.interval - Polling interval in ms (default: 50)
 * @returns The found element
 * @throws Error if element is not found within timeout
 *
 * @example
 * // ❌ WRONG - Fixed timeout hoping React has rendered
 * await new Promise(resolve => setTimeout(resolve, 200));
 * expect(domContainer.querySelector('.my-class')).toBeTruthy();
 *
 * // ✅ CORRECT - Wait for actual DOM element
 * const element = await waitForDomElement(domContainer, '.my-class');
 * expect(element).toBeTruthy();
 */
export async function waitForDomElement(
  container: Element,
  selector: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<Element> {
  const { timeout = 5000, interval = 50 } = options;

  await waitForCondition(
    () => container.querySelector(selector) !== null,
    { timeout, interval, message: `Element "${selector}" not found` }
  );

  const element = container.querySelector(selector);
  if (!element) {
    throw new Error(`Element "${selector}" not found after wait`);
  }
  return element;
}

/**
 * Retries an async function with exponential backoff.
 * Use this for operations that may fail transiently (network, file I/O).
 *
 * @param fn - Async function to retry
 * @param options - Configuration options
 * @param options.retries - Maximum number of retries (default: 3)
 * @param options.delay - Initial delay between retries in ms (default: 100)
 * @param options.backoff - Backoff multiplier (default: 2)
 * @returns The result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * // ❌ WRONG - Fixed retries with constant delay
 * for (let i = 0; i < 10; i++) {
 *   if (condition) break;
 *   await sleep(50);
 * }
 *
 * // ✅ CORRECT - Exponential backoff retry
 * await retry(() => {
 *   expect(condition).toBe(true);
 * }, { retries: 3, delay: 100, backoff: 2 });
 */
export async function retry<T>(
  fn: () => T | Promise<T>,
  options: { retries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { retries = 3, delay = 100, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(backoff, i)));
      }
    }
  }

  throw lastError;
}