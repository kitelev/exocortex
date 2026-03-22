import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
            exoob__PrintNameRule_class: "[[ems__Task]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (low)",
            exoob__Rule_priority: 10,
          },
        },
        {
          path: "rule2.md",
          frontmatter: {
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "exo__Class",
            exo__Asset_label: "ems__Task",
            exo__Class_superClass: "[[ems__Effort]]",
          },
        },
        {
          path: "rule1.md",
          frontmatter: {
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "exo__Class",
            exo__Asset_label: "ems__Task",
            exo__Class_superClass: "[[ems__Effort]]",
          },
        },
        {
          path: "effort-rule.md",
          frontmatter: {
            exo__Instance_class: "[[exoob__PrintNameRule]]",
            exoob__PrintNameRule_class: "[[ems__Effort]]",
            exoob__PrintNameRule_template: "{{exo__Asset_label}} (Effort)",
            exoob__Rule_priority: 50,
          },
        },
        {
          path: "task-rule.md",
          frontmatter: {
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "exoob__PrintNameRule",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "[[exoob__PrintNameRule]]",
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
            exo__Instance_class: "ems__Project",
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
