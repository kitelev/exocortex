import { gzipSync } from "node:zlib";
import {
  parseTarball,
  parseTarballGzip,
  type TarballEntry,
} from "../../../../src/infrastructure/tarball/parseTarball";

const enc = new TextEncoder();
const dec = new TextDecoder();

function field(h: Uint8Array, str: string, off: number, len: number): void {
  h.set(enc.encode(str).subarray(0, len), off);
}

/**
 * Build a single 512-byte POSIX ustar header. Only the fields the parser
 * reads are populated (name, size, type, ustar magic, prefix); the checksum
 * is intentionally left blank because the parser does not validate it (parity
 * with nanotar).
 */
function ustarHeader(opts: {
  name: string;
  prefix?: string;
  type?: string;
  size?: number;
  magic?: string;
}): Uint8Array {
  const h = new Uint8Array(512);
  field(h, opts.name, 0, 100);
  field(h, (opts.size ?? 0).toString(8).padStart(11, "0"), 124, 11);
  h[156] = (opts.type ?? "0").charCodeAt(0);
  field(h, opts.magic ?? "ustar", 257, 5); // "ustar\0"
  field(h, "00", 263, 2); // version
  if (opts.prefix) field(h, opts.prefix, 345, 155);
  return h;
}

interface FixtureEntry {
  name: string;
  prefix?: string;
  type?: string;
  data?: Uint8Array;
  magic?: string;
  /** Raw 512-byte header override (for PAX/GNU extension blocks). */
  rawHeader?: Uint8Array;
  /** Raw payload for the override header (PAX records / GNU long name). */
  rawPayload?: Uint8Array;
}

function tarball(entries: FixtureEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const pushPadded = (data: Uint8Array): void => {
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  };
  for (const e of entries) {
    if (e.rawHeader) {
      blocks.push(e.rawHeader);
      if (e.rawPayload && e.rawPayload.length > 0) pushPadded(e.rawPayload);
      continue;
    }
    const data = e.data ?? new Uint8Array(0);
    blocks.push(
      ustarHeader({
        name: e.name,
        prefix: e.prefix,
        type: e.type,
        size: data.length,
        magic: e.magic,
      }),
    );
    if (data.length > 0) pushPadded(data);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end-of-archive
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/** Build a PAX `x` extended-header block whose payload sets `path=<value>`. */
function paxPathBlock(value: string): { rawHeader: Uint8Array; rawPayload: Uint8Array } {
  const content = `path=${value}\n`;
  // POSIX pax record: "<len> path=value\n" where len counts itself.
  let len = content.length + 1 + 1; // space + at least 1 digit
  // eslint-disable-next-line no-constant-condition
  while (String(len).length + 1 + content.length !== len) {
    len = String(len).length + 1 + content.length;
  }
  const payload = enc.encode(`${len} ${content}`);
  const header = ustarHeader({ name: "pax_header", type: "x", size: payload.length });
  return { rawHeader: header, rawPayload: payload };
}

const byName = (entries: TarballEntry[], name: string): TarballEntry | undefined =>
  entries.find((e) => e.name === name);

describe("parseTarball — ustar prefix reconstruction", () => {
  const WRAPPER = "kitelev-exoas-honesttest-306f656e6159944a4ae18beeb618d13611826b9b"; // 65 chars
  const UUID_FILE = "a1b2c3d4-e5f6-7890-abcd-ef0123456789.md"; // 39 chars
  const FULL_PATH = `${WRAPPER}/${UUID_FILE}`; // 105 chars → ustar prefix-split

  it("reconstructs a path split across ustar prefix + name (the bug)", () => {
    // GitHub's authenticated tarball puts the 65-char wrapper into `prefix`
    // and the 39-char file into `name`. nanotar 0.3.0 dropped the prefix and
    // yielded the bare file name; the fix prepends the prefix.
    const raw = tarball([
      { name: `${WRAPPER}/`, type: "5" },
      { name: UUID_FILE, prefix: WRAPPER, type: "0", data: enc.encode("# hi") },
    ]);
    const entries = parseTarball(raw);
    expect(entries.map((e) => e.name)).toContain(FULL_PATH);
    expect(entries.map((e) => e.name)).not.toContain(UUID_FILE);
    const file = byName(entries, FULL_PATH);
    expect(file?.type).toBe("file");
    expect(dec.decode(file?.data)).toBe("# hi");
  });

  it("REVERT-VERIFY: ignoring the prefix field yields the bare (broken) name", () => {
    // Mirrors the pre-fix nanotar behaviour to prove the test exercises the
    // regression: a parser that reads only `name` returns the bare file name,
    // which then fails any "all entries under wrapper" gate.
    const raw = tarball([
      { name: UUID_FILE, prefix: WRAPPER, type: "0", data: enc.encode("x") },
    ]);
    const nameOnly = (bytes: Uint8Array): string => {
      const slice = bytes.subarray(0, 100);
      const nul = slice.indexOf(0);
      return dec.decode(nul === -1 ? slice : slice.subarray(0, nul));
    };
    expect(nameOnly(raw)).toBe(UUID_FILE); // broken parser result
    expect(byName(parseTarball(raw), FULL_PATH)).toBeDefined(); // fixed result
  });

  it("leaves short paths (empty prefix) unchanged — no regression", () => {
    const shortName = `${WRAPPER}/README.md`; // 75 chars, fits the 100-byte name field
    const raw = tarball([
      { name: shortName, type: "0", data: enc.encode("readme") },
    ]);
    const entries = parseTarball(raw);
    expect(byName(entries, shortName)).toBeDefined();
  });

  it("classifies directory entries", () => {
    const raw = tarball([{ name: `${WRAPPER}/`, type: "5" }]);
    expect(parseTarball(raw)[0].type).toBe("directory");
  });

  it("PAX `path=` extended header takes precedence over the ustar prefix", () => {
    const pax = paxPathBlock(`${WRAPPER}/pax-name.md`);
    const raw = tarball([
      { ...pax, name: "" },
      // Decoy prefix/name that must be IGNORED in favour of the PAX path.
      { name: "decoy.md", prefix: "decoy-prefix", type: "0", data: enc.encode("p") },
    ]);
    const entries = parseTarball(raw);
    expect(byName(entries, `${WRAPPER}/pax-name.md`)).toBeDefined();
    expect(byName(entries, "decoy-prefix/decoy.md")).toBeUndefined();
  });

  it("reproduces the full GitHub authenticated-tarball shape", () => {
    const raw = tarball([
      { name: `${WRAPPER}/`, type: "5" },
      { name: `${WRAPPER}/README.md`, type: "0", data: enc.encode("readme") },
      { name: UUID_FILE, prefix: WRAPPER, type: "0", data: enc.encode("asset") },
    ]);
    const entries = parseTarball(raw);
    const files = entries.filter((e) => e.type === "file").map((e) => e.name);
    // Every file shares the single wrapper prefix → discoverWrapperDir passes.
    expect(files.every((n) => n.startsWith(`${WRAPPER}/`))).toBe(true);
    expect(files).toContain(FULL_PATH);
  });

  it("parseTarballGzip decodes + reconstructs end-to-end", async () => {
    const raw = tarball([
      { name: UUID_FILE, prefix: WRAPPER, type: "0", data: enc.encode("gz") },
    ]);
    const gz = new Uint8Array(gzipSync(raw));
    const entries = await parseTarballGzip(gz);
    expect(byName(entries, FULL_PATH)).toBeDefined();
  });
});
