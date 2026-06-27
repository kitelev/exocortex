/**
 * Homoiconic vault-validation engine (RFC f402002b, M1.4) — public barrel.
 *
 * The `Validate vault` command (M1.5, plugin + CLI + mobile) builds a concrete
 * {@link IVaultCheckReader} (warm metadataCache/getTripleStore on the plugin; a
 * single fs-walk on the CLI), reads the enabled-set from validation-check
 * `setting__Setting` instances, and runs {@link VaultCheckRunner}.
 */
export * from "./types";
export * from "./checkIds";
export { CheckRegistry, createDefaultCheckRegistry } from "./CheckRegistry";
export { VaultCheckRunner } from "./VaultCheckRunner";
export { uidUniquenessCheck } from "./checks/uidUniquenessCheck";
export { coLocationCheck } from "./checks/coLocationCheck";
export { shaclCheck } from "./checks/shaclCheck";
export { dagOntologyImportsCheck } from "./checks/dagOntologyImportsCheck";
export {
  readUid,
  readIsDefinedByRef,
  readInstanceClassRefs,
} from "./frontmatterRefs";
export { readEnabledCheckIds } from "./readEnabledChecks";
