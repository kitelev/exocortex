// Mock function helper for both Jest and Playwright environments
const mockFn = (implementation?: any) => {
  // If jest is available (Jest environment), use jest.fn()
  if (typeof jest !== "undefined") {
    return jest.fn(implementation);
  }
  // Otherwise (Playwright CT environment), create a simple mock function
  const fn: any = implementation || (() => {});
  fn.mockResolvedValue = (value: any) => {
    fn._mockResolvedValue = value;
    return fn;
  };
  fn.mockRejectedValue = (error: any) => {
    fn._mockRejectedValue = error;
    return fn;
  };
  fn.mockReturnValue = (value: any) => {
    fn._mockReturnValue = value;
    return fn;
  };
  return fn;
};

// Add Obsidian-specific methods to HTMLElement globally
declare global {
  interface HTMLElement {
    createEl?: (tag: string, options?: any) => HTMLElement;
    createDiv?: (options?: any) => HTMLElement;
    createSpan?: (options?: any) => HTMLElement;
    empty?: () => void;
    addClass?: (cls: string) => void;
    removeClass?: (cls: string) => void;
    hasClass?: (cls: string) => boolean;
    setText?: (text: string) => void;
  }
}

// Setup DOM extensions
if (typeof document !== "undefined") {
  const proto = HTMLElement.prototype as any;
  if (!proto.createEl) {
    proto.createEl = function (tag: string, options?: any) {
      const el = document.createElement(tag);
      if (options?.text) el.textContent = options.text;
      if (options?.cls) el.className = options.cls;
      if (options?.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          el.setAttribute(key, String(value));
        }
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (options?: any) {
      const el = document.createElement("div");
      if (options?.cls) el.className = options.cls;
      if (options?.text) el.textContent = options.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (options?: any) {
      const el = document.createElement("span");
      if (options?.cls) el.className = options.cls;
      if (options?.text) el.textContent = options.text;
      if (options?.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          el.setAttribute(key, String(value));
        }
      }
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.empty) {
    proto.empty = function () {
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (cls: string) {
      this.classList.remove(cls);
    };
  }
  if (!proto.hasClass) {
    proto.hasClass = function (cls: string) {
      return this.classList.contains(cls);
    };
  }
  if (!proto.setText) {
    proto.setText = function (text: string) {
      this.textContent = text;
    };
  }
}

export class Plugin {
  app: App;
  manifest: any;

  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<any> {
    return {};
  }

  async saveData(data: any): Promise<void> {}

  addCommand(command: any): void {}

  addRibbonIcon(
    icon: string,
    title: string,
    callback: (evt: MouseEvent) => void,
  ): HTMLElement {
    const el = document.createElement("div");
    el.addClass = mockFn();
    return el;
  }

  addSettingTab(settingTab: any): void {}

  registerEvent(event: any): void {}

  registerInterval(interval: number): number {
    return interval;
  }

  registerMarkdownCodeBlockProcessor(
    language: string,
    handler: Function,
  ): void {
    // Mock implementation for SPARQL processor registration
    // Store the handler for potential testing
    (this as any).codeBlockProcessor = handler;
  }

  registerMarkdownPostProcessor(processor: Function): void {
    (this as any).markdownPostProcessor = processor;
  }

  registerView(type: string, viewCreator: Function): void {
    (this as any).registeredViews = (this as any).registeredViews || {};
    (this as any).registeredViews[type] = viewCreator;
  }

  addStatusBarItem(): HTMLElement {
    return document.createElement("div");
  }

  async onload(): Promise<void> {
    // Override in actual plugin
  }

  async onunload(): Promise<void> {
    // Override in actual plugin
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement;
  modalEl: HTMLElement;
  private backdrop?: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement("div");
    this.modalEl = document.createElement("div");

    // Set up Obsidian-style DOM methods on modalEl
    this.setupObsidianMethods(this.contentEl);
    this.setupObsidianMethods(this.modalEl);
  }

  private setupObsidianMethods(el: HTMLElement): void {
    if (!el.addClass) {
      (el as any).addClass = function (cls: string) {
        this.classList.add(cls);
      };
    }
    if (!el.removeClass) {
      (el as any).removeClass = function (cls: string) {
        this.classList.remove(cls);
      };
    }
    if (!el.hasClass) {
      (el as any).hasClass = function (cls: string) {
        return this.classList.contains(cls);
      };
    }
    if (!el.createEl) {
      (el as any).createEl = function (tag: string, options?: any) {
        const element = document.createElement(tag);
        if (options?.text) element.textContent = options.text;
        if (options?.cls) element.className = options.cls;
        if (options?.attr) {
          for (const [key, value] of Object.entries(options.attr)) {
            element.setAttribute(key, String(value));
          }
        }
        this.appendChild(element);
        return element;
      };
    }
    if (!el.empty) {
      (el as any).empty = function () {
        while (this.firstChild) {
          this.removeChild(this.firstChild);
        }
      };
    }
  }

  open(): void {
    // Create backdrop and add modal to DOM
    this.backdrop = document.createElement("div");
    this.backdrop.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(this.backdrop);
    this.backdrop.appendChild(this.modalEl);
    this.onOpen();
  }

  close(): void {
    this.onClose();
    if (this.backdrop) {
      document.body.removeChild(this.backdrop);
      this.backdrop = undefined;
    }
  }

  onOpen(): void {}
  onClose(): void {}
}

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;

  constructor(app: App, plugin: any) {
    this.app = app;
    this.containerEl = document.createElement("div");
  }

  display(): void {}
  hide(): void {}
}

export class Setting {
  containerEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");

    // Add Obsidian-specific methods to container
    this.setupContainerMethods(containerEl);
  }

  private setupContainerMethods(el: HTMLElement): void {
    if (!el.createEl) {
      (el as any).createEl = function (tag: string, options?: any) {
        const element = document.createElement(tag);
        if (options?.text) element.textContent = options.text;
        if (options?.cls) element.className = options.cls;
        this.appendChild(element);
        return element;
      };
    }
    if (!el.createDiv) {
      (el as any).createDiv = function (options?: any) {
        const element = document.createElement("div");
        if (options?.cls) element.className = options.cls;
        this.appendChild(element);
        return element;
      };
    }
    if (!el.empty) {
      (el as any).empty = function () {
        while (this.firstChild) {
          this.removeChild(this.firstChild);
        }
      };
    }
  }

  setName(name: string): this {
    return this;
  }

  setDesc(desc: string): this {
    return this;
  }

  addText(cb: (text: TextComponent) => void): this {
    cb(new TextComponent(this.containerEl));
    return this;
  }

  addTextArea(cb: (text: TextAreaComponent) => void): this {
    cb(new TextAreaComponent(this.containerEl));
    return this;
  }

  addToggle(cb: (toggle: ToggleComponent) => void): this {
    cb(new ToggleComponent(this.containerEl));
    return this;
  }

  addButton(cb: (button: ButtonComponent) => void): this {
    cb(new ButtonComponent(this.containerEl));
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => void): this {
    cb(new DropdownComponent(this.containerEl));
    return this;
  }
}

export class TextComponent {
  containerEl: HTMLElement;
  inputEl: HTMLInputElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.inputEl = document.createElement("input");
  }

  setPlaceholder(placeholder: string): this {
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class TextAreaComponent {
  containerEl: HTMLElement;
  inputEl: HTMLTextAreaElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.inputEl = document.createElement("textarea");
  }

  setPlaceholder(placeholder: string): this {
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class ToggleComponent {
  containerEl: HTMLElement;
  toggleEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.toggleEl = document.createElement("input");
  }

  setValue(value: boolean): this {
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    return this;
  }
}

export class ButtonComponent {
  containerEl: HTMLElement;
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.buttonEl = document.createElement("button");

    // Add Obsidian DOM extensions to button element
    if (!this.buttonEl.addClass) {
      (this.buttonEl as any).addClass = function (cls: string) {
        this.classList.add(cls);
      };
    }
    if (!this.buttonEl.removeClass) {
      (this.buttonEl as any).removeClass = function (cls: string) {
        this.classList.remove(cls);
      };
    }

    containerEl.appendChild(this.buttonEl);
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setCta(): this {
    this.buttonEl.addClass("mod-cta");
    return this;
  }

  onClick(callback: () => void): this {
    this.buttonEl.addEventListener("click", callback);
    return this;
  }

  setTooltip(tooltip: string): this {
    this.buttonEl.setAttribute("title", tooltip);
    return this;
  }

  setClass(cls: string): this {
    this.buttonEl.className = cls;
    return this;
  }
}

export class DropdownComponent {
  containerEl: HTMLElement;
  selectEl: HTMLSelectElement;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.selectEl = document.createElement("select");
    containerEl.appendChild(this.selectEl);
  }

  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display || value;
    this.selectEl.appendChild(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void): this {
    this.selectEl.addEventListener("change", () =>
      callback(this.selectEl.value),
    );
    return this;
  }
}

export class Notice {
  constructor(message: string) {}
}

// Mock setIcon function - sets an icon on an element
export function setIcon(el: HTMLElement, iconName: string): void {
  // Mark that setIcon was called for testing
  el.setAttribute("data-icon-set", "true");
  el.setAttribute("data-icon-name", iconName);
}

export class MarkdownView {
  previewMode: {
    rerender: (force: boolean) => void;
  };

  constructor() {
    this.previewMode = {
      rerender: mockFn(),
    };
  }
}

export class TFolder {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
  }
}

