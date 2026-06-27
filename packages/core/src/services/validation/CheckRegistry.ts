import type { CheckRegistryEntry } from "./types";
import {
  CHECK_ID_SHACL,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
} from "./checkIds";
import { uidUniquenessCheck } from "./checks/uidUniquenessCheck";
import { coLocationCheck } from "./checks/coLocationCheck";
import { shaclCheck } from "./checks/shaclCheck";
import { dagOntologyImportsCheck } from "./checks/dagOntologyImportsCheck";

/**
 * The check-id → runner registry. Keying is by the validation-check
 * `setting__SettingKey` UID (data, RFC f402002b M1.3); the runner functions are
 * code (Homoiconicity Q3 exc.1). A {@link VaultCheckRunner} given an enabled
 * check-id with no registry entry reports it **fail-loud**.
 */
export class CheckRegistry {
  private readonly entries = new Map<string, CheckRegistryEntry>();

  register(entry: CheckRegistryEntry): this {
    this.entries.set(entry.id, entry);
    return this;
  }

  get(checkId: string): CheckRegistryEntry | undefined {
    return this.entries.get(checkId);
  }

  has(checkId: string): boolean {
    return this.entries.has(checkId);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}

/**
 * The M1 MVP registry — the 4 checks (SHACL / co-location / uid-uniqueness /
 * DAG ontology-imports) bound to the 4 `setting__SettingKey` check-ids.
 */
export function createDefaultCheckRegistry(): CheckRegistry {
  return new CheckRegistry()
    .register({
      id: CHECK_ID_UID_UNIQUENESS,
      label: "uid-uniqueness",
      run: uidUniquenessCheck,
    })
    .register({
      id: CHECK_ID_CO_LOCATION,
      label: "co-location",
      run: coLocationCheck,
    })
    .register({ id: CHECK_ID_SHACL, label: "shacl", run: shaclCheck })
    .register({
      id: CHECK_ID_DAG_ONTOLOGY_IMPORTS,
      label: "dag-ontology-imports",
      run: dagOntologyImportsCheck,
    });
}
