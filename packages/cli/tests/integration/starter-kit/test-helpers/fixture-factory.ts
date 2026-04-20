/**
 * Fixture factory — Phase 1 integration helper (RFC v4 §7.1a foundation).
 *
 * Materialises synthetic vault assets (`ems__Task`, `ems__Project`, `ems__Area`,
 * and arbitrary host classes) inside an isolated tmp directory so parametrized
 * integration tests over the 44-Command catalog each get a fresh host asset to
 * dispatch the Grounding against.
 *
 * Contract highlights:
 *
 *  - **Deterministic UUIDs.** A seed string (e.g. a command UID plus a test-case
 *    discriminator) maps through SHA-1 to a stable UUIDv5-shaped identifier.
 *    Running the same test twice produces the same file UID — no flaky snapshot
 *    diff, no leaked random tmp names.
 *  - **Isolated tmp root per factory call** (`makeFixtureRoot`). Tests cleanup
 *    via `cleanupFixtureRoot(root)` in `afterEach`. Roots are created under
 *    `<os.tmpdir>/exocortex-fixture-<suffix>` so parallel jest workers never
 *    collide.
 *  - **Stable `targetIRI` convention** — `obsidian://vault/<basename>` without
 *    the `.md` suffix, mirroring how `GroundingExecutor.execute` consumers
 *    address the file from the real plugin (memory `reference_cli_status_iri_vault_divergence`
 *    observes the IRI shape divergence — we commit to the vault-2025 shape here).
 *  - **No updateProperty CLI stub shipped** (per Phase 0 `dd3bdaaa` note): read-back
 *    happens via direct `fs.readFileSync` in tests, not via CLI subprocess.
 *
 * RFC v4 §12 gate: matching unit test lives at
 * `packages/cli/tests/unit/test-helpers/fixture-factory.test.ts`.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface FixtureAsset {
  /** Deterministic UUID of the host asset. */
  readonly uid: string;
  /** Human-readable label. */
  readonly label: string;
  /** Absolute path of the materialised `.md` file on disk. */
  readonly path: string;
  /** Class label set as `exo__Instance_class` (e.g. "ems__Task"). */
  readonly className: string;
  /** Stable Obsidian-style IRI (`obsidian://vault/<basename>`). */
  readonly targetIRI: string;
}

export interface BuildFixtureOptions {
  /**
   * Class label to stamp as `exo__Instance_class` (e.g. "ems__Task").
   * For classes whose resolution is via UUID wikilink, pass the UUID string —
   * the factory wraps it as `[[<value>]]` verbatim.
   */
  readonly className: string;
  /**
   * Seed string used to derive the deterministic UUID. Typical value is the
   * command UID under test + an optional discriminator (e.g. `"precondition-unmet"`).
   * Two distinct seeds always produce two distinct UIDs; identical seeds produce
   * identical UIDs across runs.
   */
  readonly seed: string;
  /** Optional human-readable label. Falls back to `"Fixture for <seed>"`. */
  readonly label?: string;
  /** Additional frontmatter keys merged on top of the skeleton. */
  readonly extraFrontmatter?: Record<string, unknown>;
  /**
   * Tmp root under which the `.md` file is written. Must already exist —
   * use `makeFixtureRoot()` to allocate one. Required so callers cannot
   * accidentally leak files into the repo root.
   */
  readonly root: string;
}

const UUID_NAMESPACE = "exocortex-fixture-factory-v1";

/**
 * Deterministic UUIDv5-shaped identifier from a seed string.
 *
 * Pure SHA-1 of (namespace + "::" + seed), truncated to 16 bytes, with RFC 4122
 * version/variant nibbles patched. Matches the UUIDv5 textual shape so any
 * downstream tooling that validates UUID format accepts the output.
 */
export function uuidFromSeed(seed: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(UUID_NAMESPACE + "::" + seed)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

/**
 * Allocate a fresh, empty tmp directory for a test case. Safe for parallel
 * jest workers (suffix is process-unique).
 */
export function makeFixtureRoot(prefix = "exocortex-fixture-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Recursively remove a fixture root. No-op if the path does not exist. */
export function cleanupFixtureRoot(root: string): void {
  if (!root) return;
  fs.rmSync(root, { recursive: true, force: true });
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  const str = String(value);
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else if (value && typeof value === "object") {
      // Rare path — encode as inline JSON so downstream YAML parsers still
      // succeed. Callers who need richer structure should pass YAML strings.
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Create a synthetic host asset inside `opts.root`. Returns the materialised
 * `FixtureAsset` record. Throws if `opts.root` is missing or the file would
 * overwrite an existing one (deterministic UUID collision).
 */
export function buildFixture(opts: BuildFixtureOptions): FixtureAsset {
  if (!opts.root || !fs.existsSync(opts.root)) {
    throw new Error(
      `fixture-factory: root does not exist (did you call makeFixtureRoot()?): ${opts.root}`,
    );
  }
  const uid = uuidFromSeed(opts.seed);
  const label = opts.label ?? `Fixture for ${opts.seed}`;
  const basename = uid;
  const filePath = path.join(opts.root, `${basename}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(
      `fixture-factory: refusing to overwrite existing fixture (seed collision?): ${filePath}`,
    );
  }
  const frontmatter: Record<string, unknown> = {
    exo__Asset_uid: uid,
    exo__Asset_label: label,
    exo__Instance_class: [`[[${opts.className}]]`],
    aliases: [label],
    ...(opts.extraFrontmatter ?? {}),
  };
  const content = renderFrontmatter(frontmatter) + `# ${label}\n`;
  fs.writeFileSync(filePath, content, "utf8");
  return {
    uid,
    label,
    path: filePath,
    className: opts.className,
    targetIRI: `obsidian://vault/${basename}`,
  };
}
