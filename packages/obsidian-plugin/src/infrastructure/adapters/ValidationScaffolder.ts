/**
 * Plugin-side `Scaffold validation settings` writer (RFC f402002b, M1.5 —
 * Desktop↔Mobile parity). Writes the 4 validation-check `setting__Setting`
 * instances co-located in a chosen ontology's folder, giving `Validate vault`
 * an enabled-set to read. Mirrors the CLI `scaffold validation-settings`
 * defaults + asset template byte-for-byte, but writes through a structural
 * `ScaffoldFileWriter` (Obsidian `vault.adapter.write` on both desktop AND
 * mobile — no Node `fs`, no platform gate).
 *
 * Pure over its injected deps (writer / uid-source / clock) so the defaults +
 * template are unit-testable without Obsidian.
 */
import {
  CHECK_ID_SHACL,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
} from "@kitelev/exocortex-core";

/** setting__Setting class UID (exoas-exo/setting/, RFC f402002b M1.1). */
const SETTING_CLASS_UID = "35cf35fb-935f-4d35-a150-939f29109aec";

/**
 * The M1 scaffold default: uid-uniqueness ON, the rest OFF. uid-uniqueness is
 * the cheapest, always-safe, fully-portable integrity check (runs on mobile);
 * SHACL/co-location/DAG are opt-in.
 */
export const SCAFFOLD_DEFAULTS: ReadonlyArray<{
  checkId: string;
  label: string;
  value: boolean;
}> = [
  { checkId: CHECK_ID_UID_UNIQUENESS, label: "uid-uniqueness", value: true },
  { checkId: CHECK_ID_CO_LOCATION, label: "co-location", value: false },
  { checkId: CHECK_ID_SHACL, label: "shacl", value: false },
  { checkId: CHECK_ID_DAG_ONTOLOGY_IMPORTS, label: "dag-ontology-imports", value: false },
];

function settingAsset(
  uid: string,
  ontologyUid: string,
  checkId: string,
  label: string,
  value: boolean,
  nowIso: string,
): string {
  return `---
exo__Asset_uid: ${uid}
exo__Asset_isDefinedBy: "[[${ontologyUid}]]"
exo__Asset_createdAt: ${nowIso}
exo__Instance_class:
  - "[[${SETTING_CLASS_UID}]]"
exo__Asset_label: "Validation check: ${label} (${value ? "enabled" : "disabled"})"
setting__Setting_key: "[[${checkId}]]"
setting__Setting_value: ${value}
---

# Validation check: ${label}

Homoiconic validation-check setting (RFC f402002b, M1.5). \`Exocortex: Validate vault\` reads this instance's \`setting__Setting_value\` to decide whether to run the **${label}** check (key \`[[${checkId}]]\`). Scaffolded default — edit \`setting__Setting_value\` to toggle.
`;
}

/** Structural file-writer slice (Obsidian `vault.adapter.write`; mobile-portable). */
export interface ScaffoldFileWriter {
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
}

export interface ScaffoldedSetting {
  readonly path: string;
  readonly checkId: string;
  readonly value: boolean;
}

/**
 * Writes the 4 validation-check `setting__Setting` instances co-located in the
 * chosen ontology's folder. `newUid` is injected (Obsidian wires
 * `crypto.randomUUID` — SEC-001: never `Math.random`); `nowIso` is injected so
 * the template is deterministic under test.
 */
export class ValidationScaffolder {
  constructor(
    private readonly writer: ScaffoldFileWriter,
    private readonly newUid: () => string,
    private readonly nowIso: () => string,
  ) {}

  async scaffold(
    ontologyUid: string,
    ontologyFolder: string,
  ): Promise<ScaffoldedSetting[]> {
    const out: ScaffoldedSetting[] = [];
    for (const d of SCAFFOLD_DEFAULTS) {
      const uid = this.newUid();
      const path = ontologyFolder.length > 0 ? `${ontologyFolder}/${uid}.md` : `${uid}.md`;
      // Defensive: never clobber an existing asset (a fresh UID collision is
      // astronomically unlikely, but writing is a mutation — skip if present).
      if (await this.writer.exists(path)) continue;
      await this.writer.write(
        path,
        settingAsset(uid, ontologyUid, d.checkId, d.label, d.value, this.nowIso()),
      );
      out.push({ path, checkId: d.checkId, value: d.value });
    }
    return out;
  }
}