export class TFile {
  path: string;
  basename: string;
  name: string;
  extension: string;
  parent: TFolder | null;

  constructor(path?: string) {
    this.path = path || "";
    this.basename = path
      ? path
          .split("/")
          .pop()
          ?.replace(/\.[^/.]+$/, "") || ""
      : "";
    this.name = path ? path.split("/").pop() || "" : "";
    this.extension = path ? path.split(".").pop() || "" : "";

    // Set parent folder
    const parentPath = path ? path.split("/").slice(0, -1).join("/") : "";
    this.parent = parentPath ? new TFolder(parentPath) : null;
  }
}

export class WorkspaceLeaf {
  view: any;

  constructor() {
    this.view = null;
  }

  openFile(file: TFile): Promise<void> {
    return Promise.resolve();
  }
}

export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  fileManager: FileManager;

  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace();
    this.metadataCache = new MetadataCache(this.vault);
    this.fileManager = new FileManager(this.vault);
  }
}

export class Vault {
  private mockFiles: TFile[] = [];
  adapter: any = {
    read: mockFn().mockRejectedValue(new Error("File not found")),
    write: mockFn().mockResolvedValue(undefined),
    exists: mockFn().mockResolvedValue(false),
    mkdir: mockFn().mockResolvedValue(undefined),
    remove: mockFn().mockResolvedValue(undefined),
    list: mockFn().mockResolvedValue({ files: [], folders: [] }),
  };

