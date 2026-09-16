/**
 * req 2a020489 — `FrontmatterService.applyPatch(target, patch)` is the single
 * carrier of the object-shaped write dialect that both production
 * `IVaultAdapter.updateFrontmatter` implementations call.
 *
 * These axes pin the pure-function contract of the carrier itself. They do NOT
 * prove that either adapter is wired through it — that is what the adapter
 * axes do (plugin A1-A7 in `ObsidianVaultAdapter.test.ts`, CLI C1-C7 in
 * `filesystem-vault-adapter-patch-dialect.integration.test.ts`): a helper-level
 * axis stays green when a call site is bypassed, so wiring is locked ONLY at
 * the call sites. Revert-verify (PR body): every helper-body mutant M3-M7
 * reddens one H-axis here AND the matching A-/C-axis in both adapters.
 */
import { describe, it, expect } from "@jest/globals";
import { FrontmatterService } from "../../src/utilities/FrontmatterService";

const REQ = "@req:2a020489-00db-4fe9-b2ca-1481cb7da9b1";

describe("FrontmatterService.applyPatch — chokepoint key dialect over an object (req 2a020489) [REVERT-VERIFY]", () => {
  it(`H1 canonicalises every patch key: bare archived → exo__Asset_archived, exo__Asset_aliases → aliases, other keys → themselves ${REQ}`, () => {
    const target = FrontmatterService.applyPatch(
      {},
      {
        archived: true,
        exo__Asset_aliases: ["x"],
        ems__Effort_status: "[[y]]",
      },
    );
    expect(target).toEqual({
      exo__Asset_archived: true,
      aliases: ["x"],
      ems__Effort_status: "[[y]]",
    });
  });

  it(`H2 drops the LEGACY_YAML_KEYS spelling of a written canonical key from the target ${REQ}`, () => {
    const target = FrontmatterService.applyPatch(
      { archived: true, exo__Asset_uid: "u" },
      { exo__Asset_archived: false },
    );
    expect(target).toEqual({ exo__Asset_uid: "u", exo__Asset_archived: false });
    expect(target).not.toHaveProperty("archived");
  });

  it(`H3 resolves a dual payload canonical-wins in either insertion order ${REQ}`, () => {
    expect(
      FrontmatterService.applyPatch(
        {},
        { archived: true, exo__Asset_archived: false },
      ),
    ).toEqual({ exo__Asset_archived: false });
    expect(
      FrontmatterService.applyPatch(
        {},
        { exo__Asset_archived: false, archived: true },
      ),
    ).toEqual({ exo__Asset_archived: false });
  });

  it(`H4 PATCH: target keys the patch does not carry are preserved — omission is not deletion ${REQ}`, () => {
    const target = FrontmatterService.applyPatch(
      {
        exo__Asset_uid: "u",
        exo__Asset_label: "L",
        ems__Effort_status: "[[s]]",
      },
      { exo__Asset_label: "New" },
    );
    expect(target).toEqual({
      exo__Asset_uid: "u",
      exo__Asset_label: "New",
      ems__Effort_status: "[[s]]",
    });
  });

  it(`H5 normalises an IRI-form key and an obsidian:// / ontology-IRI string value; non-string values pass through ${REQ}`, () => {
    const target = FrontmatterService.applyPatch(
      {},
      {
        "https://exocortex.my/ontology/ems#Effort_status":
          "obsidian://vault/x/ems__EffortStatusDoing.md",
        exo__Asset_isDefinedBy: "https://exocortex.my/ontology/exo#Asset",
        exo__Asset_archived: true,
      },
    );
    expect(Object.keys(target).sort()).toEqual(
      [
        "ems__Effort_status",
        "exo__Asset_archived",
        "exo__Asset_isDefinedBy",
      ].sort(),
    );
    // Tightened from `toContain` to `toBe` by req 27fbe40b (object-path form
    // decided: the BARE wikilink; see F1 below).
    expect(target.ems__Effort_status).toBe("[[ems__EffortStatusDoing]]");
    expect(target.exo__Asset_isDefinedBy).toBe("[[exo__Asset]]");
    expect(target.exo__Asset_archived).toBe(true);
  });

  // req 27fbe40b (ticket 73b16cc4) — the object-path FORM: `applyPatch` stores
  // the BARE wikilink (the serialiser quotes it on disk), while the text path
  // keeps emitting the quoted scalar. Mutant M1 (applyPatch pre-quotes, i.e.
  // `normalizeIRIValue` without `{ bare: true }`) → RED here, H5, A7, C7, F2.
  it("F1 applyPatch stores the BARE [[x]] for obsidian:// and ontology-IRI values while updateProperty still writes the quoted scalar line @req:27fbe40b-080f-4928-b675-3c767223c875", () => {
    const target = FrontmatterService.applyPatch(
      {},
      {
        "https://exocortex.my/ontology/ems#Effort_status":
          "obsidian://vault/x/ems__EffortStatusDoing.md",
        exo__Asset_isDefinedBy: "https://exocortex.my/ontology/exo#Asset",
        plain: "just text",
      },
    );
    expect(target.ems__Effort_status).toBe("[[ems__EffortStatusDoing]]");
    expect(target.exo__Asset_isDefinedBy).toBe("[[exo__Asset]]");
    expect(target.plain).toBe("just text");

    // The helper's two forms, side by side.
    expect(
      FrontmatterService.normalizeIRIValue(
        "obsidian://vault/x/ems__EffortStatusDoing.md",
      ),
    ).toBe('"[[ems__EffortStatusDoing]]"');
    expect(
      FrontmatterService.normalizeIRIValue(
        "obsidian://vault/x/ems__EffortStatusDoing.md",
        { bare: true },
      ),
    ).toBe("[[ems__EffortStatusDoing]]");

    // Text path unchanged: the block line is the quoted scalar.
    const text = new FrontmatterService().updateProperty(
      "---\nexo__Asset_uid: u\n---\nBody\n",
      "https://exocortex.my/ontology/ems#Effort_status",
      "obsidian://vault/x/ems__EffortStatusDoing.md",
    );
    expect(text).toContain('\nems__Effort_status: "[[ems__EffortStatusDoing]]"\n');
  });

  it(`H6 mutates and returns the SAME object (the plugin hands in Obsidian's live processFrontMatter object) ${REQ}`, () => {
    const live: Record<string, unknown> = { exo__Asset_uid: "u" };
    const returned = FrontmatterService.applyPatch(live, {
      exo__Asset_label: "L",
    });
    expect(returned).toBe(live);
    expect(live).toEqual({ exo__Asset_uid: "u", exo__Asset_label: "L" });
  });

  it(`H7 a patch value of undefined is "no opinion": the existing value survives and no legacy spelling is dropped (PR #4243 review) ${REQ}`, () => {
    const target = FrontmatterService.applyPatch(
      { exo__Asset_label: "L", archived: true },
      { exo__Asset_label: undefined, exo__Asset_archived: undefined },
    );
    expect(target).toEqual({ exo__Asset_label: "L", archived: true });
    expect(
      Object.prototype.hasOwnProperty.call(target, "exo__Asset_archived"),
    ).toBe(false);
  });
});
