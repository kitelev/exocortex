import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

// Production-shape mock vault: real files + metadataCache, so the REAL
// PrintNameRuleService.scanVault → compileDisplayNameSpecs pipeline runs (no
// hand-injected rules), and DisplayNameResolver.resolve drives selection end-to-end.
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
        return mockFiles.find((f) => f.path === cleanPath) ?? null;
      }),
    },
  } as unknown as App;
}

describe("DisplayNameResolver — multi-class membership [req 83be3f2f]", () => {
  // Real class/enum/property UIDs (fixture mirrors the shipped 🔄 / 👥 / ✅👥 specs).
  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const STATUS_PROP_UID = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status
  const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745"; // ems__EffortStatusDoing
  const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6"; // ems__EffortStatusDone
  const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777"; // ems__EffortStatusBacklog
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label

  /**
   * Production-shape vault carrying three real-shaped specs, compiled by the real
   * scanVault pipeline:
   *   - ems__Meeting → "👥 " (UNCONDITIONAL, priority 10)
   *   - ems__Meeting + status=Done → "✅👥 " (CONDITIONAL, priority 60 — the composed spec)
   *   - ems__Task + status=Doing → "🔄 " (CONDITIONAL, priority 50 — the existing 🔄-Doing)
   * Plus the ems__Effort_status property def (so a conditional matchPath UID-form resolves
   * its frontmatter key via the second hop).
   */
  function meetingClassSpecVault(): App {
    return createMockApp([
      // ems__Effort_status property def — second hop for matchPath resolution.
      {
        path: `${STATUS_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_PROP_UID,
          exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
          exo__Asset_label: "ems__Effort_status",
        },
      },

      // --- ems__Meeting → "👥 " (unconditional, priority 10) ---
      {
        path: "spec-meeting-people.md",
        frontmatter: {
          exo__Asset_uid: "spec-meeting-people",
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[ems__Meeting]]",
          exo__DisplayNameSpec_priority: 10,
        },
      },
      {
        path: "mp-literal.md",
        frontmatter: {
          exo__Asset_uid: "mp-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[spec-meeting-people]]",
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "👥 ",
        },
      },
      {
        path: "mp-prop.md",
        frontmatter: {
          exo__Asset_uid: "mp-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[spec-meeting-people]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },

      // --- ems__Meeting + status=Done → "✅👥 " (conditional composed, priority 60) ---
      {
        path: "spec-meeting-done.md",
        frontmatter: {
          exo__Asset_uid: "spec-meeting-done",
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: "[[ems__Meeting]]",
          exo__DisplayNameSpec_priority: 60,
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DONE_UID}]]`,
        },
      },
      {
        path: "md-literal.md",
        frontmatter: {
          exo__Asset_uid: "md-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[spec-meeting-done]]",
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "✅👥 ",
        },
      },
      {
        path: "md-prop.md",
        frontmatter: {
          exo__Asset_uid: "md-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[spec-meeting-done]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },

      // --- ems__Task + status=Doing → "🔄 " (conditional, priority 50) ---
      {
        path: "spec-task-doing.md",
        frontmatter: {
          exo__Asset_uid: "spec-task-doing",
          exo__Instance_class: ["[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]"],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: 50,
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`,
        },
      },
      {
        path: "td-literal.md",
        frontmatter: {
          exo__Asset_uid: "td-literal",
          exo__Instance_class: ["[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]"],
          exo__DisplayNamePart_of: "[[spec-task-doing]]",
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "🔄 ",
        },
      },
      {
        path: "td-prop.md",
        frontmatter: {
          exo__Asset_uid: "td-prop",
          exo__Instance_class: ["[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]"],
          exo__DisplayNamePart_of: "[[spec-task-doing]]",
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
    ]);
  }

  // A note whose exo__Instance_class carries BOTH classes, in the given order.
  function multiClassMeeting(
    classes: string[],
    statusUid: string,
    label = "Weekly sync",
  ): Record<string, unknown> {
    return {
      exo__Instance_class: classes,
      exo__Asset_label: label,
      ems__Effort_status: `[[${statusUid}]]`,
    };
  }

  function buildResolver(app: App): DisplayNameResolver {
    const service = new PrintNameRuleService(app);
    service.initialize(); // real scanVault → compileDisplayNameSpecs
    // EMPTY classTemplates — proves the VAULT specs (not TS hardcodes) drive the prefixes.
    return new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
  }

  it("@req:83be3f2f-5b8a-49bb-a142-61918977b268 a Task-first multi-class meeting gets the ems__Meeting 👥 prefix (the reported bug — class-membership, not first-class-only) [revert-verify anchor]", () => {
    const resolver = buildResolver(meetingClassSpecVault());

    // exo__Instance_class = [ ems__Task, ems__Meeting ] — Meeting is NOT first, status NOT Doing.
    // Class-membership: the ems__Meeting 👥 spec applies because the class is PRESENT.
    // Revert-verify RED anchor: reverting the resolver to instance_class[0]-only makes only
    // ems__Task be consulted → the 🔄-Doing conditional is skipped (Backlog) → fallback label →
    // "Weekly sync" (👥 dropped) → this assertion RED. Restore → GREEN.
    const taskFirst = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Task]]", "[[ems__Meeting]]"], BACKLOG_UID),
      basename: "meeting-note",
    });
    expect(taskFirst).toBe("👥 Weekly sync");
  });

  it("is order-independent: a Meeting-first note gets the same 👥 prefix (byte-identical to today, guards symmetry)", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    const meetingFirst = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Meeting]]", "[[ems__Task]]"], BACKLOG_UID),
      basename: "meeting-note",
    });
    expect(meetingFirst).toBe("👥 Weekly sync");
  });

  it("the highest-priority participating spec across ALL classes wins — a Done Task-first meeting gets the composed ✅👥", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    // Done: the composed ems__Meeting+Done ✅👥 spec (priority 60) beats the unconditional
    // ems__Meeting 👥 (priority 10); the ems__Task 🔄-Doing conditional is skipped (not Doing).
    const done = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Task]]", "[[ems__Meeting]]"], DONE_UID),
      basename: "meeting-note",
    });
    expect(done).toBe("✅👥 Weekly sync");
  });

  it("two distinct-prefix specs simultaneously applicable → exactly ONE wins (composition out of scope)", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    // Doing: BOTH the ems__Task 🔄-Doing spec (priority 50) AND the ems__Meeting 👥 spec
    // (priority 10) participate. The single-winning-template model picks ONE — the highest
    // priority (🔄). It does NOT compose into "🔄👥" (prefix composition is a further design,
    // explicitly out of scope for req 83be3f2f).
    const doing = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Task]]", "[[ems__Meeting]]"], DOING_UID),
      basename: "meeting-note",
    });
    expect(doing).toBe("🔄 Weekly sync");
    // Non-vacuity: exactly one prefix, not both, not the other.
    expect(doing).not.toContain("👥");
  });

  it("no-regression: a single-class ems__Meeting note is byte-identical (still 👥), both before and after the membership change", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    const single = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Meeting]]"], BACKLOG_UID),
      basename: "meeting-note",
    });
    expect(single).toBe("👥 Weekly sync");
  });

  it("no-regression + negative control: a single-class ems__Task note (Backlog) shows the bare label — the membership fix does NOT leak 👥 onto a non-Meeting note", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    const taskOnly = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Task]]"], BACKLOG_UID, "Fix the parser"),
      basename: "task-note",
    });
    expect(taskOnly).toBe("Fix the parser");
  });

  it("no-regression: a single-class ems__Task note (Doing) still gets its own 🔄 (single-class path unaffected)", () => {
    const resolver = buildResolver(meetingClassSpecVault());
    const doingTask = resolver.resolve({
      metadata: multiClassMeeting(["[[ems__Task]]"], DOING_UID, "Fix the parser"),
      basename: "task-note",
    });
    expect(doingTask).toBe("🔄 Fix the parser");
  });
});
