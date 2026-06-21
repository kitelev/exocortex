import { parseTarballGzip } from "@kitelev/exocortex-core";
import type { TarballEntry } from "@kitelev/exocortex-core";

export interface ExtractedTarFile {
  path: string;
  content: Uint8Array;
}

export interface TarExtractorOptions {
  /**
   * Required path prefix all extracted entries must live under (after
   * normalisation). Pattern: trailing `/`, e.g. `"staging/"`.
   *
   * **Empty string disables the prefix gate** — only safe for tarballs whose
   * origin is fully trusted; NOT recommended for arbitrary remote tarballs.
   *
   * ⚠️ Inputs that normalise to empty ALSO disable the gate. `"/"` becomes
   * `""` after `normalizePath` strips the leading slash; same for `"./"`.
   * If you mean "everything under vault root", pass an explicit literal
   * directory name like `"exocortex-staging/"`, not `"/"`.
   */
  stagingDirPrefix: string;
}

export class ZipSlipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSlipError";
  }
}

/**
 * Normalize a tar entry path: backslash→slash, collapse `//`, strip leading
 * `./` and `/`. Does NOT resolve `..` (rejection is `validateEntry`'s job).
 */
export function normalizePath(path: string): string {
  let p = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  if (p.startsWith("/")) {
    p = p.slice(1);
  }
  return p;
}

/**
 * Validate one parsed tar entry against the 4 zip-slip checks.
 *
 * Note on layering: nanotar 0.3.0's parser already sanitises `..` and
 * absolute paths via its internal `_sanitizePath` (`../foo` → `foo`,
 * `/etc/passwd` → `etc/passwd`). The `..`/absolute checks here are
 * defense-in-depth — they fire if the parser regresses, if the entry source
 * bypasses the parser (e.g. raw `parseTar` on hand-crafted bytes), or for
 * entries with unusual encodings (Windows drive letters, backslashes).
 *
 * The PRIMARY defense in practice is the staging-prefix check: a malicious
 * `/etc/passwd` becomes `etc/passwd` post-sanitisation, which then fails the
 * prefix gate against e.g. `"staging/"`.
 *
 * @throws ZipSlipError on any violation.
 */
export function validateEntry(
  entry: { name: string; type?: string },
  prefix: string,
): void {
  const rawName = entry.name;
  if (typeof rawName !== "string" || rawName.length === 0) {
    throw new ZipSlipError("Tar entry with empty or non-string name rejected");
  }
  // Link types FIRST — a symlink with a benign-looking name is still
  // dangerous (creates a host-filesystem link to an arbitrary target).
  if (entry.type === "symbolicLink") {
    throw new ZipSlipError(`Symbolic-link entry rejected: ${rawName}`);
  }
  if (entry.type === "hardLink") {
    throw new ZipSlipError(`Hard-link entry rejected: ${rawName}`);
  }
  // Absolute paths — POSIX leading `/`, leading backslash, or Windows drive.
  if (
    rawName.startsWith("/") ||
    rawName.startsWith("\\") ||
    /^[A-Za-z]:[/\\]/.test(rawName)
  ) {
    throw new ZipSlipError(`Absolute path rejected: ${rawName}`);
  }
  // Parent-dir traversal — any segment equal to `..` after normalisation.
  const normalized = normalizePath(rawName);
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) {
    throw new ZipSlipError(`Parent-dir traversal rejected: ${rawName}`);
  }
  // Staging-prefix gate — primary defense once nanotar's parser has stripped
  // leading `..` / absolute path components.
  if (prefix.length > 0 && !normalized.startsWith(prefix)) {
    throw new ZipSlipError(
      `Path '${normalized}' outside staging prefix '${prefix}'`,
    );
  }
}

/**
 * TarExtractor — async-iterable tarball parser with zip-slip protection.
 *
 * **Empirical caveat — nanotar 0.3.0 NOT streaming:**
 * `parseTarGzip(arrayBuffer)` returns `Promise<ParsedTarFileItem[]>` — the
 * entire tarball is decompressed and materialised as an in-memory array
 * before the iterator yields its first entry. Memory bound is
 * O(tarball.size), NOT O(entry.size). The `AsyncIterable` API is preserved
 * for the iterate-then-discard yield pattern (each entry's reference in the
 * internal array is released after yield so the caller-consumed
 * `Uint8Array` becomes GC-eligible) and for forward compatibility if
 * nanotar adds true streaming in a future major.
 *
 * Tarball size guard belongs upstream — e.g. `GitHubRestClient.pullTarball`
 * already enforces `maxTarballBytes` (default 50 MB) before parsing.
 *
 * **Zip-slip protection (Security #5, RFC 0a0791c1 Vision Lock #7):**
 *   1. Reject absolute paths (`/etc/passwd`, `C:/Windows/...`).
 *   2. Reject `..` parent-dir traversal segments.
 *   3. Reject `symbolicLink` and `hardLink` entry types.
 *   4. Reject paths outside the configured `stagingDirPrefix`.
 *
 * Iteration throws `ZipSlipError` on first violation — the caller's
 * `for await` loop receives the rejection (no silent skip).
 */
export class TarExtractor {
  /**
   * Parse + iterate a gzipped tarball blob.
   *
   * @throws ZipSlipError on any per-entry validation failure.
   * @throws Error on parse failure (corrupt tarball, invalid gzip stream).
   */
  public extract(
    blob: ArrayBuffer | Uint8Array,
    opts: TarExtractorOptions,
  ): AsyncIterable<ExtractedTarFile> {
    if (!opts || typeof opts.stagingDirPrefix !== "string") {
      throw new Error("TarExtractor.extract: stagingDirPrefix is required");
    }
    const prefix = normalizePath(opts.stagingDirPrefix);
    return {
      [Symbol.asyncIterator]:
        async function* (): AsyncIterableIterator<ExtractedTarFile> {
          const parsed: TarballEntry[] = await parseTarballGzip(blob);
          try {
            for (let i = 0; i < parsed.length; i++) {
              const entry = parsed[i];
              // Validate first — throws on any zip-slip violation.
              validateEntry(entry, prefix);
              // Skip directories — callers materialise dirs via file paths.
              if (entry.type === "directory") {
                parsed[i] = undefined as unknown as TarballEntry;
                continue;
              }
              const content = entry.data ?? new Uint8Array(0);
              const path = normalizePath(entry.name);
              yield { path, content };
              // Release the entry reference so the caller-processed Uint8Array
              // becomes GC-eligible (the parsed[] array would otherwise pin it
              // for the lifetime of the iteration).
              parsed[i] = undefined as unknown as TarballEntry;
            }
          } finally {
            // Final cleanup runs even on early-abort (caller breaks out of
            // for-await loop, throws, or calls iterator.return()).
            parsed.length = 0;
          }
        },
    };
  }
}
