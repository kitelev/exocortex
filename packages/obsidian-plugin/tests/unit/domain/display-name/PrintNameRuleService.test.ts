import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

function createMockApp(files: Array<{ path: string; frontmatter: Record<string, unknown> }>): App {
  const fileCache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];

  for (const f of files) {
    const tfile = new TFile(f.path);
    tfile.basename = f.path.replace(".md", "");
    tfile.extension = "md";
    mockFiles.push(tfile);
    fileCache.set(f.path, { frontmatter: f.frontmatter } as CachedMetadata);
  }

  return {
    vault: {
      getMarkdownFiles: jest.fn().mockReturnValue(mockFiles),
    },
    metadataCache: {
      getFileCache: jest.fn().mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const cleanPath = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find(f => f.path === cleanPath) ?? null;
      }),
    },
  } as unknown as App;
}

describe("PrintNameRuleService", () => {
  describe("basic rule resolution", () => {
    it("should find rule for exact class match", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__TaskPrototype]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (TP)",
            exoob__Rule_priority: 100,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const result = service.getTemplateForClass("ems__TaskPrototype");
      expect(result).not.toBeNull();
      expect(result!.template).toBe("{{exo__Asset_label}} (TP)");
      expect(result!.priority).toBe(100);
    });

    it("should return null when no rule exists for class", () => {
      const app = createMockApp([]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getTemplateForClass("ems__Task")).toBeNull();
    });

    it("should return null when not initialized", () => {
      const app = createMockApp([]);
      const service = new PrintNameRuleService(app);

      expect(service.getTemplateForClass("ems__Task")).toBeNull();
    });
  });

  describe("priority resolution", () => {
    it("should use highest priority rule when multiple rules for same class", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (low)",
            exoob__Rule_priority: 10,
          },
        },
        {
          path: "rule2.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (high)",
            exoob__Rule_priority: 100,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const result = service.getTemplateForClass("ems__Task");
      expect(result!.template).toBe("{{exo__Asset_label}} (high)");
      expect(result!.priority).toBe(100);
    });

    it("should default priority to 0 when not specified", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}}",
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const result = service.getTemplateForClass("ems__Task");
      expect(result!.priority).toBe(0);
    });
  });

  describe("class hierarchy inheritance", () => {
    it("should inherit rule from parent class", () => {
      const app = createMockApp([
        {
          path: "effort-class.md",
          frontmatter: {
            exo__Instance_class: ["[[exo__Class]]"],
            exo__Asset_label: "ems__Task",
            exo__Class_superClass: "[[ems__Effort]]",
          },
        },
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Effort]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (Effort)",
            exoob__Rule_priority: 50,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const result = service.getTemplateForClass("ems__Task");
      expect(result).not.toBeNull();
      expect(result!.template).toBe("{{exo__Asset_label}} (Effort)");
    });

    it("should prefer direct class rule over inherited rule", () => {
      const app = createMockApp([
        {
          path: "task-class.md",
          frontmatter: {
            exo__Instance_class: ["[[exo__Class]]"],
            exo__Asset_label: "ems__Task",
            exo__Class_superClass: "[[ems__Effort]]",
          },
        },
        {
          path: "effort-rule.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Effort]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (Effort)",
            exoob__Rule_priority: 50,
          },
        },
        {
          path: "task-rule.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (Task)",
            exoob__Rule_priority: 10,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const result = service.getTemplateForClass("ems__Task");
      expect(result!.template).toBe("{{exo__Asset_label}} (Task)");
    });
  });

  describe("wikilink class value cleaning", () => {
    it("should handle class without wikilink brackets", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "ems__Task",
            exoob__PrintNameRule_template: "{{exo__Asset_label}}",
            exoob__Rule_priority: 10,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getTemplateForClass("ems__Task")).not.toBeNull();
    });

    it("should handle class with wikilink brackets", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}}",
            exoob__Rule_priority: 10,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getTemplateForClass("ems__Task")).not.toBeNull();
    });
  });

  describe("invalid rules", () => {
    it("should skip rules without template", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__Rule_priority: 10,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getTemplateForClass("ems__Task")).toBeNull();
    });

    it("should skip rules without class", () => {
      const app = createMockApp([
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_template: "{{exo__Asset_label}}",
            exoob__Rule_priority: 10,
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getRulesCount()).toBe(0);
    });
  });

  describe("refresh", () => {
    it("should reload rules on refresh", () => {
      const app = createMockApp([]);
      const service = new PrintNameRuleService(app);
      service.initialize();

      expect(service.getRulesCount()).toBe(0);

      const newFiles = [
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: ["[[exoob__PrintNameRule]]"],
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}}",
            exoob__Rule_priority: 10,
          },
        },
      ];
      const newMockFile = { path: "rule1.md", basename: "rule1", extension: "md" } as TFile;
      (app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([newMockFile]);
      (app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: TFile) => {
        if (file.path === "rule1.md") {
          return { frontmatter: newFiles[0].frontmatter };
        }
        return null;
      });

      service.refresh();

      expect(service.getRulesCount()).toBe(1);
    });
  });

  describe("metadataResolver", () => {
    it("should resolve wikilink to metadata", () => {
      const app = createMockApp([
        {
          path: "project.md",
          frontmatter: {
            exo__Asset_label: "My Project",
            exo__Instance_class: ["[[ems__Project]]"],
          },
        },
      ]);

      const service = new PrintNameRuleService(app);
      service.initialize();

      const resolver = service.createMetadataResolver();
      const metadata = resolver("[[project]]");
      expect(metadata).not.toBeNull();
      expect(metadata!.exo__Asset_label).toBe("My Project");
    });

    it("should return null for non-existent targets", () => {
      const app = createMockApp([]);
      const service = new PrintNameRuleService(app);
      service.initialize();

      const resolver = service.createMetadataResolver();
      expect(resolver("[[nonexistent]]")).toBeNull();
    });
  });
});

