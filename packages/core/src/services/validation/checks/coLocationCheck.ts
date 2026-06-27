import type { CheckContext, CheckFinding } from "../types";
import { readUid, readIsDefinedByRef } from "../frontmatterRefs";

/** UUID v4-ish — distinguishes a uid reference from a label reference. */
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseNameNoExt(p: string): string {
  const seg = p.slice(p.lastIndexOf("/") + 1);
  return seg.endsWith(".md") ? seg.slice(0, -3) : seg;
}

/** Templates hold placeholder syntax, carry isDefinedBy by inheritance, must never move (CR-1). */
function isTemplatesPath(p: string): boolean {
  return p.split("/").some((seg) => seg.toLowerCase() === "templates");
}

/**
 * co-location check (RFC f402002b, M1.4): every asset with
 * `exo__Asset_isDefinedBy` must physically live in the same folder as the
 * ontology file that reference resolves to (FLAT, exact-match — CR-1).
 *
 * Reader-based + DI-free: resolution uses one-pass indexes built from the warm
 * asset array (uid → path, basename → path), the same uid-then-basename order
 * the CLI `findReferencedFile` resolver uses, so the mobile validate path and
 * the CLI `audit co-location` agree.
 *
 * Fail-open (skipped, never a violation): empty isDefinedBy, `!`-prefixed
 * (intentionally unresolvable) ref, or a ref that resolves to no asset in this
 * vault (cross-vault / missing ontology file).
 */
export function coLocationCheck(ctx: CheckContext): CheckFinding[] {
  const byUid = new Map<string, string>();
  const byBasename = new Map<string, string>();
  for (const a of ctx.assets) {
    const uid = readUid(a.frontmatter);
    if (uid && !byUid.has(uid)) byUid.set(uid, a.path);
    const base = baseNameNoExt(a.path);
    if (!byBasename.has(base)) byBasename.set(base, a.path);
  }

  const resolve = (ref: string): string | undefined =>
    UID_RE.test(ref)
      ? (byUid.get(ref) ?? byBasename.get(ref))
      : (byBasename.get(ref) ?? byUid.get(ref));

  const findings: CheckFinding[] = [];
  for (const a of ctx.assets) {
    if (a.path.split("/").includes("node_modules")) continue;
    if (isTemplatesPath(a.path)) continue;

    const ref = readIsDefinedByRef(a.frontmatter);
    if (!ref) continue; // empty isDefinedBy — fail-open
    if (ref.startsWith("!")) continue; // bang-prefix — intentionally unresolvable

    const ontologyPath = resolve(ref);
    if (!ontologyPath) continue; // unresolvable in this vault — fail-open

    const expected = dirOf(ontologyPath);
    const actual = dirOf(a.path);
    if (expected !== actual) {
      findings.push({
        path: a.path,
        message: `co-location: isDefinedBy=${ref} expects folder "${expected}/" but asset is in "${actual}/"`,
      });
    }
  }
  return findings;
}
