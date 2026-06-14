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
 * Allowed characters in an `<owner>` / `<repo>` segment — a superset of
 * GitHub's own rules (`[A-Za-z0-9._-]`). Anything outside (path separators
 * already split away, whitespace, control chars, URL-encoded bytes) is
 * rejected so the derived path can never carry a traversal/escape primitive
 * out of frontmatter into a folder key that Phase 1b will treat as a real
 * on-disk mount path. Mirrors the validation done by `parseGitHubURL`.
 */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

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

  // `file://` is a local-filesystem clone source with no hosted `<owner>/<repo>`
  // identity, so a canonical Maven-style mount path cannot be derived. Return
  // null → callers fall back to the path-prefix strategy. Hosted schemes
  // (https/http/ssh/git + scp-like) proceed below. (RFC 01a83de8 Phase 1b T3.)
  if (/^file:\/\//i.test(s)) return null;

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
  // Reject traversal / out-of-charset segments. `.`/`..` would let a malicious
  // `_source` escape the `assetspaces/` root; any other disallowed character
  // (whitespace, control chars, encoded bytes) is treated as malformed input.
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }
  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(repo)) return null;

  return `${ASSET_SPACES_PREFIX}/${owner}/${repo}`;
}

/**
 * Derive the LEGACY flat mount path `assetspaces/<repo>` (with an `exoas-`
 * prefix stripped) that pre-#3538 `add-assetspace` / `bootstrap` mounted at,
 * before the canonical Maven `derivePath` (`assetspaces/<owner>/<repo>`) was
 * adopted. Mirrors the old `deriveFolderName` — both the plugin closure and the
 * CLI `BootstrapAssetSpaceService.deriveFolderName` — which stripped the
 * `exoas-` prefix and mounted a single level under `assetspaces/`.
 *
 * Used ONLY by flat-mount detection (#3538 follow-up): an AssetSpace
 * materialized at this legacy path is invisible to apply-profile's canonical
 * `derivePath` materialization check → it gets re-materialized at the canonical
 * path → latent DOUBLE MOUNT of the same AssetSpace UID. Detection compares the
 * two; they differ exactly when a manual migration is warranted.
 *
 * Reuses `derivePath` so it inherits the same normalisation (scheme/.git/
 * trailing-slash/scp-form/credentials) and the path-traversal / out-of-charset
 * segment guards — the returned `<repo>` is already validated. Returns `null`
 * for the same un-derivable inputs as `derivePath` (no `<owner>/<repo>` pair)
 * and when the stripped repo is empty (`exoas-` with nothing after it).
 */
export function deriveLegacyFlatPath(source: unknown): string | null {
  const canonical = derivePath(source);
  if (canonical === null) return null;
  // canonical === `assetspaces/<owner>/<repo>` with validated segments — the
  // third path component is the repo name.
  const repo = canonical.split("/")[2];
  if (repo === undefined || repo.length === 0) return null;
  const flat = repo.startsWith("exoas-")
    ? repo.slice("exoas-".length)
    : repo;
  if (flat.length === 0) return null;
  return `${ASSET_SPACES_PREFIX}/${flat}`;
}
