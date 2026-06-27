/**
 * Generic Settings Distribution engine (RFC f402002b, M2.1).
 *
 * Two pure transforms over a {@link SettingsSource}:
 *  - {@link exportSettings}: declared keys → `setting__Setting` asset specs.
 *  - {@link importSettings}: asset frontmatter → live-value writes.
 *
 * Allowlist-by-construction (RFC sec F1): export iterates ONLY
 * `source.declaredKeys()`; import applies ONLY keys present in that set. A
 * field absent from the allowlist (a secret, a structural setting) can never be
 * exported nor imported — regardless of what the live keyspace / asset folder
 * carries.
 *
 * No I/O here (Q3 exc.1 / Desktop↔Mobile parity): the caller writes the
 * returned {@link ExportedSettingAsset}s via its platform writer (vault.adapter
 * on plugin/mobile, fs on CLI) and feeds {@link importSettings} the assets its
 * reader surfaced (subClass-closure filtering lives in the reader).
 */
import {
  coerceSettingValue,
  extractKeyRef,
  readSettingValueRaw,
  renderSettingAssetMarkdown,
} from "./settingAsset";
import type {
  ExportOptions,
  ExportedSettingAsset,
  ImportResult,
  ImportSkip,
  ImportableSettingAsset,
  SettingKeySpec,
  SettingsSource,
} from "./types";

/**
 * Snapshot every DECLARED setting key of `source` into a `setting__Setting`
 * asset spec (one per key, allowlist-by-construction). The live value is read
 * via `source.readLiveValue`; the keyspace is NEVER enumerated, so an undeclared
 * field cannot leak into the export. Returns specs only — the caller writes them
 * (full-overwrite) at `<targetFolder>/<fileName>`.
 */
export function exportSettings(
  source: SettingsSource,
  opts: ExportOptions,
): ExportedSettingAsset[] {
  return source.declaredKeys().map((key) => ({
    field: key.field,
    fileName: `${key.settingUid}.md`,
    content: renderSettingAssetMarkdown(
      key,
      source.readLiveValue(key),
      source.settingClassUid,
      opts.ontologyUid,
      opts.nowIso,
    ),
  }));
}

/**
 * Apply each importable asset's value to live settings — but ONLY for keys in
 * `source.declaredKeys()` (allowlist-by-construction) and ONLY when the value
 * coerces to the declared datatype. Every non-applied asset is reported in
 * `skipped` (never silently dropped): `unknown-key` (not in the allowlist) or
 * `uncoercible` (invalid value). Key matching is dual-read (canonical
 * `setting__Setting_key`, then legacy `exo__Setting_key`) and accepts both the
 * key UID and the key label.
 */
export async function importSettings(
  source: SettingsSource,
  assets: readonly ImportableSettingAsset[],
): Promise<ImportResult> {
  const byRef = new Map<string, SettingKeySpec>();
  for (const k of source.declaredKeys()) {
    byRef.set(k.keyUid, k);
    byRef.set(k.keyLabel, k);
  }

  const applied: string[] = [];
  const skipped: ImportSkip[] = [];

  for (const asset of assets) {
    const ref = extractKeyRef(asset.frontmatter);
    const spec = ref !== null ? byRef.get(ref) : undefined;
    if (spec === undefined) {
      // Not in the allowlist (or no key-ref at all) → never apply.
      skipped.push({
        path: asset.path,
        reason: "unknown-key",
        detail: ref ?? "<no setting key>",
      });
      continue;
    }
    const value = coerceSettingValue(
      spec.datatype,
      readSettingValueRaw(asset.frontmatter),
    );
    if (value === undefined) {
      skipped.push({
        path: asset.path,
        reason: "uncoercible",
        detail: `expected ${spec.datatype}`,
      });
      continue;
    }
    await source.writeLiveValue(spec, value);
    applied.push(spec.field);
  }

  return { applied, skipped };
}
