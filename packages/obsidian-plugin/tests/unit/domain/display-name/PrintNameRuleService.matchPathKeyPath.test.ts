import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DisplayNameTemplateEngine } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

/**
 * req fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 — `exo__DisplayNameSpec_matchPath` supports a
 * dot-notation key-path, so ONE conditional spec covers every prototype of a class
 * (`exo__Asset_prototype.exo__Instance_class`) instead of N specs for N prototypes.
 *
 * Integration-STYLE by nature (real scanVault → compile → per-render matcher → real
 * DisplayNameResolver over a production-shape vault; nothing about the key-path walk is
 * stubbed), placed under tests/unit/** because that is what the plugin jest config
 * actually runs — `packages/obsidian-plugin/tests/integration/**` matches NO testMatch
 * pattern (verified: `jest --listTests` yields 0 files there), so a @req binding parked
 * there would satisfy the requirements-trace grep while never executing.
 *
 * Fixture shapes mirror the live vault — MEASURED over all three vaults (29 574 files),
 * not inferred from one sample:
 *   exo__Asset_prototype  545 scalar "[[<uid>]]" / 68 YAML list  — BOTH forms are live;
 *                         for ems__Meeting (the req's trigger class) 189 / 11, i.e. the
 *                         list form is 5.5% of it. Scenario 5 covers the list form; without
 *                         the first-element hop it fails SILENTLY.
 *   exo__Instance_class   a list (reduced by extractClassKeys' first-element convention)
 */
function createMockApp(
  files: Array<{ path: string; frontmatter: Record<string, unknown> }>,
): App {
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
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const cleanPath = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === cleanPath) ?? null;
      }),
    },
  } as unknown as App;
}

