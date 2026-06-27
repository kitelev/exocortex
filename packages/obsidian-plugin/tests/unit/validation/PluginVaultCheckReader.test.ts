/**
 * PluginVaultCheckReader + listOntologyCandidates tests (RFC f402002b, M1.5
 * plugin half). The reader builds the warm asset array from the metadataCache
 * source (skipping paths with no cache entry) and omits the SHACL/DAG runner
 * thunks (M2-deferred → enabling them is fail-loud, not a silent skip).
 */
import {
  PluginVaultCheckReader,
  listOntologyCandidates,
  type WarmVaultSource,
} from "../../../src/infrastructure/adapters/PluginVaultCheckReader";
import type { VaultAssetRecord } from "@kitelev/exocortex-core";

function source(
  fm: Record<string, Record<string, unknown> | undefined>,
): WarmVaultSource {
  return {
    listMarkdownPaths: () => Object.keys(fm),
    frontmatterOf: (p) => fm[p],
  };
}

describe("PluginVaultCheckReader", () => {
  it("builds the warm asset array from the metadataCache source, skipping no-cache paths, and omits SHACL/DAG runners — @req:807a8a6d-95d4-49a3-90b0-5e2b8d330d32", async () => {
    const reader = new PluginVaultCheckReader(
      source({
        "a/x.md": { exo__Asset_uid: "x" },
        "a/y.md": undefined, // no cache entry yet → skipped (warm-only)
        "a/z.md": { exo__Asset_uid: "z" },
      }),
    );
    const ctx = await reader.read();

    expect(ctx.assets.map((a) => a.path)).toEqual(["a/x.md", "a/z.md"]);
    // SHACL/DAG deferred to M2 → no thunks → the runner reports them fail-loud
    expect(ctx.runShacl).toBeUndefined();
    expect(ctx.runDag).toBeUndefined();
  });

  it("passes through an injected SHACL runner seam when provided (M2 wiring point)", async () => {
    const runShacl = jest.fn().mockResolvedValue([]);
    const reader = new PluginVaultCheckReader(source({}), runShacl);
    const ctx = await reader.read();
    expect(ctx.runShacl).toBe(runShacl);
  });
});

describe("listOntologyCandidates", () => {
  const assets: VaultAssetRecord[] = [
    // the ontology anchor (self-referential isDefinedBy)
    {
      path: "assetspaces/exo/exo/onto.md",
      frontmatter: {
        exo__Asset_uid: "onto-1",
        exo__Asset_label: "$exo",
        exo__Asset_isDefinedBy: "[[onto-1]]",
      },
    },
    // an instance pointing at the anchor
    {
      path: "assetspaces/exo/exo/inst.md",
      frontmatter: {
        exo__Asset_uid: "inst-1",
        exo__Asset_label: "Some class",
        exo__Asset_isDefinedBy: "[[onto-1]]",
      },
    },
    // an instance pointing at an UNRESOLVABLE (cross-vault) anchor → not a candidate
    {
      path: "assetspaces/x/y/orphan.md",
      frontmatter: {
        exo__Asset_uid: "orphan-1",
        exo__Asset_label: "Orphan",
        exo__Asset_isDefinedBy: "[[missing-anchor]]",
      },
    },
  ];

  it("lists ontologies that anchor a co-location group (resolvable isDefinedBy targets) with label + folder — @req:0b7ce59c-0486-45b7-94a4-66f266484b1f", () => {
    const candidates = listOntologyCandidates(assets);
    expect(candidates).toEqual([
      { uid: "onto-1", label: "$exo", folder: "assetspaces/exo/exo" },
    ]);
  });

  it("returns no candidates when nothing resolves (e.g. all anchors cross-vault)", () => {
    const candidates = listOntologyCandidates([assets[2]]);
    expect(candidates).toEqual([]);
  });
});
