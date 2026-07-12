import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS } from "@plugin/presentation/utils/displayMatcherHostFunctions";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";

/**
 * PREFIX COMPOSITION (req 1a550210) — the displayName resolver COMPOSES the prefixes of ALL
 * participating exo__DisplayNameSpec specs into "<composed prefixes> + <base label>", instead of
 * selecting a single winning template. Production-shape: a REAL PrintNameRuleService.scanVault
 * compiles the vault specs, the REAL DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS registry runs the REAL
 * BlockerHelpers.isEffortBlocked (a cross-asset predicate over the referenced blocker's status), and
 * DisplayNameResolver.resolve drives selection end-to-end — NO hand-injected rule or matcher result.
 *
 * The vault carries the two shipped-shaped Task specs the acceptance scenario needs:
 *   - 🚩-blocked  (matchHostFunction isEffortBlocked, priority 200 — blocker tier, composes FIRST)
 *   - 🔄-Doing    (matchValue ems__Effort_status=Doing, priority 100 — status tier)
 * A blocked Doing task therefore composes "🚩 🔄 <label>"; the compose ORDER (priority DESC =
 * blocker before status) is vault-declared, not hardcoded.
 */

// Canonical UIDs (verified in-vault this session — mirror the shipped d069c316 🔄-Doing spec).
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e";
const STATUS_PROP_UID = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745";
const BACKLOG_UID = "753a44d5-846c-4b82-9196-4fd9a4d48777";
const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label
const DISPLAY_NAME_SPEC_CLASS = "07eab746-0874-4676-9d98-dbaad1bc6fb8";
const PRINTED_LITERAL_CLASS = "4d5437c9-788e-4a6d-9be0-4af3a84554f4";
const PRINTED_PROPERTY_CLASS = "7d58de40-d941-4a66-88e2-13afc4fdc41d";

const BLOCKER_BASENAME = "the-blocking-task";

/**
 * Build the production-shape vault + resolver. `blockerStatus` seeds the referenced blocker's own
 * status (bare-label form), shared by reference with the fileCache so `setBlockerStatus` can flip the
 * CROSS-ASSET condition per-render (no re-scan), exactly like the shipped isEffortBlocked path.
 */
function compositionVault(
  opts: { blockerStatus?: string | null } = {},
): {
  resolver: DisplayNameResolver;
  setBlockerStatus: (status: string | null) => void;
} {
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

  // ems__Effort_status property def — second hop for the 🔄-Doing matchPath UID-form.
  addFile(`${STATUS_PROP_UID}.md`, {
    exo__Asset_uid: STATUS_PROP_UID,
    exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
    exo__Asset_label: "ems__Effort_status",
  });

  // --- 🚩-blocked spec (host-function matcher, priority 200 — composes FIRST) ---
  addFile("spec-blocked.md", {
    exo__Asset_uid: "spec-blocked",
    exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_CLASS}|exo__DisplayNameSpec]]`],
    exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
    exo__DisplayNameSpec_priority: 200,
    exo__DisplayNameSpec_matchHostFunction: "isEffortBlocked",
  });
  addFile("blocked-literal.md", {
    exo__Asset_uid: "blocked-literal",
    exo__Instance_class: [`[[${PRINTED_LITERAL_CLASS}|exo__PrintedLiteral]]`],
    exo__DisplayNamePart_of: "[[spec-blocked]]",
    exo__DisplayNamePart_order: 0,
    exo__PrintedLiteral_literal: "🚩 ",
  });
  addFile("blocked-prop.md", {
    exo__Asset_uid: "blocked-prop",
    exo__Instance_class: [`[[${PRINTED_PROPERTY_CLASS}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: "[[spec-blocked]]",
    exo__DisplayNamePart_order: 1,
    exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
  });

  // --- 🔄-Doing spec (value matcher status=Doing, priority 100 — status tier) ---
  addFile("spec-doing.md", {
    exo__Asset_uid: "spec-doing",
    exo__Instance_class: [`[[${DISPLAY_NAME_SPEC_CLASS}|exo__DisplayNameSpec]]`],
    exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
    exo__DisplayNameSpec_priority: 100,
    exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}|ems__Effort_status]]`,
    exo__DisplayNameSpec_matchValue: `[[${DOING_UID}|ems__EffortStatusDoing]]`,
  });
  addFile("doing-literal.md", {
    exo__Asset_uid: "doing-literal",
    exo__Instance_class: [`[[${PRINTED_LITERAL_CLASS}|exo__PrintedLiteral]]`],
    exo__DisplayNamePart_of: "[[spec-doing]]",
    exo__DisplayNamePart_order: 0,
    exo__PrintedLiteral_literal: "🔄 ",
  });
  addFile("doing-prop.md", {
    exo__Asset_uid: "doing-prop",
    exo__Instance_class: [`[[${PRINTED_PROPERTY_CLASS}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: "[[spec-doing]]",
    exo__DisplayNamePart_order: 1,
    exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
  });

  addFile(`${BLOCKER_BASENAME}.md`, blockerFm); // the SAME blockerFm reference lives in fileCache

  const app = {
    vault: { getMarkdownFiles: jest.fn().mockReturnValue(mockFiles) },
    metadataCache: {
      getFileCache: jest
        .fn()
        .mockImplementation((file: TFile) => fileCache.get(file.path) ?? null),
      getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
        const clean = path.endsWith(".md") ? path : path + ".md";
        return mockFiles.find((f) => f.path === clean) ?? null;
      }),
    },
  } as unknown as App;

  // Wire the REAL host-function registry (isEffortBlocked → BlockerHelpers.isEffortBlocked).
  const service = new PrintNameRuleService(app, DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS);
  service.initialize(); // real scanVault → compileDisplayNameSpecs
  // EMPTY classTemplates prove the VAULT specs (not TS hardcodes) drive every prefix.
  const resolver = new DisplayNameResolver(
    { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
    service,
  );
  const setBlockerStatus = (status: string | null) => {
    if (status === null) delete blockerFm.ems__Effort_status;
    else blockerFm.ems__Effort_status = status;
  };
  return { resolver, setBlockerStatus };
}

