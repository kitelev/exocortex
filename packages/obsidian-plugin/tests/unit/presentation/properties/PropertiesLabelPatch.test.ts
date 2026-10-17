import {
  PropertiesLabelPatch,
  unwrapWikilinkUid,
  normalizeClassList,
  labelLocalPart,
  labelClassSegment,
  classNameFromLabel,
  disambiguateBlockLabels,
} from "../../../../src/presentation/properties/PropertiesLabelPatch";

jest.mock("obsidian", () => ({
  Plugin: class {},
  TFile: class {},
  Notice: jest.fn(),
  Keymap: {
    // Minimal stub that mirrors Obsidian's behavior for the modifier
    // combinations we care about in tests. The real implementation also
    // distinguishes split/window via Alt/Shift but tests below exercise only
    // the plain-click and Mod+click cases.
    isModEvent: (evt?: MouseEvent | KeyboardEvent): "tab" | "split" | "window" | false => {
      if (!evt) return false;
      const mod = (evt as MouseEvent).metaKey || (evt as MouseEvent).ctrlKey;
      if (!mod) return false;
      if ((evt as MouseEvent).altKey && (evt as MouseEvent).shiftKey) return "window";
      if ((evt as MouseEvent).altKey) return "split";
      return "tab";
    },
  },
}));

interface FakeFile {
  path: string;
  basename: string;
  extension: string;
}

interface FakeLeaf {
  openFile: jest.Mock;
}

const EXO_PROPERTY_UID = "38277bfa-d7f9-4a75-b856-b23276ab0db3";
const EXO_OBJECT_PROPERTY_UID = "9a1cf31c-9d41-4ef3-9023-584a8d087d16";
const IMS_CONCEPT_UID = "dda12c48-6886-4624-8710-ed4ba92ce2b3";

