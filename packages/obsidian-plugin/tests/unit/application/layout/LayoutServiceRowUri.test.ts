/**
 * LayoutService.transformToTableRows — threads the store's real `?asset`
 * subject IRI into row metadata so the action-button precondition gate (#3654)
 * substitutes the correct `$target`.
 *
 * Without this, the downstream `TableLayoutRenderer` recomputes the asset IRI
 * from `row.path` via `encodeURIComponent` (over-encoding slashes → `%2F`),
 * which never matches the store subject (`encodeURI`) → every precondition ASK
 * evaluates false → every button silently hidden (mis-gating). This guards the
 * fix at its source.
 *
 * Binds req c5542956-dded-4892-b35c-011a03227562.
 */
import type { App } from "obsidian";
import { SolutionMapping, IRI } from "@kitelev/exocortex-core";
import type { IVaultAdapter } from "@kitelev/exocortex-core";
import { LayoutService } from "../../../../src/application/layout/LayoutService";

const REQ = "@req:c5542956-dded-4892-b35c-011a03227562";

interface RowShape {
  path: string;
  metadata: Record<string, unknown>;
}
interface RowBuilder {
  transformToTableRows(
    solutions: SolutionMapping[],
    columns: unknown[],
    variables: string[],
  ): RowShape[];
}

// `transformToTableRows` is a pure transformation (no app/adapter access), so a
// minimal stub App/adapter is sufficient — the service is never initialised.
const stubApp = {
  vault: { getMarkdownFiles: () => [] },
  metadataCache: {},
} as unknown as App;
const stubAdapter = {} as unknown as IVaultAdapter;

describe(`LayoutService row metadata.uri carries the real store IRI [${REQ}]`, () => {
  it(`sets row.metadata.uri to the store's actual ?asset subject IRI (slashes preserved, not %2F) [${REQ}]`, () => {
    const service = new LayoutService(stubApp, stubAdapter);

    const assetIri = "obsidian://vault/assetspaces/ems/task-alpha.md";
    const solution = new SolutionMapping();
    solution.set("asset", new IRI(assetIri));

    const rows = (
      service as unknown as RowBuilder
    ).transformToTableRows([solution], [], []);

    expect(rows).toHaveLength(1);
    // The precondition gate substitutes `$target` with this exact value, so it
    // MUST be the store subject form (encodeURI — slashes preserved), never the
    // over-encoded `encodeURIComponent` recompute.
    expect(rows[0].metadata.uri).toBe(assetIri);
    expect(String(rows[0].metadata.uri)).not.toContain("%2F");
  });
});
