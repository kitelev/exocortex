/**
 * USTAR-aware tarball parser.
 *
 * ## Why this exists (Issue: private-repo AssetSpace pull broken)
 *
 * The previous implementation used `nanotar@0.3.0`'s `parseTarGzip`, which
 * reads ONLY the 100-byte `name` field of each tar header and never reads the
 * POSIX ustar `prefix` field (header bytes 345..499). When a tar entry's full
 * path exceeds 100 bytes, the POSIX ustar format splits it across `prefix`
 * (directory part) and `name` (file part); the real path is
 * `prefix + "/" + name`. nanotar drops the `prefix`, yielding only the bare
 * file name.
 *
 * GitHub's REST tarball endpoint wraps every entry under a single
 * `<owner>-<repo>-<sha>/` directory. For **authenticated** requests the
 * wrapper carries the FULL 40-char commit SHA, so a UUID-named asset
 * (`<36-char-uuid>.md`) ends up with a 100+ char path → ustar prefix-split →
 * nanotar drops the wrapper prefix → the entry looks like it lives outside the
 * wrapper → `AssetSpaceManager.discoverWrapperDir` throws and the whole pull
 * fails. (Anonymous requests get a 7-char abbreviated SHA, so the path stays
 * under 100 bytes and the bug never triggers — which is why public-repo pulls
 * worked but private ones did not.)
 *
 * This parser mirrors nanotar's header walk (so behaviour is identical for the
 * cases nanotar already handled — PAX `path=` extended headers, GNU long
 * names, octal sizes, the same type map and `..`/absolute sanitisation) and
 * adds the one missing step: honour the ustar `prefix` field.
 *
 * Storage-agnostic: gunzip uses the web-standard `DecompressionStream`
 * (available in Electron renderer, Node ≥18, and the Jest/Node test env), so
 * no Node-only or Obsidian-only imports.
 */

export interface TarballEntry {
  /** Full entry path (ustar `prefix` + `name` reconstructed when applicable). */
  name: string;
  /** nanotar-compatible type string (`"file"`, `"directory"`, `"symbolicLink"`, …). */
  type: string;
  /** Declared entry size in bytes. */
  size: number;
  /** File payload (omitted for zero-size entries and directories). */
  data?: Uint8Array;
}

// Mirrors nanotar's tarItemTypeMap so downstream `entry.type` checks keep working.
const TAR_TYPE_MAP: Record<string, string> = {
  "0": "file",
  "1": "hardLink",
  "2": "symbolicLink",
  "3": "characterDevice",
  "4": "blockDevice",
  "5": "directory",
  "6": "fifo",
  "7": "contiguousFile",
  g: "globalExtendedHeader",
  x: "extendedHeader",
  D: "gnuDirectory",
  I: "gnuInodeMetadata",
  K: "gnuLongLinkName",
  L: "gnuLongFileName",
  N: "gnuOldLongFileName",
  M: "gnuMultiVolume",
  S: "gnuSparseFile",
  E: "gnuExtendedSparse",
};

const HEADER_TYPES = new Set([
  "extendedHeader",
  "globalExtendedHeader",
  "gnuLongFileName",
  "gnuOldLongFileName",
  "gnuLongLinkName",
]);

// Lazy singleton — constructing `TextDecoder` at module load fails in test
// environments (jsdom) that only expose it at runtime. Matches nanotar's
// per-call construction but reuses one instance.
let _decoder: TextDecoder | undefined;
function getDecoder(): TextDecoder {
  return (_decoder ??= new TextDecoder());
}

function readString(bytes: Uint8Array, offset: number, size: number): string {
  const slice = bytes.subarray(offset, offset + size);
  const nul = slice.indexOf(0);
  return getDecoder().decode(nul === -1 ? slice : slice.subarray(0, nul));
}

// Octal numeric field (POSIX ustar). parseInt stops at the first non-octal
// byte (trailing NUL / space), matching nanotar's _readNumber semantics.
function readNumber(bytes: Uint8Array, offset: number, size: number): number {
  let str = "";
  for (let i = 0; i < size; i++) {
    str += String.fromCodePoint(bytes[offset + i]);
  }
  const n = Number.parseInt(str, 8);
  return Number.isNaN(n) ? 0 : n;
}

// PAX extended-header payload: records like `<len> path=<value>\n`.
function parseExtendedHeaders(payload: Uint8Array): Record<string, string> {
  const text = getDecoder().decode(payload);
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(line.indexOf(" ") + 1, eq);
    const value = line.slice(eq + 1);
    if (key) headers[key] = value;
  }
  return headers;
}

