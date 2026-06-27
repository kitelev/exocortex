import type {
  CheckResult,
  IVaultCheckReader,
  VaultCheckReport,
} from "./types";
import { CheckRegistry } from "./CheckRegistry";

/**
 * The vault-validation engine (RFC f402002b, M1.4).
 *
 * Builds the warm {@link CheckContext} ONCE per run (one `reader.read()` call —
 * the warm-cache / one-pass contract: checks never re-read files), then runs
 * each ENABLED check (enabled-set = data, passed in by the `Validate vault`
 * command from check-Setting instances) against that single context.
 *
 * **Fail-loud (RFC):** an enabled check-id with no registry entry, OR a runner
 * that throws (e.g. SHACL/DAG with no platform machinery wired), is reported as
 * an `error` result — NEVER a silent skip (anti-precedent: Repair-Folder
 * fail-open). `ok` is true only when every enabled check `pass`ed.
 */
export class VaultCheckRunner {
  constructor(private readonly registry: CheckRegistry = new CheckRegistry()) {}

  async run(
    reader: IVaultCheckReader,
    enabledCheckIds: readonly string[],
  ): Promise<VaultCheckReport> {
    const ctx = await reader.read(); // ← ONE pass; warm source built once
    const results: CheckResult[] = [];

    for (const checkId of enabledCheckIds) {
      const entry = this.registry.get(checkId);
      if (!entry) {
        results.push({
          checkId,
          label: checkId,
          status: "error",
          findings: [],
          errorMessage: `fail-loud: enabled check-id "${checkId}" has no registered runner`,
        });
        continue;
      }
      try {
        const findings = await entry.run(ctx);
        results.push({
          checkId,
          label: entry.label,
          status: findings.length > 0 ? "fail" : "pass",
          findings,
        });
      } catch (err) {
        results.push({
          checkId,
          label: entry.label,
          status: "error",
          findings: [],
          errorMessage: `fail-loud: check "${entry.label}" threw — ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }

    return {
      totalAssets: ctx.assets.length,
      results,
      ok: results.every((r) => r.status === "pass"),
    };
  }
}
