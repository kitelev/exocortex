/**
 * Locating an asset that lives in a PARKED AssetSpace (req `c171e24d`).
 *
 * ## Why this module exists
 *
 * Parking moves an AssetSpace's bytes from `assetspaces/<owner>/<repo>` to
 * `.exocortex/parked/<owner>/<repo>` ({@link parkedPathFor}). That location is a
 * DOT-folder, so Obsidian never indexes it: `getMarkdownFiles()` does not list
 * it and `metadataCache.getFirstLinkpathDest` cannot resolve a link into it.
 * Every wikilink pointing at a parked asset therefore renders as an unresolved
 * link — a raw UID, dimmed, with no preview.
 *
 * The whole point of parking is that the bytes are STILL ON THE DEVICE. So the
 * honest render is not "broken" but "here, just not active" — and to say that,
 * something has to look where Obsidian will not. `vault.adapter` will: it is a
 * plain filesystem port with no index behind it, and the plugin already reads a
 * dot-folder through it in production (`OperationsLogReader` reads
 * `.exocortex/switch-journal.jsonl` for the Settings journal panel).
 *
 * ⛔ This module must therefore NEVER be given an index-backed reader. The
 * asymmetry between `getMarkdownFiles()` and the adapter is not an
 * implementation detail here — it is the entire mechanism.
 *
 * ## Why a directory index and not a derived path
 *
 * A link carries a link target (`[[<uid>]]`), not a path. Nothing in the vault
 * maps a UID to its location inside a parked repo, so the location has to be
 * discovered by walking. The walk happens ONCE per index instance and is
 * amortised over every unresolved link on the page; a hit then costs exactly one
 * file read (the asset's own frontmatter, for its label).
 *
 * The index is keyed on the file's basename because that is what a UID-canon
 * wikilink resolves against — the same key Obsidian's own linkpath resolution
 * uses for an active mount.
 *
 * ## Why the miss is as load-bearing as the hit
 *
 * A link to an asset that exists NOWHERE must stay red. If this lookup answered
 * "parked" for anything it could not find, the placeholder would swallow real
 * broken links and the "no broken links" property would be satisfied by
 * pretending. The lookup is therefore positive-evidence-only: it returns a hit
 * ONLY for a basename actually present under the parked root.
 */

import { PARKED_ROOT } from "./ParkedMountState";

/**
 * The filesystem capabilities this module needs, and nothing more.
 *
 * Deliberately shaped as the subset of Obsidian's `DataAdapter` that the plugin
 * already exposes (`exists` / `list` / `read`), so the production wiring is the
 * adapter itself rather than a translation layer that could quietly resolve
 * through the index instead.
 */
export interface ParkedVaultReader {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
}

/** A parked asset found on this device. */
export interface ParkedAssetHit {
  /** Vault-relative path of the parked file. */
  readonly path: string;
  /**
   * `<owner>/<repo>` — the parked AssetSpace holding it. This is what the
   * "activate" action needs to name; it is DERIVED from the path, never stored.
   */
  readonly assetSpace: string;
  /**
   * `exo__Asset_label` of the parked asset, or `null` when it carries none.
   * The caller decides the fallback — this module does not invent a label.
   */
  readonly label: string | null;
}

/** Strip wikilink brackets, quotes, a block/heading ref and the `.md` suffix. */
function normalizeLinkTarget(linkTarget: string): string {
  const cleaned = linkTarget
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();
  const withoutRef = cleaned.split("#")[0].trim();
  // A linkpath may carry folders (`some/folder/uid`); the index is keyed on the
  // basename because that is what UID-canon links resolve against.
  const basename = withoutRef.split("/").pop() ?? withoutRef;
  return basename.replace(/\.md$/i, "");
}

/**
 * Read `exo__Asset_label` out of raw markdown WITHOUT a YAML parser.
 *
 * A parked asset is read purely to name it in a placeholder; pulling a YAML
 * dependency (or the vault's `FrontmatterService`, which carries update/write
 * machinery this path must never reach) would buy nothing. The single-line
 * scalar form is the only one the label is ever authored in — `exocortex-cli
 * create` and `apply set-label` both write it that way — and an unreadable
 * label degrades to `null`, which the caller already handles.
 */
/** Frontmatter block of a markdown file, or `null` when it carries none. */
function frontmatterOf(content: string): string | null {
  const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return fence === null ? null : fence[1];
}

/**
 * Positive evidence that a parked FILE is an Exocortex ASSET.
 *
 * Every asset carries `exo__Asset_uid` (it is what UID-canon filenames are
 * derived from); a README, a licence or a stray note does not.
 */
function hasAssetUid(content: string): boolean {
  const fm = frontmatterOf(content);
  if (fm === null) return false;
  const match = fm.match(/^exo__Asset_uid:[ \t]*(.+)$/m);
  return match !== null && match[1].trim().length > 0;
}

