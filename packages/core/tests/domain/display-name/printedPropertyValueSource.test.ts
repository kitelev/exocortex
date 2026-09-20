import { describe, it, expect } from "@jest/globals";
import { DisplayNameResolver } from "../../../src/domain/display-name/DisplayNameResolver";
import { PrintNameRuleService } from "../../../src/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "../../../src/domain/display-name/DisplayNameSettings";
import type { VaultMetadataPort } from "../../../src/domain/display-name/VaultMetadataPort";
import { DisplayNameTemplateEngine } from "../../../src/domain/display-name/DisplayNameTemplateEngine";

/**
 * req ff1482f2 (issue #4303, its opt-in half) — `exo__PrintedProperty_valueSource` declares WHICH
 * name of the referenced asset a part prints.
 *
 * ⛤ Sibling of `0f992e88`, which made the composed name reachable only where the target has NO
 * label. Here the target HAS one, and the spec's author chooses. The declaration is a PREFERENCE:
 * when nothing composes, the label is still printed — so the fallback chain becomes
 * composed → label → linkpath, and every part WITHOUT the declaration keeps the chain it had.
 *
 * ⛔ Four of the thirteen axes are CONTROLS (S3 S4 S5 S7). The requirement's regression claim is
 * that a live vault renders byte-identically until an author adds the property, and that is true
 * only because absence, the Label individual and an unrecognised value all mean the same thing.
 *
 * ⛤ Three guards of the diff carry NO mutant, each for a stated reason rather than by omission:
 *  - `if (value.length === 0) return false` on an empty list — DEFENSIVE by arithmetic: without
 *    it `value[0]` is `undefined` and the `typeof` guard below returns `false` anyway;
 *  - that `typeof value !== "string"` guard itself — same arithmetic: a non-string value
 *    stringifies to something no individual is named;
 *  - the `preferComposed` threading inside the `joinArrayValues` branch — UNREACHABLE in every
 *    live construction site: `joinArrayValues` is set only by `ConceptDefinitionResolver`, which
 *    passes no `nestedDisplayName`, so no composed name can be asked for there at all.
 * Every OTHER call site that carries the marker has its own mutant (S_M6, S_M14, S_M15, S_M16).
 */
const REQ = "@req:ff1482f2-8a0d-4386-89d9-45a3198c5904";

const QUARTER_CLASS = "11111111-aaaa-4111-8111-111111111111";
const REVIEW_CLASS = "22222222-aaaa-4222-8222-222222222222";
const PROP_NUMBER = "33333333-aaaa-4333-8333-333333333333";
const PROP_QUARTER = "44444444-aaaa-4444-8444-444444444444";
const QUARTER = "55555555-aaaa-4555-8555-555555555555";
const REVIEW = "66666666-aaaa-4666-8666-666666666666";
const QUARTER_SPEC = "aaaaaaaa-aaaa-4000-8000-00000000000a";
const REVIEW_SPEC = "bbbbbbbb-aaaa-4000-8000-00000000000a";
const REVIEW_PART = "bbbbbbbb-aaaa-4000-8000-00000000000c";

/** The shipped enum individual — the same UID the service keys on. */
const SOURCE_DISPLAY_NAME = "8bc662e3-2984-4845-9593-d37e0db9b7e3";
const SOURCE_LABEL = "37a4ec62-3879-47d6-a221-ce41e27d8f2c";

type FM = Record<string, unknown>;

function portOf(assets: FM[]): VaultMetadataPort {
  const byUid = new Map<string, FM>();
  for (const a of assets) {
    const uid = a.exo__Asset_uid;
    if (typeof uid === "string") byUid.set(uid, a);
  }
  return {
    listFrontmatter: () => assets,
    resolveLinkpathFrontmatter: (linkpath: string) =>
      byUid.get(linkpath.replace(/\.md$/, "")) ?? null,
  };
}

/**
 * The fixture: a quarter that carries BOTH a label ("Q4-25") and a spec composing something else
 * ("Q4-2025"). That combination is the whole point — under req 0f992e88 the label always won.
 */
