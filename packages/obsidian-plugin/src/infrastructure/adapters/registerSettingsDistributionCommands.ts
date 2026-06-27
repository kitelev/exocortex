/**
 * Palette registration for the M2.1 Settings Distribution commands (RFC
 * f402002b). Obsidian auto-prefixes the plugin name, so the user sees:
 *   - «Exocortex: Export settings»  (id `export-settings`)
 *   - «Exocortex: Import settings»  (id `import-settings`)
 * Ids/names omit "exocortex" (the plugin id/name) per obsidianmd lint rules.
 *
 * ⛔ Desktop↔Mobile Command Parity invariant (CLAUDE.md): BOTH register
 * UNCONDITIONALLY — NO `Platform.isMobile` gate. Export writes via
 * `vault.adapter` (no Node `fs`); Import reads the warm `metadataCache`. So
 * settings distribution IS available on iPhone. Command ids are byte-exact
 * (Obsidian persists hotkeys by id).
 *
 * The registrars take high-level thunks (no `obsidian` runtime import,
 * `SettingsSource` from core) so they are unit-testable; `ExocortexPlugin`
 * injects the picker / vault.adapter writer / warm reader / Notice at onload.
 *
 * Additive: these commands give the user an explicit, frictionless snapshot /
 * restore of their settings (full-overwrite — RFC §4, Andrey's decision). They
 * do NOT touch the live-mirror (`VaultSettingsStore`) — M2.3 deprecates that.
 */
import {
  exportSettings,
  importSettings,
  type ImportResult,
  type ImportableSettingAsset,
  type SettingsSource,
} from "@kitelev/exocortex-core";
import type { OntologyChoice } from "./PluginVaultCheckReader";

/** Structural slice of `Plugin.addCommand` (no `obsidian` runtime import). */
export interface SettingsCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

export interface ExportSettingsDeps {
  /** The domain whose declared keys are exported (allowlist-by-construction). */
  source: SettingsSource;
  /** Pick the target ontology (its folder = where assets are written; uid = isDefinedBy). */
  pickOntology: () => Promise<OntologyChoice | null>;
  /** Full-overwrite one asset at `<folder>/<fileName>` (vault.adapter.write). */
  writeAsset: (
    folder: string,
    fileName: string,
    content: string,
  ) => Promise<void>;
  /** ISO timestamp for the exported assets (deterministic under test). */
  nowIso: () => string;
  notify: (message: string) => void;
}

export interface ImportSettingsDeps {
  /** The domain into which values are applied (allowlist-by-construction). */
  source: SettingsSource;
  /** Surface importable setting assets (subClass-closure filtered by the wiring). */
  readAssets: () => Promise<readonly ImportableSettingAsset[]>;
  notify: (message: string) => void;
}

/** Human-readable summary of an export run for a Notice. */
export function formatExportResult(
  choice: OntologyChoice,
  written: readonly { field: string }[],
): string {
  return `Export settings: wrote ${written.length} setting asset(s) into «${choice.label}». Edit there or run «Import settings» to restore.`;
}

/** Human-readable summary of an import run for a Notice. */
export function formatImportResult(result: ImportResult): string {
  if (result.applied.length === 0 && result.skipped.length === 0) {
    return "Import settings: no setting assets found to import.";
  }
  const head = `Import settings: applied ${result.applied.length} setting(s)`;
  if (result.skipped.length === 0) return head + ".";
  const unknown = result.skipped.filter((s) => s.reason === "unknown-key").length;
  const bad = result.skipped.filter((s) => s.reason === "uncoercible").length;
  const parts: string[] = [];
  if (unknown > 0) parts.push(`${unknown} unknown-key`);
  if (bad > 0) parts.push(`${bad} uncoercible`);
  return `${head}; skipped ${result.skipped.length} (${parts.join(", ")}).`;
}

export function registerExportSettingsCommand(
  plugin: SettingsCommandRegistrar,
  deps: ExportSettingsDeps,
): void {
  plugin.addCommand({
    id: "export-settings",
    name: "Export settings",
    callback: () => {
      void (async () => {
        try {
          const choice = await deps.pickOntology();
          if (choice === null) return; // user cancelled the picker
          const assets = exportSettings(deps.source, {
            ontologyUid: choice.uid,
            nowIso: deps.nowIso(),
          });
          for (const a of assets) {
            await deps.writeAsset(choice.folder, a.fileName, a.content);
          }
          deps.notify(formatExportResult(choice, assets));
        } catch (err) {
          deps.notify(
            `Export settings: errored — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    },
  });
}

export function registerImportSettingsCommand(
  plugin: SettingsCommandRegistrar,
  deps: ImportSettingsDeps,
): void {
  plugin.addCommand({
    id: "import-settings",
    name: "Import settings",
    callback: () => {
      void (async () => {
        try {
          const assets = await deps.readAssets();
          const result = await importSettings(deps.source, assets);
          deps.notify(formatImportResult(result));
        } catch (err) {
          deps.notify(
            `Import settings: errored — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    },
  });
}