// Identical to nanotar's _sanitizePath — drops drive letters, leading slashes,
// resolves `.`/`..` segments. Defence-in-depth; consumers also validate.
function sanitizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  normalized = normalized.replace(/^[a-zA-Z]:\//, "");
  normalized = normalized.replace(/^\/+/, "");
  const hasLeadingDotSlash = normalized.startsWith("./");
  const parts = normalized.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }
  let result = resolved.join("/");
  if (hasLeadingDotSlash && !result.startsWith("./")) {
    result = "./" + result;
  }
  if (path.endsWith("/") && !result.endsWith("/")) {
    result += "/";
  }
  return result;
}

/**
 * Parse a raw (un-gzipped) tar archive.
 *
 * Header types `extendedHeader` / `globalExtendedHeader` / GNU long-name
 * variants are consumed to override the next entry's path but are NOT emitted
 * as entries (parity with nanotar).
 */
export function parseTarball(input: Uint8Array): TarballEntry[] {
  // Copy into a fresh, zero-offset array so header offsets are absolute and we
  // never depend on the caller's byteOffset (nanotar's `data.buffer` shortcut
  // mis-reads sub-arrays — avoided here).
  const bytes =
    input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
      ? input
      : input.slice();

  const entries: TarballEntry[] = [];
  let offset = 0;
  let nextExtendedHeader: Record<string, string> | undefined;
  let globalExtendedHeader: Record<string, string> | undefined;

  while (offset + 512 <= bytes.byteLength) {
    let name = readString(bytes, offset, 100);
    if (name.length === 0) break; // zero-block terminator

    let nameOverridden = false;
    if (nextExtendedHeader) {
      const longName = nextExtendedHeader.path ?? nextExtendedHeader.linkpath;
      if (longName) {
        name = longName;
        nameOverridden = true;
      }
    }

    const size = readNumber(bytes, offset + 124, 12);
    const seek = 512 + 512 * Math.trunc(size / 512) + (size % 512 ? 512 : 0);
    const typeChar = readString(bytes, offset + 156, 1) || "0";
    const type = TAR_TYPE_MAP[typeChar] ?? typeChar;

    if (type === "extendedHeader" || type === "globalExtendedHeader") {
      const headers = parseExtendedHeaders(
        bytes.subarray(offset + 512, offset + 512 + size),
      );
      if (type === "extendedHeader") {
        nextExtendedHeader = headers;
      } else {
        nextExtendedHeader = undefined;
        globalExtendedHeader = { ...globalExtendedHeader, ...headers };
      }
      offset += seek;
      continue;
    }

    if (HEADER_TYPES.has(type)) {
      // GNU long file/link name: payload is the long path for the next entry.
      nextExtendedHeader = { path: readString(bytes, offset + 512, size) };
      offset += seek;
      continue;
    }

    // ── The fix: honour the ustar `prefix` field ──────────────────────────
    // Only when the name came from the 100-byte `name` field (no PAX/GNU
    // override). POSIX ustar splits paths > 100 bytes as prefix + "/" + name.
    if (!nameOverridden) {
      const magic = readString(bytes, offset + 257, 6);
      if (magic.startsWith("ustar")) {
        const prefix = readString(bytes, offset + 345, 155);
        if (prefix.length > 0) {
          name = `${prefix}/${name}`;
        }
      }
    }

    name = sanitizePath(name);
    const data =
      size === 0
        ? undefined
        : bytes.subarray(offset + 512, offset + 512 + size);

    entries.push({ name, type, size, data });
    nextExtendedHeader = undefined;
    offset += seek;
  }

  // globalExtendedHeader is parsed for parity but not surfaced; reference it so
  // strict lint/tsc does not flag it as unused.
  void globalExtendedHeader;

  return entries;
}

/**
 * Gunzip + parse a gzipped tar archive (e.g. a GitHub REST tarball response).
 */
export async function parseTarballGzip(
  input: Uint8Array | ArrayBuffer,
): Promise<TarballEntry[]> {
  // Normalise to a fresh ArrayBuffer-backed Uint8Array (matches the old
  // nanotar `new Uint8Array(data)` copy and satisfies `BufferSource`, which
  // excludes SharedArrayBuffer-backed views).
  const u8 = new Uint8Array(
    input instanceof Uint8Array ? input : new Uint8Array(input),
  );
  const ds = new DecompressionStream("gzip");
  // Write to the writable side directly (the `ReadableStream(...).pipeThrough`
  // form trips TS's `Uint8Array<ArrayBuffer>` vs `<ArrayBufferLike>` variance
  // check on some lib.dom versions). `Promise.all` drains the read while the
  // single write runs (no deadlock for our size-capped tarballs) AND ensures
  // both sides are awaited so a decompression error (corrupt gzip) surfaces as
  // a rejected promise here rather than an unhandled rejection.
  const writer = ds.writable.getWriter();
  const [, decompressed] = await Promise.all([
    writer.write(u8).then(() => writer.close()),
    new Response(ds.readable).arrayBuffer(),
  ]);
  return parseTarball(new Uint8Array(decompressed));
}