function taskMeta(
  opts: { status?: string; blocker?: string | null; label?: string } = {},
): Record<string, unknown> {
  const m: Record<string, unknown> = {
    exo__Instance_class: [`[[${TASK_UID}]]`],
    exo__Asset_label: opts.label ?? "Ship the release",
  };
  if (opts.status != null) m.ems__Effort_status = opts.status;
  if (opts.blocker != null) m.ems__Effort_blocker = opts.blocker;
  return m;
}

describe("DisplayNameResolver — prefix composition [req 1a550210]", () => {
  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 a blocked Doing task composes BOTH prefixes → '🚩 🔄 <label>' (blocker before status, vault-declared priority order) [revert-verify anchor]", () => {
    // The task is Doing (🔄 value-spec matches) AND blocked — its blocker's status is Doing (not
    // done) so the REAL isEffortBlocked returns true (🚩 host-fn spec matches). BOTH specs
    // participate; composition prints both prefixes in priority-DESC order (🚩 prio 200 before 🔄
    // prio 100). Revert-verify RED anchor: revert the resolver to single-winning-template → only
    // the highest-priority spec (🚩) renders → "🚩 Ship the release" (🔄 dropped) → RED; restore →
    // "🚩 🔄 Ship the release" GREEN.
    const { resolver } = compositionVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });

    const composed = resolver.resolve({
      metadata: taskMeta({
        status: `[[${DOING_UID}]]`,
        blocker: `[[${BLOCKER_BASENAME}]]`,
      }),
      basename: "blocked-doing",
    });
    expect(composed).toBe("🚩 🔄 Ship the release");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 a blocked NON-Doing task shows a single 🚩 (only the blocked spec participates)", () => {
    // Backlog status → the 🔄-Doing value matcher does NOT match; only the 🚩 host-fn spec
    // participates → a single prefix, no double 🚩.
    const { resolver } = compositionVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });

    const single = resolver.resolve({
      metadata: taskMeta({
        status: `[[${BACKLOG_UID}]]`,
        blocker: `[[${BLOCKER_BASENAME}]]`,
      }),
      basename: "blocked-backlog",
    });
    expect(single).toBe("🚩 Ship the release");
    expect(single).not.toContain("🚩 🚩");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 a single participating spec composes to itself — a Doing, NOT-blocked task is byte-identical '🔄 <label>' (no regression)", () => {
    const { resolver } = compositionVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });
    // Doing but NO ems__Effort_blocker → isEffortBlocked false → only the 🔄 spec participates.
    const only = resolver.resolve({
      metadata: taskMeta({ status: `[[${DOING_UID}]]` }),
      basename: "doing-unblocked",
    });
    expect(only).toBe("🔄 Ship the release");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 no participating spec → plain label (no regression)", () => {
    const { resolver } = compositionVault({ blockerStatus: "[[ems__EffortStatusDoing]]" });
    // Backlog + not blocked → neither spec participates → the bare label.
    const plain = resolver.resolve({
      metadata: taskMeta({ status: `[[${BACKLOG_UID}]]` }),
      basename: "backlog-unblocked",
    });
    expect(plain).toBe("Ship the release");
  });

  it("@req:1a550210-f07e-4cbc-8707-6d4b428bba11 composition is PER-RENDER + CROSS-ASSET — flipping the BLOCKER's status toggles the composed 🚩 without a re-scan", () => {
    const { resolver, setBlockerStatus } = compositionVault({
      blockerStatus: "[[ems__EffortStatusDoing]]",
    });
    const meta = taskMeta({
      status: `[[${DOING_UID}]]`,
      blocker: `[[${BLOCKER_BASENAME}]]`,
    }); // SAME task metadata throughout — only the OTHER asset (blocker) changes.

    // blocker not-done → task blocked → both prefixes compose.
    expect(resolver.resolve({ metadata: meta, basename: "t" })).toBe(
      "🚩 🔄 Ship the release",
    );
    // the blocker becomes Done → task no longer blocked → 🚩 drops, 🔄 (still Doing) remains — no re-scan.
    setBlockerStatus("[[ems__EffortStatusDone]]");
    expect(resolver.resolve({ metadata: meta, basename: "t" })).toBe(
      "🔄 Ship the release",
    );
  });
});