  getFiles(): TFile[] {
    return this.mockFiles;
  }

  getMarkdownFiles(): TFile[] {
    return this.mockFiles.filter((file) => file.extension === "md");
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const file = this.mockFiles.find((file) => file.path === path);
    if (file) return file;

    // Check if it's a folder path
    const isFolder = this.mockFiles.some((f) => f.path.startsWith(path + "/"));
    if (isFolder) {
      return new TFolder(path);
    }

    return null;
  }

  create(path: string, content: string): Promise<TFile> {
    const file = new TFile(path);
    this.mockFiles.push(file);
    return Promise.resolve(file);
  }

  async read(file: TFile | string): Promise<string> {
    if (typeof file === "string") {
      // Mock reading by path
      return Promise.resolve("Mock file content");
    }
    // Mock reading from TFile
    return Promise.resolve("Mock file content");
  }

  async modify(file: TFile, content: string): Promise<void> {
    // Mock file modification
    return Promise.resolve();
  }

  async delete(file: TFile): Promise<void> {
    const index = this.mockFiles.indexOf(file);
    if (index > -1) {
      this.mockFiles.splice(index, 1);
    }
    return Promise.resolve();
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const targetFile = this.mockFiles.find((f) => f === file);
    if (targetFile) {
      targetFile.path = newPath;
      targetFile.name = newPath.split("/").pop() || "";
    }
    return Promise.resolve();
  }

  getAllLoadedFiles(): TFile[] {
    return this.mockFiles;
  }

  async createFolder(path: string): Promise<void> {
    // Mock folder creation
    return Promise.resolve();
  }

  async exists(path: string): Promise<boolean> {
    return this.mockFiles.some((file) => file.path === path);
  }

