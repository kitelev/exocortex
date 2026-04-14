import { PropertiesLabelPatch } from "../../../../src/presentation/properties/PropertiesLabelPatch";

jest.mock("obsidian", () => ({
  Plugin: class {},
  TFile: class {},
  Notice: jest.fn(),
}));

interface FakeFile {
  path: string;
  basename: string;
  extension: string;
}

interface FakeLeaf {
  openFile: jest.Mock;
}

describe("PropertiesLabelPatch", () => {
  let patch: PropertiesLabelPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockContainer: HTMLElement;
  let mockMetadataContainer: HTMLElement;
  let mockWorkspaceLeaf: any;
  let openedFiles: FakeFile[];
  let openFileMock: jest.Mock;

  const FILE_EFFORT_AREA: FakeFile = {
    path: "exo/properties/ems__Effort_area.md",
    basename: "ems__Effort_area",
    extension: "md",
  };
  const FILE_EFFORT_STATUS: FakeFile = {
    path: "exo/properties/ems__Effort_status.md",
    basename: "ems__Effort_status",
    extension: "md",
  };
  const FILE_ASSET_LABEL: FakeFile = {
    path: "exo/properties/exo__Asset_label.md",
    basename: "exo__Asset_label",
    extension: "md",
  };

  const FRONTMATTERS: Record<string, any> = {
    [FILE_EFFORT_AREA.path]: {
      exo__Asset_label: "Effort Area",
      aliases: ["ems__Effort_area"],
      exo__Instance_class: "[[exo__ObjectProperty]]",
    },
    [FILE_EFFORT_STATUS.path]: {
      exo__Asset_label: "Effort Status",
      aliases: ["ems__Effort_status"],
      exo__Instance_class: "[[exo__ObjectProperty]]",
    },
    [FILE_ASSET_LABEL.path]: {
      exo__Asset_label: "Label",
      aliases: ["exo__Asset_label"],
      exo__Instance_class: "[[exo__StringProperty]]",
    },
  };

  function createPropertyRow(key: string, valueText: string): HTMLElement {
    const propertyEl = document.createElement("div");
    propertyEl.className = "metadata-property";
    propertyEl.setAttribute("data-property-key", key);

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.value = key;
    keyEl.appendChild(keyInput);
    propertyEl.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";
    valueEl.textContent = valueText;
    propertyEl.appendChild(valueEl);

    return propertyEl;
  }

  function createPropertyRowTextKey(key: string, valueText: string): HTMLElement {
    const propertyEl = document.createElement("div");
    propertyEl.className = "metadata-property";

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    keyEl.textContent = key;
    propertyEl.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";
    valueEl.textContent = valueText;
    propertyEl.appendChild(valueEl);

    return propertyEl;
  }

  beforeEach(() => {
    openedFiles = [];
    openFileMock = jest.fn().mockImplementation((file: FakeFile) => {
      openedFiles.push(file);
      return Promise.resolve();
    });

    mockMetadataContainer = document.createElement("div");
    mockMetadataContainer.className = "metadata-container";

    mockContainer = document.createElement("div");
    mockContainer.appendChild(mockMetadataContainer);
    document.body.appendChild(mockContainer);

    mockWorkspaceLeaf = {
      view: { containerEl: mockContainer },
    };

    const fakeLeaf: FakeLeaf = { openFile: openFileMock };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockWorkspaceLeaf]),
        getLeaf: jest.fn().mockReturnValue(fakeLeaf),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      metadataCache: {
        on: jest.fn().mockReturnValue({ id: "test" }),
        getFileCache: jest.fn().mockImplementation((file: FakeFile) => {
          const fm = FRONTMATTERS[file.path];
          return fm ? { frontmatter: fm } : null;
        }),
      },
      vault: {
        getMarkdownFiles: jest
          .fn()
          .mockReturnValue([FILE_EFFORT_AREA, FILE_EFFORT_STATUS, FILE_ASSET_LABEL]),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    patch = new PropertiesLabelPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    if (mockContainer.parentNode) {
      mockContainer.parentNode.removeChild(mockContainer);
    }
  });

  describe("enable", () => {
    it("registers layout-change, active-leaf-change, metadataCache changed events", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "active-leaf-change",
        expect.any(Function)
      );
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
    });

    it("is idempotent (double-enable registers events only once)", () => {
      patch.enable();
      const callCount = mockPlugin.registerEvent.mock.calls.length;
      patch.enable();
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(callCount);
    });
  });

  describe("Scenario A: known predicates get readable labels", () => {
    it("replaces raw predicate with readable label for ems__Effort_area", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Area");
      expect(input.getAttribute("data-exo-original-key")).toBe("ems__Effort_area");
    });

    it("replaces raw predicate for ems__Effort_status", () => {
      const row = createPropertyRow("ems__Effort_status", "Doing");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Status");
    });

    it("replaces raw predicate for exo__Asset_label", () => {
      const row = createPropertyRow("exo__Asset_label", "Build API");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Label");
    });

    it("adds clickable affordance (class + aria-label) to the key element", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(true);
      expect(keyEl.getAttribute("aria-label")).toContain("Effort Area");
      expect(keyEl.getAttribute("aria-label")).toContain("ems__Effort_area");
    });

    it("marks the property row as patched to avoid double-patching", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Area");

      // Invoke layout-change callback to re-run patchAll
      const layoutCb = mockApp.workspace.on.mock.calls.find(
        (c: any[]) => c[0] === "layout-change"
      )?.[1];
      if (layoutCb) layoutCb();

      // Still "Effort Area", not "Effort Area" → (label of "Effort Area")
      expect(input.value).toBe("Effort Area");
    });

    it("patches property row that uses text content instead of input for key", () => {
      const row = createPropertyRowTextKey("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.textContent).toBe("Effort Area");
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(true);
    });
  });

  describe("Scenario B: clicking readable label opens definition", () => {
    it("click on patched key element calls openFile for the definition asset", () => {
      const row = createPropertyRow("ems__Effort_status", "Doing");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      keyEl.click();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(openFileMock).toHaveBeenCalledTimes(1);
      expect(openedFiles[0]).toBe(FILE_EFFORT_STATUS);
    });
  });

  describe("Scenario C: unknown predicate fallback", () => {
    it("does NOT modify input value for predicate with no definition asset", () => {
      const row = createPropertyRow("vendor__Custom_field", "whatever");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("vendor__Custom_field");
      expect(input.getAttribute("data-exo-original-key")).toBeNull();
    });

    it("does NOT attach clickable class for unknown predicate", () => {
      const row = createPropertyRow("vendor__Custom_field", "whatever");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(false);
    });

    it("does NOT emit errors when only unknown predicates are present", () => {
      const row = createPropertyRow("vendor__Custom_field", "whatever");
      mockMetadataContainer.appendChild(row);

      const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() => patch.enable()).not.toThrow();
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("disable / cleanup", () => {
    it("restores original input.value on disable", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Area");

      patch.disable();

      expect(input.value).toBe("ems__Effort_area");
      expect(input.getAttribute("data-exo-original-key")).toBeNull();
    });

    it("restores original text content on disable when no input is present", () => {
      const row = createPropertyRowTextKey("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.textContent).toBe("Effort Area");

      patch.disable();

      expect(keyEl.textContent).toBe("ems__Effort_area");
    });

    it("removes clickable class and aria-label on disable", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(true);

      patch.disable();
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(false);
      expect(keyEl.getAttribute("aria-label")).toBeNull();
    });

    it("click handler no longer fires after disable", () => {
      const row = createPropertyRow("ems__Effort_status", "Doing");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      patch.disable();

      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      keyEl.click();
      expect(openFileMock).not.toHaveBeenCalled();
    });
  });

  describe("dynamic DOM (MutationObserver)", () => {
    it("patches a property row that is added after enable()", async () => {
      patch.enable();

      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Area");
    });
  });

  describe("index invalidation", () => {
    it("re-patches on metadataCache changed event", () => {
      const row = createPropertyRow("ems__Effort_area", "Development");
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("Effort Area");

      const changedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "changed"
      )?.[1];
      expect(typeof changedCb).toBe("function");

      // Fire the callback — index should rebuild, existing patched rows remain
      changedCb();

      // Still patched (idempotent on patched rows)
      expect(input.value).toBe("Effort Area");
    });
  });
});
