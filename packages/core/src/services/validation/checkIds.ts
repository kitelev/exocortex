/**
 * Stable check-ids — the UIDs of the validation-check `setting__SettingKey`
 * individuals (RFC f402002b, M1.3, in `exoas-exo/setting/`). These are the keys
 * the {@link CheckRegistry} maps to runners; a check-Setting instance whose key
 * UID is none of these (no registered runner) is reported **fail-loud** by the
 * runner, never silently skipped.
 *
 * The split is the Homoiconicity Invariant in action: the ENABLED-SET is data
 * (check-Setting instances reference these keys); the RUNNER mapping is code.
 */

/** `setting__ValidationCheckShacl` — SHACL-lite vault-wide check. */
export const CHECK_ID_SHACL = "f83ffedd-1f05-4ab5-839d-58873c69c4ba";

/** `setting__ValidationCheckCoLocation` — asset folder == isDefinedBy ontology folder. */
export const CHECK_ID_CO_LOCATION = "61f95c82-f6fc-4b20-b06d-19f3dc1b1f12";

/** `setting__ValidationCheckUidUniqueness` — no two assets share an exo__Asset_uid. */
export const CHECK_ID_UID_UNIQUENESS = "ac10db25-231c-4677-8cac-647d3cf15c64";

/** `setting__ValidationCheckDagOntologyImports` — cross-ontology link covered by imports closure. */
export const CHECK_ID_DAG_ONTOLOGY_IMPORTS = "a57f4a6b-a462-4c8d-b958-0dbee4674727";

/** All known validation-check ids (the M1 MVP set of 4). */
export const KNOWN_CHECK_IDS: ReadonlySet<string> = new Set([
  CHECK_ID_SHACL,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
]);

/**
 * Filename-named classes (UUID-canon whitelist, CLAUDE.md) whose instances are
 * NOT UID-named (`pn__DailyNote` → `YYYY-MM-DD.md`, `period__Week` →
 * `YYYY-Www.md`, required by obsidian-calendar-plugin). Their assets still carry
 * a unique `exo__Asset_uid`, but they are exempt from the uid-uniqueness check
 * so a (defensive) collision in the calendar corpus never false-flags.
 */
export const UID_UNIQUENESS_WHITELIST_CLASS_UIDS: ReadonlySet<string> = new Set([
  "b04e7a3e-6b49-4984-9f8d-b74e9f36818b", // pn__DailyNote
  "2b754a16-cccf-49ee-af69-a18c6d1e3b63", // period__Week
]);
