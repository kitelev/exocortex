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
    path: "ems/ab1b5cc2.md",
    basename: "ab1b5cc2",
    extension: "md",
  };
  const FILE_EFFORT_STATUS: FakeFile = {
    path: "ems/64594641.md",
    basename: "64594641",
    extension: "md",
  };
  const FILE_ASSET_LABEL: FakeFile = {
    path: "exo/3d1e4212.md",
    basename: "3d1e4212",
    extension: "md",
  };
  const FILE_EFFORT_AREA_FALLBACK: FakeFile = {
    path: "exo/properties/ems__Effort_area.md",
    basename: "ems__Effort_area",
    extension: "md",
  };

  const FRONTMATTERS: Record<string, any> = {
    [FILE_EFFORT_AREA.path]: {
      exo__Asset_label: "Effort Area",
      aliases: ["ems__Effort_area"],
    },
    [FILE_EFFORT_STATUS.path]: {
      exo__Asset_label: "Effort Status",
      aliases: ["ems__Effort_status"],
    },
    [FILE_ASSET_LABEL.path]: {
      exo__Asset_label: "Label",
      aliases: ["exo__Asset_label"],
    },
    [FILE_EFFORT_AREA_FALLBACK.path]: {
      exo__Asset_label: "Effort Area Fallback",
    },
  };

  function createPropertyRow(options: {
    lowercaseAttr?: boolean;
    inputValue: string;
  }): HTMLElement {
    const { lowercaseAttr = true, inputValue } = options;
    const propertyEl = document.createElement("div");
    propertyEl.className = "metadata-property";
    const attrValue = lowercaseAttr ? inputValue.toLowerCase() : inputValue;
    propertyEl.setAttribute("data-property-key", attrValue);

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.value = inputValue;
    keyEl.appendChild(keyInput);
    propertyEl.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";
    propertyEl.appendChild(valueEl);

    return propertyEl;
  }

  function createPropertyRowTextKey(key: string): HTMLElement {
    const propertyEl = document.createElement("div");
    propertyEl.className = "metadata-property";

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    keyEl.textContent = key;
    propertyEl.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";
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
          .mockReturnValue([
            FILE_EFFORT_AREA,
            FILE_EFFORT_STATUS,
            FILE_ASSET_LABEL,
            FILE_EFFORT_AREA_FALLBACK,
          ]),
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

  describe("Scenario A: known predicates get readable labels via span overlay", () => {
    it("inserts a display span with the readable label while leaving input.value UNCHANGED", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      // CRITICAL regression guard: input.value MUST stay as the raw predicate.
      // Mutating input.value causes Obsidian to persist a rename of the
      // frontmatter key, which corrupts the asset (observed live 2026-04-14).
      expect(input.value).toBe("ems__Effort_area");

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span).toBeTruthy();
      expect(span.textContent).toBe("Effort Area");
      expect(input.classList.contains("exo-label-hidden-input")).toBe(true);
    });

    it("resolves original-case predicate from input.value when data-property-key is lowercased", () => {
      // Regression guard: Obsidian lowercases data-property-key
      // (e.g. `ems__effort_area`), but input.value holds original case.
      const row = createPropertyRow({
        inputValue: "ems__Effort_area",
        lowercaseAttr: true,
      });
      expect(row.getAttribute("data-property-key")).toBe("ems__effort_area");

      mockMetadataContainer.appendChild(row);
      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.textContent).toBe("Effort Area");
    });

    it("replaces all 3 canonical predicates independently", () => {
      const rowStatus = createPropertyRow({ inputValue: "ems__Effort_status" });
      const rowArea = createPropertyRow({ inputValue: "ems__Effort_area" });
      const rowLabel = createPropertyRow({ inputValue: "exo__Asset_label" });
      mockMetadataContainer.appendChild(rowStatus);
      mockMetadataContainer.appendChild(rowArea);
      mockMetadataContainer.appendChild(rowLabel);

      patch.enable();

      expect(
        rowStatus.querySelector<HTMLSpanElement>(".exo-label-display")?.textContent
      ).toBe("Effort Status");
      expect(
        rowArea.querySelector<HTMLSpanElement>(".exo-label-display")?.textContent
      ).toBe("Effort Area");
      expect(
        rowLabel.querySelector<HTMLSpanElement>(".exo-label-display")?.textContent
      ).toBe("Label");
    });

    it("adds aria-label and role=link affordance for accessibility", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.getAttribute("role")).toBe("link");
      expect(span.getAttribute("tabindex")).toBe("0");
      expect(span.getAttribute("aria-label")).toContain("Effort Area");
      expect(span.getAttribute("aria-label")).toContain("ems__Effort_area");
    });

    it("marks the property row as patched to avoid double-patching", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      // Invoke layout-change callback to re-run patchAll
      const layoutCb = mockApp.workspace.on.mock.calls.find(
        (c: any[]) => c[0] === "layout-change"
      )?.[1];
      if (layoutCb) layoutCb();

      // Still exactly one span, not two
      const spans = row.querySelectorAll(".exo-label-display");
      expect(spans.length).toBe(1);
    });

    it("patches property row that uses text content instead of input for key", () => {
      const row = createPropertyRowTextKey("ems__Effort_area");
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.textContent).toBe("Effort Area");
    });
  });

  describe("Scenario B: clicking readable label opens definition", () => {
    it("click on display span calls openFile for the definition asset", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.click();

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(openFileMock).toHaveBeenCalledTimes(1);
      expect(openedFiles[0]).toBe(FILE_EFFORT_STATUS);
    });

    it("click event does NOT propagate to the input (no frontmatter corruption)", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      const inputFocusSpy = jest.fn();
      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      input.addEventListener("focus", inputFocusSpy);
      input.addEventListener("click", inputFocusSpy);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.click();

      expect(inputFocusSpy).not.toHaveBeenCalled();
      expect(input.value).toBe("ems__Effort_status");
    });
  });

  describe("Scenario C: unknown predicate fallback", () => {
    it("does NOT create a display span for unknown predicate", () => {
      const row = createPropertyRow({ inputValue: "vendor__Custom_field" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span).toBeNull();
    });

    it("leaves the input intact for unknown predicate", () => {
      const row = createPropertyRow({ inputValue: "vendor__Custom_field" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.value).toBe("vendor__Custom_field");
      expect(input.classList.contains("exo-label-hidden-input")).toBe(false);
    });

    it("does NOT emit errors when only unknown predicates are present", () => {
      const row = createPropertyRow({ inputValue: "vendor__Custom_field" });
      mockMetadataContainer.appendChild(row);

      const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() => patch.enable()).not.toThrow();
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("disable / cleanup", () => {
    it("removes display span on disable and restores input visibility", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const input = row.querySelector<HTMLInputElement>(
        ".metadata-property-key input"
      )!;
      expect(input.classList.contains("exo-label-hidden-input")).toBe(true);
      expect(row.querySelector(".exo-label-display")).toBeTruthy();

      patch.disable();

      expect(row.querySelector(".exo-label-display")).toBeNull();
      expect(input.classList.contains("exo-label-hidden-input")).toBe(false);
      expect(input.value).toBe("ems__Effort_area");
    });

    it("removes clickable class from key element on disable", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const keyEl = row.querySelector<HTMLElement>(".metadata-property-key")!;
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(true);

      patch.disable();
      expect(keyEl.classList.contains("exo-label-clickable")).toBe(false);
    });

    it("click handler no longer fires after disable", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();
      patch.disable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span).toBeNull();
      expect(openFileMock).not.toHaveBeenCalled();
    });
  });

  describe("dynamic DOM (MutationObserver)", () => {
    it("patches a property row that is added after enable()", async () => {
      patch.enable();

      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span?.textContent).toBe("Effort Area");
    });
  });

  describe("index invalidation", () => {
    it("re-patches on metadataCache changed event", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();
      const spanBefore = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(spanBefore?.textContent).toBe("Effort Area");

      const changedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "changed"
      )?.[1];
      expect(typeof changedCb).toBe("function");

      changedCb();

      // Still exactly one span (idempotent on patched rows)
      const spansAfter = row.querySelectorAll(".exo-label-display");
      expect(spansAfter.length).toBe(1);
    });

    it("registers metadataCache resolved event listener", () => {
      patch.enable();
      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "resolved",
        expect.any(Function)
      );
    });

    // REGRESSION: Finding 4 from UX audit 2026-04-14.
    // Scenario: fresh vault + starter-kit tarball install. Plugin enables 500ms
    // after onload, but Obsidian's metadataCache has NOT finished the initial
    // vault parse. buildIndex() runs against a cache where getFileCache returns
    // null for every def file. Index is empty. Then Obsidian fires "resolved"
    // ONCE — PropertiesLabelPatch was NOT listening → index stays empty forever
    // → Properties block shows raw `ems__Effort_a...` instead of "Effort Area"
    // for every user who installs via the supported tarball path.
    //
    // Fix: subscribe to metadataCache.on("resolved") → invalidate + re-patch.
    // Without the fix this test FAILS: span is null because resolvePredicate
    // returned null at enable() time and there was no signal to retry.
    it("recovers when metadataCache is empty at enable() and resolves later (Finding 4)", () => {
      // Arrange: metadataCache is not yet resolved — every getFileCache call
      // returns null (Obsidian's actual behavior during fresh vault startup).
      const lateFrontmatters: Record<string, any> = { ...FRONTMATTERS };
      let metadataResolved = false;
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (!metadataResolved) return null;
          const fm = lateFrontmatters[file.path];
          return fm ? { frontmatter: fm } : null;
        });

      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      // Act 1: plugin enables before cache is resolved — no patch possible.
      patch.enable();

      expect(
        row.querySelector<HTMLSpanElement>(".exo-label-display")
      ).toBeNull();

      // Act 2: Obsidian finishes its initial parse and fires "resolved".
      metadataResolved = true;
      const resolvedCb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "resolved"
      )?.[1];
      expect(typeof resolvedCb).toBe("function");
      resolvedCb();

      // Assert: the row now carries the readable label.
      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span?.textContent).toBe("Effort Area");
    });
  });

  describe("stylesheet: .exo-label-display matches native input metrics", () => {
    it("occupies the same geometric box as native .metadata-property-key input", () => {
      const fs = require("fs");
      const path = require("path");
      const stylesPath = path.resolve(
        __dirname,
        "../../../../styles.css"
      );
      const css = fs.readFileSync(stylesPath, "utf8");

      // Extract the .metadata-property-key .exo-label-display rule block.
      const match = css.match(
        /\.metadata-property-key \.exo-label-display\s*\{([^}]*)\}/
      );
      expect(match).toBeTruthy();
      const block = match![1];

      // font: inherit + explicit font-size overrides weight/line-height/family
      // so the span picks up native metrics instead of forcing --font-medium /
      // --line-height-tight (which caused the v15.98.1 vertical misalignment).
      expect(block).toMatch(/font:\s*inherit/);
      expect(block).toMatch(/font-size:\s*var\(--metadata-label-font-size/);

      // The span must occupy the same box as the hidden input so baselines
      // align with native Properties keys.
      expect(block).toMatch(/display:\s*inline-flex/);
      expect(block).toMatch(/align-items:\s*center/);
      expect(block).toMatch(/height:\s*var\(--input-height/);
      expect(block).toMatch(/padding:\s*var\(--size-4-1\) var\(--size-4-2/);
      expect(block).toMatch(/box-sizing:\s*border-box/);

      // Regression gates (v15.98.1 post-mortem): explicit font-weight and
      // line-height broke vertical alignment because native uses --font-normal
      // and normal line-height. Must NOT be re-introduced.
      expect(block).not.toMatch(
        /font-weight:\s*var\(--metadata-label-font-weight/
      );
      expect(block).not.toMatch(/line-height:\s*var\(--line-height-tight/);
    });
  });
});