function vaultWith(
  valueSource?: unknown,
  quarterLabel: string | null = "Q4-25",
  quarterSpec = true,
  partFormat?: string,
): FM[] {
  const reviewPart: FM = {
    exo__Asset_uid: REVIEW_PART,
    exo__Instance_class: "[[exo__PrintedProperty]]",
    exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
    exo__DisplayNamePart_order: 2,
    exo__PrintedProperty_property: `[[${PROP_QUARTER}]]`,
  };
  if (valueSource !== undefined)
    reviewPart.exo__PrintedProperty_valueSource = valueSource;
  if (partFormat !== undefined)
    reviewPart.exo__PrintedProperty_format = partFormat;

  const quarter: FM = {
    exo__Asset_uid: QUARTER,
    exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
    period__Quarter_number: 4,
  };
  if (quarterLabel !== null) quarter.exo__Asset_label = quarterLabel;

  const assets: FM[] = [
    {
      exo__Asset_uid: QUARTER_CLASS,
      exo__Asset_label: "period__Quarter",
      exo__Instance_class: "[[exo__Class]]",
    },
    {
      exo__Asset_uid: REVIEW_CLASS,
      exo__Asset_label: "tbank__Review",
      exo__Instance_class: "[[exo__Class]]",
    },
    {
      exo__Asset_uid: PROP_NUMBER,
      exo__Asset_label: "period__Quarter_number",
      exo__Instance_class: "[[exo__DatatypeProperty]]",
    },
    {
      exo__Asset_uid: PROP_QUARTER,
      exo__Asset_label: "tbank__Review_quarter",
      exo__Instance_class: "[[exo__ObjectProperty]]",
    },

    {
      exo__Asset_uid: REVIEW_SPEC,
      exo__Asset_label: "spec: tbank__Review",
      exo__Instance_class: "[[exo__DisplayNameSpec]]",
      exo__DisplayNameSpec_appliesToClass: `[[${REVIEW_CLASS}|tbank__Review]]`,
      exo__DisplayNameSpec_priority: 100,
      exo__DisplayNameSpec_separator: " ",
    },
    {
      exo__Asset_uid: "bbbbbbbb-aaaa-4000-8000-00000000000b",
      exo__Instance_class: "[[exo__PrintedLiteral]]",
      exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
      exo__DisplayNamePart_order: 1,
      exo__PrintedLiteral_literal: "ОС",
    },
    reviewPart,
    quarter,
    {
      exo__Asset_uid: REVIEW,
      exo__Asset_label: "ОС a.a.aleksin",
      exo__Instance_class: `[[${REVIEW_CLASS}|tbank__Review]]`,
      tbank__Review_quarter: `[[${QUARTER}]]`,
    },
  ];

  if (quarterSpec) {
    assets.push(
      {
        exo__Asset_uid: QUARTER_SPEC,
        exo__Asset_label: "spec: period__Quarter",
        exo__Instance_class: "[[exo__DisplayNameSpec]]",
        exo__DisplayNameSpec_appliesToClass: `[[${QUARTER_CLASS}|period__Quarter]]`,
        exo__DisplayNameSpec_priority: 100,
      },
      {
        exo__Asset_uid: "aaaaaaaa-aaaa-4000-8000-00000000000b",
        exo__Instance_class: "[[exo__PrintedLiteral]]",
        exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: "Q",
      },
      {
        exo__Asset_uid: "aaaaaaaa-aaaa-4000-8000-00000000000c",
        exo__Instance_class: "[[exo__PrintedProperty]]",
        exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: `[[${PROP_NUMBER}]]`,
      },
      {
        exo__Asset_uid: "aaaaaaaa-aaaa-4000-8000-00000000000d",
        exo__Instance_class: "[[exo__PrintedLiteral]]",
        exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
        exo__DisplayNamePart_order: 3,
        exo__PrintedLiteral_literal: "-2025",
      },
    );
  }
  return assets;
}

function reviewNameOver(assets: FM[], reviewOverride?: FM): string | null {
  const rules = new PrintNameRuleService(portOf(assets));
  rules.initialize();
  const resolver = new DisplayNameResolver(
    DEFAULT_DISPLAY_NAME_SETTINGS,
    rules,
    rules.createMetadataResolver(),
  );
  const self =
    reviewOverride ?? (assets.find((a) => a.exo__Asset_uid === REVIEW) as FM);
  return resolver.resolveWithProvenance({ metadata: self, basename: REVIEW })
    .displayName;
}

