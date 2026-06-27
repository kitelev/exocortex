/**
 * Palette registration for the M1.5 vault-validation commands (RFC f402002b):
 *   - «Exocortex: Validate vault»             (id `validate-vault`)
 *   - «Exocortex: Scaffold validation settings» (id `scaffold-validation-settings`)
 *
 * ⛔ Desktop↔Mobile Command Parity invariant (CLAUDE.md): BOTH commands register
 * UNCONDITIONALLY — there is NO `Platform.isMobile` gate. The plugin reader is
 * mobile-portable (warm metadataCache) and the scaffold writes via
 * `vault.adapter` (no Node `fs`), so «Validate vault» on iPhone IS the core M1
 * value. Command ids are byte-exact (Obsidian persists hotkeys by id).
 *
 * The registrars take high-level thunks (no `obsidian` runtime import) so they
 * are unit-testable; `ExocortexPlugin` injects the warm reader / scaffolder /
 * picker / Notice slices at onload.
 */
import type {
  ScaffoldedSetting,
} from "./ValidationScaffolder";
import type { OntologyChoice } from "./PluginVaultCheckReader";
import type { VaultCheckReport } from "@kitelev/exocortex-core";

/** Structural slice of `Plugin.addCommand` (no `obsidian` runtime import). */
export interface ValidationCommandRegistrar {
  addCommand(command: { id: string; name: string; callback: () => void }): unknown;
}

export interface ValidateVaultDeps {
  /** Build the warm context + run the enabled-set; the report is what we render. */
  runValidation: () => Promise<VaultCheckReport>;
  /** Surface the result to the user (Obsidian `new Notice`). */
  notify: (message: string) => void;
}

export interface ScaffoldValidationDeps {
  /** Open the ontology picker; resolves the chosen ontology or null on cancel. */
  pickOntology: () => Promise<OntologyChoice | null>;
  /** Write the 4 check-Settings co-located in the chosen ontology's folder. */
  scaffold: (choice: OntologyChoice) => Promise<ScaffoldedSetting[]>;
  notify: (message: string) => void;
}

/** Human-readable summary of a vault-check run for a Notice. */
export function formatVaultCheckReport(report: VaultCheckReport): string {
  if (report.results.length === 0) {
    return "Validate vault: no checks enabled. Run «Scaffold validation settings» (or enable some) first.";
  }
  const lines = report.results.map((r) => {
    if (r.status === "pass") return `✅ ${r.label}`;
    if (r.status === "error")
      return `🟥 ${r.label}: ${r.errorMessage ?? "errored"}`;
    return `❌ ${r.label}: ${r.findings.length} violation(s)`;
  });
  const head = report.ok
    ? `Validate vault: all ${report.results.length} check(s) passed (${report.totalAssets} assets)`
    : `Validate vault: FAILED (${report.totalAssets} assets)`;
  return [head, ...lines].join("\n");
}

/** Human-readable summary of a scaffold run for a Notice. */
export function formatScaffoldResult(
  choice: OntologyChoice,
  created: ScaffoldedSetting[],
): string {
  if (created.length === 0) {
    return `Scaffold validation settings: nothing written for «${choice.label}» (settings already exist).`;
  }
  const enabled = created.filter((c) => c.value).length;
  return `Scaffold validation settings: wrote ${created.length} check-setting(s) in «${choice.label}» (${enabled} enabled by default). Run «Validate vault» to use them.`;
}

export function registerValidateVaultCommand(
  plugin: ValidationCommandRegistrar,
  deps: ValidateVaultDeps,
): void {
  plugin.addCommand({
    id: "validate-vault",
    name: "Validate vault",
    callback: () => {
      void (async () => {
        try {
          const report = await deps.runValidation();
          deps.notify(formatVaultCheckReport(report));
        } catch (err) {
          deps.notify(
            `Validate vault: errored — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    },
  });
}

export function registerScaffoldValidationCommand(
  plugin: ValidationCommandRegistrar,
  deps: ScaffoldValidationDeps,
): void {
  plugin.addCommand({
    id: "scaffold-validation-settings",
    name: "Scaffold validation settings",
    callback: () => {
      void (async () => {
        try {
          const choice = await deps.pickOntology();
          if (choice === null) return; // user cancelled the picker
          const created = await deps.scaffold(choice);
          deps.notify(formatScaffoldResult(choice, created));
        } catch (err) {
          deps.notify(
            `Scaffold validation settings: errored — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    },
  });
}
