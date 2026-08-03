import { PrintNameRuleService } from "@plugin/domain/display-name/PrintNameRuleService";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS } from "@plugin/presentation/utils/displayMatcherHostFunctions";
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { installFakeOffsetDate } from "../../../../../core/tests/helpers/installFakeOffsetDate";

const EPISODE_UID = "51ffac65-5043-4863-b16e-c974ec4a5ef0"; // life__Episode
const LABEL_PROP_UID = "12a6151b-801f-4be2-bd6e-a787eedd56ae"; // exo__Asset_label
const START_PROP_UID = "bf82fb62-d3cb-449d-8518-4a22ed96558d"; // life__Episode_start
const END_PROP_UID = "f797730f-0898-47e8-a2c1-eb968dd9dc9f"; // life__Episode_end
const SPEC_CLASS = "07eab746-0874-4676-9d98-dbaad1bc6fb8"; // exo__DisplayNameSpec
const LITERAL_CLASS = "4d5437c9-788e-4a6d-9be0-4af3a84554f4"; // exo__PrintedLiteral
const PROPERTY_CLASS = "7d58de40-d941-4a66-88e2-13afc4fdc41d"; // exo__PrintedProperty

const BASE_SPEC = "spec-episode-period";
const ONGOING_SPEC = "spec-episode-ongoing";

/**
 * UTC+5 at 2026-08-03T19:27:00Z → LOCAL day 2026-08-04, UTC day 2026-08-03.
 *
 * The two days deliberately differ: an episode ending 2026-08-03 is over in local terms
 * but still "today" in UTC terms, so a UTC-based implementation renders 📍 where a
 * local-based one does not. That divergence is the local-basis discriminator below —
 * without it the suite would pass in a UTC runner with OR without the local getters
 * ([[jest-timezone-sensitive-tests]]).
 */
const FIXED_INSTANT = "2026-08-03T19:27:00Z";
const OFFSET_HOURS = 5;

/**
 * Production-shape vault: the life__Episode period spec (label · start · end, separator-joined,
 * priority 100) PLUS the 📍 ongoing spec whose matcher is the host function `isEpisodeOngoing`
 * (priority 200, so it composes first). The service is wired with the REAL registry, so the REAL
 * EpisodePeriodHelpers.isEpisodeOngoing runs — no hand-injected matcher result.
 */