  async process(file: TFile, fn: (content: string) => string): Promise<string> {
    const content = await this.read(file);
    const newContent = fn(content);
    await this.modify(file, newContent);
    return newContent;
  }

  on(event: string, callback: any): any {
    // Return an EventRef-like object that registerEvent expects
    return {
      e: {
        target: this,
        fn: callback,
        event: event,
      },
    };
  }

  off(event: string, callback: any): void {
    // Mock implementation for removing event listeners
  }

  // Helper method for testing
  __addMockFile(path: string, content?: string): TFile {
    const file = new TFile(path);
    this.mockFiles.push(file);
    return file;
  }

  // Helper method to clear mock files for tests
  __clearMockFiles(): void {
    this.mockFiles = [];
  }
}

export class Workspace {
  private activeFile: TFile | null = null;
  private leaves: WorkspaceLeaf[] = [];

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  getLeaf(newLeaf?: boolean): WorkspaceLeaf {
    if (newLeaf || this.leaves.length === 0) {
      const leaf = new WorkspaceLeaf();
      this.leaves.push(leaf);
      return leaf;
    }
    return this.leaves[0];
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void {
    this.leaves.forEach(callback);
  }

  getActiveViewOfType<T>(type: any): T | null {
    return null;
  }

  openLinkText(linkText: string, sourcePath: string): void {
    // Mock implementation for opening links
  }

  on(name: string, callback: Function): void {
    // Mock event listener
  }

  off(name: string, callback: Function): void {
    // Mock event listener removal
  }

  trigger(name: string, ...data: any[]): void {
    // Mock event triggering
  }

  // Helper method for testing
  __setActiveFile(file: TFile | null): void {
    this.activeFile = file;
  }
}

export class MetadataCache {
  private cache: Map<string, any> = new Map();
  private vault: Vault | null = null;

  constructor(vault?: Vault) {
    this.vault = vault || null;
  }

  getFileCache(file: TFile): any {
    return (
      this.cache.get(file.path) || {
        frontmatter: {},
        sections: [],
        headings: [],
        links: [],
        embeds: [],
        tags: [],
      }
    );
  }

  getBacklinksForFile(file: TFile): any {
    return {
      data: new Map(),
      count: () => 0,
      keys: () => [],
    };
  }

  getFrontmatterPropertyValue(file: TFile, property: string): any {
    const cache = this.getFileCache(file);
    return cache.frontmatter?.[property];
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    if (!this.vault) return null;

    // Simple mock: try to find file by linkpath directly
    const files = this.vault.getMarkdownFiles();
    return (
      files.find((f) => f.basename === linkpath || f.path === linkpath) || null
    );
  }

  on(name: string, callback: Function): void {
    // Mock event listener
  }

  off(name: string, callback: Function): void {
    // Mock event listener removal
  }

  // Helper method for testing
  __setFileCache(path: string, cache: any): void {
    this.cache.set(path, cache);
  }

  // Helper method to clear cache for tests
  __clearCache(): void {
    this.cache.clear();
  }

  // Helper method to set vault reference
  __setVault(vault: Vault): void {
    this.vault = vault;
  }
}

export interface Editor {}

export interface MarkdownPostProcessorContext {
  sourcePath: string;
  frontmatter?: any;
  addChild(component: any): void;
  getSectionInfo(el: HTMLElement): any;
}

// Additional commonly used types and interfaces
export interface FileSystemAdapter {
  path: {
    join(...paths: string[]): string;
    dirname(path: string): string;
    basename(path: string): string;
  };
}

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  addChild<T extends Component>(component: T): T {
    return component;
  }
  removeChild<T extends Component>(component: T): T {
    return component;
  }
}

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
}

export class MarkdownRenderer {
  static renderMarkdown(
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component,
  ): Promise<void> {
    el.innerHTML = markdown;
    return Promise.resolve();
  }
}

export class FileManager {
  constructor(private vault: Vault) {}

  generateMarkdownLink(file: TFile, sourcePath: string): string {
    return `[[${file.basename}]]`;
  }

  async renameFile(file: TFile, newPath: string): Promise<void> {
    await this.vault.rename(file, newPath);
  }

  async processFrontMatter(
    _file: TFile,
    fn: (frontmatter: any) => void,
  ): Promise<void> {
    const frontmatter: any = {};
    fn(frontmatter);
    return Promise.resolve();
  }
}