describe("PrintNameRuleService — matchPath dot-notation key-path [req fedeaa6e]", () => {
  const MEETING_UID = "3f2a1c88-1d4e-4b7a-9c33-51a0e7d9b204"; // ems__Meeting (class)
  const MEETING_PROTO_UID = "7c9e4b10-88a2-42f5-b6d1-2e0c5a37f9ab"; // ems__MeetingPrototype (class)
  const TASK_PROTO_UID = "df7e579d-02d4-4f3a-971f-3d1d785b689b"; // ems__TaskPrototype (class)
  const PROTO_PROP_UID = "5f830626-42d5-409d-9bf6-331129812038"; // exo__Asset_prototype (property)
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label (property)
  const MEETING_PROTO_ASSET = "a1b2c3d4-5e6f-4071-8293-0a1b2c3d4e5f"; // a MeetingPrototype INSTANCE
  const TASK_PROTO_ASSET = "b2c3d4e5-6f70-4182-93a4-1b2c3d4e5f60"; // a TaskPrototype INSTANCE

  const SPEC_UID = "spec-meeting-keypath-uid";

  /**
   * Production-shape vault: a conditional spec whose matchPath is a DOT-PATH authored the
   * canonical way — an aliased wikilink whose alias IS the key-path (resolvePropertyKey
   * takes the alias verbatim, so it arrives at matcher.matchKey unchanged).
   */
  function meetingKeyPathVault(): App {
    return createMockApp([
      {
        path: `${PROTO_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: PROTO_PROP_UID,
          exo__Instance_class: [
            "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]",
          ],
          exo__Asset_label: "exo__Asset_prototype",
        },
      },
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: [
            "[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]",
          ],
          exo__DisplayNameSpec_appliesToClass: `[[${MEETING_UID}|ems__Meeting]]`,
          exo__DisplayNameSpec_priority: 50,
          // The dot-path addresses a property of the RELATED prototype asset.
          exo__DisplayNameSpec_matchPath: `[[${PROTO_PROP_UID}|exo__Asset_prototype.exo__Instance_class]]`,
          exo__DisplayNameSpec_matchValue: `[[${MEETING_PROTO_UID}]]`,
        },
      },
      {
        path: "kp-literal.md",
        frontmatter: {
          exo__Asset_uid: "kp-literal",
          exo__Instance_class: [
            "[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]",
          ],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "📅 ",
        },
      },
      {
        path: "kp-prop.md",
        frontmatter: {
          exo__Asset_uid: "kp-prop",
          exo__Instance_class: [
            "[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]",
          ],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
      // The RELATED assets the key-path hops onto.
      {
        path: `${MEETING_PROTO_ASSET}.md`,
        frontmatter: {
          exo__Asset_uid: MEETING_PROTO_ASSET,
          exo__Instance_class: [`[[${MEETING_PROTO_UID}]]`],
          exo__Asset_label: "Weekly sync (prototype)",
        },
      },
      {
        path: `${TASK_PROTO_ASSET}.md`,
        frontmatter: {
          exo__Asset_uid: TASK_PROTO_ASSET,
          exo__Instance_class: [`[[${TASK_PROTO_UID}]]`],
          exo__Asset_label: "Recurring chore (prototype)",
        },
      },
    ]);
  }

  /** `prototypeValue` takes BOTH live authoring forms: a scalar wikilink or a YAML list. */
  function meetingMeta(
    prototypeValue?: string | string[],
    label = "Sync 2026-08-12",
  ): Record<string, unknown> {
    return {
      exo__Instance_class: [`[[${MEETING_UID}]]`],
      exo__Asset_label: label,
      ...(prototypeValue === undefined
        ? {}
        : { exo__Asset_prototype: prototypeValue }),
    };
  }

  function keyPathResolverUnderTest(): DisplayNameResolver {
    const service = new PrintNameRuleService(meetingKeyPathVault());
    service.initialize();
    // EMPTY classTemplates — proves the VAULT spec drives the 📅, not a TS hardcode.
    return new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );
  }

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 scenario 1 — a dot-notation key-path matches a property of the RELATED asset (bare wikilink form)", () => {
    const resolver = keyPathResolverUnderTest();

    // Revert-verify axis 1 (RED anchor): neutralize the dot-branch in matcherSatisfied
    // (fall back to the flat metadata[matchKey] read) → the key-path never resolves →
    // this assertion goes RED while scenario 4 stays GREEN.
    expect(
      resolver.resolve({
        metadata: meetingMeta(`[[${MEETING_PROTO_ASSET}]]`),
        basename: "m1",
      }),
    ).toBe("📅 Sync 2026-08-12");
  });

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 scenario 2 — fail-closed when the related asset is of another class, or the reference is absent", () => {
    const resolver = keyPathResolverUnderTest();

    // prototype exists but is a TaskPrototype, not a MeetingPrototype
    expect(
      resolver.resolve({
        metadata: meetingMeta(`[[${TASK_PROTO_ASSET}]]`),
        basename: "m2",
      }),
    ).toBe("Sync 2026-08-12");

    // no exo__Asset_prototype at all
    expect(
      resolver.resolve({ metadata: meetingMeta(undefined), basename: "m3" }),
    ).toBe("Sync 2026-08-12");

    // the reference points at an asset that does not exist in the vault
    expect(
      resolver.resolve({
        metadata: meetingMeta("[[99999999-0000-4000-8000-000000000000]]"),
        basename: "m4",
      }),
    ).toBe("Sync 2026-08-12");
  });

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 scenario 3 — both wikilink forms resolve identically: [[uid]] and [[uid|alias]]", () => {
    const resolver = keyPathResolverUnderTest();

    // Revert-verify axis 2 (RED anchor): neutralize the |alias strip in
    // createMetadataResolver → getFirstLinkpathDest("<uid>|<label>") fails → SILENT
    // non-match → ONLY this aliased assertion goes RED; scenario 1 stays GREEN.
    expect(
      resolver.resolve({
        metadata: meetingMeta(
          `[[${MEETING_PROTO_ASSET}|Weekly sync (prototype)]]`,
        ),
        basename: "m5",
      }),
    ).toBe("📅 Sync 2026-08-12");

    // bare form — the control that keeps axis 2 honest (must stay GREEN under that revert)
    expect(
      resolver.resolve({
        metadata: meetingMeta(`[[${MEETING_PROTO_ASSET}]]`),
        basename: "m6",
      }),
    ).toBe("📅 Sync 2026-08-12");

    // negative control: an aliased reference to the WRONG class must still not match,
    // so the alias strip cannot be "fixed" by matching everything.
    expect(
      resolver.resolve({
        metadata: meetingMeta(
          `[[${TASK_PROTO_ASSET}|Recurring chore (prototype)]]`,
        ),
        basename: "m7",
      }),
    ).toBe("Sync 2026-08-12");
  });

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 scenario 5 — a reference authored as a YAML LIST resolves like the scalar form", () => {
    const resolver = keyPathResolverUnderTest();

    // 68 of 613 exo__Asset_prototype values across the vaults are YAML lists (11 of 200
    // ems__Meeting instances — the req's own trigger class). Before the first-element hop
    // an array fell into the plain-object branch and silently failed to match, which would
    // have made the Job Story's "ONE spec covers ALL prototypes" false for 5.5% of meetings.
    //
    // Revert-verify axis 3 (RED anchor): remove the Array.isArray hop in resolveKeyPath →
    // ONLY this scenario goes RED; scenarios 1/3 (scalar + aliased scalar) stay GREEN.
    expect(
      resolver.resolve({
        metadata: meetingMeta([`[[${MEETING_PROTO_ASSET}]]`]),
        basename: "m8",
      }),
    ).toBe("📅 Sync 2026-08-12");

    // the list form must honour the alias strip too (both fixes compose)
    expect(
      resolver.resolve({
        metadata: meetingMeta([
          `[[${MEETING_PROTO_ASSET}|Weekly sync (prototype)]]`,
        ]),
        basename: "m9",
      }),
    ).toBe("📅 Sync 2026-08-12");

    // negative control — a list pointing at the WRONG class must still not match
    expect(
      resolver.resolve({
        metadata: meetingMeta([`[[${TASK_PROTO_ASSET}]]`]),
        basename: "m10",
      }),
    ).toBe("Sync 2026-08-12");

    // negative control — an EMPTY list is fail-closed, not a crash
    expect(
      resolver.resolve({ metadata: meetingMeta([]), basename: "m11" }),
    ).toBe("Sync 2026-08-12");
  });

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 the |alias strip also reaches TEMPLATE dot-paths (shared resolver — documented blast radius)", () => {
    // createMetadataResolver is shared with DisplayNameTemplateEngine's {{a.b}} walk, so the
    // alias strip changes template rendering too: an intermediate reference authored
    // [[uid|label]] used to resolve to null (empty render) and now dereferences. The req
    // itself cites this authoring form, so the effect is intended — this pins it.
    const service = new PrintNameRuleService(meetingKeyPathVault());
    service.initialize();
    const engine = new DisplayNameTemplateEngine(
      "{{exo__Asset_prototype.exo__Asset_label}}",
    );

    const rendered = engine.render(
      {
        exo__Asset_prototype: `[[${MEETING_PROTO_ASSET}|Weekly sync (prototype)]]`,
      },
      "basename",
      undefined,
      service.createMetadataResolver(),
    );
    expect(rendered).toBe("Weekly sync (prototype)");
  });
});

describe("PrintNameRuleService — single-component matchPath is byte-identical [req fedeaa6e scenario 4]", () => {
  const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
  const STATUS_PROP_UID = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status
  const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
  const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";
  const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae";
  const SPEC_UID = "spec-nodot-uid";

  /** A conditional spec whose matchPath has NO dot — the pre-fedeaa6e code path. */
  function flatSpecVault(): App {
    return createMockApp([
      {
        path: `${STATUS_PROP_UID}.md`,
        frontmatter: {
          exo__Asset_uid: STATUS_PROP_UID,
          exo__Instance_class: [
            "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]",
          ],
          exo__Asset_label: "ems__Effort_status",
        },
      },
      {
        path: `${SPEC_UID}.md`,
        frontmatter: {
          exo__Asset_uid: SPEC_UID,
          exo__Instance_class: [
            "[[07eab746-0874-4676-9d98-dbaad1bc6fb8|exo__DisplayNameSpec]]",
          ],
          exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
          exo__DisplayNameSpec_priority: 50,
          exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}]]`,
          exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`,
        },
      },
      {
        path: "flat-literal.md",
        frontmatter: {
          exo__Asset_uid: "flat-literal",
          exo__Instance_class: [
            "[[4d5437c9-788e-4a6d-9be0-4af3a84554f4|exo__PrintedLiteral]]",
          ],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 0,
          exo__PrintedLiteral_literal: "🔄 ",
        },
      },
      {
        path: "flat-prop.md",
        frontmatter: {
          exo__Asset_uid: "flat-prop",
          exo__Instance_class: [
            "[[7d58de40-d941-4a66-88e2-13afc4fdc41d|exo__PrintedProperty]]",
          ],
          exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
          exo__DisplayNamePart_order: 1,
          exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
        },
      },
    ]);
  }

  function taskMeta(statusValue: string): Record<string, unknown> {
    return {
      exo__Instance_class: [`[[${TASK_UID}]]`],
      exo__Asset_label: "Fix the parser",
      ems__Effort_status: statusValue,
    };
  }

  it("@req:fedeaa6e-1619-4a2c-8b45-86fdc9ffaf03 scenario 4 — a dot-free matchPath behaves exactly as before (zero-regression)", () => {
    const service = new PrintNameRuleService(flatSpecVault());
    service.initialize();
    const resolver = new DisplayNameResolver(
      { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
      service,
    );

    // Stays GREEN under BOTH revert-verify axes — the dot-free key takes the untouched
    // flat read, so scenarios 1/3 going RED cannot be explained by a broken matcher.
    expect(
      resolver.resolve({
        metadata: taskMeta(`[[${DOING_UID}]]`),
        basename: "t1",
      }),
    ).toBe("🔄 Fix the parser");
    expect(
      resolver.resolve({
        metadata: taskMeta(`[[${DONE_UID}]]`),
        basename: "t2",
      }),
    ).toBe("Fix the parser");
    // dual-IRI alias form on the FLAT path — unchanged by the key-path work
    expect(
      resolver.resolve({
        metadata: taskMeta(`[[${DOING_UID}|ems__EffortStatusDoing]]`),
        basename: "t3",
      }),
    ).toBe("🔄 Fix the parser");
  });
});
