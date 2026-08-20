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

  it("applies a spec from a PARENT class to a child-class asset (class-hierarchy inheritance)", () => {
    const app = createMockApp([
      {
        path: "task-class.md",
        frontmatter: {
          exo__Asset_uid: "taskcls",
          exo__Instance_class: ["[[8619c4fc-64f1-4869-b17e-e34186cacca9|exo__Class]]"],
          exo__Asset_label: "ems__Task",
          exo__Class_superClass: ["[[E|ems__Effort]]"],
        },
      },
      {
        path: "spec.md",
        frontmatter: {
          exo__Asset_uid: "spec",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[E|ems__Effort]]",
          exo__DisplayNameSpec_priority: 1,
        },
      },
      {
        path: "part.md",
        frontmatter: {
          exo__Asset_uid: "part",
          exo__Instance_class: ["[[exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[spec]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "EFFORT",
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    // direct spec on the parent class...
    expect(service.getTemplateForClass("ems__Effort")!.template).toBe("EFFORT");
    // ...inherited by the child class via the hierarchy walk.
    expect(service.getTemplateForClass("ems__Task")!.template).toBe("EFFORT");
  });

  it("refresh() reloads specs from the vault", () => {
    const app = createMockApp([]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    expect(service.getRulesCount()).toBe(0);

    (app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([
      { path: "spec.md", basename: "spec", extension: "md" } as TFile,
      { path: "part.md", basename: "part", extension: "md" } as TFile,
    ]);
    (app.metadataCache.getFileCache as jest.Mock).mockImplementation((f: TFile) =>
      f.path === "spec.md"
        ? {
            frontmatter: {
              exo__Asset_uid: "spec",
              exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
              exo__DisplayNameSpec_appliesToClass: "[[ems__Task]]",
            },
          }
        : f.path === "part.md"
          ? {
              frontmatter: {
                exo__Asset_uid: "part",
                exo__Instance_class: ["[[exo__PrintedLiteral]]"],
                exo__DisplayNamePart_of: "[[spec]]",
                exo__DisplayNamePart_order: 1,
                exo__PrintedLiteral_literal: "X",
              },
            }
          : null,
    );

    service.refresh();
    expect(service.getRulesCount()).toBe(1);
  });

  it("skips a spec with no parts and a part carrying neither property nor literal", () => {
    const app = createMockApp([
      {
        path: "empty-spec.md",
        frontmatter: {
          exo__Asset_uid: "es",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[ems__Task]]",
        },
      },
      {
        path: "bad-part.md",
        frontmatter: {
          exo__Asset_uid: "bp",
          exo__Instance_class: ["[[exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[es]]",
          exo__DisplayNamePart_order: 1,
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    expect(service.getRulesCount()).toBe(0);
    expect(service.getTemplateForClass("ems__Task")).toBeNull();
  });
});

describe("PrintNameRuleService — conditional exo__DisplayNameSpec (v2 slice, per-render matcher) [req ed4201d1]", () => {
  // Real class/enum/property UIDs (the fixture mirrors the shipped 🔄-Doing spec).
  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const STATUS_PROP_UID = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status
  const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745"; // ems__EffortStatusDoing
  const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6"; // ems__EffortStatusDone
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label
  const SPEC_UID = "spec-doing-cond-uid";

  // Production-shape vault: a CONDITIONAL 🔄-Doing spec (matchPath=ems__Effort_status,
  // matchValue=EffortStatusDoing) + its two ordered parts + the ems__Effort_status
  // property def (so matchPath's UID-form resolves the frontmatter key via a second hop).
  // NO hand-injected rule — the real scanVault→compile pipeline builds the matcher.
  function conditionalDoingSpecVault(priority = 50): App {
    return createMockApp([
      {
        path: `${STATUS_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_PROP_UID,
          exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
          exo__Asset_label: "ems__Effort_status",
        },
      },
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: priority,
          // UID-canon strip-alias form → second-hop resolves the property KEY "ems__Effort_status".
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`,
        },
      },
      {
        path: "cond-literal.md",
        frontmatter: {
          exo__Asset_uid: "cond-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "🔄 ",
        },
      },
      {
        path: "cond-prop.md",
        frontmatter: {
          exo__Asset_uid: "cond-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
    ]);
  }

  function taskMeta(statusValue: string, label = "Fix the parser"): Record<string, unknown> {
    return {
      exo__Instance_class: [`[[${TASK_UID}]]`],
      exo__Asset_label: label,
      ems__Effort_status: statusValue,
    };
  }

  it("@req:ed4201d1-f9da-4142-b12a-5769d4c67f38 the conditional 🔄-Doing spec applies ONLY to a Doing task; a non-Doing task falls through to the label (revert-verify anchor)", () => {
    const app = conditionalDoingSpecVault();
    const service = new PrintNameRuleService(app);
    service.initialize();

    // EMPTY classTemplates — proves the VAULT conditional spec drives the 🔄, not a TS hardcode.
    // Revert-verify RED anchor: neutralize the per-render matcher gate (treat conditional
    // rules as always-participating) → the DONE task ALSO gets "🔄 " → this assertion RED.
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );

    const doing = resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t1" });
    expect(doing).toBe("🔄 Fix the parser");

    const done = resolver.resolve({ metadata: taskMeta(`[[${DONE_UID}]]`), basename: "t2" });
    expect(done).toBe("Fix the parser");
  });

  it("evaluates the condition PER-RENDER — the same loaded spec flips 🔄 on/off as the instance status changes (no re-scan)", () => {
    const app = conditionalDoingSpecVault();
    const service = new PrintNameRuleService(app);
    service.initialize(); // scanVault runs ONCE

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );

    // Same task, three consecutive renders with a changing status — no service.refresh() between them.
    expect(resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t" })).toBe(
      "🔄 Fix the parser",
    );
    expect(resolver.resolve({ metadata: taskMeta(`[[${DONE_UID}]]`), basename: "t" })).toBe(
      "Fix the parser",
    );
    expect(resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t" })).toBe(
      "🔄 Fix the parser",
    );
  });

  it("dual-IRI equality — matches the Doing status in UID form AND in the [[uid|label]] alias form", () => {
    const app = conditionalDoingSpecVault();
    const service = new PrintNameRuleService(app);
    service.initialize();
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );

    // UID form
    expect(resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t" })).toBe(
      "🔄 Fix the parser",
    );
    // alias form [[uid|label]] — cleaned-identity equality, not raw-string.
    // Revert-verify RED anchor #2: break the dual-IRI cleaning → this assertion RED.
    expect(
      resolver.resolve({
        metadata: taskMeta(`[[${DOING_UID}|ems__EffortStatusDoing]]`),
        basename: "t",
      }),
    ).toBe("🔄 Fix the parser");
    // a genuinely different status must NOT match (negative control — non-vacuity).
    expect(
      resolver.resolve({
        metadata: taskMeta(`[[${DONE_UID}|ems__EffortStatusDone]]`),
        basename: "t",
      }),
    ).toBe("Fix the parser");
  });

  it("dual-IRI equality closes the bare-label gap — a UID-form matchValue matches a BARE-label-form status via the compile-time second hop", () => {
    // The shipped spec authors matchValue UID-canon [[<doing-uid>]]; a legacy instance may
    // store its status as the bare label [[ems__EffortStatusDoing]] (no UID). With the
    // enum asset present, resolveMatchValues expands matchValue to {uid, label} at compile
    // time, so the bare-label instance still matches. Fixture includes the EffortStatusDoing
    // enum asset so the second hop can read its uid + label.
    const app = createMockApp([
      {
        path: `${DOING_UID}.md`,
        frontmatter: {
          exo__Asset_uid: DOING_UID,
          exo__Instance_class: ["[[ems__EffortStatus]]"],
          exo__Asset_label: "ems__EffortStatusDoing",
        },
      },
      {
        path: `${STATUS_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_PROP_UID,
          exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
          exo__Asset_label: "ems__Effort_status",
        },
      },
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: 50,
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`, // UID-canon
        },
      },
      {
        path: "cond-literal.md",
        frontmatter: {
          exo__Asset_uid: "cond-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "🔄 ",
        },
      },
      {
        path: "cond-prop.md",
        frontmatter: {
          exo__Asset_uid: "cond-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    // bare label-form status (target IS the label, no UID) still resolves the 🔄.
    expect(
      resolver.resolve({ metadata: taskMeta("[[ems__EffortStatusDoing]]"), basename: "t" }),
    ).toBe("🔄 Fix the parser");
    // UID-form still works.
    expect(resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t" })).toBe(
      "🔄 Fix the parser",
    );
    // a different bare label must NOT match (negative control).
    expect(
      resolver.resolve({ metadata: taskMeta("[[ems__EffortStatusDone]]"), basename: "t" }),
    ).toBe("Fix the parser");
  });

  it("a matched conditional spec COMPOSES with a lower-priority unconditional spec (priority sets order); an unmatched conditional yields to it alone [req 1a550210]", () => {
    // Two specs on ems__Task: a HIGH-priority conditional 🔄-Doing (prio 80) + a LOW-priority
    // unconditional "[TASK] <label>" (prio 1). Doing → BOTH participate → prefix composition prints
    // them priority-DESC ("🔄 [TASK] <label>"); non-Doing → the conditional is skipped and only the
    // unconditional participates.
    const app = createMockApp([
      // conditional (priority 80)
      {
        path: `${STATUS_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_PROP_UID,
          exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
          exo__Asset_label: "ems__Effort_status",
        },
      },
      {
        path: "cond-spec.md",
        frontmatter: {
          exo__Asset_uid: "cond-spec",
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: 80,
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`,
        },
      },
      {
        path: "cl.md",
        frontmatter: {
          exo__Asset_uid: "cl",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[cond-spec]]",
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "🔄 ",
        },
      },
      {
        path: "cp.md",
        frontmatter: {
          exo__Asset_uid: "cp",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[cond-spec]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
      // unconditional (priority 1)
      {
        path: "uncond-spec.md",
        frontmatter: {
          exo__Asset_uid: "uncond-spec",
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: 1,
        },
      },
      {
        path: "ul.md",
        frontmatter: {
          exo__Asset_uid: "ul",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[uncond-spec]]",
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "[TASK] ",
        },
      },
      {
        path: "up.md",
        frontmatter: {
          exo__Asset_uid: "up",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[uncond-spec]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );

    // Doing → BOTH participate → composition prints 🔄 (prio 80) before [TASK] (prio 1).
    expect(resolver.resolve({ metadata: taskMeta(`[[${DOING_UID}]]`), basename: "t" })).toBe(
      "🔄 [TASK] Fix the parser",
    );
    // Done → conditional skipped → only the unconditional "[TASK] <label>" participates.
    expect(resolver.resolve({ metadata: taskMeta(`[[${DONE_UID}]]`), basename: "t" })).toBe(
      "[TASK] Fix the parser",
    );
  });

  it("no-regression: an unconditional spec compiles WITHOUT a matcher (v1 path byte-identical, works with no metadata)", () => {
    // A pure-v1 spec (no matchPath/matchValue) resolves exactly as before — including via
    // getTemplateForClass called with NO metadata (the v1 signature).
    const app = createMockApp([
      {
        path: "v1-spec.md",
        frontmatter: {
          exo__Asset_uid: "v1-spec",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[C|ems__Project]]",
          exo__DisplayNameSpec_priority: 5,
        },
      },
      {
        path: "v1-part.md",
        frontmatter: {
          exo__Asset_uid: "v1-part",
          exo__Instance_class: ["[[exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[v1-spec]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "PROJECT",
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    // v1 call shape (no metadata) still returns the unconditional rule.
    const byUid = service.getTemplateForClass("ems__Project");
    expect(byUid).not.toBeNull();
    expect(byUid!.template).toBe("PROJECT");
    // and with metadata it is unchanged (matcher-less → always participates).
    const withMeta = service.getTemplateForClass("ems__Project", {
      exo__Instance_class: ["[[ems__Project]]"],
    });
    expect(withMeta!.template).toBe("PROJECT");
  });
});

describe("PrintNameRuleService — host-function exo__DisplayNameSpec (v2 computed matcher, cross-asset) [req d6cd2371]", () => {
  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label
  const SPEC_UID = "spec-blocked-hostfn-uid";
  const BLOCKER_BASENAME = "the-blocking-task";

  // Production-shape vault: a 🚩-blocked exo__DisplayNameSpec for ems__Task whose matcher is a
  // HOST FUNCTION (matchHostFunction=isEffortBlocked) + its two ordered parts + a BLOCKER asset
  // the task's ems__Effort_blocker resolves to. The service is wired with the REAL registry
  // (the built-in registry) so the REAL BlockerHelpers.isEffortBlocked runs —
  // NO hand-injected matcher result. `setBlockerStatus` mutates the SAME blocker cache so a
  // per-render test can flip the CROSS-ASSET condition without a re-scan.
  function blockedHostFnVault(
    opts: {
      priority?: number;
      blockerStatus?: string | null; // bare-label form, e.g. "[[ems__EffortStatusDoing]]"
      hostFunctionName?: string; // override to exercise the fail-closed path
      extraFiles?: Array<{ path: string; frontmatter: Record<string, unknown> }>;
    } = {},
  ): {
    service: PrintNameRuleService;
    resolver: DisplayNameResolver;
    setBlockerStatus: (status: string | null) => void;
  } {
    // The blocker's frontmatter is a live object shared with the fileCache so status flips
    // are visible to isEffortBlocked on the next render (mirrors metadataCache re-reads).
    const blockerFm: Record<string, unknown> = {
      exo__Asset_uid: "blocker-asset-uid",
      exo__Asset_label: "The blocking task",
    };
    if (opts.blockerStatus != null) blockerFm.ems__Effort_status = opts.blockerStatus;

    const fileCache = new Map<string, CachedMetadata>();
    const mockFiles: TFile[] = [];
    const addFile = (path: string, frontmatter: Record<string, unknown>) => {
      const tfile = new TFile(path);
      tfile.basename = path.replace(".md", "");
      tfile.extension = "md";
      mockFiles.push(tfile);
      fileCache.set(path, { frontmatter } as CachedMetadata);
    };

    addFile(`${SPEC_UID}.md`, {
      exo__Asset_uid: SPEC_UID,
      exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
      exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
      exo__DisplayNameSpec_priority: opts.priority ?? 100,
      // The computed matcher: a plain string naming the registered host function.
      exo__DisplayNameSpec_matchHostFunction: opts.hostFunctionName ?? "isEffortBlocked",
    });
    addFile("blocked-literal.md", {
      exo__Asset_uid: "blocked-literal",
      exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
      exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
      exo__DisplayNamePart_order: 0,
      exo__PrintedLiteral_literal: "🚩 ",
    });
    addFile("blocked-prop.md", {
      exo__Asset_uid: "blocked-prop",
      exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
      exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
      exo__DisplayNamePart_order: 1,
      exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
    });
    addFile(`${BLOCKER_BASENAME}.md`, blockerFm); // fileCache holds the SAME blockerFm reference

    for (const ef of opts.extraFiles ?? []) addFile(ef.path, ef.frontmatter);

    const app = {
      vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
      metadataCache: {
        getFileCache: jest
          .fn()
          .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
        getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
          const cleanPath = path.endsWith(".md") ? path : path + ".md";
          return mockFiles.find((f) => f.path === cleanPath) ?? null;
        }),
      },
    } as unknown as App;

    // Wire the REAL registry (isEffortBlocked → BlockerHelpers.isEffortBlocked).
    const service = new PrintNameRuleService(app);
    service.initialize();
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    const setBlockerStatus = (status: string | null) => {
      if (status === null) delete blockerFm.ems__Effort_status;
      else blockerFm.ems__Effort_status = status;
    };
    return { service, resolver, setBlockerStatus };
  }

  function taskMeta(
    opts: { blocker?: string | null; label?: string } = {},
  ): Record<string, unknown> {
    const m: Record<string, unknown> = {
      exo__Instance_class: [`[[${TASK_UID}]]`],
      exo__Asset_label: opts.label ?? "Ship the release",
    };
    if (opts.blocker != null) m.ems__Effort_blocker = opts.blocker;
    return m;
  }

  it("@req:d6cd2371-bdf2-460e-840e-841480273869 a 🚩-blocked host-function spec applies ONLY to a blocked task; a non-blocked task falls through to the label (revert-verify anchor)", () => {
    // The blocker asset's status is Doing (not done) → real isEffortBlocked returns true for a
    // task referencing it. EMPTY classTemplates prove the VAULT host-function spec drives the 🚩,
    // not a TS hardcode. Revert-verify RED anchor: neutralize the host-function matcher gate
    // (treat host-function rules as never-participating) → the blocked task loses "🚩 " → RED.
    const { resolver } = blockedHostFnVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });

    const blocked = resolver.resolve({
      metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }),
      basename: "t1",
    });
    expect(blocked).toBe("🚩 Ship the release");

    // No blocker → isEffortBlocked false → the spec does NOT participate.
    const notBlocked = resolver.resolve({ metadata: taskMeta(), basename: "t2" });
    expect(notBlocked).toBe("Ship the release");
  });

  it("the condition is CROSS-ASSET — a task whose blocker is DONE is not blocked → no 🚩 (reads the BLOCKER's status, not the task's own frontmatter)", () => {
    const { resolver } = blockedHostFnVault({ blockerStatus: "[[ems__EffortStatusDone]]" });
    // The task DOES carry ems__Effort_blocker, but the referenced blocker is Done → not blocked.
    expect(
      resolver.resolve({
        metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }),
        basename: "t",
      }),
    ).toBe("Ship the release");
  });

  it("@req:d6cd2371-bdf2-460e-840e-841480273869 a BARE-UID Done status also unblocks — the form the vault actually stores", () => {
    // ⛔ The axis this surface was missing entirely. Every other fixture here writes the status
    // SYMBOLICALLY (`[[ems__EffortStatusDone]]`), which short-circuits before the status-form
    // normalisation runs — so all of these tests passed identically with and WITHOUT the dual-IRI
    // fix, on the very surface where the wrongly-flagged efforts live. Measured 2026-08-15: 49 of
    // 49 blockers carrying a status use this bare-UID form and zero use symbolic, i.e. the shape
    // exercised below is the ONLY one that occurs in production.
    const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";
    const { resolver } = blockedHostFnVault({
      blockerStatus: `[[${DONE_UID}]]`,
      // The status TBox must be present, exactly as it is in a real vault: the fix resolves the
      // UID through the vault rather than against a hardcoded table, so omitting it would send
      // the predicate down its "unknown ⇒ still blocking" fallback and hide the fix.
      extraFiles: [
        {
          path: `${DONE_UID}.md`,
          frontmatter: {
            exo__Asset_uid: DONE_UID,
            exo__Asset_label: "ems__EffortStatusDone",
          },
        },
      ],
    });

    const notBlocked = resolver.resolve({
      metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }),
      basename: "t1",
    });

    // Pre-fix this rendered "🚩 Ship the release": the bracket strip left a UID, which matched
    // neither terminal label, so a FINISHED blocker read as active.
    expect(notBlocked).toBe("Ship the release");
  });

  it("@req:d6cd2371-bdf2-460e-840e-841480273869 an ALIASED blocker link still blocks — the link form must not decide the answer (issue #4057)", () => {
    // ⛤ The discriminating axis. Pre-fix `isEffortBlocked` stripped BRACKETS only, so
    // `[[<basename>|display text]]` reached the port as `<basename>|display text`, which resolves
    // to nothing → "no such blocker" → fail-OPEN (no 🚩) on a genuinely blocked task.
    //
    // ⛔ This fixture is faithful precisely because `getFirstLinkpathDest` above does NOT strip the
    // alias — that mirrors Obsidian. The CLI adapter DOES strip it
    // (`FileSystemVaultAdapter.getFirstLinkpathDest` → `linkpath.split("|")[0]`), which is why the
    // defect was surface-ASYMMETRIC: the same vault rendered 🚩 through the CLI naming oracle and
    // not in the plugin. A fake that stripped the alias would be green both ways — decoration.
    //
    // ⚠ Inert as of 2026-08-16: 0 of 74 live blockers carry an alias (counted from RAW frontmatter,
    // since SPARQL discards the alias and is structurally blind to this question). The reason to
    // close it is the divergence, not the incidence — stated rather than implied.
    const { resolver } = blockedHostFnVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });

    expect(
      resolver.resolve({
        metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}|Some display text]]` }),
        basename: "t1",
      }),
    ).toBe("🚩 Ship the release");
  });

  it("@req:d6cd2371-bdf2-460e-840e-841480273869 CONTROL — an ALIASED blocker that is DONE still unblocks, so the fix is not 'always blocked'", () => {
    // Same aliased form, terminal blocker. Green both ways — pre-fix because the link did not
    // resolve, post-fix because it resolves and reads Done. Recorded so that a future "simplify"
    // cannot reduce the pair to this case, which discriminates nothing on its own.
    const { resolver } = blockedHostFnVault({ blockerStatus: "[[ems__EffortStatusDone]]" });

    expect(
      resolver.resolve({
        metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}|Some display text]]` }),
        basename: "t1",
      }),
    ).toBe("Ship the release");
  });

  it("@req:d6cd2371-bdf2-460e-840e-841480273869 CONTROL — an aliased link to a NON-EXISTENT blocker stays fail-safe (no 🚩)", () => {
    // The asymmetry documented on `resolveStatusLabel` must survive the fix: an unresolvable
    // BLOCKER yields "not blocked" (a blocker that does not exist cannot block), whereas an
    // unresolvable STATUS yields "still blocking". Stripping the alias must not turn the first
    // into the second by accident.
    const { resolver } = blockedHostFnVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });

    expect(
      resolver.resolve({
        metadata: taskMeta({ blocker: "[[no-such-asset|Some display text]]" }),
        basename: "t1",
      }),
    ).toBe("Ship the release");
  });

  it("evaluates the condition PER-RENDER — the SAME loaded spec flips 🚩 on/off as the referenced BLOCKER's status changes (cross-asset, no re-scan)", () => {
    const { resolver, setBlockerStatus } = blockedHostFnVault({
      blockerStatus: "[[ems__EffortStatusDoing]]",
    });
    const meta = taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }); // SAME task metadata throughout

    // blocker not-done → blocked → 🚩
    expect(resolver.resolve({ metadata: meta, basename: "t" })).toBe("🚩 Ship the release");
    // the OTHER asset (the blocker) becomes Done → task no longer blocked → 🚩 disappears (no refresh()).
    setBlockerStatus("[[ems__EffortStatusDone]]");
    expect(resolver.resolve({ metadata: meta, basename: "t" })).toBe("Ship the release");
    // blocker reverts to not-done → 🚩 returns.
    setBlockerStatus("[[ems__EffortStatusDoing]]");
    expect(resolver.resolve({ metadata: meta, basename: "t" })).toBe("🚩 Ship the release");
  });

  it("a matched host-function spec COMPOSES with a lower-priority unconditional spec (priority sets order); an unmatched one yields to it alone [req 1a550210]", () => {
    const { resolver } = blockedHostFnVault({
      priority: 80, // host-function spec
      blockerStatus: "[[ems__EffortStatusDoing]]",
      extraFiles: [
        {
          path: "uncond-spec.md",
          frontmatter: {
            exo__Asset_uid: "uncond-spec",
            exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
            exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
            exo__DisplayNameSpec_priority: 1,
          },
        },
        {
          path: "ul.md",
          frontmatter: {
            exo__Asset_uid: "ul",
            exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
            exo__DisplayNamePart_of: "[[uncond-spec]]",
            exo__DisplayNamePart_order: 0,
            exo__PrintedLiteral_literal: "[TASK] ",
          },
        },
        {
          path: "up.md",
          frontmatter: {
            exo__Asset_uid: "up",
            exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
            exo__DisplayNamePart_of: "[[uncond-spec]]",
            exo__DisplayNamePart_order: 1,
            exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
          },
        },
      ],
    });

    // blocked → BOTH participate → prefix composition prints them in priority-DESC order:
    // 🚩 (host-fn, prio 80) before [TASK] (unconditional, prio 1) → "🚩 [TASK] <label>" (req 1a550210).
    expect(
      resolver.resolve({ metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }), basename: "t" }),
    ).toBe("🚩 [TASK] Ship the release");
    // not blocked → host-function skipped → only the unconditional "[TASK] <label>" participates.
    expect(resolver.resolve({ metadata: taskMeta(), basename: "t" })).toBe(
      "[TASK] Ship the release",
    );
  });

  it("a spec naming an UNREGISTERED host function never participates (fail-closed) → falls through to the label", () => {
    const { resolver } = blockedHostFnVault({
      blockerStatus: "[[ems__EffortStatusDoing]]",
      hostFunctionName: "noSuchDisplayMatcher",
    });
    // Even a genuinely blocked task gets no 🚩 — the unknown function can't be evaluated.
    expect(
      resolver.resolve({ metadata: taskMeta({ blocker: `[[${BLOCKER_BASENAME}]]` }), basename: "t" }),
    ).toBe("Ship the release");
  });

  it("no-regression: a no-matcher spec is byte-identical even with the host-function registry wired (v1 path, no metadata)", () => {
    // A pure-v1 spec (no matchPath/matchValue/matchHostFunction) still always participates when
    // the service is constructed WITH the real host-function registry.
    const app = createMockApp([
      {
        path: "v1-spec.md",
        frontmatter: {
          exo__Asset_uid: "v1-spec",
          exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[C|ems__Project]]",
          exo__DisplayNameSpec_priority: 5,
        },
      },
      {
        path: "v1-part.md",
        frontmatter: {
          exo__Asset_uid: "v1-part",
          exo__Instance_class: ["[[exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[v1-spec]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "PROJECT",
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    // v1 call shape (no metadata) still returns the unconditional rule.
    expect(service.getTemplateForClass("ems__Project")!.template).toBe("PROJECT");
    // and with metadata it is unchanged (matcher-less → always participates).
    expect(
      service.getTemplateForClass("ems__Project", {
        exo__Instance_class: ["[[ems__Project]]"],
      })!.template,
    ).toBe("PROJECT");
  });
});

describe("PrintNameRuleService — full-homoiconic seed removal (#3838 part 3)", () => {
  const TASK_PROTO_UID = "df7e579d-02d4-4f3a-971f-3d1d785b689b";
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae";
  const SPEC_UID = "e20fda38-shaped-taskproto-spec";

  // Production-shape vault mirroring the SHIPPED unconditional TaskPrototype spec
  // (e20fda38 on kitelev/exoas-exo): appliesToClass=ems__TaskPrototype, priority 100,
  // UNCONDITIONAL → PrintedProperty(label) order 1 + PrintedLiteral(" (TaskPrototype)") order 2.
  function taskProtoSpecFiles(): Array<{ path: string; frontmatter: Record<string, unknown> }> {
    return [
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_PROTO_UID}|ems__TaskPrototype]]`,
          exo__DisplayNameSpec_priority: 100,
        },
      },
      {
        path: "e20-prop.md",
        frontmatter: {
          exo__Asset_uid: "e20-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
      {
        path: "e20-literal.md",
        frontmatter: {
          exo__Asset_uid: "e20-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 2,
          exo__PrintedLiteral_literal: " (TaskPrototype)",
        },
      },
    ];
  }

  it("the vault spec (not a TS classTemplate seed) provides the TaskPrototype suffix with EMPTY classTemplates", () => {
    // GREEN: the shipped-shape spec is present in the vault → an ems__TaskPrototype instance
    // gets " (TaskPrototype)" through the real scanVault→compile→resolve pipeline, with the TS
    // classTemplates seeds REMOVED (classTemplates: {}). This proves the suffix is vault-sourced.
    const app = createMockApp(taskProtoSpecFiles());
    const service = new PrintNameRuleService(app);
    service.initialize();

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    // prototype keyed by the REAL class UID (how real instances reference exo__Instance_class)
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: [`[[${TASK_PROTO_UID}]]`],
          exo__Asset_label: "Measure HRV",
        },
        basename: TASK_PROTO_UID,
      }),
    ).toBe("Measure HRV (TaskPrototype)");
  });

  it("REVERT-VERIFY: without the vault spec, the same prototype instance falls to the plain label (proves the spec — not a seed — drives the suffix)", () => {
    // RED direction executable: remove the exo__DisplayNameSpec from the fixture vault → the
    // service finds no rule → the resolver falls to the (empty) classTemplates → defaultTemplate
    // → plain label. If a TS classTemplate seed still existed, this would STILL be suffixed.
    const app = createMockApp([]); // no spec in the vault
    const service = new PrintNameRuleService(app);
    service.initialize();

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: [`[[${TASK_PROTO_UID}]]`],
          exo__Asset_label: "Measure HRV",
        },
        basename: TASK_PROTO_UID,
      }),
    ).toBe("Measure HRV");
  });

  it("no regression: EMPTY classTemplates leaves a plain non-prototype class at the plain label", () => {
    // A class with NO spec + empty classTemplates → plain label (unchanged from the seeded world,
    // where the pure-label classes had already been dropped as byte-identical to the default).
    const app = createMockApp(taskProtoSpecFiles());
    const service = new PrintNameRuleService(app);
    service.initialize();

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: ["[[ems__Task]]"],
          exo__Asset_label: "Fix bug",
        },
        basename: "fix-bug",
      }),
    ).toBe("Fix bug");
  });
});

describe("PrintNameRuleService — appliesToClass second-hop symmetry (#3838 part 2)", () => {
  const TASK_PROTO_UID = "df7e579d-02d4-4f3a-971f-3d1d785b689b";
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae";
  const SPEC_UID = "bare-uid-appliesto-spec";

  // A spec authored appliesToClass in the UID-canon strip-alias form `[[<uid>]]` (NO alias),
  // plus the TaskPrototype CLASS asset (so the compile-time second hop can read its uid + label),
  // plus its two ordered parts. With the second-hop symmetry (resolveIdentityForms), the spec
  // registers under BOTH df7e579d AND ems__TaskPrototype.
  function bareUidAppliesToFiles(
    opts: { includeClassAsset?: boolean } = { includeClassAsset: true },
  ): Array<{ path: string; frontmatter: Record<string, unknown> }> {
    const files: Array<{ path: string; frontmatter: Record<string, unknown> }> = [];
    if (opts.includeClassAsset) {
      files.push({
        // the class def asset — second hop reads its exo__Asset_uid + exo__Asset_label
        path: `${TASK_PROTO_UID}.md`,
        frontmatter: {
          exo__Asset_uid: TASK_PROTO_UID,
          exo__Instance_class: ["[[8619c4fc-64f1-4869-b17e-e34186cacca9|exo__Class]]"],
          exo__Asset_label: "ems__TaskPrototype",
        },
      });
    }
    files.push(
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          // BARE UID — no `|label` alias. Without the second hop only df7e579d is indexed.
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_PROTO_UID}]]`,
          exo__DisplayNameSpec_priority: 100,
        },
      },
      {
        path: "p2-prop.md",
        frontmatter: {
          exo__Asset_uid: "p2-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
      {
        path: "p2-literal.md",
        frontmatter: {
          exo__Asset_uid: "p2-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 2,
          exo__PrintedLiteral_literal: " (TaskPrototype)",
        },
      },
    );
    return files;
  }

  it("a bare-UID-authored appliesToClass matches a LABEL-keyed instance via the second hop", () => {
    // GREEN: appliesToClass `[[df7e579d]]` (bare UID) + the class asset present → the second hop
    // reads the class asset's exo__Asset_label (ems__TaskPrototype) and registers the spec under
    // BOTH df7e579d AND ems__TaskPrototype. An instance keying exo__Instance_class by the LABEL
    // form `[[ems__TaskPrototype]]` therefore matches and gets the suffix.
    const app = createMockApp(bareUidAppliesToFiles());
    const service = new PrintNameRuleService(app);
    service.initialize();

    // registered under BOTH forms:
    expect(service.getTemplateForClass(TASK_PROTO_UID)!.template).toBe(
      "{{exo__Asset_label}} (TaskPrototype)",
    );
    expect(service.getTemplateForClass("ems__TaskPrototype")!.template).toBe(
      "{{exo__Asset_label}} (TaskPrototype)",
    );

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    // instance keyed by the LABEL form (the form NOT literally present in appliesToClass).
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
          exo__Asset_label: "Morning routine",
        },
        basename: "morning-routine",
      }),
    ).toBe("Morning routine (TaskPrototype)");
    // and the UID form still matches (both indexed).
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: [`[[${TASK_PROTO_UID}]]`],
          exo__Asset_label: "Morning routine",
        },
        basename: "morning-routine",
      }),
    ).toBe("Morning routine (TaskPrototype)");
  });

  it("REVERT-VERIFY (data control): without the class asset the second hop finds no label → the LABEL-keyed instance does NOT match", () => {
    // The second hop DEPENDS on reading the referenced class asset's label. Remove the class
    // asset → resolveIdentityForms('[[df7e579d]]') yields only df7e579d → the LABEL-keyed
    // instance falls through to the plain label. (This is also exactly the behaviour the OLD
    // plain-extractClassKeys code produced for a bare-UID appliesToClass — a functional RED.)
    const app = createMockApp(bareUidAppliesToFiles({ includeClassAsset: false }));
    const service = new PrintNameRuleService(app);
    service.initialize();

    // only the bare UID is indexed now:
    expect(service.getTemplateForClass(TASK_PROTO_UID)!.template).toBe(
      "{{exo__Asset_label}} (TaskPrototype)",
    );
    expect(service.getTemplateForClass("ems__TaskPrototype")).toBeNull();

    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
    expect(
      resolver.resolve({
        metadata: {
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
          exo__Asset_label: "Morning routine",
        },
        basename: "morning-routine",
      }),
    ).toBe("Morning routine");
  });

  it("byte-identical for shipped alias-form appliesToClass — `[[uid|label]]` still registers under both forms (the hop adds nothing)", () => {
    // The shipped specs author appliesToClass `[[uid|label]]`; extractClassKeys already returns
    // both forms, so resolveIdentityForms is a no-op superset → no behavioural change for them.
    const app = createMockApp([
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_PROTO_UID}|ems__TaskPrototype]]`,
          exo__DisplayNameSpec_priority: 100,
        },
      },
      {
        path: "p2-literal.md",
        frontmatter: {
          exo__Asset_uid: "p2-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedLiteral_literal: "PROTO",
        },
      },
    ]);
    const service = new PrintNameRuleService(app);
    service.initialize();
    expect(service.getTemplateForClass(TASK_PROTO_UID)!.template).toBe("PROTO");
    expect(service.getTemplateForClass("ems__TaskPrototype")!.template).toBe("PROTO");
  });
});

describe("PrintNameRuleService — scheduleRefresh() debounce (iPhone crash-loop fix, ems__Bug 98df110e)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("collapses a burst of scheduleRefresh() calls into ONE scanVault (was one full O(N) walk per 'changed' event)", () => {
    jest.useFakeTimers();
    const app = createMockApp([]);
    const service = new PrintNameRuleService(app);
    // getMarkdownFiles() is called exactly once per scanVault() → a proxy for scan-count.
    const scan = app.vault.getMarkdownFiles as jest.Mock;

    // Simulate a sync burst: many metadataCache "changed" events in quick succession.
    for (let i = 0; i < 8; i++) service.scheduleRefresh();

    // Debounced: NO full walk yet. The un-debounced bug did 8 walks here → the O(K·N) storm
    // that triggered iOS Jetsam. This assertion is RED if scheduleRefresh scans immediately.
    expect(scan).not.toHaveBeenCalled();

    // After the debounce window, exactly ONE scanVault runs for the whole burst.
    jest.advanceTimersByTime(PRINT_NAME_RESCAN_DEBOUNCE_MS);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("still performs the scan eventually — does not swallow the refresh", () => {
    jest.useFakeTimers();
    const app = createMockApp([]);
    const service = new PrintNameRuleService(app);
    const scan = app.vault.getMarkdownFiles as jest.Mock;

    service.scheduleRefresh();
    jest.advanceTimersByTime(PRINT_NAME_RESCAN_DEBOUNCE_MS);
    expect(scan).toHaveBeenCalledTimes(1);
  });
});

const PRINT_NAME_RESCAN_DEBOUNCE_MS = 300;