describe("exo__PrintedProperty_valueSource — which name of the target a part prints (req ff1482f2)", () => {
  it(`${REQ} S1 a part declaring DisplayName prints the COMPOSED name over the label`, () => {
    expect(reviewNameOver(vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`))).toBe(
      "ОС Q4-2025",
    );
  });

  it(`${REQ} S2 the declaration resolves from the ALIASED form too (dual-IRI)`, () => {
    expect(
      reviewNameOver(
        vaultWith(
          `[[${SOURCE_DISPLAY_NAME}|exo__PrintedPropertyValueSourceDisplayName]]`,
        ),
      ),
    ).toBe("ОС Q4-2025");
    // and from a bare label, which is how a hand-authored vault often writes an enum reference
    expect(
      reviewNameOver(vaultWith("exo__PrintedPropertyValueSourceDisplayName")),
    ).toBe("ОС Q4-2025");
  });

  it(`${REQ} S10 the declaration written as a YAML LIST is recognised`, () => {
    // Obsidian's metadataCache hands a multi-value frontmatter key back as an array, and a
    // hand-authored vault writes object-properties as lists routinely — so the array form is a
    // REACHABLE authoring shape, not a defensive branch, even though the property is 0..1.
    expect(reviewNameOver(vaultWith([`[[${SOURCE_DISPLAY_NAME}]]`]))).toBe(
      "ОС Q4-2025",
    );
  });

  it(`${REQ} S11 the declaration survives an explicit .md suffix in the link`, () => {
    // `[[<uid>.md]]` is a legal Obsidian wikilink, and `unwrapLinkTarget` keeps the extension —
    // so without the strip the value would not match the individual it plainly names.
    expect(reviewNameOver(vaultWith(`[[${SOURCE_DISPLAY_NAME}.md]]`))).toBe(
      "ОС Q4-2025",
    );
  });

  it(`${REQ} S12 a part carrying BOTH a format and the declaration still composes`, () => {
    // `_format` is date-only and declines on a wikilink, so the two per-part declarations are
    // independent — but they ride the SAME placeholder (`{{key::FORMAT!displayName}}`) and reach
    // a DIFFERENT call site inside the engine than a part carrying the declaration alone.
    expect(
      reviewNameOver(
        vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`, "Q4-25", true, "YYYY-MM-DD"),
      ),
    ).toBe("ОС Q4-2025");
  });

  it(`${REQ} S13 the declaration survives a MULTI-VALUE property (first-only path)`, () => {
    // A YAML list on the printed property itself — the default array path renders the first
    // value, and it must carry the declaration down with it.
    const assets = vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`);
    const review = {
      ...(assets.find((a) => a.exo__Asset_uid === REVIEW) as FM),
      tbank__Review_quarter: [`[[${QUARTER}]]`],
    };
    expect(reviewNameOver(assets, review)).toBe("ОС Q4-2025");
  });

  it(`${REQ} S3 CONTROL — a part with NO declaration is byte-identical to req 0f992e88`, () => {
    expect(reviewNameOver(vaultWith(undefined))).toBe("ОС Q4-25");
  });

  it(`${REQ} S4 CONTROL — declaring Label explicitly equals declaring nothing`, () => {
    expect(reviewNameOver(vaultWith(`[[${SOURCE_LABEL}]]`))).toBe("ОС Q4-25");
  });

  it(`${REQ} S5 CONTROL — an unrecognised value is FAIL-OPEN, not an error`, () => {
    expect(reviewNameOver(vaultWith("[[totally-unknown-individual]]"))).toBe(
      "ОС Q4-25",
    );
    expect(reviewNameOver(vaultWith("displayname"))).toBe("ОС Q4-25");
  });

  it(`${REQ} S6 the declaration is a PREFERENCE — with nothing to compose, the label prints`, () => {
    // Same declaration, but the target's own spec is gone: the composed name is unavailable and
    // the label must still be printed rather than the linkpath.
    expect(
      reviewNameOver(vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`, "Q4-25", false)),
    ).toBe("ОС Q4-25");
  });

  it(`${REQ} S7 CONTROL — an authored alias beats the declaration`, () => {
    const assets = vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`);
    const review = {
      ...(assets.find((a) => a.exo__Asset_uid === REVIEW) as FM),
      tbank__Review_quarter: `[[${QUARTER}|Q-четвёртый]]`,
    };
    expect(reviewNameOver(assets, review)).toBe("ОС Q-четвёртый");
  });

  it(`${REQ} S9 the composed name is asked for ONCE per reference, not twice`, () => {
    // A nested render walks the target's whole spec, so asking twice doubles that work for every
    // declared part whose target composes nothing. The engine is driven directly here because the
    // count is a property of THIS class's ordering, not of the vault.
    let asked = 0;
    const engine = new DisplayNameTemplateEngine("{{ref!displayName}}", {
      nestedDisplayName: () => {
        asked += 1;
        return null; // nothing composes
      },
    });
    // No label either — that is the ONLY state in which the guard is reachable: with a label the
    // method returns before a second lookup could happen.
    const metadataResolver = (): Record<string, unknown> => ({});

    expect(
      engine.render({ ref: "[[q]]" }, "stem", undefined, metadataResolver),
    ).toBe("q");
    expect(asked).toBe(1);
  });

  it(`${REQ} S8 a label-less target still composes — the two requirements compose, not conflict`, () => {
    // req 0f992e88's own case, now through a part that ALSO declares DisplayName. ⛤ This axis is
    // deliberately INSENSITIVE to the declaration — without a label the composed name is printed
    // either way — so it locks the COMPOSITION of the two requirements, not this one's mechanism;
    // its mutants live in the 0f992e88 specs.
    expect(reviewNameOver(vaultWith(`[[${SOURCE_DISPLAY_NAME}]]`, null))).toBe(
      "ОС Q4-2025",
    );
  });
});
