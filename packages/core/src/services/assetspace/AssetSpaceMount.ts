/**
 * AssetSpace mount/unmount core (Issue #3423 — Option A hexagonal consolidation).
 *
 * ## Why this exists
 *
 * There were two parallel mount/unmount implementations of the same logic:
 *
 *   - `RestAssetSpaceMount` (plugin) — Obsidian `DataAdapter` + `requestUrl`.
 *   - `BootstrapAssetSpaceService` (CLI) — Node `fs` + `fetch`.
 *
 * Both fetched a GitHub REST tarball, discovered the `<owner>-<repo>-<sha>/`
 * wrapper, extracted the SHA, ran the same zip-slip checks, wrote each file, and
 * mutated `.gitmodules` with byte-identical text transforms. That duplicated
 * **pure** logic (wrapper discovery, SHA extraction, zip-slip validation,
 * `.gitmodules` append/strip) is the exact drift pattern that has bitten this
 * codebase before (`extractReference` triplication, PR #3296).
 *
 * This module is the **single platform-agnostic core**. The drift-prone pure
 * logic lives here once; the genuinely platform-specific I/O (how bytes hit
 * disk, how the tarball is fetched) is injected via two ports:
 *
 *   - {@link HttpClient}  — fetch the tarball bytes (plugin: `requestUrl` +
 *     rate-limit gate; CLI: Node `fetch` + 403/404 hint handling).
 *   - {@link FileSystemPort} — materialize the wrapper-stripped files and remove
 *     a mount tree. The platform owns the **write strategy**: the plugin writes
 *     additively (overwrite collisions, leave extant files), the CLI stages to a
 *     temp dir and atomically renames, refusing a non-empty target. This
 *     strategy divergence is genuine platform behaviour, so it stays in the
 *     adapter's `materialize` — relocated verbatim, NOT rewritten.
 *
 * Precedent: `restCreateCommit` is a shared transport-agnostic core that both
 * the plugin (`GitHubRestClient`) and CLI (`RestPushService`) consume via an
 * injected transport. This extraction follows the same pattern.
 */

/** A single wrapper-stripped file to materialize under the mount target. */
export interface MountFile {
  /**
   * Path relative to the mount target, wrapper-stripped, forward-slash
   * normalised. Guaranteed by the core to contain no absolute prefix and no
   * `..` segment before it reaches the {@link FileSystemPort}.
   */
  relPath: string;
  content: Uint8Array;
}

/**
 * Platform file-system port. Path convention is opaque to the core — the plugin
 * passes vault-relative paths (its `DataAdapter` is rooted at the vault), the
 * CLI passes absolute paths. The core only ever joins `targetPath` with a
 * core-validated `relPath` (no `..`, no absolute) and reads/writes `.gitmodules`
 * at a caller-supplied path.
 */
export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  /**
   * Materialize `files` under `targetPath`. The platform owns the write
   * strategy (plugin: additive direct write; CLI: atomic stage+rename refusing
   * a non-empty target). Each `relPath` is already core-validated against
   * zip-slip; the adapter MAY keep its own defense-in-depth resolve check.
   * Returns the number of files written.
   *
   * `onFileWritten(processed)` — optional per-file progress tick
   * (al-mount-observability). Invoked by the adapter after each file is written
   * with the 1-based count so the core can re-emit throttled within-AS install
   * progress for a large AssetSpace. Best-effort: the core wraps it so a
   * throwing observer can never break the mount; adapters MAY call it
   * unconditionally (cheap when absent → no-op closure not passed).
   */
  materialize(
    targetPath: string,
    files: MountFile[],
    onFileWritten?: (processed: number) => void,
  ): Promise<number>;
  /** Recursively remove a mount tree. The platform owns any safety guards. */
  removeDir(path: string): Promise<void>;
}

/** Platform HTTP port — fetch the GitHub REST tarball as raw gzipped bytes. */
export interface HttpClient {
  /**
   * Fetch `GET /repos/{owner}/{repo}/tarball/{ref}` as raw gzipped bytes. The
   * adapter owns auth, rate-limit gating, size caps, and HTTP-error messaging
   * (rate-limit / 404 hints / PAT redaction).
   */
  fetchTarball(owner: string, repo: string, ref: string): Promise<Uint8Array>;
}

