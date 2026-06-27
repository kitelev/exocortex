import { Command } from "commander";
import { existsSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { dirname, join, resolve } from "path";
import {
  CHECK_ID_SHACL,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
  readUid,
} from "@kitelev/exocortex-core";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/** setting__Setting class UID (exoas-exo/setting/, RFC f402002b M1.1). */
const SETTING_CLASS_UID = "35cf35fb-935f-4d35-a150-939f29109aec";

/**
 * The M1 scaffold default: uid-uniqueness ON, the rest OFF. uid-uniqueness is
 * the cheapest, always-safe integrity check; SHACL/co-location/DAG are opt-in.
 */
const SCAFFOLD_DEFAULTS: ReadonlyArray<{ checkId: string; label: string; value: boolean }> = [
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

export interface ScaffoldValidationOptions {
  vault: string;
  ontology: string;
  output?: OutputFormat;
}

/**
 * `exocortex scaffold validation-settings --vault <path> --ontology <uid>`
 * (RFC f402002b, M1.5) — creates the 4 validation-check `setting__Setting`
 * instances (uid-uniqueness=true, rest=false) co-located in the chosen
 * ontology's folder, so `validate vault` has an enabled-set to read.
 */
/** `exocortex scaffold` parent — homoiconic scaffolding helpers (M1.5+). */
export function scaffoldCommand(): Command {
  return new Command("scaffold")
    .description("Scaffold homoiconic configuration assets")
    .addCommand(scaffoldValidationCommand());
}

export function scaffoldValidationCommand(): Command {
  return new Command("validation-settings")
    .description(
      "Scaffold the 4 validation-check setting__Setting instances (uid-uniqueness=true, rest=false) co-located in the chosen ontology",
    )
    .requiredOption("--vault <path>", "Vault root directory")
    .requiredOption(
      "--ontology <uid>",
      "UID of the ontology whose folder the check settings are co-located in",
    )
    .option("--output <type>", "Response format: text|json", "text")
    .action(async (options: ScaffoldValidationOptions) => {
      const fmt = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(fmt);
      try {
        const vaultPath = resolve(options.vault);
        if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
          throw new VaultNotFoundError(vaultPath);
        }

        // Resolve the target ontology's folder from its UID (one warm fs-walk).
        const adapter = new CachingNodeFsAdapter(vaultPath);
        const indexed = await adapter.indexedAssets();
        const ontologyAsset = indexed.find(
          (a) => readUid(a.metadata) === options.ontology,
        );
        if (!ontologyAsset) {
          throw new Error(
            `Ontology UID "${options.ontology}" not found in vault ${vaultPath} (its folder is where the check settings co-locate).`,
          );
        }
        const targetDir = join(vaultPath, dirname(ontologyAsset.path));

        const nowIso = new Date().toISOString().slice(0, 19);
        const created: string[] = [];
        for (const d of SCAFFOLD_DEFAULTS) {
          const uid = randomUUID();
          const filePath = join(targetDir, `${uid}.md`);
          await writeFile(
            filePath,
            settingAsset(uid, options.ontology, d.checkId, d.label, d.value, nowIso),
            "utf-8",
          );
          created.push(filePath);
        }

        if (fmt === "json") {
          console.log(
            JSON.stringify(
              { vaultPath, ontology: options.ontology, targetDir, created },
              null,
              2,
            ),
          );
        } else {
          console.log(
            `OK: scaffolded ${created.length} validation-check setting(s) in ${targetDir}`,
          );
          for (const c of created) console.log(`  ${c}`);
          console.log(
            "\nDefaults: uid-uniqueness=true, co-location/shacl/dag=false. Run 'exocortex validate vault --vault <path>'.",
          );
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
