/**
 * «Register for sync» descriptor builder (Issue #3707).
 *
 * A knowledge pack added via «Add a knowledge pack» (tarball mount, RFC 0005
 * Phase 1) materialises its files at `assetspaces/<owner>/<repo>` but carries NO
 * `exo__AssetSpace` descriptor of its own. ExoSync's discovery is class-based,
 * vault-wide ({@link classifySpaceDeclaration} over `exo__AssetSpace` + a
 * `_source` URL), so a pack with no such descriptor is NEVER enumerated into the
 * materialised sync set — the user's edits in it silently do not sync
 * (`collectSyncRepoSpecs` surfaces it only as a `mountedNotDeclared` notice,
 * FINDING-3).
 *
 * This pure builder produces the descriptor the «Register for sync» affordance
 * writes INTO the pack folder to close that gap. It is platform-free (no I/O, no
 * YAML, no Obsidian / Node API) so the same descriptor shape is shared by the
 * plugin command and any unit/integration test — the caller serialises the
 * `frontmatter` with whichever `YamlCodec` it already owns and writes
 * `<uid>.md` via its own filesystem port (`vault.adapter` in the plugin → free
 * Desktop↔Mobile parity).
 *
 * Descriptor shape (mirrors a proven registry descriptor, e.g.
 * `mudriy/exoas-tbank`):
 *   - `exo__Instance_class` — `[[<ASSET_SPACE_CLASS_UID>]]` (the discriminator
 *     `isAssetSpaceFrontmatter` matches).
 *   - `exo__AssetSpace_source` — the plain `https://github.com/<owner>/<repo>`
 *     URL (`readSpaceSource` reads it; the SAME allowlist
 *     `parseStrictGitHubRepoURL` the sync layer enforces).
 *   - `exo__AssetSpace_namespace` — the repo basename minus the `exoas-` prefix.
 *   - `exo__Asset_isDefinedBy` — a SELF-anchor (`[[<own-uid>]]`) so the
 *     co-location invariant keeps the descriptor in the pack folder it
 *     describes (namespace-ontology self-referential pattern).
 */

import {
  ASSET_SPACE_CLASS_UID,
  parseStrictGitHubRepoURL,
} from "./spaceSpecCore";

/** Inputs to {@link buildAssetSpaceDescriptor}. */
export interface AssetSpaceDescriptorInput {
  /** Fresh UUID for the descriptor asset (caller supplies — platform RNG). */
  uid: string;
  /** The pack's `https://github.com/<owner>/<repo>` source URL. */
  sourceUrl: string;
  /**
   * Namespace override. When omitted, derived from the repo basename
   * ({@link deriveAssetSpaceNamespace}).
   */
  namespace?: string;
  /** ISO-8601 timestamp for createdAt/updatedAt (caller supplies — no clock here). */
  createdAt: string;
}

/** A built `exo__AssetSpace` descriptor, ready for the caller to serialise + write. */
export interface AssetSpaceDescriptor {
  /** `<uid>.md` — the file to write into the pack folder. */
  fileName: string;
  /** The frontmatter object (caller serialises with its own `YamlCodec`). */
  frontmatter: Record<string, unknown>;
  /** Markdown body (everything after the frontmatter block). */
  body: string;
}

/**
 * Derive an AssetSpace namespace from its GitHub source URL: the repo basename
 * with a leading `exoas-` stripped (`…/kitelev/exoas-pmbok` → `pmbok`). Returns
 * `null` when the URL is not a plain `https://github.com/<owner>/<repo>` (the
 * sync allowlist) or the stripped repo is empty.
 */
export function deriveAssetSpaceNamespace(sourceUrl: string): string | null {
  if (typeof sourceUrl !== "string") return null;
  const parsed = parseStrictGitHubRepoURL(sourceUrl.replace(/\.git$/i, ""));
  if (parsed === null) return null;
  const repo = parsed.repo;
  const ns = repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  return ns.length > 0 ? ns : null;
}

/**
 * Build the `exo__AssetSpace` descriptor for a mounted-but-undeclared pack.
 * Pure — returns `null` (no throw) when the source URL is not a plain
 * `https://github.com/<owner>/<repo>` URL, the uid is blank, or no namespace can
 * be derived (and none was supplied). The caller warns-and-skips on `null`.
 */
export function buildAssetSpaceDescriptor(
  input: AssetSpaceDescriptorInput,
): AssetSpaceDescriptor | null {
  const uid = typeof input.uid === "string" ? input.uid.trim() : "";
  if (uid.length === 0) return null;

  const normalized =
    typeof input.sourceUrl === "string"
      ? input.sourceUrl.replace(/\.git$/i, "")
      : "";
  const parsed = parseStrictGitHubRepoURL(normalized);
  if (parsed === null) return null;

  const namespace =
    (typeof input.namespace === "string" && input.namespace.trim().length > 0
      ? input.namespace.trim()
      : deriveAssetSpaceNamespace(normalized)) ?? "";
  if (namespace.length === 0) return null;

  const label = `${parsed.owner}/${parsed.repo}`;
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt.length > 0
      ? input.createdAt
      : new Date(0).toISOString();

  // Key order mirrors a proven registry descriptor (uid, isDefinedBy, ts,
  // class, label, source, namespace, aliases) for readable diffs.
  const frontmatter: Record<string, unknown> = {
    exo__Asset_uid: uid,
    // SELF-anchor: the descriptor is its own co-location anchor, so it stays in
    // the pack folder it describes (namespace-ontology self-referential pattern).
    exo__Asset_isDefinedBy: `[[${uid}]]`,
    exo__Asset_createdAt: createdAt,
    exo__Asset_updatedAt: createdAt,
    exo__Instance_class: [`[[${ASSET_SPACE_CLASS_UID}]]`],
    exo__Asset_label: label,
    exo__AssetSpace_source: normalized,
    exo__AssetSpace_namespace: namespace,
    aliases: [`$${namespace} AssetSpace`],
  };

  const body =
    `exo__AssetSpace descriptor for \`${label}\` — registered for ExoSync ` +
    `(#3707). Mount path \`assetspaces/${parsed.owner}/${parsed.repo}/\`.`;

  return { fileName: `${uid}.md`, frontmatter, body };
}