/** Outcome of {@link mountAssetSpaceFiles}. */
export interface MountResult {
  /** Commit SHA discovered from the GitHub tarball wrapper dir (lowercased). */
  sha: string;
  /** Number of files written into the mount target. */
  fileCount: number;
}

import { parseTarballGzip, type TarballEntry } from "../../infrastructure/tarball/parseTarball";

const GITMODULES_HEADER_TYPES = new Set(["globalExtendedHeader", "extendedHeader"]);

/** Normalise a tar entry path: backslash→slash, collapse `//`, strip leading `./`. */
function normalizeEntryPath(path: string): string {
  let p = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/**
 * Discover the wrapper directory of a GitHub REST tarball
 * (`<owner>-<repo>-<sha>/`). Skips ustar/pax header entries and reads the first
 * content entry that carries a path separator, then verifies every other
 * content entry shares the wrapper prefix.
 */
export function discoverWrapperDir(entries: TarballEntry[]): string {
  const firstContent = entries.find(
    (e) => !GITMODULES_HEADER_TYPES.has(e.type) && normalizeEntryPath(e.name).includes("/"),
  );
  if (firstContent === undefined) {
    throw new Error("discoverWrapperDir: no wrapper-bearing entry in tarball");
  }
  const norm = normalizeEntryPath(firstContent.name);
  const wrapper = norm.slice(0, norm.indexOf("/"));
  if (wrapper.length === 0) {
    throw new Error(`discoverWrapperDir: empty wrapper segment in entry "${firstContent.name}"`);
  }
  const wrapperPrefix = wrapper + "/";
  for (const entry of entries) {
    if (GITMODULES_HEADER_TYPES.has(entry.type)) continue;
    const name = normalizeEntryPath(entry.name);
    if (name === wrapper || name === wrapperPrefix) continue;
    if (!name.startsWith(wrapperPrefix)) {
      throw new Error(`discoverWrapperDir: entry "${entry.name}" not under wrapper "${wrapper}"`);
    }
  }
  return wrapper;
}

/**
 * Extract the commit SHA from a GitHub tarball wrapper name
 * (`<owner>-<repo>-<sha>`). SHA length is auth-dependent: anonymous tarballs
 * carry a 7-char abbreviated SHA, authenticated ones the full 40-char SHA, so
 * the trailing hex segment is matched at 7..40 chars. Returned lowercased.
 */
export function extractShaFromWrapper(wrapper: string): string {
  const m = wrapper.match(/-([0-9a-fA-F]{7,40})$/);
  if (m === null) {
    throw new Error(
      `extractShaFromWrapper: wrapper "${wrapper}" does not match expected GitHub pattern <owner>-<repo>-<sha>`,
    );
  }
  return m[1].toLowerCase();
}

/**
 * Build the wrapper-stripped {@link MountFile} list from parsed tarball entries.
 *
 * Zip-slip + security checks (defense-in-depth — the adapter's `materialize`
 * keeps its own platform resolve check too):
 *   - reject `symbolicLink` / `hardLink` entries (host-fs link injection)
 *   - skip header / directory / data-less entries
 *   - require every entry under the wrapper prefix
 *   - reject any `..` path segment after wrapper-strip
 */
function buildMountFiles(entries: TarballEntry[], wrapper: string): MountFile[] {
  const wrapperPrefix = wrapper + "/";
  const files: MountFile[] = [];
  for (const entry of entries) {
    if (entry.type === "symbolicLink" || entry.type === "hardLink") {
      throw new Error(`${entry.type} entry "${entry.name}" rejected for security`);
    }
    if (GITMODULES_HEADER_TYPES.has(entry.type)) continue;
    if (entry.type === "directory") continue;
    const name = normalizeEntryPath(entry.name);
    if (name === wrapper || name === wrapperPrefix) continue;
    if (!name.startsWith(wrapperPrefix)) {
      throw new Error(`entry "${entry.name}" not under wrapper "${wrapper}"`);
    }
    const rel = name.slice(wrapperPrefix.length);
    if (rel.length === 0) continue;
    if (rel.split("/").some((s) => s === "..")) {
      throw new Error(`path traversal detected for entry "${entry.name}"`);
    }
    if (entry.data === undefined) continue;
    files.push({ relPath: rel, content: entry.data });
  }
  return files;
}

/**
 * Sub-phase of a single AssetSpace mount (#al-activitylog-progress). A mount
 * proceeds `fetch` (download tarball — the long network step) → `extract`
 * (gunzip + parse entries) → `materialize` (write files to disk). Surfaced so a
 * slow mount shows WHICH phase it is in, finer than a single "Mounting X" marker.
 */
export type MountProgressPhase = "fetch" | "extract" | "materialize";

/**
 * Within-AS materialize file-write progress (al-mount-observability) — the
 * count of files written so far and the AssetSpace's total file volume. Carried
 * by the `materialize` sub-phase of {@link MountAssetSpaceParams.onProgress} so a
 * slow install advances visibly (`N of M files`) instead of going silent.
 */
export interface MountFileProgress {
  processed: number;
  total: number;
}

/**
 * Files between within-AS materialize progress ticks (al-mount-observability).
 * Mirrors {@link NoteToRDFConverter.INDEX_PROGRESS_INTERVAL} (200) — keeps a
 * ~5 000-file mount to ~25 activity-log lines.
 */
export const MATERIALIZE_PROGRESS_INTERVAL = 200;

/**
 * Minimum file count for a mount to emit granular materialize progress
 * (al-mount-observability). A small AssetSpace materialises fast enough that the
 * per-AS "Mounting … (i of N)" marker suffices; only large AssetSpaces went
 * silent for ~100s during the file-write phase, so only those (strictly greater
 * than this threshold) emit per-file ticks.
 */
export const MATERIALIZE_PROGRESS_MIN_FILES = 500;

/** Parameters for {@link mountAssetSpaceFiles}. */
export interface MountAssetSpaceParams {
  http: HttpClient;
  fs: FileSystemPort;
  owner: string;
  repo: string;
  ref: string;
  /** Mount target in the port's path convention (vault-relative or absolute). */
  targetPath: string;
  /**
   * Optional sub-phase progress sink (#al-activitylog-progress) — invoked
   * BEFORE each phase (`fetch` → `extract` → `materialize`) so a long mount
   * shows live progress. Best-effort: a throwing observer is swallowed so it
   * can never break a mount. Omitted by the CLI bootstrap path (zero cost).
   *
   * The `materialize` phase additionally re-emits with a {@link MountFileProgress}
   * payload every {@link MATERIALIZE_PROGRESS_INTERVAL} files for a large
   * AssetSpace (> {@link MATERIALIZE_PROGRESS_MIN_FILES}) — al-mount-observability.
   * The `progress` arg is `undefined` for the baseline phase markers.
   */
  onProgress?: (phase: MountProgressPhase, progress?: MountFileProgress) => void;
}

/**
 * Mount an AssetSpace's files: fetch its GitHub tarball, discover the wrapper +
 * SHA, validate every entry against zip-slip, and materialize the
 * wrapper-stripped files under `targetPath` via the injected
 * {@link FileSystemPort}. Does NOT touch `.gitmodules` — callers compose
 * {@link appendGitmodulesEntry} with their own port I/O (the plugin and CLI
 * differ on whether the `.gitmodules` mutation is bundled with the file write).
 *
 * @throws on empty/malformed tarball, link entries, path traversal, or any
 *   error surfaced by the injected ports (rate-limit, 404, refuse-non-empty).
 */
export async function mountAssetSpaceFiles(params: MountAssetSpaceParams): Promise<MountResult> {
  const { http, fs, owner, repo, ref, targetPath } = params;
  // Best-effort sub-phase progress (#al-activitylog-progress) — a throwing
  // observer must never break the mount.
  const emit = (phase: MountProgressPhase, progress?: MountFileProgress): void => {
    if (params.onProgress === undefined) return;
    try {
      params.onProgress(phase, progress);
    } catch {
      /* swallow — progress is best-effort, never blocks the mount */
    }
  };

  emit("fetch");
  const blob = await http.fetchTarball(owner, repo, ref);
  emit("extract");
  const entries = await parseTarballGzip(blob);
  if (entries.length === 0) {
    throw new Error(`tarball empty for ${owner}/${repo}@${ref}`);
  }
  const wrapper = discoverWrapperDir(entries);
  const sha = extractShaFromWrapper(wrapper);
  const files = buildMountFiles(entries, wrapper);
  emit("materialize");
  // Granular within-AS install progress (al-mount-observability). The file-write
  // phase is the longest for a large AssetSpace and was previously silent (one
  // "materialize" marker then ~100s of nothing on iPhone). Mirror the indexing
  // observability (NoteToRDFConverter `Indexing vault: N of M` every 200): when
  // the file volume exceeds the threshold, hand the platform's materialize a
  // per-file tick and re-emit it throttled every N files, skipping the final
  // tick (the post-mount "Mounted" marker covers completion). Below the
  // threshold a small AS stays quiet — the per-AS "Mounting … (i of N)" marker
  // is signal enough.
  const total = files.length;
  const trackProgress =
    params.onProgress !== undefined && total > MATERIALIZE_PROGRESS_MIN_FILES;
  const fileCount = await fs.materialize(
    targetPath,
    files,
    trackProgress
      ? (processed) => {
          if (processed % MATERIALIZE_PROGRESS_INTERVAL === 0 && processed < total) {
            emit("materialize", { processed, total });
          }
        }
      : undefined,
  );
  return { sha, fileCount };
}

// ───────────────────────────── .gitmodules transforms ─────────────────────────────

/** Escape a string for safe interpolation into a RegExp. */
export function escapeGitmodulesRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Result of {@link appendGitmodulesEntry}. */
export interface GitmodulesAppendResult {
  /** New `.gitmodules` content (unchanged when the stanza already exists). */
  content: string;
  /** `true` when a new stanza was appended, `false` when it was already present. */
  added: boolean;
}

/**
 * Idempotently append a `[submodule "<path>"]` stanza to `.gitmodules` content.
 * Pure text transform — no I/O. Re-appending an already-registered path is a
 * no-op (`added: false`). The header detection tolerates extra whitespace
 * (`[submodule  "x"]`); the emitted stanza uses the canonical single-space form
 * so plugin + CLI produce byte-identical output.
 */
export function appendGitmodulesEntry(
  existing: string,
  submodulePath: string,
  url: string,
): GitmodulesAppendResult {
  const headerRegex = new RegExp(
    `^\\s*\\[submodule\\s+"${escapeGitmodulesRegex(submodulePath)}"\\]`,
    "m",
  );
  if (existing.length > 0 && headerRegex.test(existing)) {
    return { content: existing, added: false };
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const newEntry = `[submodule "${submodulePath}"]\n\tpath = ${submodulePath}\n\turl = ${url}\n`;
  return { content: existing + sep + newEntry, added: true };
}

/**
 * Strip a `[submodule "<path>"]` stanza (header + body lines up to the next
 * `[…]` header or EOF) from `.gitmodules` content, then collapse the
 * double-blank line the strip may leave behind. Pure text transform — no I/O.
 * Returns the input unchanged when no matching stanza exists.
 */
export function stripGitmodulesEntry(content: string, submodulePath: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  const headerPattern = new RegExp(
    `^\\[submodule\\s+"${escapeGitmodulesRegex(submodulePath)}"\\]\\s*$`,
  );
  for (const line of lines) {
    if (skipping) {
      // Next stanza starts — stop skipping (do NOT consume the new header).
      if (/^\[.+\]\s*$/.test(line)) {
        skipping = false;
        out.push(line);
        continue;
      }
      continue;
    }
    if (headerPattern.test(line)) {
      skipping = true;
      continue;
    }
    out.push(line);
  }
  // Collapse double-blank lines created by the strip.
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of out) {
    const blank = line.trim().length === 0;
    if (blank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = blank;
  }
  return collapsed.join("\n");
}
