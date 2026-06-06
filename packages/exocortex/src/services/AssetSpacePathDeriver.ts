/**
 * RFC `01a83de8` v10 (UD1) — derive an AssetSpace's vault-relative mount path
 * purely from its `exo__AssetSpace_source` URL.
 *
 * Canonical layout: `assetspaces/<owner>/<repo>` (Maven-style, two levels).
 * GitHub guarantees global uniqueness of `owner/repo`, so the derived path is
 * collision-safe across the whole ecosystem without needing reversed-host
 * depth (`com/github/…` was rejected — alt L/S). `_path` is excluded by design:
 * the derivation is a single pure function, so there is no mixed flat/deep
 * state to persist per-asset.
 *
 * This is intentionally NOT `IRICanonicalizer` — that service remaps synth-A
 * RDF IRIs across federated stores. `derivePath` answers a different question:
 * "given a clone URL, where on disk does this AssetSpace mount?".
 *
 * Normalisation handled (all map to the same `<owner>/<repo>`):
 *   - scheme: `https://`, `http://`, `ssh://`, `git://`
 *   - SSH scp-like form: `git@github.com:owner/repo.git`
 *   - embedded credentials: `https://user:token@github.com/owner/repo`
 *   - `.git` suffix
 *   - trailing slash(es)
 *   - host port: `ssh://git@github.com:22/owner/repo`
 *
 * Returns `null` when an `<owner>/<repo>` pair cannot be extracted (malformed
 * input, fewer than two path segments) — callers fall back to the legacy
 * path-prefix strategy.
 */

const ASSET_SPACES_PREFIX = "assetspaces";

/**
 * Derive `assetspaces/<owner>/<repo>` from a git source URL.
 *
 * @param source A git clone URL in HTTPS, SSH (URL or scp-like), or git://
 *   form. Leading/trailing whitespace, a `.git` suffix, trailing slashes,
 *   and embedded credentials are all normalised away.
 * @returns The vault-relative mount path, or `null` if no `<owner>/<repo>`
 *   pair can be extracted.
 */
export function derivePath(source: unknown): string | null {
  if (typeof source !== "string") return null;
  let s = source.trim();
  if (s.length === 0) return null;

  // Strip trailing slashes first so a `.git/` tail still loses its suffix.
  s = s.replace(/\/+$/, "");
  // Strip a single `.git` suffix (case-insensitive).
  s = s.replace(/\.git$/i, "");

  let pathPart: string | null = null;

  // scp-like SSH form: `user@host:owner/repo` — no scheme, single `:` before
  // the path. Detected by absence of `://` and presence of `@…:`.
  if (!s.includes("://")) {
    const scp = /^[^/@\s]+@[^/:\s]+:(.+)$/.exec(s);
    if (scp) {
      pathPart = scp[1];
    }
  }

  if (pathPart === null) {
    // URL form. Strip scheme, then credentials, then host segment.
    let rest = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    rest = rest.replace(/^[^/@]+@/, ""); // user:pass@ or user@
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) return null; // host only, no path
    pathPart = rest.slice(slashIdx + 1); // drop host (+ optional :port)
  }

  const segments = pathPart.split("/").filter((seg) => seg.length > 0);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1];
  if (owner.length === 0 || repo.length === 0) return null;

  return `${ASSET_SPACES_PREFIX}/${owner}/${repo}`;
}