// Mock normalizePath function
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

// Mock requestUrl function
export function requestUrl(request: {
  url: string;
  [key: string]: any;
}): Promise<any> {
  return Promise.resolve({
    status: 200,
    json: {},
    text: "",
    arrayBuffer: new ArrayBuffer(0),
  });
}

// Mock debounce function - compatible with Jest fake timers
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate?: boolean,
): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    if (immediate && timeoutId === null) {
      func(...args);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!immediate) {
        func(...args);
      }
    }, wait);
  }) as T;

  return debounced;
}

// Mock moment if needed
export const moment = {
  now: () => Date.now(),
  unix: (timestamp: number) => ({
    format: (format?: string) => new Date(timestamp * 1000).toISOString(),
  }),
};

// Mock Platform API - Enhanced for Mobile Testing
export const Platform = {
  isMobile: process.env.TEST_PLATFORM === "mobile" || false,
  isMobileApp: process.env.TEST_PLATFORM === "mobile" || false,
  isIosApp: process.env.TEST_PLATFORM === "ios" || false,
  isAndroidApp: process.env.TEST_PLATFORM === "android" || false,
  isTablet: process.env.TEST_PLATFORM === "tablet" || false,
  isDesktop:
    process.env.TEST_PLATFORM !== "mobile" &&
    process.env.TEST_PLATFORM !== "tablet",
  isWin: false,
  isMacOS: true,
  isLinux: false,
};

// Mobile Environment Mocks
declare global {
  interface Window {
    TouchEvent: typeof TouchEvent;
    PointerEvent?: typeof PointerEvent;
    Capacitor?: any;
    ObsidianMobile?: any;
  }

  interface Navigator {
    vibrate?: (pattern: number | number[]) => boolean;
    deviceMemory?: number;
    connection?: {
      effectiveType?: string;
      type?: string;
      downlink?: number;
    };
    maxTouchPoints: number;
    msMaxTouchPoints?: number;
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      chargingTime: number;
      dischargingTime: number;
    }>;
  }
}

