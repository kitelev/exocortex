import {
  PropertiesLabelPatch,
  unwrapWikilinkUid,
  normalizeClassList,
} from "../../../../src/presentation/properties/PropertiesLabelPatch";

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
    it("falls back to exo__Asset_label when displayName is missing", () => {
      const row = createPropertyRow({ inputValue: "ems__Tag_field" });
      mockMetadataContainer.appendChild(row);

      patch.enable();

      const span = row.querySelector<HTMLSpanElement>(".exo-label-display")!;
      expect(span).toBeTruthy();
      // FILE_NO_DISPLAYNAME has label "ems__Tag_field" and no
      // exo__Property_displayName, so display falls back to the label itself.
      expect(span.textContent).toBe("ems__Tag_field");
    });

    it("falls back when displayName is empty string", () => {
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
      expect(span.textContent).toBe("ems__Empty_dn");
    });

    it("falls back when displayName is whitespace-only", () => {
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
      expect(span.textContent).toBe("ems__Ws_dn");
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
        .spyOn(console, "warn")
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
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      patch.enable();

      // The duplicate file.path is the same — collision-guard treats it as
      // re-write of the same value, not as a real collision.
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
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
