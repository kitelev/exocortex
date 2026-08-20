/**
 * Issue #4041 — the two 1-hop resolvers stopped agreeing on the unwrap.
 *
 * `PropertiesDefinitionValuePatch.buildMetadataResolver` is an inline copy of
 * `PrintNameRuleService.createMetadataResolver`, deliberately inline so the
 * patch does not depend on the service. After req fedeaa6e the canonical one
 * began stripping a display alias (`[[uid|label]]` → `uid`) and the copy did
 * not — so the two changes in that PR landed on a DIFFERENT number of surfaces,
 * and a concept-definition dot-path over an aliased intermediate reference kept
 * a silent non-match while the same authoring form resolved everywhere else.
 *
 * ⛤ What is shared now is the UNWRAP, not the hop: the canonical resolver goes
 * through a `VaultMetadataPort`, this one through Obsidian's `metadataCache`,
 * and that difference is by construction — it is not what diverged.
 *
 * ⛤ Live radius when written: ZERO. Measured over the raw frontmatter of all
 * three canonical vaults — 138 parts carry `exo__PrintedProperty_property`, the
 * 3 dot-paths among them all belong to `exo__DisplayNameSpec`, not to a
 * concept-definition spec. This closes an authoring trap before anyone falls in.
 * (⛔ Not measurable by SPARQL: the store emits the wikilink TARGET and discards
 * the alias, so a query for "how many are aliased" answers zero regardless.)
 *
 * Revert-verify: restoring the alias-blind unwrap here turns the aliased axis
 * RED; the plain axes stay GREEN in both states.
 */
import { TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import { PropertiesDefinitionValuePatch } from "@plugin/presentation/properties/PropertiesDefinitionValuePatch";

const TARGET_PATH = "assetspaces/kitelev/exoas-my/my/cccccccc-0003.md";
const TARGET_UID = "cccccccc-0003";

function app(): App {
  const file = Object.assign(new TFile(), {
    path: TARGET_PATH,
    basename: TARGET_UID,
    extension: "md",
  });
  const cache = new Map<string, CachedMetadata>([
    [
      TARGET_PATH,
      { frontmatter: { exo__Asset_label: "Целевой ассет" } } as CachedMetadata,
    ],
  ]);
  return {
    metadataCache: {
      getFileCache: (f: TFile) => cache.get(f.path) ?? null,
      // Resolves ONLY the bare uid — exactly like Obsidian: an unstripped
      // `uid|label` linkpath finds nothing.
      getFirstLinkpathDest: (p: string) =>
        p === TARGET_UID || p === `${TARGET_UID}.md` ? file : null,
    },
    workspace: { getLeavesOfType: () => [] },
  } as unknown as App;
}

/** The private resolver under test — the patch builds it for its dot-path hops. */
function resolverOf(): (t: string) => Record<string, unknown> | null {
  const patch = new PropertiesDefinitionValuePatch({ app: app() } as never);
  return (
    patch as unknown as {
      buildMetadataResolver: () => (
        t: string,
      ) => Record<string, unknown> | null;
    }
  ).buildMetadataResolver();
}

describe("@req:7405c664-826e-40af-a1df-395534530eb2 Issue #4041: the patch's resolver strips a display alias too", () => {
  it("resolves an ALIASED reference exactly as the bare one", () => {
    // The defect: `getFirstLinkpathDest("<uid>|<label>")` never resolves, so this
    // returned null — a silent non-match with no diagnostic.
    expect(resolverOf()(`[[${TARGET_UID}|Целевой ассет]]`)).toEqual({
      exo__Asset_label: "Целевой ассет",
    });
  });

  it("resolves a BARE reference unchanged", () => {
    // Canary — green in BOTH states. Every live part is this shape or simpler.
    expect(resolverOf()(`[[${TARGET_UID}]]`)).toEqual({
      exo__Asset_label: "Целевой ассет",
    });
  });

  it("still returns null for an unknown target", () => {
    // Canary — green in BOTH states. Fail-closed is unchanged.
    expect(resolverOf()("[[nope-does-not-exist]]")).toBeNull();
  });

  it("still returns null for an empty target", () => {
    // Canary — an alias-only value (`[[|label]]`) normalises to "" and must not
    // become a lookup for the label.
    expect(resolverOf()("[[|Целевой ассет]]")).toBeNull();
  });
});