function extractLabel(content: string): string | null {
  const fm = frontmatterOf(content);
  if (fm === null) return null;
  // ⛔ `[ \t]*`, never `\s*`: `\s` matches `\n`, so on a multi-line (list) value
  // the match would spill past the newline and capture the first list item.
  const match = fm.match(/^exo__Asset_label:[ \t]*(.+)$/m);
  if (match === null) return null;
  const raw = match[1].trim();
  if (raw.length < 1) return null;

  // Undo the quoting `create` adds for scalars that would otherwise be
  // ambiguous. The two YAML quoting styles unescape DIFFERENTLY, and getting
  // this wrong is visible to the user: measured against a real corpus of 22 971
  // assets, a naive quote-strip renders 18 labels with literal backslashes
  // (`Issue \"под ключ\" = merged PR`).
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return orNull(
      raw
        .slice(1, -1)
        .replace(/\\(["\\ntr])/g, (_m, c: string) =>
          c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c,
        ),
    );
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    // Single-quoted YAML has exactly ONE escape: a doubled quote.
    return orNull(raw.slice(1, -1).replace(/''/g, "'"));
  }
  return orNull(raw);
}

function orNull(value: string): string | null {
  return value.length === 0 ? null : value;
}

/**
 * Basename → parked-file lookup over `.exocortex/parked`.
 *
 * The directory index is built lazily on the first lookup and reused; call
 * {@link invalidate} whenever the parked tree may have changed (an
 * `apply-profile` parks or unparks mounts).
 */
export class ParkedAssetIndex {
  private readonly reader: ParkedVaultReader;
  /** basename (no `.md`) → vault-relative path. First occurrence wins. */
  private index: Map<string, string> | null = null;
  private building: Promise<Map<string, string>> | null = null;
  /**
   * Bumped by {@link invalidate}. A walk that started BEFORE an invalidation
   * describes a world that no longer exists, so its result must be discarded
   * rather than installed.
   */
  private generation = 0;

  constructor(reader: ParkedVaultReader) {
    this.reader = reader;
  }

  /** Drop the cached directory listing; the next lookup re-walks. */
  invalidate(): void {
    this.index = null;
    this.building = null;
    this.generation += 1;
  }

  /**
   * Resolve a link target to a parked asset, or `null` when nothing under the
   * parked root carries that basename.
   */
  async lookup(linkTarget: string): Promise<ParkedAssetHit | null> {
    const key = normalizeLinkTarget(linkTarget);
    if (key.length === 0) return null;

    const index = await this.ensureIndex();
    const path = index.get(key);
    if (path === undefined) return null;

    const assetSpace = assetSpaceOf(path);
    if (assetSpace === null) return null;

    let content: string;
    try {
      content = await this.reader.read(path);
    } catch {
      // No evidence read, no hit. Silence is not proof that the file is an asset.
      return null;
    }

    // ⛔ A markdown FILE under the parked root is not automatically an ASSET.
    // Real data: 22 `README.md` live inside assetspaces across this device's
    // vaults, despite the co-location canon saying they should not. Indexing
    // those would make a genuinely broken `[[README]]` render as a placeholder
    // offering to activate an AssetSpace — the placeholder swallowing exactly
    // the broken link it must leave alone. `exo__Asset_uid` is the positive
    // evidence that a file IS an asset.
    if (!hasAssetUid(content)) return null;

    return { path, assetSpace, label: extractLabel(content) };
  }

  private async ensureIndex(): Promise<Map<string, string>> {
    if (this.index !== null) return this.index;
    // Concurrent unresolved links on one page all miss at once; share one walk.
    const generation = this.generation;
    if (this.building === null) {
      this.building = this.buildIndex();
    }
    const built = await this.building;
    // ⛔ Load-bearing: `invalidate()` cannot cancel a walk already in flight, and
    // an apply-profile takes SECONDS (it moves files, which churns
    // metadataCache, which re-renders open notes, which look links up again).
    // Installing this snapshot unconditionally would therefore write the
    // PRE-invalidation world back over the invalidation — i.e. a just-activated
    // asset would keep resolving as parked, which is exactly what the
    // invalidation hook exists to prevent.
    if (generation !== this.generation) {
      this.building = null;
      return this.ensureIndex();
    }
    this.index = built;
    this.building = null;
    return built;
  }

  private async buildIndex(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await this.walk(PARKED_ROOT, out);
    return out;
  }

  private async walk(dir: string, out: Map<string, string>): Promise<void> {
    let listing: { files: string[]; folders: string[] };
    try {
      if (!(await this.reader.exists(dir))) return;
      listing = await this.reader.list(dir);
    } catch {
      // Absent or unreadable directory: nothing parked here.
      return;
    }
    for (const file of listing.files) {
      if (!file.toLowerCase().endsWith(".md")) continue;
      const base = (file.split("/").pop() ?? file).replace(/\.md$/i, "");
      if (base.length === 0 || out.has(base)) continue;
      out.set(base, file);
    }
    for (const folder of listing.folders) {
      const base = folder.split("/").pop() ?? folder;
      // Skip nested dot-folders — a parked mount carries its own `.git`, and
      // walking it would cost thousands of entries for nothing. The parked ROOT
      // is itself a dot-folder, which is why this test runs on children only.
      if (base.startsWith(".")) continue;
      await this.walk(folder, out);
    }
  }
}

/**
 * `.exocortex/parked/<owner>/<repo>/…` → `<owner>/<repo>`.
 *
 * Returns `null` for a path that does not carry both segments, so a stray file
 * directly under the parked root can never be reported as belonging to an
 * AssetSpace that does not exist.
 */
function assetSpaceOf(path: string): string | null {
  const prefix = `${PARKED_ROOT}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).split("/");
  if (rest.length < 3) return null;
  const [owner, repo] = rest;
  if (owner.length === 0 || repo.length === 0) return null;
  return `${owner}/${repo}`;
}