function episodeVault(): { service: PrintNameRuleService; resolver: DisplayNameResolver } {
  const fileCache = new Map<string, CachedMetadata>();
  const mockFiles: TFile[] = [];
  const addFile = (path: string, frontmatter: Record<string, unknown>) => {
    const tfile = new TFile(path);
    tfile.basename = path.replace(".md", "");
    tfile.extension = "md";
    mockFiles.push(tfile);
    fileCache.set(path, { frontmatter } as CachedMetadata);
  };

  // --- base period spec: "<label> · <start> · <end>", empty parts collapse with their separator
  addFile(`${BASE_SPEC}.md`, {
    exo__Asset_uid: BASE_SPEC,
    exo__Instance_class: [`[[${SPEC_CLASS}|exo__DisplayNameSpec]]`],
    exo__DisplayNameSpec_appliesToClass: `[[${EPISODE_UID}|life__Episode]]`,
    exo__DisplayNameSpec_priority: 100,
    exo__DisplayNameSpec_separator: " · ",
  });
  addFile("base-label.md", {
    exo__Asset_uid: "base-label",
    exo__Instance_class: [`[[${PROPERTY_CLASS}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: `[[${BASE_SPEC}]]`,
    exo__DisplayNamePart_order: 1,
    exo__PrintedProperty_property: `[[${LABEL_PROP_UID}|exo__Asset_label]]`,
  });
  addFile("base-start.md", {
    exo__Asset_uid: "base-start",
    exo__Instance_class: [`[[${PROPERTY_CLASS}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: `[[${BASE_SPEC}]]`,
    exo__DisplayNamePart_order: 2,
    exo__PrintedProperty_property: `[[${START_PROP_UID}|life__Episode_start]]`,
  });
  addFile("base-end.md", {
    exo__Asset_uid: "base-end",
    exo__Instance_class: [`[[${PROPERTY_CLASS}|exo__PrintedProperty]]`],
    exo__DisplayNamePart_of: `[[${BASE_SPEC}]]`,
    exo__DisplayNamePart_order: 3,
    exo__PrintedProperty_property: `[[${END_PROP_UID}|life__Episode_end]]`,
  });

  // --- 📍 ongoing spec: participates only while isEpisodeOngoing(metadata) is true
  addFile(`${ONGOING_SPEC}.md`, {
    exo__Asset_uid: ONGOING_SPEC,
    exo__Instance_class: [`[[${SPEC_CLASS}|exo__DisplayNameSpec]]`],
    exo__DisplayNameSpec_appliesToClass: `[[${EPISODE_UID}|life__Episode]]`,
    exo__DisplayNameSpec_priority: 200,
    exo__DisplayNameSpec_matchHostFunction: "isEpisodeOngoing",
  });
  addFile("ongoing-literal.md", {
    exo__Asset_uid: "ongoing-literal",
    exo__Instance_class: [`[[${LITERAL_CLASS}|exo__PrintedLiteral]]`],
    exo__DisplayNamePart_of: `[[${ONGOING_SPEC}]]`,
    exo__DisplayNamePart_order: 0,
    exo__PrintedLiteral_literal: "📍 ",
  });

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

  const service = new PrintNameRuleService(app, DEFAULT_DISPLAY_MATCHER_HOST_FUNCTIONS);
  service.initialize();
  const resolver = new DisplayNameResolver(
    { defaultTemplate: "{{exo__Asset_label}}", classTemplates: {} },
    service,
  );
  return { service, resolver };
}

function episodeMeta(
  opts: { start?: string | null; end?: string | null; label?: string } = {},
): Record<string, unknown> {
  const m: Record<string, unknown> = {
    exo__Instance_class: [`[[${EPISODE_UID}]]`],
    exo__Asset_label: opts.label ?? "Отпуск",
  };
  if (opts.start != null) m.life__Episode_start = opts.start;
  if (opts.end != null) m.life__Episode_end = opts.end;
  return m;
}

describe("PrintNameRuleService — 📍 ongoing life__Episode via the isEpisodeOngoing host function [req 8a47ff93]", () => {
  let restoreDate: () => void;

  beforeEach(() => {
    restoreDate = installFakeOffsetDate(OFFSET_HOURS, FIXED_INSTANT);
    // Guard: the simulated zone is active, and local/UTC name DIFFERENT days — the whole
    // local-basis discriminator rests on this. Without the guard a broken fake would make
    // the suite pass vacuously.
    expect(new Date().getFullYear()).toBe(2026);
    expect(new Date().getMonth()).toBe(7); // August
    expect(new Date().getDate()).toBe(4); // LOCAL day
    expect(new Date().getUTCDate()).toBe(3); // UTC day — deliberately different
  });

  afterEach(() => restoreDate());

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa a period CONTAINING today composes 📍 ahead of the period spec (revert-verify anchor)", () => {
    // EMPTY classTemplates prove the VAULT specs drive both the marker and the period —
    // no TS hardcode. Revert-verify RED anchor: neutralize isEpisodeOngoing to never-participate
    // → the 📍 disappears here → RED; always-participate → the past/future cases below go RED.
    const { resolver } = episodeVault();
    const rendered = resolver.resolve({
      metadata: episodeMeta({ start: "2026-08-01", end: "2026-08-10" }),
      basename: "ongoing-episode",
    });
    expect(rendered).toBe("📍 Отпуск · 2026-08-01 · 2026-08-10");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa an OPEN period (started, no end) is ongoing — 📍 with the absent end collapsed", () => {
    const { resolver } = episodeVault();
    const rendered = resolver.resolve({
      metadata: episodeMeta({ start: "2026-07-23" }),
      basename: "open-episode",
    });
    // The separator collapses the empty end part — no trailing " · ".
    expect(rendered).toBe("📍 Отпуск · 2026-07-23");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa a period entirely in the PAST renders no 📍 — and the cutoff is the LOCAL day, not the UTC one", () => {
    const { resolver } = episodeVault();
    // end = 2026-08-03 = TODAY in UTC but YESTERDAY in the simulated UTC+5 zone. A UTC-based
    // implementation would call this ongoing and emit 📍; the local-based one must not.
    const rendered = resolver.resolve({
      metadata: episodeMeta({ start: "2026-07-20", end: "2026-08-03" }),
      basename: "past-episode",
    });
    expect(rendered).toBe("Отпуск · 2026-07-20 · 2026-08-03");
    expect(rendered).not.toContain("📍");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa a period entirely in the FUTURE renders no 📍", () => {
    const { resolver } = episodeVault();
    const rendered = resolver.resolve({
      metadata: episodeMeta({ start: "2026-09-01", end: "2026-09-10" }),
      basename: "future-episode",
    });
    expect(rendered).toBe("Отпуск · 2026-09-01 · 2026-09-10");
    expect(rendered).not.toContain("📍");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa the boundary days are INCLUSIVE — a period starting today and one ending today both show 📍", () => {
    const { resolver } = episodeVault();
    const startsToday = resolver.resolve({
      metadata: episodeMeta({ start: "2026-08-04", end: "2026-08-20" }),
      basename: "starts-today",
    });
    const endsToday = resolver.resolve({
      metadata: episodeMeta({ start: "2026-07-01", end: "2026-08-04" }),
      basename: "ends-today",
    });
    expect(startsToday).toBe("📍 Отпуск · 2026-08-04 · 2026-08-20");
    expect(endsToday).toBe("📍 Отпуск · 2026-07-01 · 2026-08-04");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa an absent or unparseable start is NOT ongoing (fail-closed)", () => {
    const { resolver } = episodeVault();
    const noStart = resolver.resolve({
      metadata: episodeMeta({ end: "2026-08-10" }),
      basename: "no-start",
    });
    const junkStart = resolver.resolve({
      metadata: episodeMeta({ start: "не дата", end: "2026-08-10" }),
      basename: "junk-start",
    });
    expect(noStart).not.toContain("📍");
    expect(junkStart).not.toContain("📍");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa a value carrying a TIME component compares by its calendar day", () => {
    const { resolver } = episodeVault();
    const rendered = resolver.resolve({
      metadata: episodeMeta({ start: "2026-08-04T09:30:00", end: "2026-08-04T18:00:00" }),
      basename: "same-day-with-time",
    });
    expect(rendered).toContain("📍");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa the verdict is per-render — one scan serves an ongoing and a finished episode differently", () => {
    // A single scanVault, two resolves: proves the predicate runs at match time rather than
    // being baked into the compiled template (so the marker lapses when the day advances).
    const { resolver } = episodeVault();
    const ongoing = resolver.resolve({
      metadata: episodeMeta({ start: "2026-08-01", end: "2026-08-10", label: "Идёт" }),
      basename: "a",
    });
    const finished = resolver.resolve({
      metadata: episodeMeta({ start: "2026-06-01", end: "2026-06-10", label: "Прошёл" }),
      basename: "b",
    });
    expect(ongoing).toBe("📍 Идёт · 2026-08-01 · 2026-08-10");
    expect(finished).toBe("Прошёл · 2026-06-01 · 2026-06-10");
  });

  it("@req:8a47ff93-4909-4b3a-89f5-4a39c15131fa a NON-episode asset is untouched (negative control — stays GREEN under both reverts)", () => {
    const { resolver } = episodeVault();
    const rendered = resolver.resolve({
      metadata: {
        exo__Instance_class: ["[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"],
        exo__Asset_label: "Ship the release",
        life__Episode_start: "2026-08-01", // even carrying episode-ish dates
      },
      basename: "some-task",
    });
    expect(rendered).toBe("Ship the release");
    expect(rendered).not.toContain("📍");
  });
});
