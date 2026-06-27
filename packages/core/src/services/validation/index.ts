/**
 * Homoiconic vault-validation engine (RFC f402002b, M1.4/M1.5) — public barrel.
 *
 * The `Validate vault` command (M1.5, plugin + CLI + mobile) builds a concrete
 * {@link IVaultCheckReader} (warm metadataCache/getTripleStore on the plugin; a
 * single fs-walk on the CLI), reads the enabled-set from validation-check
 * `setting__Setting` instances, and runs {@link VaultCheckRunner}.
 *
 * ⚠ EXPLICIT named re-exports only — NO `export *`. The core package compiles to
 * CommonJS; an ESM consumer's named imports are resolved by `cjs-module-lexer`
 * static analysis, which does NOT recurse reliably through chained `export *`. A
 * nested `export *` here (re-exported in turn by the core barrel) truncated
 * core's ESM-visible export set, dropping unrelated names (e.g.
 * `FileAlreadyExistsError`) for CLI ESM importers (test-coverage-cli red).
 * Flat explicit re-exports keep every core export statically detectable.
 */
export type {
  VaultAssetRecord,
  ShaclViolationLike,
  CheckContext,
  CheckFinding,
  CheckStatus,
  CheckResult,
  VaultCheckReport,
  CheckFn,
  CheckRegistryEntry,
  IVaultCheckReader,
} from "./types";
export {
  CHECK_ID_SHACL,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
  KNOWN_CHECK_IDS,
  UID_UNIQUENESS_WHITELIST_CLASS_UIDS,
} from "./checkIds";
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
