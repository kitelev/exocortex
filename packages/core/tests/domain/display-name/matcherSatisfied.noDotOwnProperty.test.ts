import { describe, it, expect } from "@jest/globals";
import { PrintNameRuleService } from "../../../src/domain/display-name/PrintNameRuleService";
import type { VaultMetadataPort } from "../../../src/domain/display-name/VaultMetadataPort";

/**
 * req 4a2e6b80 — conformance for the OTHER read in `matcherSatisfied` (issue #4059).
 *
 * The req's Job Story says "каждый сегмент читался только как СОБСТВЕННОЕ поле ассета — чтобы
 * имя, которое видит пользователь, нельзя было получить из Object.prototype". A one-component
 * `matchKey` is a segment too: it comes from the same `exo__DisplayNameSpec_matchPath`
 * frontmatter. #4058 closed the dotted walk; this closes the flat read.
 *
 * ⛤ This is a CALL-SITE axis on purpose. Asserting `ownProperty(...)` directly — which is what
 * the first attempt did, and why it was reverted out of #4058 — cannot observe whether THIS
 * branch routes through it: revert line 327 to `metadata[matcher.matchKey]` and a helper-level
 * assertion stays green. True by construction, so such a test is decoration, not coverage.
 *
 * ⛔ The discriminating input is an INHERITED STRING, not a prototype function. A function is
 * rejected downstream by `extractClassKeys` (non-string → []), so `toString`/`constructor` give
 * the same answer either way — the old code was fail-closed BY ACCIDENT of that guard rather
 * than by decision at the read site. Only a string up the prototype chain separates the two.
 *
 * ⚠ Prototype-chained frontmatter is a shape the parsers cannot emit (both VaultMetadataPort
 * adapters return YAML/Obsidian-parsed plain objects). This axis therefore locks the READ
 * SEMANTICS, not a live scenario — stated rather than implied, per the req's Known-boundaries.
 */
const REQ = "@req:4a2e6b80-bd46-47b1-a8c5-08c40837879a";

const SPEC_CLASS_UID = "07eab746-0874-4676-9d98-dbaad1bc6fb8"; // exo__DisplayNameSpec
const LITERAL_CLASS_UID = "4d5437c9-788e-4a6d-9be0-4af3a84554f4"; // exo__PrintedLiteral
const TASK_UID = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task (class)
const STATUS_PROP_UID = "9b1a77c4-0d2e-4a11-9f3c-7e5b21d0a844"; // ems__Effort_status (property)
const DOING_UID = "027e78f4-6e16-4b36-b8fb-5510507d5745"; // ems__EffortStatusDoing (enum)
const SPEC_UID = "spec-nodot-ownprop";

/**
 * Production-shape vault: ONE conditional spec whose matchPath is authored the canonical way —
 * an aliased wikilink whose alias IS the frontmatter key (`resolvePropertyKey` takes the alias
 * verbatim). The alias here has NO dot, so the spec takes the flat read.
 */
function vaultWithNoDotSpec(): VaultMetadataPort {
  const assets: Record<string, Record<string, unknown>> = {
    [STATUS_PROP_UID]: {
      exo__Asset_uid: STATUS_PROP_UID,
      exo__Instance_class: ["[[9a1cf31c-9d41-4ef3-9023-584a8d087d16|exo__ObjectProperty]]"],
      exo__Asset_label: "ems__Effort_status",
    },
    [DOING_UID]: {
      exo__Asset_uid: DOING_UID,
      exo__Instance_class: ["[[6b3e9f21-5a7c-4d88-91bf-2c0a7d5e4b03|ems__EffortStatus]]"],
      exo__Asset_label: "ems__EffortStatusDoing",
    },
    [SPEC_UID]: {
      exo__Asset_uid: SPEC_UID,
      exo__Instance_class: [`[[${SPEC_CLASS_UID}|exo__DisplayNameSpec]]`],
      exo__DisplayNameSpec_appliesToClass: `[[${TASK_UID}|ems__Task]]`,
      exo__DisplayNameSpec_priority: 50,
      // ⛤ NO dot in the alias — this is what routes the matcher to the flat read.
      exo__DisplayNameSpec_matchPath: `[[${STATUS_PROP_UID}|ems__Effort_status]]`,
      exo__DisplayNameSpec_matchValue: `[[${DOING_UID}]]`,
    },
    "part-nodot": {
      exo__Asset_uid: "part-nodot",
      exo__Instance_class: [`[[${LITERAL_CLASS_UID}|exo__PrintedLiteral]]`],
      exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
      exo__DisplayNamePart_order: 0,
      exo__PrintedLiteral_literal: "🔄 ",
    },
  };

  return {
    listFrontmatter: () => Object.values(assets),
    resolveLinkpathFrontmatter: (linkpath: string) => {
      const target = (linkpath.split("|")[0] ?? "").replace(/\.md$/, "").trim();
      return assets[target] ?? null;
    },
  };
}

function serviceUnderTest(): PrintNameRuleService {
  const s = new PrintNameRuleService(vaultWithNoDotSpec());
  s.initialize();
  return s;
}

describe("PrintNameRuleService.matcherSatisfied — the no-dot branch reads own-only [req 4a2e6b80 / #4059]", () => {
  it(`${REQ} CONTROL — an OWN matchKey still matches, so the guard is not "reject everything"`, () => {
    // The whole axis is worthless if the conditional spec never fires at all; this proves the
    // fixture reaches the matcher and the flat read still works for real frontmatter.
    const own = { ems__Effort_status: `[[${DOING_UID}]]` } as Record<string, unknown>;
    expect(serviceUnderTest().getTemplateForClass("ems__Task", own)?.template).toContain("🔄");
  });

  it(`${REQ} an INHERITED matchKey does NOT match — the discriminating input`, () => {
    // Pre-fix `metadata[matcher.matchKey]` walked up the prototype chain and read the string,
    // so the spec matched on a value the asset does NOT carry — a wrongly-applied displayName.
    const inherited = Object.create({
      ems__Effort_status: `[[${DOING_UID}]]`,
    }) as Record<string, unknown>;
    expect(serviceUnderTest().getTemplateForClass("ems__Task", inherited)).toBeNull();
  });

  it(`${REQ} CONTROL — a prototype FUNCTION was already fail-closed, so it does NOT discriminate`, () => {
    // Recorded deliberately: `toString` gives the same answer before and after the fix
    // (extractClassKeys rejects a non-string). Anyone tempted to "simplify" this suite down to
    // a toString case would produce an axis that is green both ways.
    const svc = new PrintNameRuleService(vaultWithNoDotSpec());
    svc.initialize();
    expect(svc.getTemplateForClass("ems__Task", {} as Record<string, unknown>)).toBeNull();
  });
});
