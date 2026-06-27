import type { CheckContext, CheckFinding } from "../types";

/**
 * SHACL-lite vault-wide check (RFC f402002b, M1.4).
 *
 * The triple-store machinery is platform-specific and heavy, so the reader
 * injects a pre-bound `runShacl` thunk (plugin: `ShaclLiteValidator.validate`
 * over the warm `getTripleStore()`; CLI: `runShapesValidation`). This check
 * just maps the violations to findings.
 *
 * **Fail-loud:** if the context provides no `runShacl` (the reader cannot supply
 * a triple-store), the check throws — the runner surfaces it as an `error`
 * result, never a silent skip (anti-precedent: Repair-Folder fail-open).
 */
export async function shaclCheck(ctx: CheckContext): Promise<CheckFinding[]> {
  if (!ctx.runShacl) {
    throw new Error(
      "SHACL check is enabled but this context provides no triple-store (runShacl). " +
        "Wire a warm getTripleStore()/runShapesValidation reader, or disable the check.",
    );
  }
  const violations = await ctx.runShacl();
  return violations.map((v) => ({
    path: v.focusNode ?? v.path,
    message: `SHACL: ${v.message}${v.path ? ` (path ${v.path})` : ""}`,
  }));
}