// Setup mobile environment mocks
if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Touch Event Support
  if (!window.TouchEvent) {
    class MockTouchEvent extends Event {
      touches: TouchList;
      changedTouches: TouchList;
      targetTouches: TouchList;

      constructor(type: string, eventInitDict?: TouchEventInit) {
        super(type, eventInitDict);

        const createTouchList = (touches?: Touch[]): TouchList => {
          const list = (touches || []) as any;
          list.item = (index: number) => list[index] || null;
          return list as TouchList;
        };

        this.touches = createTouchList(eventInitDict?.touches as Touch[]);
        this.changedTouches = createTouchList(
          eventInitDict?.changedTouches as Touch[],
        );
        this.targetTouches = createTouchList(
          eventInitDict?.targetTouches as Touch[],
        );
      }
    }

    window.TouchEvent = MockTouchEvent as any;
  }

  // Pointer Event Support
  if (!window.PointerEvent) {
    class MockPointerEvent extends Event {
      pointerId: number;
      pointerType: string;
      clientX: number;
      clientY: number;

      constructor(type: string, eventInitDict?: PointerEventInit) {
        super(type, eventInitDict);
        this.pointerId = eventInitDict?.pointerId || 0;
        this.pointerType = eventInitDict?.pointerType || "touch";
        this.clientX = eventInitDict?.clientX || 0;
        this.clientY = eventInitDict?.clientY || 0;
      }
    }

    window.PointerEvent = MockPointerEvent as any;
  }

  // Touch capability detection
  if (!("ontouchstart" in window)) {
    Object.defineProperty(window, "ontouchstart", {
      value: null,
      configurable: true,
      writable: true,
    });
  }

  // Navigator enhancements for mobile testing
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: process.env.TEST_PLATFORM === "mobile" ? 10 : 0,
    configurable: true,
  });

  Object.defineProperty(navigator, "msMaxTouchPoints", {
    value: process.env.TEST_PLATFORM === "mobile" ? 10 : 0,
    configurable: true,
  });

  // Vibration API mock
  if (!navigator.vibrate) {
    Object.defineProperty(navigator, "vibrate", {
      value: mockFn((pattern: number | number[]) => {
        console.log(`Mock vibrate called with:`, pattern);
        return true;
      }),
      configurable: true,
      writable: true,
    });
  }

  // Device Memory API mock
  Object.defineProperty(navigator, "deviceMemory", {
    value: process.env.TEST_PLATFORM === "mobile" ? 4 : 8, // 4GB for mobile, 8GB for desktop
    configurable: true,
  });

  // Network Information API mock
  Object.defineProperty(navigator, "connection", {
    value: {
      effectiveType: process.env.TEST_PLATFORM === "mobile" ? "3g" : "4g",
      type: "cellular",
      downlink: process.env.TEST_PLATFORM === "mobile" ? 1.5 : 10,
    },
    configurable: true,
  });

  // Battery API mock
  Object.defineProperty(navigator, "getBattery", {
    value: () =>
      Promise.resolve({
        level: 0.75,
        charging: false,
        chargingTime: Infinity,
        dischargingTime: 7200,
      }),
    configurable: true,
  });

  // Mock Capacitor for Obsidian mobile detection
  if (process.env.TEST_PLATFORM === "mobile") {
    window.Capacitor = {
      platform: process.env.TEST_PLATFORM === "ios" ? "ios" : "android",
      isNative: true,
    };

    window.ObsidianMobile = {
      version: "1.0.0",
      platform: process.env.TEST_PLATFORM === "ios" ? "ios" : "android",
    };
  }

  // Performance memory mock
  if (!performance.memory && process.env.TEST_PLATFORM === "mobile") {
    Object.defineProperty(performance, "memory", {
      value: {
        usedJSHeapSize: 50 * 1024 * 1024, // 50MB
        totalJSHeapSize: 100 * 1024 * 1024, // 100MB
        jsHeapSizeLimit: 512 * 1024 * 1024, // 512MB for mobile
      },
      configurable: true,
    });
  }

  // Mock requestAnimationFrame and cancelAnimationFrame if not present
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = mockFn((callback: FrameRequestCallback) => {
      const id = setTimeout(() => callback(performance.now()), 16);
      return id;
    }) as any;
  }

  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = mockFn((id: number) => {
      clearTimeout(id);
    });
  }

  // Mock screen orientation API
  if (!screen.orientation) {
    Object.defineProperty(screen, "orientation", {
      value: {
        angle: 0,
        type: "portrait-primary",
        addEventListener: mockFn(),
        removeEventListener: mockFn(),
      },
      configurable: true,
    });
  }

  // Mock matchMedia for responsive design tests
  if (!window.matchMedia) {
    window.matchMedia = mockFn((query: string) => ({
      matches: query.includes("max-width: 768px")
        ? process.env.TEST_PLATFORM === "mobile"
        : false,
      media: query,
      onchange: null,
      addListener: mockFn(),
      removeListener: mockFn(),
      addEventListener: mockFn(),
      removeEventListener: mockFn(),
      dispatchEvent: mockFn(),
    }));
  }

  // Mock CSS support detection
  if (!window.CSS) {
    Object.defineProperty(window, "CSS", {
      value: {
        supports: mockFn((property: string) => {
          // Mock support for safe-area CSS
          return property.includes("safe-area") || property.includes("env(");
        }),
      },
      configurable: true,
    });
  }

  // Mock computed style for safe area detection
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = mockFn((element: Element) => {
    const mockStyle = {
      getPropertyValue: mockFn((prop: string) => {
        // Mock safe area insets for iOS
        const safeAreaMap: { [key: string]: string } = {
          "env(safe-area-inset-top)":
            process.env.TEST_PLATFORM === "ios" ? "44px" : "0px",
          "env(safe-area-inset-bottom)":
            process.env.TEST_PLATFORM === "ios" ? "34px" : "0px",
          "env(safe-area-inset-left)": "0px",
          "env(safe-area-inset-right)": "0px",
        };
        return safeAreaMap[prop] || "0px";
      }),
      ...(originalGetComputedStyle ? originalGetComputedStyle(element) : {}),
    };
    return mockStyle as any;
  });

  // Mock user agent for mobile detection
  const mobileUserAgents = {
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    android:
      "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36",
    tablet:
      "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    desktop:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
  };

  if (
    process.env.TEST_PLATFORM &&
    process.env.TEST_PLATFORM in mobileUserAgents
  ) {
    Object.defineProperty(navigator, "userAgent", {
      value:
        mobileUserAgents[
          process.env.TEST_PLATFORM as keyof typeof mobileUserAgents
        ],
      configurable: true,
    });
  }

  // Mock platform for mobile detection
  const platformMap: { [key: string]: string } = {
    ios: "iPhone",
    android: "Linux armv8l",
    tablet: "iPad",
    desktop: "MacIntel",
  };

  if (process.env.TEST_PLATFORM && process.env.TEST_PLATFORM in platformMap) {
    Object.defineProperty(navigator, "platform", {
      value: platformMap[process.env.TEST_PLATFORM],
      configurable: true,
    });
  }

  // Mock inner dimensions for different screen sizes
  const screenDimensions = {
    mobile: { width: 375, height: 667 },
    ios: { width: 375, height: 667 },
    android: { width: 412, height: 892 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1920, height: 1080 },
  };

  if (
    process.env.TEST_PLATFORM &&
    process.env.TEST_PLATFORM in screenDimensions
  ) {
    const dimensions =
      screenDimensions[
        process.env.TEST_PLATFORM as keyof typeof screenDimensions
      ];
    Object.defineProperty(window, "innerWidth", {
      value: dimensions.width,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: dimensions.height,
      configurable: true,
    });
    Object.defineProperty(screen, "width", {
      value: dimensions.width,
      configurable: true,
    });
    Object.defineProperty(screen, "height", {
      value: dimensions.height,
      configurable: true,
    });
  }
}