describe("PropertiesLabelPatch", () => {
  let patch: PropertiesLabelPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockContainer: HTMLElement;
  let mockMetadataContainer: HTMLElement;
  let mockWorkspaceLeaf: any;
  let openedFiles: FakeFile[];
  let openFileMock: jest.Mock;

  // ----- property-class definition assets (TBox class hierarchy) -----
  // Without these, resolvePropertyClassUids only knows the root UID.
  // With FILE_CLASS_OBJECTPROPERTY (superClass=[exo__Property]) the BFS
  // closure adds the ObjectProperty UID — required for the subClass-closure
  // tests to succeed.
  const FILE_CLASS_OBJECTPROPERTY: FakeFile = {
    path: "exo/9a1cf31c.md",
    basename: "9a1cf31c-9d41-4ef3-9023-584a8d087d16",
    extension: "md",
  };

  // ----- property assets (instance_class is exo__Property direct) -----
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
  // Property asset WITHOUT displayName — exercises label-fallback path.
  const FILE_NO_DISPLAYNAME: FakeFile = {
    path: "ems/no-dn.md",
    basename: "no-dn",
    extension: "md",
  };
  // Property asset with class=ObjectProperty (subClass of Property) — exercises
  // the subClass-closure filter path.
  const FILE_CONCEPT_BROADER: FakeFile = {
    path: "ims/4b67640a.md",
    basename: "4b67640a",
    extension: "md",
  };

  // ----- non-property asset — must be filtered out (regression: 8400800f) -----
  const FILE_NON_PROPERTY: FakeFile = {
    path: "concepts/aliases-concept.md",
    basename: "8400800f",
    extension: "md",
  };

  // ----- collision pair — two property assets sharing the same label -----
  const FILE_COLLISION_A: FakeFile = {
    path: "exo/collision-a.md",
    basename: "collision-a",
    extension: "md",
  };
  const FILE_COLLISION_B: FakeFile = {
    path: "exo/collision-b.md",
    basename: "collision-b",
    extension: "md",
  };

  const FRONTMATTERS: Record<string, any> = {
    [FILE_CLASS_OBJECTPROPERTY.path]: {
      exo__Asset_uid: EXO_OBJECT_PROPERTY_UID,
      exo__Asset_label: "exo__ObjectProperty",
      exo__Class_superClass: [`[[${EXO_PROPERTY_UID}]]`],
    },
    [FILE_EFFORT_AREA.path]: {
      exo__Asset_uid: "ab1b5cc2-0000-0000-0000-000000000000",
      exo__Asset_label: "ems__Effort_area",
      exo__Property_displayName: "Effort Area",
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
      aliases: ["ems__Effort_area"],
    },
    [FILE_EFFORT_STATUS.path]: {
      exo__Asset_uid: "64594641-0000-0000-0000-000000000000",
      exo__Asset_label: "ems__Effort_status",
      exo__Property_displayName: "Effort Status",
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
      aliases: ["ems__Effort_status"],
    },
    [FILE_ASSET_LABEL.path]: {
      exo__Asset_uid: "3d1e4212-0000-0000-0000-000000000000",
      exo__Asset_label: "exo__Asset_label",
      exo__Property_displayName: "Label",
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
      aliases: ["exo__Asset_label"],
    },
    [FILE_NO_DISPLAYNAME.path]: {
      exo__Asset_uid: "deadbeef-0000-0000-0000-000000000000",
      exo__Asset_label: "ems__Tag_field",
      // intentionally no exo__Property_displayName — fallback case
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
    },
    [FILE_CONCEPT_BROADER.path]: {
      exo__Asset_uid: "4b67640a-71b5-4fbb-83bd-82342eed479b",
      exo__Asset_label: "ims__Concept_broader",
      exo__Property_displayName: "broader",
      // class = ObjectProperty, which itself is a subClass of exo__Property.
      // This forces resolvePropertyClassUids to do the BFS expansion.
      exo__Instance_class: [`[[${EXO_OBJECT_PROPERTY_UID}]]`],
    },
    [FILE_NON_PROPERTY.path]: {
      exo__Asset_uid: "8400800f-71c5-48a6-b68d-fd640771ce3e",
      exo__Asset_label: "aliases",
      // class = ims__Concept (not exo__Property and not a subClass) — must
      // be skipped by the filter. Regression guard: 8400800f-... case from
      // RFC-030 §1.1 / §8 intentional behavior change.
      exo__Instance_class: [`[[${IMS_CONCEPT_UID}]]`],
      aliases: ["aliases"],
    },
    [FILE_COLLISION_A.path]: {
      exo__Asset_uid: "aaaa1111-0000-0000-0000-000000000000",
      exo__Asset_label: "exo__Asset_updatedAt",
      exo__Property_displayName: "Updated At (A)",
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
    },
    [FILE_COLLISION_B.path]: {
      exo__Asset_uid: "bbbb2222-0000-0000-0000-000000000000",
      exo__Asset_label: "exo__Asset_updatedAt",
      exo__Property_displayName: "Updated At (B)",
      exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
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
            FILE_CLASS_OBJECTPROPERTY,
            FILE_EFFORT_AREA,
            FILE_EFFORT_STATUS,
            FILE_ASSET_LABEL,
            FILE_NO_DISPLAYNAME,
            FILE_CONCEPT_BROADER,
            FILE_NON_PROPERTY,
            // Collision pair NOT included by default — opt-in per test
            // via mockReturnValueOnce.
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
    jest.useRealTimers();
    jest.clearAllMocks();
    if (mockContainer.parentNode) {
      mockContainer.parentNode.removeChild(mockContainer);
    }
  });

  // ============================================================
  // Pure-function helpers
  // ============================================================
  describe("unwrapWikilinkUid", () => {
    it('returns inner uid for "[[uuid]]" form', () => {
      expect(unwrapWikilinkUid("[[38277bfa-d7f9-4a75-b856-b23276ab0db3]]")).toBe(
        "38277bfa-d7f9-4a75-b856-b23276ab0db3"
      );
    });

    it('returns inner uid for "[[uuid|alias]]" form (strips alias)', () => {
      expect(
        unwrapWikilinkUid("[[38277bfa-d7f9-4a75-b856-b23276ab0db3|Property]]")
      ).toBe("38277bfa-d7f9-4a75-b856-b23276ab0db3");
    });

    it("returns bare uuid string as-is when shape matches UUID layout", () => {
      expect(unwrapWikilinkUid("38277bfa-d7f9-4a75-b856-b23276ab0db3")).toBe(
        "38277bfa-d7f9-4a75-b856-b23276ab0db3"
      );
    });

    it("returns null for non-UUID strings and non-strings", () => {
      expect(unwrapWikilinkUid("not-a-uuid")).toBeNull();
      expect(unwrapWikilinkUid("")).toBeNull();
      expect(unwrapWikilinkUid("   ")).toBeNull();
      expect(unwrapWikilinkUid(null)).toBeNull();
      expect(unwrapWikilinkUid(undefined)).toBeNull();
      expect(unwrapWikilinkUid(42)).toBeNull();
      expect(unwrapWikilinkUid({})).toBeNull();
    });

    it("trims whitespace before parsing", () => {
      expect(
        unwrapWikilinkUid("  [[38277bfa-d7f9-4a75-b856-b23276ab0db3]]  ")
      ).toBe("38277bfa-d7f9-4a75-b856-b23276ab0db3");
    });

    it("strips path prefix from path-qualified wikilink (defensive)", () => {
      // UID-canon TBox doesn't emit path-qualified links, but legacy
      // authoring tools may. Defensive parsing prevents silent BFS-closure
      // miss on class refs like [[03 Knowledge/exo/38277bfa-...]].
      expect(
        unwrapWikilinkUid(
          "[[assetspaces/exo/38277bfa-d7f9-4a75-b856-b23276ab0db3]]"
        )
      ).toBe("38277bfa-d7f9-4a75-b856-b23276ab0db3");
      expect(
        unwrapWikilinkUid(
          "[[some/path/38277bfa-d7f9-4a75-b856-b23276ab0db3|alias]]"
        )
      ).toBe("38277bfa-d7f9-4a75-b856-b23276ab0db3");
    });

    it("returns null when path-stripped form is not a UUID", () => {
      // Symbolic path-qualified wikilink — neither UID-canon nor UUID shape.
      expect(
        unwrapWikilinkUid("[[some/path/symbolic-label]]")
      ).toBeNull();
    });
  });

  describe("normalizeClassList", () => {
    it("returns empty array for missing or invalid input", () => {
      expect(normalizeClassList(undefined)).toEqual([]);
      expect(normalizeClassList(null)).toEqual([]);
      expect(normalizeClassList(42)).toEqual([]);
      expect(normalizeClassList({})).toEqual([]);
    });

    it("handles scalar wikilink string (YAML inline form)", () => {
      // Obsidian YAML can emit `exo__Instance_class: "[[uuid]]"` as scalar.
      expect(normalizeClassList(`[[${EXO_PROPERTY_UID}]]`)).toEqual([
        EXO_PROPERTY_UID,
      ]);
    });

    it("handles array of wikilinks (YAML list form)", () => {
      expect(
        normalizeClassList([
          `[[${EXO_PROPERTY_UID}]]`,
          `[[${EXO_OBJECT_PROPERTY_UID}]]`,
        ])
      ).toEqual([EXO_PROPERTY_UID, EXO_OBJECT_PROPERTY_UID]);
    });

    it("filters out non-string and non-UUID array entries", () => {
      expect(
        normalizeClassList([
          `[[${EXO_PROPERTY_UID}]]`,
          "garbage",
          null,
          42,
          `[[${EXO_OBJECT_PROPERTY_UID}]]`,
        ])
      ).toEqual([EXO_PROPERTY_UID, EXO_OBJECT_PROPERTY_UID]);
    });
  });

  // ============================================================
  // Lifecycle
  // ============================================================
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

  // ============================================================
  // Scenario A — readable labels (displayName path)
  // ============================================================
  describe("Scenario A: known predicates get readable labels via span overlay", () => {
    it("inserts a display span with the displayName while leaving input.value UNCHANGED", () => {
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

  // ============================================================
  // Scenario B — click navigates to definition
  // ============================================================
  describe("Scenario B: clicking readable label opens definition", () => {
    it("plain click opens definition in the SAME tab (getLeaf(false))", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith(false);
      expect(openFileMock).toHaveBeenCalledTimes(1);
      expect(openedFiles[0]).toBe(FILE_EFFORT_STATUS);
    });

    it("Cmd-click (metaKey) opens definition in a NEW tab (getLeaf('tab'))", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        })
      );

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(openFileMock).toHaveBeenCalledTimes(1);
      expect(openedFiles[0]).toBe(FILE_EFFORT_STATUS);
    });

    it("Ctrl-click (ctrlKey) opens definition in a NEW tab — non-mac fallback", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        })
      );

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(openFileMock).toHaveBeenCalledTimes(1);
    });

    it("middle-mouse auxclick (button=1) opens definition in a NEW tab", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.dispatchEvent(
        new MouseEvent("auxclick", {
          bubbles: true,
          cancelable: true,
          button: 1,
        })
      );

      expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith("tab");
      expect(openFileMock).toHaveBeenCalledTimes(1);
    });

    it("right-mouse auxclick (button=2) does NOT open the definition", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_status" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      span.dispatchEvent(
        new MouseEvent("auxclick", {
          bubbles: true,
          cancelable: true,
          button: 2,
        })
      );

      expect(openFileMock).not.toHaveBeenCalled();
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

  // ============================================================
  // Scenario C — unknown predicate fallback
  // ============================================================
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

  // ============================================================
  // RFC-030 §3.2 — displayName → label fallback
  // ============================================================
  describe("RFC-030 displayName fallback", () => {
    it("L7 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 falls back to the label local part when displayName and localName are missing", () => {
      const row = createPropertyRow({ inputValue: "ems__Tag_field" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span).toBeTruthy();
      // FILE_NO_DISPLAYNAME has label "ems__Tag_field" and neither
      // exo__Property_displayName nor exo__Property_localName, so display falls
      // back to the label's local part (issue #4568), not the raw label.
      expect(span.textContent).toBe("field");
    });

    it("L7b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 falls back to the label local part when displayName is empty string", () => {
      // Patch a property asset to have an empty-string displayName
      const tempFile: FakeFile = {
        path: "tmp/empty-dn.md",
        basename: "empty-dn",
        extension: "md",
      };
      const tempFrontmatter = {
        exo__Asset_uid: "11111111-0000-0000-0000-000000000000",
        exo__Asset_label: "ems__Empty_dn",
        exo__Property_displayName: "",
        exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
      };
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([FILE_CLASS_OBJECTPROPERTY, tempFile]);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (file.path === FILE_CLASS_OBJECTPROPERTY.path) {
            return { frontmatter: FRONTMATTERS[FILE_CLASS_OBJECTPROPERTY.path] };
          }
          if (file.path === tempFile.path) {
            return { frontmatter: tempFrontmatter };
          }
          return null;
        });

      const row = createPropertyRow({ inputValue: "ems__Empty_dn" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.textContent).toBe("dn");
    });

    it("L7c @req:0a85d233-f084-4652-bff0-418e18fcb9e0 falls back to the label local part when displayName is whitespace-only", () => {
      const tempFile: FakeFile = {
        path: "tmp/ws-dn.md",
        basename: "ws-dn",
        extension: "md",
      };
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([FILE_CLASS_OBJECTPROPERTY, tempFile]);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (file.path === FILE_CLASS_OBJECTPROPERTY.path) {
            return { frontmatter: FRONTMATTERS[FILE_CLASS_OBJECTPROPERTY.path] };
          }
          if (file.path === tempFile.path) {
            return {
              frontmatter: {
                exo__Asset_uid: "22222222-0000-0000-0000-000000000000",
                exo__Asset_label: "ems__Ws_dn",
                exo__Property_displayName: "   ",
                exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
              },
            };
          }
          return null;
        });

      const row = createPropertyRow({ inputValue: "ems__Ws_dn" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.textContent).toBe("dn");
    });

    it("skips assets entirely when exo__Asset_label is missing", () => {
      const tempFile: FakeFile = {
        path: "tmp/no-label.md",
        basename: "no-label",
        extension: "md",
      };
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([FILE_CLASS_OBJECTPROPERTY, tempFile]);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (file.path === FILE_CLASS_OBJECTPROPERTY.path) {
            return { frontmatter: FRONTMATTERS[FILE_CLASS_OBJECTPROPERTY.path] };
          }
          if (file.path === tempFile.path) {
            return {
              frontmatter: {
                exo__Asset_uid: "33333333-0000-0000-0000-000000000000",
                // intentionally NO exo__Asset_label
                exo__Property_displayName: "Whatever",
                exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
              },
            };
          }
          return null;
        });

      const row = createPropertyRow({ inputValue: "Whatever" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      // Asset lacking label is skipped entirely.
      expect(
        row.querySelector<HTMLSpanElement>(".exo-label-display")
      ).toBeNull();
    });
  });

  // ============================================================
  // RFC-030 §3.2 — rdf:type filter (positive + negative)
  // ============================================================
  describe("RFC-030 rdf:type filter", () => {
    it("indexes asset with direct exo__Property class (positive direct)", () => {
      const row = createPropertyRow({ inputValue: "ems__Effort_area" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      expect(
        row.querySelector<HTMLSpanElement>(".exo-label-display")?.textContent
      ).toBe("Effort Area");
    });

    it("indexes asset with subClass-of-Property class via BFS closure (positive subClass)", () => {
      // FILE_CONCEPT_BROADER has class=exo__ObjectProperty; its class asset
      // declares exo__Class_superClass=[exo__Property]. resolvePropertyClassUids
      // must add ObjectProperty UID to the closure set so this asset indexes.
      const row = createPropertyRow({ inputValue: "ims__Concept_broader" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span?.textContent).toBe("broader");
    });

    it("skips non-property asset (FILE_NON_PROPERTY ims__Concept describing aliases)", () => {
      // FILE_NON_PROPERTY has class=ims__Concept (not a subClass of Property).
      // RFC-030 intentional behavior change: 8400800f-... no longer resolves.
      // The frontmatter key "aliases" must NOT be patched by the resolver
      // (Obsidian native "System Reserved" indicator continues to operate
      // independently).
      const row = createPropertyRow({ inputValue: "aliases" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      expect(
        row.querySelector<HTMLSpanElement>(".exo-label-display")
      ).toBeNull();
    });

    it("skips asset with no exo__Instance_class at all", () => {
      const tempFile: FakeFile = {
        path: "tmp/no-class.md",
        basename: "no-class",
        extension: "md",
      };
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([FILE_CLASS_OBJECTPROPERTY, tempFile]);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (file.path === FILE_CLASS_OBJECTPROPERTY.path) {
            return { frontmatter: FRONTMATTERS[FILE_CLASS_OBJECTPROPERTY.path] };
          }
          if (file.path === tempFile.path) {
            return {
              frontmatter: {
                exo__Asset_uid: "44444444-0000-0000-0000-000000000000",
                exo__Asset_label: "ems__Orphan",
                exo__Property_displayName: "Orphan",
                // intentionally NO exo__Instance_class
              },
            };
          }
          return null;
        });

      const row = createPropertyRow({ inputValue: "ems__Orphan" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      expect(
        row.querySelector<HTMLSpanElement>(".exo-label-display")
      ).toBeNull();
    });

    it("accepts scalar exo__Instance_class (YAML inline form, not array)", () => {
      const tempFile: FakeFile = {
        path: "tmp/scalar-class.md",
        basename: "scalar-class",
        extension: "md",
      };
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([FILE_CLASS_OBJECTPROPERTY, tempFile]);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          if (file.path === FILE_CLASS_OBJECTPROPERTY.path) {
            return { frontmatter: FRONTMATTERS[FILE_CLASS_OBJECTPROPERTY.path] };
          }
          if (file.path === tempFile.path) {
            return {
              frontmatter: {
                exo__Asset_uid: "55555555-0000-0000-0000-000000000000",
                exo__Asset_label: "ems__Scalar_class",
                exo__Property_displayName: "Scalar Class",
                // SCALAR (string, not array) — YAML accepts both forms
                exo__Instance_class: `[[${EXO_PROPERTY_UID}]]`,
              },
            };
          }
          return null;
        });

      const row = createPropertyRow({ inputValue: "ems__Scalar_class" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span?.textContent).toBe("Scalar Class");
    });
  });

  // ============================================================
  // RFC-030 §3.2 — collision guard
  // ============================================================
  describe("RFC-030 collision guard", () => {
    it("first-write-wins on label collision; warns about the second asset", () => {
      // Include both collision-pair fixtures
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([
          FILE_CLASS_OBJECTPROPERTY,
          FILE_COLLISION_A,
          FILE_COLLISION_B,
        ]);

      const warnSpy = jest
        .spyOn(console, "info")
        .mockImplementation(() => undefined);

      const row = createPropertyRow({ inputValue: "exo__Asset_updatedAt" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      // FILE_COLLISION_A enumerated first → wins.
      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span.textContent).toBe("Updated At (A)");

      // Click on the span should open the winning file (A), not the loser.
      span.click();
      expect(openedFiles[0]).toBe(FILE_COLLISION_A);

      // Collision warning fired with both paths in the message.
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain("exo__Asset_updatedAt");
      expect(warnMsg).toContain(FILE_COLLISION_A.path);
      expect(warnMsg).toContain(FILE_COLLISION_B.path);

      warnSpy.mockRestore();
    });

    it("does NOT warn when the same asset is encountered twice (same file.path)", () => {
      // If buildIndex sees same file twice (theoretical, but defensive)
      // we should not log a spurious collision.
      mockApp.vault.getMarkdownFiles = jest
        .fn()
        .mockReturnValue([
          FILE_CLASS_OBJECTPROPERTY,
          FILE_EFFORT_AREA,
          FILE_EFFORT_AREA, // intentional duplicate
        ]);

      const warnSpy = jest
        .spyOn(console, "info")
        .mockImplementation(() => undefined);

      patch.enable();

      // The duplicate file.path is the same — collision-guard treats it as
      // re-write of the same value, not as a real collision.
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // ============================================================
  // Issue #4568 — short names + ClassName. disambiguation per block
  // (req 0a85d233-f084-4652-bff0-418e18fcb9e0). Axis id is the FIRST token of
  // every title — the mutant driver reads it; the @req token follows it.
  // ============================================================
  describe("issue #4568: short name and per-block ClassName. disambiguation", () => {
    const UID_EFFORT = "c1a55000-0000-4000-8000-000000000001";
    const UID_TASK = "c1a55000-0000-4000-8000-000000000002";
    // A domain UID that names no asset in the vault.
    const UID_GHOST = "c1a55000-0000-4000-8000-0000000000ff";

    // Class assets a property's exo__Property_domain may point at. Effort carries
    // an exo__Class_localName DIFFERENT from its label, so an axis can tell
    // which of the two produced the ClassName.
    const CLASS_EFFORT = {
      exo__Asset_uid: UID_EFFORT,
      exo__Asset_label: "ems__Effort",
      exo__Class_localName: "Work",
    };
    const CLASS_TASK = {
      exo__Asset_uid: UID_TASK,
      exo__Asset_label: "ems__Task",
    };

    let nextUid = 0;
    function prop(
      label: string,
      extra: Record<string, unknown> = {}
    ): Record<string, unknown> {
      nextUid += 1;
      return {
        exo__Asset_uid: `70000000-0000-4000-8000-${String(nextUid).padStart(12, "0")}`,
        exo__Asset_label: label,
        exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
        ...extra,
      };
    }

    function useVault(frontmatters: Record<string, Record<string, unknown>>): void {
      const files: FakeFile[] = Object.keys(frontmatters).map((path) => ({
        path,
        basename: path.replace(/^.*\//, "").replace(/\.md$/, ""),
        extension: "md",
      }));
      mockApp.vault.getMarkdownFiles = jest.fn().mockReturnValue(files);
      mockApp.metadataCache.getFileCache = jest
        .fn()
        .mockImplementation((file: FakeFile) => {
          const fm = frontmatters[file.path];
          return fm ? { frontmatter: fm } : null;
        });
    }

    // DOM access goes through untyped helpers: the test type-check program
    // carries two DOM declarations (HTMLElement vs Node), and typed calls here
    // would add diagnostics to this file's ratchet (scripts/check-test-types.mjs).
    function attach(block: any, row: any): void {
      block.appendChild(row);
    }

    function addRows(block: any, ...keys: string[]): any[] {
      return keys.map((key) => {
        const row: any = createPropertyRow({ inputValue: key });
        attach(block, row);
        return row;
      });
    }

    function spanOf(row: any): any {
      return row.querySelector(".exo-label-display");
    }

    function textOf(row: any): string | null {
      return spanOf(row)?.textContent ?? null;
    }

    function inputOf(row: any): any {
      return row.querySelector("input");
    }

    function changedCallback(): () => void {
      const cb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === "changed"
      )?.[1];
      if (typeof cb !== "function") {
        throw new Error("metadataCache 'changed' handler is not registered");
      }
      return cb;
    }

    // The "changed" handler refreshes after a trailing debounce (ems__Bug cc7df026):
    // axes that fire it switch to fake timers BEFORE enable() and flush the refresh.
    function flushRefresh(): void {
      jest.runOnlyPendingTimers();
    }

    // ---------------- pure helpers ----------------

    it("L1 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 the label local part is everything after the class segment", () => {
      expect(labelLocalPart("concept__Concept_genus")).toBe("genus");
      expect(labelLocalPart("ems__Effort_status")).toBe("status");
      // The case the issue names: a compound local part stays whole.
      expect(labelLocalPart("tbank__Task_planned_start_timestamp")).toBe(
        "planned_start_timestamp"
      );
      expect(labelLocalPart("rdfs__seeAlso")).toBe("seeAlso");
      expect(labelLocalPart("aliases")).toBe("aliases");
    });

    it("L1b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a label with an empty local part reads the class segment and its underscore, never an empty name", () => {
      expect(labelLocalPart("ems__Effort_")).toBe("Effort_");
    });

    it("L1c @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a label with nothing after __ reads the whole label, never an empty name", () => {
      expect(labelLocalPart("ems__")).toBe("ems__");
    });

    it("L2 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 class names come from the label class segment and from a class label after __", () => {
      expect(labelClassSegment("ems__Effort_status")).toBe("Effort");
      expect(labelClassSegment("tbank__Task_planned_start_timestamp")).toBe("Task");
      expect(labelClassSegment("rdfs__seeAlso")).toBeNull();
      expect(labelClassSegment("aliases")).toBeNull();
      expect(classNameFromLabel("concept__Concept")).toBe("Concept");
      expect(classNameFromLabel("Person")).toBe("Person");
      expect(classNameFromLabel("ems__")).toBeNull();
    });

    it("L3 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 equal short names of one block get ClassName., a unique one keeps its short name", () => {
      const texts = disambiguateBlockLabels([
        { key: "ems__Effort_status", shortName: "status", className: "Effort" },
        { key: "ems__Task_status", shortName: "status", className: "Task" },
        { key: "ems__Effort_area", shortName: "area", className: "Effort" },
      ]);
      expect(texts.get("ems__Effort_status")).toBe("Effort.status");
      expect(texts.get("ems__Task_status")).toBe("Task.status");
      expect(texts.get("ems__Effort_area")).toBe("area");
    });

    it("L4 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a prefixed text that still collides, or a missing ClassName, falls back to the raw predicate", () => {
      const texts = disambiguateBlockLabels([
        { key: "exo__Asset_label", shortName: "label", className: "Asset" },
        { key: "foo__Asset_label", shortName: "label", className: "Asset" },
        { key: "ems__Effort_parent", shortName: "parent", className: null },
        { key: "ems__Task_parent", shortName: "parent", className: "Task" },
      ]);
      expect(texts.get("exo__Asset_label")).toBe("exo__Asset_label");
      expect(texts.get("foo__Asset_label")).toBe("foo__Asset_label");
      expect(texts.get("ems__Effort_parent")).toBe("ems__Effort_parent");
      expect(texts.get("ems__Task_parent")).toBe("Task.parent");
    });

    it("L5 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a key without a definition takes part in the collision but is not re-texted", () => {
      const texts = disambiguateBlockLabels([
        { key: "status", shortName: null, className: null },
        { key: "ems__Effort_status", shortName: "status", className: "Effort" },
      ]);
      expect(texts.get("ems__Effort_status")).toBe("Effort.status");
      expect(texts.has("status")).toBe(false);
    });

    it("L5b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a prefixed text equal to the raw text of a key without a definition falls back to the raw predicate", () => {
      const texts = disambiguateBlockLabels([
        { key: "Effort.status", shortName: null, className: null },
        { key: "ems__Effort_status", shortName: "status", className: "Effort" },
        { key: "ems__Task_status", shortName: "status", className: "Task" },
      ]);
      expect(texts.get("ems__Effort_status")).toBe("ems__Effort_status");
      expect(texts.get("ems__Task_status")).toBe("Task.status");
    });

    it("L6 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 the decision is order-independent; a unique short name wins over an equal prefixed text", () => {
      const keys = [
        { key: "a__X_status", shortName: "status", className: "X" },
        { key: "b__Y_status", shortName: "status", className: "Y" },
        // A defined key whose OWN short name equals a's prefixed text.
        { key: "c__Z_note", shortName: "X.status", className: "Z" },
      ];
      const expected = new Map([
        ["a__X_status", "a__X_status"],
        ["b__Y_status", "Y.status"],
        ["c__Z_note", "X.status"],
      ]);
      expect(disambiguateBlockLabels(keys)).toEqual(expected);
      expect(disambiguateBlockLabels([...keys].reverse())).toEqual(expected);
    });

    // ---------------- through the real patch on a DOM block ----------------

    it("L8 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 the short name chain: displayName, then exo__Property_localName, then the label local part", () => {
      useVault({
        "p/start.md": prop("tbank__Task_planned_start_timestamp", {
          exo__Property_localName: "plannedStart",
        }),
        "p/due.md": prop("tbank__Task_due_date"),
        "p/owner.md": prop("tbank__Task_owner", {
          exo__Property_localName: "ownerLocal",
          exo__Property_displayName: "Owner",
        }),
        "p/blank.md": prop("tbank__Task_note", {
          exo__Property_localName: "   ",
        }),
      });
      const [start, due, owner, blank] = addRows(
        mockMetadataContainer,
        "tbank__Task_planned_start_timestamp",
        "tbank__Task_due_date",
        "tbank__Task_owner",
        "tbank__Task_note"
      );

      patch.enable();

      expect(textOf(start)).toBe("plannedStart");
      expect(textOf(due)).toBe("due_date");
      expect(textOf(owner)).toBe("Owner");
      // A whitespace-only localName counts as missing.
      expect(textOf(blank)).toBe("note");
    });

    it("L9 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a same-block collision prefixes the domain class name — exo__Class_localName first, else the class label after __", () => {
      useVault({
        "c/effort.md": CLASS_EFFORT,
        "c/task.md": CLASS_TASK,
        "p/es.md": prop("ems__Effort_status", {
          exo__Property_domain: `[[${UID_EFFORT}]]`,
        }),
        // The label class segment (Other) differs from the domain (Task): the
        // axis shows the domain wins.
        "p/os.md": prop("zz__Other_status", {
          exo__Property_domain: `[[${UID_TASK}|ems__Task]]`,
        }),
        "p/area.md": prop("ems__Effort_area", {
          exo__Property_domain: `[[${UID_EFFORT}]]`,
        }),
      });
      const [es, os, area] = addRows(
        mockMetadataContainer,
        "ems__Effort_status",
        "zz__Other_status",
        "ems__Effort_area"
      );

      patch.enable();

      expect(textOf(es)).toBe("Work.status");
      expect(textOf(os)).toBe("Task.status");
      expect(textOf(area)).toBe("area");
      // The native key editor is untouched — no frontmatter rename.
      expect(inputOf(es).value).toBe("ems__Effort_status");
    });

    it("L10 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 without a domain the ClassName is the class segment of the property label", () => {
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const [es, ts] = addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");

      patch.enable();

      expect(textOf(es)).toBe("Effort.status");
      expect(textOf(ts)).toBe("Task.status");
    });

    it("L11 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a symbolic domain is read by its label", () => {
      useVault({
        "p/a.md": prop("zz__A_name", { exo__Property_domain: "[[person__Person]]" }),
        "p/b.md": prop("zz__B_name", { exo__Property_domain: "org__Company" }),
      });
      const [a, b] = addRows(mockMetadataContainer, "zz__A_name", "zz__B_name");

      patch.enable();

      expect(textOf(a)).toBe("Person.name");
      expect(textOf(b)).toBe("Company.name");
    });

    it("L11b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 the first RESOLVABLE domain entry wins — an unknown UID is skipped, not final", () => {
      useVault({
        "c/task.md": CLASS_TASK,
        "p/a.md": prop("zz__A_name", {
          exo__Property_domain: [`[[${UID_GHOST}]]`, `[[${UID_TASK}]]`],
        }),
        "p/b.md": prop("zz__B_name"),
      });
      const [a, b] = addRows(mockMetadataContainer, "zz__A_name", "zz__B_name");

      patch.enable();

      expect(textOf(a)).toBe("Task.name");
      expect(textOf(b)).toBe("B.name");
    });

    it("L11c @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a domain class with neither label nor localName is skipped, not read as its UID", () => {
      useVault({
        "c/bare.md": { exo__Asset_uid: UID_EFFORT },
        "p/a.md": prop("ems__Effort_status", { exo__Property_domain: `[[${UID_EFFORT}]]` }),
        "p/b.md": prop("ems__Task_status"),
      });
      const [a, b] = addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");

      patch.enable();

      expect(textOf(a)).toBe("Effort.status");
      expect(textOf(b)).toBe("Task.status");
    });

    it("L12 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 the context is ONE block: the same pair split across two notes keeps short names", () => {
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const otherContainer: any = document.createElement("div");
      const otherBlock: any = document.createElement("div");
      otherBlock.className = "metadata-container";
      attach(otherContainer, otherBlock);
      attach(document.body, otherContainer);
      mockApp.workspace.getLeavesOfType = jest
        .fn()
        .mockReturnValue([mockWorkspaceLeaf, { view: { containerEl: otherContainer } }]);
      try {
        const [es] = addRows(mockMetadataContainer, "ems__Effort_status");
        const [ts] = addRows(otherBlock, "ems__Task_status");

        patch.enable();

        expect(textOf(es)).toBe("status");
        expect(textOf(ts)).toBe("status");
      } finally {
        otherContainer.remove();
      }
    });

    it("L13 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a key added later re-texts the already patched key of its block", async () => {
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const [es] = addRows(mockMetadataContainer, "ems__Effort_status");
      patch.enable();
      expect(textOf(es)).toBe("status");

      const [ts] = addRows(mockMetadataContainer, "ems__Task_status");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(textOf(es)).toBe("Effort.status");
      expect(textOf(ts)).toBe("Task.status");
      expect(es.querySelectorAll(".exo-label-display").length).toBe(1);
      expect(spanOf(es).getAttribute("aria-label")).toBe(
        "Open definition: Effort.status (ems__Effort_status)"
      );
    });

    it("L14 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 when the collision disappears the next re-render returns the short name", () => {
      jest.useFakeTimers();
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const [es, ts] = addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");
      patch.enable();
      expect(textOf(es)).toBe("Effort.status");

      ts.remove();
      changedCallback()();
      flushRefresh();

      expect(textOf(es)).toBe("status");
    });

    it("L15 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a key without a definition collides too, and is left as it is", () => {
      useVault({ "p/es.md": prop("ems__Effort_status") });
      const [raw, es] = addRows(mockMetadataContainer, "status", "ems__Effort_status");

      patch.enable();

      expect(textOf(raw)).toBeNull();
      expect(inputOf(raw).classList.contains("exo-label-hidden-input")).toBe(false);
      expect(textOf(es)).toBe("Effort.status");
    });

    it("L16 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 keys whose prefixed texts are still equal read their raw predicates", () => {
      useVault({
        "p/a.md": prop("exo__Asset_label"),
        "p/b.md": prop("foo__Asset_label"),
      });
      const [a, b] = addRows(mockMetadataContainer, "exo__Asset_label", "foo__Asset_label");

      patch.enable();

      expect(textOf(a)).toBe("exo__Asset_label");
      expect(textOf(b)).toBe("foo__Asset_label");
    });

    it("L17 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 an explicit displayName collision is disambiguated the same way", () => {
      useVault({
        "p/es.md": prop("ems__Effort_status", { exo__Property_displayName: "Status" }),
        "p/ts.md": prop("ems__Task_status", { exo__Property_displayName: "Status" }),
      });
      const [es, ts] = addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");

      patch.enable();

      expect(textOf(es)).toBe("Effort.Status");
      expect(textOf(ts)).toBe("Task.Status");
    });

    it("L18 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a patched TEXT-node key is re-texted by its predicate, not by the text it now shows", async () => {
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const es: any = createPropertyRowTextKey("ems__Effort_status");
      attach(mockMetadataContainer, es);
      patch.enable();
      expect(textOf(es)).toBe("status");

      const ts: any = createPropertyRowTextKey("ems__Task_status");
      attach(mockMetadataContainer, ts);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(textOf(es)).toBe("Effort.status");
      expect(textOf(ts)).toBe("Task.status");
    });

    it("L18b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a patched TEXT-node key that falls back to raw reads its predicate, not the text it showed", async () => {
      useVault({
        "p/a.md": prop("exo__Asset_label"),
        "p/b.md": prop("foo__Asset_label"),
      });
      const a: any = createPropertyRowTextKey("exo__Asset_label");
      attach(mockMetadataContainer, a);
      patch.enable();
      expect(textOf(a)).toBe("label");

      const b: any = createPropertyRowTextKey("foo__Asset_label");
      attach(mockMetadataContainer, b);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(textOf(a)).toBe("exo__Asset_label");
      expect(textOf(b)).toBe("foo__Asset_label");
    });

    it("L19 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a patched key, the only row of its key, is re-texted from the resolution it was patched with, not from the index", () => {
      jest.useFakeTimers();
      useVault({ "p/es.md": prop("ems__Effort_status") });
      const [es] = addRows(mockMetadataContainer, "ems__Effort_status");
      patch.enable();
      expect(textOf(es)).toBe("status");

      // The index no longer knows ems__Effort_status; ems__Task_status arrives.
      useVault({ "p/ts.md": prop("ems__Task_status") });
      const [ts] = addRows(mockMetadataContainer, "ems__Task_status");
      changedCallback()();
      flushRefresh();

      expect(textOf(es)).toBe("Effort.status");
      expect(textOf(ts)).toBe("Task.status");
    });

    it("L20 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 metadataCache changes on a fully patched block do not rebuild the whole-vault index", () => {
      jest.useFakeTimers();
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");
      patch.enable();
      const scansAfterEnable = mockApp.vault.getMarkdownFiles.mock.calls.length;
      expect(scansAfterEnable).toBe(1);

      const changed = changedCallback();
      for (let i = 0; i < 20; i++) {
        changed();
        // Flush every event on its own: a single trailing refresh would leave
        // M17/M28 (re-resolving patched rows) only one rebuild to show.
        flushRefresh();
      }

      expect(mockApp.vault.getMarkdownFiles.mock.calls.length).toBe(scansAfterEnable);
    });

    it("L20b @req:0a85d233-f084-4652-bff0-418e18fcb9e0 two rows of the same key in one block (a transient re-render) read the short name, not a collision", () => {
      useVault({ "p/es.md": prop("ems__Effort_status") });
      const [first, second] = addRows(
        mockMetadataContainer,
        "ems__Effort_status",
        "ems__Effort_status"
      );

      patch.enable();

      expect(textOf(first)).toBe("status");
      expect(textOf(second)).toBe("status");
    });

    it("L21 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 turning the patch off and on again on the same instance re-patches every key", () => {
      useVault({
        "p/es.md": prop("ems__Effort_status"),
        "p/ts.md": prop("ems__Task_status"),
      });
      const [es, ts] = addRows(mockMetadataContainer, "ems__Effort_status", "ems__Task_status");
      patch.enable();
      expect(textOf(es)).toBe("Effort.status");

      // The settings toggle reuses this object: disable() then enable().
      patch.disable();
      expect(textOf(es)).toBeNull();
      patch.enable();

      expect(textOf(es)).toBe("Effort.status");
      expect(textOf(ts)).toBe("Task.status");
    });

    it("L22 @req:0a85d233-f084-4652-bff0-418e18fcb9e0 a key row added outside any Properties block is patched on its own", async () => {
      useVault({ "p/es.md": prop("ems__Effort_status") });
      patch.enable();

      const lone: any = createPropertyRow({ inputValue: "ems__Effort_status" });
      attach(document.body, lone);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(textOf(lone)).toBe("status");
      } finally {
        lone.remove();
      }
    });
  });

  // ============================================================
  // disable / cleanup
  // ============================================================
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

  // ============================================================
  // Dynamic DOM
  // ============================================================
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

  // ============================================================
  // Index invalidation + Finding-4 recovery
  // ============================================================
  describe("index invalidation", () => {
    it("re-patches on metadataCache changed event", () => {
      jest.useFakeTimers();
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
      jest.runOnlyPendingTimers();

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
      jest.useFakeTimers();
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
      jest.runOnlyPendingTimers();

      // Assert: the row now carries the readable label.
      const span = row.querySelector<HTMLSpanElement>(".exo-label-display");
      expect(span?.textContent).toBe("Effort Area");
    });
  });

  // ============================================================
  // ems__Bug cc7df026: debounced index refresh
  // ============================================================
  // A row whose key has no property definition (`tags`) stays unpatched, so every
  // refresh resolves it and rebuilds the whole-vault index — one getMarkdownFiles
  // call per rebuild. Mutants: PropertiesLabelPatch.debounce-cc7df026.spec.json.
  describe("ems__Bug cc7df026: metadataCache bursts refresh the index once", () => {
    function handler(name: "changed" | "resolved"): () => void {
      const cb = mockApp.metadataCache.on.mock.calls.find(
        (c: any[]) => c[0] === name
      )?.[1];
      if (typeof cb !== "function") {
        throw new Error(`metadataCache '${name}' handler is not registered`);
      }
      return cb;
    }

    function addRow(block: any, key: string): any {
      const row: any = createPropertyRow({ inputValue: key });
      block.appendChild(row);
      return row;
    }

    function scans(): number {
      return mockApp.vault.getMarkdownFiles.mock.calls.length;
    }

    it("D1 fifty changed events on a block with an undefined key rebuild the whole-vault index once, after the burst", () => {
      jest.useFakeTimers();
      addRow(mockMetadataContainer, "ems__Effort_area");
      addRow(mockMetadataContainer, "tags");
      patch.enable();
      expect(scans()).toBe(1);

      const changed = handler("changed");
      for (let i = 0; i < 50; i++) changed();
      expect(scans()).toBe(1);

      jest.runOnlyPendingTimers();
      expect(scans()).toBe(2);
    });

    it("D2 the refresh after a burst sees a property definition that appeared during it", () => {
      jest.useFakeTimers();
      const row = addRow(mockMetadataContainer, "ems__Brand_new");
      patch.enable();
      expect(row.querySelector(".exo-label-display")).toBeNull();

      const brandNew: FakeFile = {
        path: "ems/brand-new.md",
        basename: "brand-new",
        extension: "md",
      };
      FRONTMATTERS[brandNew.path] = {
        exo__Asset_uid: "d2000000-0000-4000-8000-000000000001",
        exo__Asset_label: "ems__Brand_new",
        exo__Instance_class: [`[[${EXO_PROPERTY_UID}]]`],
      };
      const files = mockApp.vault.getMarkdownFiles();
      mockApp.vault.getMarkdownFiles.mockReturnValue([...files, brandNew]);
      try {
        const changed = handler("changed");
        for (let i = 0; i < 3; i++) changed();
        jest.runOnlyPendingTimers();

        expect(row.querySelector(".exo-label-display")?.textContent).toBe("new");
      } finally {
        delete FRONTMATTERS[brandNew.path];
      }
    });

    it("D3 each edit's changed+resolved pair shares one refresh", () => {
      jest.useFakeTimers();
      addRow(mockMetadataContainer, "tags");
      patch.enable();
      expect(scans()).toBe(1);

      const changed = handler("changed");
      const resolved = handler("resolved");
      for (let i = 0; i < 10; i++) {
        changed();
        resolved();
      }
      jest.runOnlyPendingTimers();

      expect(scans()).toBe(2);
    });

    it("D4 disable() cancels a pending refresh", () => {
      jest.useFakeTimers();
      addRow(mockMetadataContainer, "tags");
      patch.enable();
      handler("changed")();

      patch.disable();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  // ============================================================
  // Stylesheet guard
  // ============================================================
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
