import type { CheckContext, CheckFinding } from "../types";

/**
 * Ontology-imports DAG check (RFC f402002b, M1.4) — a cross-ontology link is a
 * violation unless the source ontology declares an `exo__Ontology_imports`
 * closure covering the target (the invariant of the existing CLI
 * `audit ontology-imports`, req 6999f49b).
 *
 * The ontology-graph derivation (asset → ontology, declared-imports edges,
 * cross-ontology link classification) is shared with — and validated against —
 * the CLI scanner (`ontologyImportsGraph` transitive-closure primitives). To
 * keep that single source of truth and avoid a drifting re-implementation, the
 * reader injects a pre-bound `runDag` thunk (plugin: over the warm asset graph;
 * CLI: the existing scanner). This check just surfaces its findings.
 *
 * **Fail-loud:** if the context provides no `runDag`, the check throws — the
 * runner surfaces it as an `error` result, never a silent skip.
 */
export async function dagOntologyImportsCheck(
  ctx: CheckContext,
): Promise<CheckFinding[]> {
  if (!ctx.runDag) {
    throw new Error(
      "DAG ontology-imports check is enabled but this context provides no graph " +
        "derivation (runDag). Wire a reader that supplies it, or disable the check.",
    );
  }
  return [...(await ctx.runDag())];
}