// Export mobile testing utilities
export const MobileTestUtils = {
  /**
   * Set the test platform for mobile tests
   */
  setPlatform(platform: "mobile" | "ios" | "android" | "tablet" | "desktop") {
    process.env.TEST_PLATFORM = platform;
    // Force refresh of cached values
    if (typeof window !== "undefined") {
      // Trigger platform detection refresh if available
      (window as any).__PLATFORM_REFRESH__?.();
    }
  },

  /**
   * Create a mock touch event for testing
   */
  createTouchEvent(
    type: string,
    touches: Array<{ x: number; y: number; id?: number }>,
    target?: Element,
  ): TouchEvent {
    const touchList = touches.map((touch, index) => ({
      identifier: touch.id || index,
      clientX: touch.x,
      clientY: touch.y,
      pageX: touch.x,
      pageY: touch.y,
      screenX: touch.x,
      screenY: touch.y,
      target: target || document.body,
    }));

    const event = new TouchEvent(type, {
      touches:
        type === "touchend" || type === "touchcancel" ? [] : (touchList as any),
      changedTouches: touchList as any,
      targetTouches:
        type === "touchend" || type === "touchcancel" ? [] : (touchList as any),
      bubbles: true,
      cancelable: true,
    });

    (event as any).preventDefault = mockFn();
    (event as any).stopPropagation = mockFn();

    return event;
  },

  /**
   * Mock device capabilities for testing
   */
  mockDeviceCapabilities(capabilities: {
    vibration?: boolean;
    geolocation?: boolean;
    battery?: boolean;
    memory?: number;
    connection?: string;
  }) {
    if (capabilities.vibration !== undefined) {
      Object.defineProperty(navigator, "vibrate", {
        value: capabilities.vibration ? mockFn() : undefined,
        configurable: true,
      });
    }

    if (capabilities.geolocation !== undefined) {
      Object.defineProperty(navigator, "geolocation", {
        value: capabilities.geolocation
          ? {
              getCurrentPosition: mockFn(),
              watchPosition: mockFn(),
              clearWatch: mockFn(),
            }
          : undefined,
        configurable: true,
      });
    }

    if (capabilities.memory !== undefined) {
      Object.defineProperty(navigator, "deviceMemory", {
        value: capabilities.memory,
        configurable: true,
      });
    }

    if (capabilities.connection !== undefined) {
      Object.defineProperty(navigator, "connection", {
        value: {
          effectiveType: capabilities.connection,
          type: "cellular",
          downlink: capabilities.connection === "4g" ? 10 : 1.5,
        },
        configurable: true,
      });
    }
  },

  /**
   * Reset all mobile mocks to default state
   */
  reset() {
    delete process.env.TEST_PLATFORM;
    // Reset other mock states as needed
  },
};
