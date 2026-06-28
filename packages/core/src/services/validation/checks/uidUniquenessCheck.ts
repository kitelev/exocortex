import type { CheckContext, CheckFinding } from "../types";
import { readUid, readInstanceClassRefs } from "../frontmatterRefs";
import { UID_UNIQUENESS_WHITELIST_CLASS_UIDS } from "../checkIds";

/**
 * uid-uniqueness check (RFC f402002b, M1.4): no two assets share an
 * `exo__Asset_uid`. A uid on ≥2 paths breaks the UID-canon contract (the
 * resolver, ExoSync uid-keyed diff #3477, and SHACL class resolution all assume
 * a uid maps to exactly one file).
 *
 * Filename-named classes (`pn__DailyNote` / `period__Week`, whitelist) are
 * exempt — their identity is the filename, not the uid (see
 * {@link UID_UNIQUENESS_WHITELIST_CLASS_UIDS}).
 *
 * Pure over the warm one-pass asset array; never re-reads files.
 */
export function uidUniquenessCheck(ctx: CheckContext): CheckFinding[] {
  const byUid = new Map<string, string[]>();

  for (const asset of ctx.assets) {
    const uid = readUid(asset.frontmatter);
    if (!uid) continue; // assets without a uid match by path (D18); not our concern

    // Exempt whitelist filename-classes: their uid is not their identity.
    const classes = readInstanceClassRefs(asset.frontmatter);
    if (classes.some((c) => UID_UNIQUENESS_WHITELIST_CLASS_UIDS.has(c))) continue;

    const paths = byUid.get(uid);
    if (paths) paths.push(asset.path);
    else byUid.set(uid, [asset.path]);
  }

  const findings: CheckFinding[] = [];
  for (const [uid, paths] of byUid) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort();
    for (const p of sorted) {
      findings.push({
        path: p,
        message: `duplicate exo__Asset_uid "${uid}" — also at ${sorted
          .filter((o) => o !== p)
          .join(", ")}`,
      });
    }
  }
  return findings;
}
