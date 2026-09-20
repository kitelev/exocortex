import { describe, it, expect } from "@jest/globals";
import { DisplayNameResolver } from "../../../src/domain/display-name/DisplayNameResolver";
import { DisplayNameTemplateEngine } from "../../../src/domain/display-name/DisplayNameTemplateEngine";
import { PrintNameRuleService } from "../../../src/domain/display-name/PrintNameRuleService";
import { DEFAULT_DISPLAY_NAME_SETTINGS } from "../../../src/domain/display-name/DisplayNameSettings";
import type { VaultMetadataPort } from "../../../src/domain/display-name/VaultMetadataPort";

/**
 * req 0f992e88 (issue #4303) — an `exo__PrintedProperty` prints the referenced asset's COMPOSED
 * displayName when that asset has NO `exo__Asset_label`.
 *
 * ⛤ Production-shape by construction: every axis drives the REAL
 * `PrintNameRuleService.initialize()` → `DisplayNameResolver.resolveWithProvenance()` pipeline over
 * a fixture vault of frontmatter objects. The template under test is COMPILED from the fixture's
 * own `exo__DisplayNameSpec` + `exo__PrintedProperty` assets exactly as the plugin and the CLI
 * compile a live vault — nothing is hand-injected. That is what makes V1 an axis on the WIRING
 * (does the resolver hand the hop to the engine at all) and not merely on the hop's body.
 *
 * ⛔ Three of the seven axes are CONTROLS, and they carry the requirement's real weight: the
 * measured claim is that 0 of 50 884 live assets change their rendered name, which is true only
 * because the alias and the label are still consulted first and a non-composed name is refused.
 * A change that made the fallback unconditional would satisfy V1 and break V2/V3/V4.
 */
const REQ = "@req:0f992e88-e43b-4317-9707-5e1d5309d44e";

const QUARTER_CLASS = "11111111-1111-1111-1111-111111111111";
const REVIEW_CLASS = "22222222-2222-2222-2222-222222222222";
const PROP_NUMBER = "33333333-3333-3333-3333-333333333333";
const PROP_QUARTER = "44444444-4444-4444-4444-444444444444";
const QUARTER = "55555555-5555-5555-5555-555555555555";
const REVIEW = "66666666-6666-6666-6666-666666666666";
const QUARTER_SPEC = "aaaaaaaa-0000-4000-8000-00000000000a";
const REVIEW_SPEC = "bbbbbbbb-0000-4000-8000-00000000000a";

type FM = Record<string, unknown>;

/** The two-method port the engine needs — keyed by `exo__Asset_uid`, as a UID-canon vault is. */
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

function resolverOver(assets: FM[]): DisplayNameResolver {
  const port = portOf(assets);
  const rules = new PrintNameRuleService(port);
  rules.initialize();
  return new DisplayNameResolver(
    DEFAULT_DISPLAY_NAME_SETTINGS,
    rules,
    rules.createMetadataResolver(),
  );
}

/** The TBox + the two specs every axis shares: Quarter renders "Q<number>-2025", Review "ОС <quarter>". */
function baseVault(): FM[] {
  return [
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
      exo__Asset_uid: QUARTER_SPEC,
      exo__Asset_label: "spec: period__Quarter",
      exo__Instance_class: "[[exo__DisplayNameSpec]]",
      exo__DisplayNameSpec_appliesToClass: `[[${QUARTER_CLASS}|period__Quarter]]`,
      exo__DisplayNameSpec_priority: 100,
    },
    {
      exo__Asset_uid: "aaaaaaaa-0000-4000-8000-00000000000b",
      exo__Instance_class: "[[exo__PrintedLiteral]]",
      exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
      exo__DisplayNamePart_order: 1,
      exo__PrintedLiteral_literal: "Q",
    },
    {
      exo__Asset_uid: "aaaaaaaa-0000-4000-8000-00000000000c",
      exo__Instance_class: "[[exo__PrintedProperty]]",
      exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
      exo__DisplayNamePart_order: 2,
      exo__PrintedProperty_property: `[[${PROP_NUMBER}]]`,
    },
    {
      exo__Asset_uid: "aaaaaaaa-0000-4000-8000-00000000000d",
      exo__Instance_class: "[[exo__PrintedLiteral]]",
      exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
      exo__DisplayNamePart_order: 3,
      exo__PrintedLiteral_literal: "-2025",
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
      exo__Asset_uid: "bbbbbbbb-0000-4000-8000-00000000000b",
      exo__Instance_class: "[[exo__PrintedLiteral]]",
      exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
      exo__DisplayNamePart_order: 1,
      exo__PrintedLiteral_literal: "ОС",
    },
    {
      exo__Asset_uid: "bbbbbbbb-0000-4000-8000-00000000000c",
      exo__Instance_class: "[[exo__PrintedProperty]]",
      exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
      exo__DisplayNamePart_order: 2,
      exo__PrintedProperty_property: `[[${PROP_QUARTER}]]`,
    },
  ];
}

