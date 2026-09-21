import { describe, it, expect } from "@jest/globals";
import { DisplayNameTemplateEngine } from "../../../src/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameResolver } from "../../../src/domain/display-name/DisplayNameResolver";
import { PrintNameRuleService } from "../../../src/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "../../../src/domain/display-name/DisplayNameSettings";
import type { VaultMetadataPort } from "../../../src/domain/display-name/VaultMetadataPort";

/**
 * req c67e4c69 — a spec whose PROPERTY placeholders ALL render empty declines, so the caller
 * prints the label (or the basename) instead of the spec's literals glued together.
 *
 * ⛤ The capability already existed in SEPARATOR mode (`renderWithSeparator`: "the affixes alone
 * are not a name") and was absent in the plain path. A mutant of that separator-mode guard
 * reddened ZERO axes before this file, so D6 below is as much of the deliverable as D1-D3.
 *
 * ⛔ Four of the seven axes are CONTROLS. The one that carries the design is D3: declining is
 * an improvement only when something readable is left to fall back to. With no label and a UUID
 * basename, declining would print a bare UID inside a title — the very defect req 0f992e88
 * exists to prevent — so there the literals stay. Measured on the live corpus: 51 of 51 461
 * names move, and exactly 3 are held back by D3, all of them affix-only specs whose property
 * part is empty by design.
 */
const REQ = "@req:c67e4c69-a55e-416e-bcdf-cf15681773a1";

const UUID_BASENAME = "3f94d999-6044-45b1-b758-547daa3d18e4";

function render(
  template: string,
  metadata: Record<string, unknown>,
  basename: string,
  options?: { separator?: string },
): string | null {
  return new DisplayNameTemplateEngine(template, options ?? {}).render(metadata, basename);
}

describe("a DisplayNameSpec whose property parts all render empty (req c67e4c69)", () => {
  it(`${REQ} D1 every placeholder empty and a label present — the spec declines`, () => {
    // The live shape: a period__Month whose year and number both fail to resolve composed "-",
    // and that single separator outranked the label "June (period__Month) (DEPRECATED)".
    expect(
      render("{{period__Month_year}}-{{period__Month_monthNumber}}", {
        exo__Asset_label: "June (period__Month) (DEPRECATED)",
      }, UUID_BASENAME),
    ).toBeNull();
  });

  it(`${REQ} D2 every placeholder empty, no label, but the FILE is named — the spec declines`, () => {
    // 44 of the 51 live names this requirement moves are exactly this: calendar weeks stored as
    // 2025-W26.md with no label, composing "-W" today and their own filename after.
    expect(
      render("{{period__Week_year}}-W{{period__Week_weekNumber}}", {}, "2025-W26"),
    ).toBeNull();
  });

  it(`${REQ} D3 CONTROL — no label AND a UUID basename: the spec does NOT decline`, () => {
    // Declining here hands the caller null, it falls to the basename, and a bare UID lands in
    // the title. The literals — an affix spec's "👥" — are the lesser evil (req 0f992e88).
    expect(render("👥 {{exo__Asset_label}}", {}, UUID_BASENAME)).toBe("👥");
  });

  it(`${REQ} D4 CONTROL — one placeholder non-empty: byte-identical to before`, () => {
    expect(
      render("Q{{period__Quarter_quarterNumber}}-{{period__Quarter_year}}", {
        period__Quarter_quarterNumber: 3,
        period__Quarter_year: "2025",
        exo__Asset_label: "Q3-25",
      }, UUID_BASENAME),
    ).toBe("Q3-2025");
  });

  it(`${REQ} D5 CONTROL — a template with NO placeholders at all is untouched`, () => {
    // The rule keys on "every placeholder rendered empty", not on "the result is short": a
    // literal-only template never had a placeholder, so it has nothing to decline about.
    expect(render("— archived —", { exo__Asset_label: "whatever" }, UUID_BASENAME)).toBe(
      "— archived —",
    );
  });

  it(`${REQ} D6 separator mode declines too — the guard that had no axis before`, () => {
    // ⛔ The fixture MUST carry affixes. Without them the guard is defensive by arithmetic
    // (§A35): every field empty makes the join empty, and the trailing `joined === "" ? null`
    // returns null anyway — so a mutant of the guard changes nothing and the axis is vacuous.
    // With a prefix "Q" and a suffix " гг." the two paths diverge: guarded → null, unguarded →
    // "Q гг.", a name assembled entirely from separators and literals. Measured, not assumed:
    // the first version of this axis was written without affixes and D_M9 reddened nothing.
    expect(
      render("Q{{period__Quarter_quarterNumber}}-{{period__Quarter_year}} гг.", {
        exo__Asset_label: "Q3-2025",
      }, UUID_BASENAME, { separator: "-" }),
    ).toBeNull();
  });

  it(`${REQ} D7 production-shape: through the real spec pipeline the label survives`, () => {
    const SPEC = "cccccccc-aaaa-4000-8000-00000000000a";
    const CLASS = "dddddddd-aaaa-4000-8000-00000000000a";
    const PROP = "eeeeeeee-aaaa-4000-8000-00000000000a";
    const MONTH = "ffffffff-aaaa-4000-8000-00000000000a";
    const assets: Record<string, unknown>[] = [
      { exo__Asset_uid: CLASS, exo__Asset_label: "period__Month", exo__Instance_class: "[[exo__Class]]" },
      {
        exo__Asset_uid: PROP,
        exo__Asset_label: "period__Month_monthNumber",
        exo__Instance_class: "[[exo__DatatypeProperty]]",
      },
      {
        exo__Asset_uid: SPEC,
        exo__Asset_label: "spec: period__Month",
        exo__Instance_class: "[[exo__DisplayNameSpec]]",
        exo__DisplayNameSpec_appliesToClass: `[[${CLASS}|period__Month]]`,
        exo__DisplayNameSpec_priority: 100,
      },
      {
        exo__Asset_uid: "cccccccc-aaaa-4000-8000-00000000000b",
        exo__Instance_class: "[[exo__PrintedLiteral]]",
        exo__DisplayNamePart_of: `[[${SPEC}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: "-",
      },
      {
        exo__Asset_uid: "cccccccc-aaaa-4000-8000-00000000000c",
        exo__Instance_class: "[[exo__PrintedProperty]]",
        exo__DisplayNamePart_of: `[[${SPEC}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: `[[${PROP}]]`,
      },
      {
        exo__Asset_uid: MONTH,
        exo__Asset_label: "June (period__Month) (DEPRECATED)",
        exo__Instance_class: `[[${CLASS}|period__Month]]`,
      },
    ];
    const byUid = new Map(assets.map((a) => [String(a.exo__Asset_uid), a]));
    const port: VaultMetadataPort = {
      listFrontmatter: () => assets,
      resolveLinkpathFrontmatter: (l: string) => byUid.get(l.replace(/\.md$/, "")) ?? null,
    };
    const rules = new PrintNameRuleService(port);
    rules.initialize();
    const resolver = new DisplayNameResolver(
      DEFAULT_DISPLAY_NAME_SETTINGS,
      rules,
      rules.createMetadataResolver(),
    );
    const month = byUid.get(MONTH) as Record<string, unknown>;
    const resolved = resolver.resolveWithProvenance({ metadata: month, basename: MONTH });
    // The spec participates (provenance says so) and declines — the caller keeps the label.
    expect(resolved.provenance).toBe("spec");
    expect(resolved.displayName).toBeNull();
  });
});
