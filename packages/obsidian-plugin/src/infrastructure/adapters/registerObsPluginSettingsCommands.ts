/**
 * Palette registration for the M4.1 `obsplugin__Setting` export command (RFC
 * f402002b). Pilot: «Exocortex: Export Periodic Notes settings» (id
 * `export-periodic-notes-settings`). Obsidian auto-prefixes the plugin name;
 * the id omits "exocortex" per obsidianmd lint rules + is byte-exact (hotkeys
 * persist by id).
 *
 * ⛔ Desktop↔Mobile Command Parity invariant (CLAUDE.md): registered
 * UNCONDITIONALLY — NO `Platform.isMobile` gate. The source reads the target
 * plugin's `data.json` via `vault.adapter` (no Node `fs`), so export IS
 * available on iPhone.
 *
 * Unlike the exocortex export (whose source is fixed), an obsplugin source is
 * built per-invocation from the target plugin's live `data.json` (read at
 * callback time) — `loadSource` returns `null` when the plugin isn't installed
 * / its `data.json` is unreadable, and the command notifies instead of erroring.
 *
 * Reuses the generic engine (`exportSettings`) + the exocortex export's
 * {@link SettingsCommandRegistrar} / {@link formatExportResult}; additive (a
 * NEW command — it does NOT touch the exocortex export or the live-mirror).
 * Export-only (M4.1); Import is M4.2.
 */
import { exportSettings, type SettingsSource } from "@kitelev/exocortex-core";
import type { OntologyChoice } from "./PluginVaultCheckReader";
import type { SettingsCommandRegistrar } from "./registerSettingsDistributionCommands";

export interface ExportObsPluginSettingsDeps {
  /** Command id (byte-exact; obsidian persists hotkeys by id). */
  readonly commandId: string;
  /** Command name (obsidian auto-prefixes «Exocortex: »). */
  readonly commandName: string;
  /** Human label of the target plugin (for the not-found notice). */
  readonly pluginLabel: string;
  /**
   * Build the export source from the target plugin's live config — `null` when
   * the plugin is not installed / its `data.json` is missing or unparseable.
   */
  loadSource: () => Promise<SettingsSource | null>;
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

export function registerExportObsPluginSettingsCommand(
  plugin: SettingsCommandRegistrar,
  deps: ExportObsPluginSettingsDeps,
): void {
  plugin.addCommand({
    id: deps.commandId,
    name: deps.commandName,
    callback: () => {
      void (async () => {
        try {
          const source = await deps.loadSource();
          if (source === null) {
            deps.notify(
              `Export ${deps.pluginLabel} settings: ${deps.pluginLabel} not found in this vault (no readable data.json).`,
            );
            return;
          }
          const choice = await deps.pickOntology();
          if (choice === null) return; // user cancelled the picker
          const assets = exportSettings(source, {
            ontologyUid: choice.uid,
            nowIso: deps.nowIso(),
          });
          for (const a of assets) {
            await deps.writeAsset(choice.folder, a.fileName, a.content);
          }
          // Plugin-aware notice — do NOT reuse the exocortex `formatExportResult`
          // (its "run «Import settings» to restore" hint points at the EXOCORTEX
          // import; obsplugin Import is M4.2, not shipped).
          deps.notify(
            `Export ${deps.pluginLabel} settings: wrote ${assets.length} setting asset(s) into «${choice.label}». Re-export to update (Import is not yet available).`,
          );
        } catch (err) {
          deps.notify(
            `Export ${deps.pluginLabel} settings: errored — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    },
  });
}