function review(quarterRef: string): FM {
  return {
    exo__Asset_uid: REVIEW,
    exo__Asset_label: "ОС a.a.aleksin",
    exo__Instance_class: `[[${REVIEW_CLASS}|tbank__Review]]`,
    tbank__Review_quarter: quarterRef,
  };
}

function nameOf(assets: FM[], uid: string): string | null {
  const resolver = resolverOver(assets);
  const self = assets.find((a) => a.exo__Asset_uid === uid);
  return resolver.resolveWithProvenance({ metadata: self ?? {}, basename: uid })
    .displayName;
}

describe("printed property → the referenced asset's composed displayName (req 0f992e88)", () => {
  it(`${REQ} V1 a LABEL-LESS target with its own spec prints its composed name, not a bare UID`, () => {
    const assets = [
      ...baseVault(),
      // The #4294 shape: an instance created without a label, named per-render by its spec.
      {
        exo__Asset_uid: QUARTER,
        exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
        period__Quarter_number: 4,
      },
      review(`[[${QUARTER}]]`),
    ];

    expect(nameOf(assets, QUARTER)).toBe("Q4-2025");
    expect(nameOf(assets, REVIEW)).toBe("ОС Q4-2025");
    expect(nameOf(assets, REVIEW)).not.toContain(QUARTER);
  });

  it(`${REQ} V2 CONTROL — a target that HAS a label keeps printing the label`, () => {
    const assets = [
      ...baseVault(),
      // Carries BOTH a label and a spec composing something else: the label must win, which is
      // why the live corpus sweep measured 0 changed names.
      {
        exo__Asset_uid: QUARTER,
        exo__Asset_label: "Q4-25",
        exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
        period__Quarter_number: 4,
      },
      review(`[[${QUARTER}]]`),
    ];

    expect(nameOf(assets, QUARTER)).toBe("Q4-2025");
    expect(nameOf(assets, REVIEW)).toBe("ОС Q4-25");
  });

  it(`${REQ} V3 CONTROL — a label-less target with NO composing spec still prints the linkpath`, () => {
    const assets = baseVault()
      // Drop the Quarter spec parts: nothing composes the target's name, so the engine's
      // `default` render (label → basename) must be REFUSED rather than printed as debris.
      .filter(
        (a) =>
          String(a.exo__DisplayNamePart_of ?? "") !== `[[${QUARTER_SPEC}]]`,
      )
      .filter((a) => a.exo__Asset_uid !== QUARTER_SPEC)
      .concat([
        {
          exo__Asset_uid: QUARTER,
          exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
          period__Quarter_number: 4,
        },
        review(`[[${QUARTER}]]`),
      ]);

    expect(nameOf(assets, REVIEW)).toBe(`ОС ${QUARTER}`);
  });

  it(`${REQ} V4 CONTROL — an authored display alias still wins over everything`, () => {
    const assets = [
      ...baseVault(),
      {
        exo__Asset_uid: QUARTER,
        exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
        period__Quarter_number: 4,
      },
      review(`[[${QUARTER}|Q-четвёртый]]`),
    ];

    expect(nameOf(assets, REVIEW)).toBe("ОС Q-четвёртый");
  });

  it(`${REQ} V5 a reference CYCLE terminates and prints the linkpath for the re-entered side`, () => {
    const A = "cccccccc-0000-4000-8000-00000000000a";
    const B = "cccccccc-0000-4000-8000-00000000000b";
    const CYCLE_CLASS = "cccccccc-0000-4000-8000-0000000000c1";
    const CYCLE_PROP = "cccccccc-0000-4000-8000-0000000000c2";
    const CYCLE_SPEC = "cccccccc-0000-4000-8000-0000000000c3";

    const assets: FM[] = [
      {
        exo__Asset_uid: CYCLE_CLASS,
        exo__Asset_label: "t__Knot",
        exo__Instance_class: "[[exo__Class]]",
      },
      {
        exo__Asset_uid: CYCLE_PROP,
        exo__Asset_label: "t__Knot_peer",
        exo__Instance_class: "[[exo__ObjectProperty]]",
      },
      {
        exo__Asset_uid: CYCLE_SPEC,
        exo__Asset_label: "spec: t__Knot",
        exo__Instance_class: "[[exo__DisplayNameSpec]]",
        exo__DisplayNameSpec_appliesToClass: `[[${CYCLE_CLASS}|t__Knot]]`,
        exo__DisplayNameSpec_priority: 100,
      },
      {
        exo__Asset_uid: "cccccccc-0000-4000-8000-0000000000c4",
        exo__Instance_class: "[[exo__PrintedLiteral]]",
        exo__DisplayNamePart_of: `[[${CYCLE_SPEC}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: "~",
      },
      {
        exo__Asset_uid: "cccccccc-0000-4000-8000-0000000000c5",
        exo__Instance_class: "[[exo__PrintedProperty]]",
        exo__DisplayNamePart_of: `[[${CYCLE_SPEC}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: `[[${CYCLE_PROP}]]`,
      },
      {
        exo__Asset_uid: A,
        exo__Instance_class: `[[${CYCLE_CLASS}|t__Knot]]`,
        t__Knot_peer: `[[${B}]]`,
      },
      {
        exo__Asset_uid: B,
        exo__Instance_class: `[[${CYCLE_CLASS}|t__Knot]]`,
        t__Knot_peer: `[[${A}]]`,
      },
    ];

    // A prints B; B prints A; that nested A prints B AGAIN — and THAT B is already on the stack,
    // so it falls back to its linkpath. Three literals, one bare uid, and the walk stops: the
    // re-entry set bounds a cycle without the ROOT being on the stack (the root is addressed by
    // metadata, not by a linkpath, so it cannot be keyed there).
    expect(nameOf(assets, A)).toBe(`~~~${B}`);
  });

  it(`${REQ} V6 the nested render is DEPTH-CAPPED — a long chain stops and prints the linkpath`, () => {
    const CHAIN_CLASS = "dddddddd-0000-4000-8000-0000000000d1";
    const CHAIN_PROP = "dddddddd-0000-4000-8000-0000000000d2";
    const CHAIN_SPEC = "dddddddd-0000-4000-8000-0000000000d3";
    const link = (n: number) => `dddddddd-0000-4000-8000-00000000000${n}`;

    const assets: FM[] = [
      {
        exo__Asset_uid: CHAIN_CLASS,
        exo__Asset_label: "t__Link",
        exo__Instance_class: "[[exo__Class]]",
      },
      {
        exo__Asset_uid: CHAIN_PROP,
        exo__Asset_label: "t__Link_next",
        exo__Instance_class: "[[exo__ObjectProperty]]",
      },
      {
        exo__Asset_uid: CHAIN_SPEC,
        exo__Asset_label: "spec: t__Link",
        exo__Instance_class: "[[exo__DisplayNameSpec]]",
        exo__DisplayNameSpec_appliesToClass: `[[${CHAIN_CLASS}|t__Link]]`,
        exo__DisplayNameSpec_priority: 100,
      },
      {
        exo__Asset_uid: "dddddddd-0000-4000-8000-0000000000d4",
        exo__Instance_class: "[[exo__PrintedLiteral]]",
        exo__DisplayNamePart_of: `[[${CHAIN_SPEC}]]`,
        exo__DisplayNamePart_order: 1,
        exo__PrintedLiteral_literal: ">",
      },
      {
        exo__Asset_uid: "dddddddd-0000-4000-8000-0000000000d5",
        exo__Instance_class: "[[exo__PrintedProperty]]",
        exo__DisplayNamePart_of: `[[${CHAIN_SPEC}]]`,
        exo__DisplayNamePart_order: 2,
        exo__PrintedProperty_property: `[[${CHAIN_PROP}]]`,
      },
    ];
    // 0 → 1 → 2 → 3 → 4, every link label-less: five hops against a cap of three.
    for (let i = 0; i <= 4; i += 1) {
      assets.push({
        exo__Asset_uid: link(i),
        exo__Instance_class: `[[${CHAIN_CLASS}|t__Link]]`,
        ...(i < 4 ? { t__Link_next: `[[${link(i + 1)}]]` } : {}),
      });
    }

    // The cap allows THREE nested renders (links 1, 2 and 3), so four literals are composed —
    // the root's own plus one per nested render — and the FOURTH hop, from link(3) to link(4),
    // is refused: link(4) prints bare.
    expect(nameOf(assets, link(0))).toBe(`>>>>${link(4)}`);
  });

  it(`${REQ} V7 FAIL-OPEN — a resolver with NO metadata resolver prints the linkpath, as before`, () => {
    const assets = [
      ...baseVault(),
      {
        exo__Asset_uid: QUARTER,
        exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
        period__Quarter_number: 4,
      },
      review(`[[${QUARTER}]]`),
    ];
    const rules = new PrintNameRuleService(portOf(assets));
    rules.initialize();
    // No third argument — the shape every caller that has no vault handle constructs.
    const resolver = new DisplayNameResolver(
      DEFAULT_DISPLAY_NAME_SETTINGS,
      rules,
      null,
    );

    const rendered = resolver.resolveWithProvenance({
      metadata: review(`[[${QUARTER}]]`),
      basename: REVIEW,
    });
    expect(rendered.displayName).toBe(`ОС ${QUARTER}`);
  });

  it(`${REQ} V8 the ENGINE asks for the composed name only AFTER the label declines`, () => {
    const asked: string[] = [];
    const nestedDisplayName = (wikilink: string): string | null => {
      asked.push(wikilink);
      return "COMPOSED";
    };
    const metadataResolver = (
      wikilink: string,
    ): Record<string, unknown> | null =>
      wikilink.includes("labelled") ? { exo__Asset_label: "A Label" } : {};

    const engine = new DisplayNameTemplateEngine("{{ref}}", {
      nestedDisplayName,
    });

    expect(
      engine.render(
        { ref: "[[labelled]]" },
        "stem",
        undefined,
        metadataResolver,
      ),
    ).toBe("A Label");
    expect(asked).toEqual([]);

    expect(
      engine.render({ ref: "[[bare]]" }, "stem", undefined, metadataResolver),
    ).toBe("COMPOSED");
    expect(asked).toEqual(["[[bare]]"]);

    // An engine constructed WITHOUT the option is byte-identical to before the requirement.
    const plain = new DisplayNameTemplateEngine("{{ref}}");
    expect(
      plain.render({ ref: "[[bare]]" }, "stem", undefined, metadataResolver),
    ).toBe("bare");
  });

  it(`${REQ} V10 the SAME resolver renders the same name twice — the depth is unwound`, () => {
    // A resolver is long-lived in the plugin (one instance per load). If the nested-render depth
    // were not unwound, the FIRST composed name would exhaust the budget and every later render
    // would silently degrade to the linkpath — a defect no single-render axis can see.
    const assets = [
      ...baseVault(),
      {
        exo__Asset_uid: QUARTER,
        exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
        period__Quarter_number: 4,
      },
      review(`[[${QUARTER}]]`),
    ];
    const resolver = resolverOver(assets);
    const render = (): string | null =>
      resolver.resolveWithProvenance({
        metadata: review(`[[${QUARTER}]]`),
        basename: REVIEW,
      }).displayName;

    for (let i = 0; i < 6; i += 1) {
      expect(render()).toBe("ОС Q4-2025");
    }
  });

  it(`${REQ} V11 a target named only by a TEMPLATE (not by a spec) is refused — debris is not a name`, () => {
    // The settings-level template is user-configurable (the shipped `classSuffix` preset is
    // exactly this string), so `default` provenance CAN render non-empty over a missing label:
    // "(period__Quarter)". That is debris, and printing it inside a sibling's title would be
    // strictly worse than the UID it replaced — hence the provenance gate.
    const assets = baseVault()
      .filter(
        (a) =>
          String(a.exo__DisplayNamePart_of ?? "") !== `[[${QUARTER_SPEC}]]`,
      )
      .filter((a) => a.exo__Asset_uid !== QUARTER_SPEC)
      .concat([
        {
          exo__Asset_uid: QUARTER,
          exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
          period__Quarter_number: 4,
        },
        review(`[[${QUARTER}]]`),
      ]);
    const rules = new PrintNameRuleService(portOf(assets));
    rules.initialize();
    const resolver = new DisplayNameResolver(
      {
        ...DEFAULT_DISPLAY_NAME_SETTINGS,
        defaultTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
      },
      rules,
      rules.createMetadataResolver(),
    );

    // The target itself renders the debris ...
    expect(
      resolver.resolveWithProvenance({
        metadata: assets.find((a) => a.exo__Asset_uid === QUARTER) ?? {},
        basename: QUARTER,
      }).displayName,
    ).toBe("(period__Quarter)");

    // ... and the referring asset must NOT print it.
    expect(
      resolver.resolveWithProvenance({
        metadata: review(`[[${QUARTER}]]`),
        basename: REVIEW,
      }).displayName,
    ).toBe(`ОС ${QUARTER}`);
  });

  it(`${REQ} V9 a BLANK composed name is refused — the linkpath is printed instead`, () => {
    // `nestedDisplayName` is a constructor option, i.e. part of this class's public surface: a
    // caller other than DisplayNameResolver may hand back a whitespace-only string. Printing it
    // would replace a UID — which at least identifies the asset — with nothing at all.
    const engine = new DisplayNameTemplateEngine("{{ref}}", {
      nestedDisplayName: () => "   ",
    });
    const metadataResolver = (): Record<string, unknown> => ({});

    expect(
      engine.render({ ref: "[[bare]]" }, "stem", undefined, metadataResolver),
    ).toBe("bare");
  });
});