describe("PrintNameRuleService — exo__DisplayNameSpec (v1 thin, single-hop) [req b4ee3caa]", () => {
  const TASK_PROTO_UID = "df7e579d-02d4-4f3a-971f-3d1d785b689b";
  const SPEC_UID = "spec-taskproto-uid";

  // Production-shape vault: one exo__DisplayNameSpec + a PrintedProperty part + a PrintedLiteral part.
  function taskPrototypeSpecVault(): App {
    return createMockApp([
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_PROTO_UID}|ems__TaskPrototype]]`,
          exo__DisplayNameSpec_priority: 10,
        },
      },
      {
        path: "part-prop.md",
        frontmatter: {
          exo__Asset_uid: "part-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: "[[12a6151b-801f-4be2-bd6e-a787eedd56ae|exo__Asset_label]]",
        },
      },
      {
        path: "part-literal.md",
        frontmatter: {
          exo__Asset_uid: "part-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 2,
          exo__PrintedLiteral_literal: " (TaskPrototype)",
        },
      },
    ]);
  }

  it("@req:b4ee3caa-8dda-4596-89b2-59111b14602f compiles a vault DisplayNameSpec into a template and renders the composed displayName (revert-verify anchor)", () => {
    const app = taskPrototypeSpecVault();
    const service = new PrintNameRuleService(app);
    service.initialize();

    // Ordered parts compile to a single-hop template string.
    const byUid = service.getTemplateForClass(TASK_PROTO_UID);
    expect(byUid).not.toBeNull();
    expect(byUid!.template).toBe("{{exo__Asset_label}} (TaskPrototype)");

    // #2110 dual-keying: the SAME spec is reachable by the class LABEL too.
    const byLabel = service.getTemplateForClass("ems__TaskPrototype");
    expect(byLabel).not.toBeNull();
    expect(byLabel!.template).toBe("{{exo__Asset_label}} (TaskPrototype)");

    // End-to-end render with EMPTY classTemplates — proves the VAULT spec (not a TS
    // hardcode) drives the suffix. Revert-verify RED anchor: reverting scanVault's
    // spec-reading makes getTemplateForClass return null → resolver falls to
    // defaultTemplate → displayName becomes the raw label "Morning Routine".
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    const displayName = resolver.resolve({
      metadata: {
        exo__Instance_class: [`[[${TASK_PROTO_UID}]]`],
        exo__Asset_label: "Morning Routine",
      },
      basename: TASK_PROTO_UID,
    });
    expect(displayName).toBe("Morning Routine (TaskPrototype)");
  });

  it("selects the higher-priority spec when two specs apply to the same class", () => {
    const app = createMockApp([
      {
        path: "specA.md",
        frontmatter: {
          exo__Asset_uid: "specA",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[C|ems__Task]]",
          exo__DisplayNameSpec_priority: 1,
        },
      },
      {
        path: "pA.md",
        frontmatter: {
          exo__Asset_uid: "pA",
          exo__Instance_class: ["[[exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[specA]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "LOW",
        },
      },
      {
        path: "specB.md",
        frontmatter: {
          exo__Asset_uid: "specB",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[C|ems__Task]]",
          exo__DisplayNameSpec_priority: 99,
        },
      },
      {
        path: "pB.md",
        frontmatter: {
          exo__Asset_uid: "pB",
          exo__Instance_class: ["[[exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[specB]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "HIGH",
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    const result = service.getTemplateForClass("ems__Task");
    expect(result).not.toBeNull();
    expect(result!.template).toBe("HIGH");
  });

  it("returns null (→ resolver fallback) for a class with no spec", () => {
    const service = new PrintNameRuleService(createMockApp([]));
    service.initialize();
    expect(service.getTemplateForClass("ems__Whatever")).toBeNull();
  });

  it("resolves a PrintedProperty authored with the UID-canon strip-alias form [[<uid>]] via a second hop", () => {
    const PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae";
    const app = createMockApp([
      // the exo__Property def asset — second hop reads its exo__Asset_label
      {
        path: `${PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: PROP_UID,
          exo__Instance_class: ["[[ae56ca4c-b610-42a4-a25d-058c23673296|exo__DatatypeProperty]]"],
          exo__Asset_label: "exo__Asset_label",
        },
      },
      {
        path: "spec.md",
        frontmatter: {
          exo__Asset_uid: "spec",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[C|ems__Task]]",
          exo__DisplayNameSpec_priority: 1,
        },
      },
      {
        path: "part.md",
        frontmatter: {
          exo__Asset_uid: "part",
          exo__Instance_class: ["[[exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[spec]]",
          exo__DisplayNamePart_order: 1,
          // strip-alias UID-canon form — no "|label"
          exo__PrintedProperty_property: `[[${PROP_UID}]]`,
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    const result = service.getTemplateForClass("ems__Task");
    expect(result).not.toBeNull();
    expect(result!.template).toBe("{{exo__Asset_label}}");
  });
});
