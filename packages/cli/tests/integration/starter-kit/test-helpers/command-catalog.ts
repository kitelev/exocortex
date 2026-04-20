/**
 * Command catalog loader — Phase 1 integration helper.
 *
 * Scans starter-kit fixtures for `exocmd__Command` instances and returns a
 * parametrization catalog for the test suite. Discovery contract:
 *
 *   - Filter by class UUID `790e5b16-251d-4556-96ac-e5c7f1429b2e`
 *     (`exocmd__Command` class definition). Accept three wikilink forms:
 *       1. `[[790e5b16-251d-4556-96ac-e5c7f1429b2e]]` — canonical UUID
 *       2. `[[exocmd__Command]]` — resolved class label (legacy)
 *       3. `"exocmd__Command"` — bare label (legacy; not currently emitted)
 *
 *     A substring match on `"exocmd__Command"` is forbidden — it silently
 *     returns `[]` on UUID-wikilink assets (issue #2863 / PR #2873 class of
 *     bug — see memory `feedback_cli_dyncommand_list_uuid_wikilink`).
 *
 *   - Exclude property-definition stubs: the 8 ontology assets under
 *     `exocmd/` whose `exo__Instance_class` points to `exo__Property` /
 *     `exo__ObjectProperty` (RFC v4 §4.0a). The class-UUID filter above
 *     rejects these naturally (their `exo__Instance_class` is NOT
 *     `[[790e5b16-...]]`).
 *
 *   - A reverse index `Map<classLabel, classUuid>` is built once at load
 *     time by scanning every `.md` file under the fixture root for assets
 *     that themselves declare `exo__Instance_class: [[8619c4fc-...]]`
 *     (the `exo__Class` meta-class UUID). Used to resolve legacy label
 *     wikilinks to their UUID.
 *
 * Phase 1 is the first helper shipped under this convention. RFC v4 §12
 * gate requires a matching unit test at
 * `tests/unit/test-helpers/command-catalog.test.ts` and an inline
 * integration guard at
 * `tests/integration/starter-kit/test-helpers/command-catalog.self.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

/** `exocmd__Command` class UUID — RFC v4 header constant. */
export const EXOCMD_COMMAND_CLASS_UUID =
  "790e5b16-251d-4556-96ac-e5c7f1429b2e";

/** `exo__Class` meta-class UUID — used to find class-definition files. */
export const EXO_CLASS_META_UUID = "8619c4fc-64f1-4869-b17e-e34186cacca9";

/**
 * Phase 2 stopgap filter (RFC v4 §4.0). The starter-kit has 44 `exocmd__Command`
 * instances, of which 3 criticality commands are UI-broken pending the UX-RFC
 * zone migration (P0-2). Until `exocmd__Command_state` lands in the starter-kit
 * ontology, we hardcode the broken set so the parametrized integration suite
 * can filter to 41 active commands without running against known-red fixtures.
 *
 * Dropping any UUID from this set must be accompanied by the corresponding
 * starter-kit cleanup; the integration self-test asserts each UUID is still
 * present in the raw catalog so a rename surfaces as a test failure rather
 * than a silent filter drift.
 */
export const KNOWN_BROKEN_UUIDS: ReadonlySet<string> = new Set([
  "6b2f1cc6-a9f4-452a-93be-79b531188a62", // Set Criticality High
  "e64dd9bd-49b6-480c-8e62-baaf6cab81fc", // Set Criticality Medium
  "828c4653-cae2-446e-8d47-2826f8638bd9", // Set Criticality Low
]);

/** Lifecycle classification of a Command (RFC v4 §4.0). */
export type CommandState = "active" | "broken" | "deprecated";

const COMMAND_CLASS_WIKILINK_UUID = `[[${EXOCMD_COMMAND_CLASS_UUID}]]`;
const COMMAND_CLASS_WIKILINK_LABEL = "[[exocmd__Command]]";
const COMMAND_CLASS_BARE_LABEL = "exocmd__Command";
const EXO_CLASS_WIKILINK_UUID = `[[${EXO_CLASS_META_UUID}]]`;
const EXO_CLASS_WIKILINK_LABEL = "[[exo__Class]]";

/**
 * Resolved Command instance. `raw` retains the full parsed frontmatter for
 * downstream helpers (extract-target-class, predict-mutation) that need more
 * than the top-level fields this contract exposes.
 */
export interface CommandCatalogEntry {
  /** `exo__Asset_uid` — UUID of the command instance. */
  uid: string;
  /** `exo__Asset_label` — human-readable command name. */
  label: string;
  /** Absolute path to the fixture `.md` file. */
  path: string;
  /** Class UUID that matched (always `EXOCMD_COMMAND_CLASS_UUID`). */
  classUuid: string;
  /** `exocmd__Command_icon` if declared. */
  icon?: string;
  /** `exocmd__Command_category` if declared (e.g. `"creation"`, `"status"`). */
  category?: string;
  /** `exocmd__Command_grounding` wikilink if declared. */
  grounding?: string;
  /** `exocmd__Command_precondition` wikilink if declared. */
  precondition?: string;
  /** `exocmd__Command_targetClass` wikilink if declared (Phase 1 addendum). */
  targetClass?: string;
  /** Raw parsed frontmatter — ground truth for downstream helpers. */
  raw: Record<string, unknown>;
}

export interface LoadOptions {
  /** Override fixture root (default: `<worktree>/packages/starter-kit-fixtures`). */
  fixturesRoot?: string;
  /** DI hook for test isolation — list `.md` files under the fixture root. */
  listMarkdownFiles?: (root: string) => string[];
  /** DI hook — read a file as UTF-8 text. */
  readFile?: (filePath: string) => string;
  /** DI hook — called with `{ path, reason }` when an entry is skipped. */
  onSkip?: (event: { path: string; reason: string; cause?: unknown }) => void;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Resolve the default fixtures root via `import.meta.url` — stable regardless
 * of the jest cwd (phase0-benchmark uses cwd and is brittle).
 *
 * File location: `<repo>/packages/cli/tests/integration/starter-kit/test-helpers/command-catalog.ts`
 * Target:        `<repo>/packages/starter-kit-fixtures`
 */
function defaultFixturesRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "..", "starter-kit-fixtures");
}

function defaultListMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function defaultReadFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function extractFrontmatter(raw: string): Record<string, unknown> | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  const parsed = yaml.load(match[1]);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Does any value in `classField` match the `exocmd__Command` class?
 * Accepts UUID wikilink, label wikilink, or bare label.
 */
function matchesCommandClass(classField: unknown, labelToUuid: Map<string, string>): boolean {
  for (const raw of toArray(classField)) {
    if (typeof raw !== "string") continue;
    if (raw === COMMAND_CLASS_WIKILINK_UUID) return true;
    if (raw === COMMAND_CLASS_WIKILINK_LABEL) return true;
    if (raw === COMMAND_CLASS_BARE_LABEL) return true;
    // Defence in depth: if a legacy fixture uses some other label wikilink
    // that the reverse index resolves to the Command UUID, accept it.
    const labelMatch = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(raw);
    if (labelMatch) {
      const resolved = labelToUuid.get(labelMatch[1]);
      if (resolved === EXOCMD_COMMAND_CLASS_UUID) return true;
    }
  }
  return false;
}

/**
 * Is this asset an instance of `exo__Class` (i.e. a class definition)?
 * Used to build the reverse index on first scan.
 */
function isClassDefinition(classField: unknown): boolean {
  for (const raw of toArray(classField)) {
    if (typeof raw !== "string") continue;
    if (raw === EXO_CLASS_WIKILINK_UUID) return true;
    if (raw === EXO_CLASS_WIKILINK_LABEL) return true;
    if (raw === "exo__Class") return true;
  }
  return false;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Build a `Map<classLabel, classUuid>` reverse index by scanning every parsed
 * frontmatter for assets whose `exo__Instance_class` is `exo__Class`. When
 * two class definitions share a label, the first seen wins (deterministic
 * under a sorted `files` input).
 */
export function buildClassLabelToUuid(
  parsed: Array<{ path: string; fm: Record<string, unknown> }>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const { fm } of parsed) {
    if (!isClassDefinition(fm["exo__Instance_class"])) continue;
    const label = asString(fm["exo__Asset_label"]);
    const uid = asString(fm["exo__Asset_uid"]);
    if (!label || !uid) continue;
    if (!index.has(label)) {
      index.set(label, uid);
    }
  }
  return index;
}

/**
 * Load the command catalog from the starter-kit fixtures. Deterministically
 * sorted by UID so parametrized test output is stable across machines.
 */
export function loadCommandCatalog(options: LoadOptions = {}): CommandCatalogEntry[] {
  const fixturesRoot = options.fixturesRoot ?? defaultFixturesRoot();
  const listFiles = options.listMarkdownFiles ?? defaultListMarkdownFiles;
  const readFile = options.readFile ?? defaultReadFile;
  const onSkip = options.onSkip ?? (() => {});

  const files = listFiles(fixturesRoot).slice().sort();
  const parsed: Array<{ path: string; fm: Record<string, unknown> }> = [];

  for (const filePath of files) {
    let raw: string;
    try {
      raw = readFile(filePath);
    } catch (cause) {
      onSkip({ path: filePath, reason: "read_error", cause });
      continue;
    }
    let fm: Record<string, unknown> | null;
    try {
      fm = extractFrontmatter(raw);
    } catch (cause) {
      onSkip({ path: filePath, reason: "yaml_parse_error", cause });
      continue;
    }
    if (!fm) {
      onSkip({ path: filePath, reason: "no_frontmatter" });
      continue;
    }
    parsed.push({ path: filePath, fm });
  }

  const labelToUuid = buildClassLabelToUuid(parsed);

  const entries: CommandCatalogEntry[] = [];
  for (const { path: filePath, fm } of parsed) {
    if (!matchesCommandClass(fm["exo__Instance_class"], labelToUuid)) {
      continue;
    }
    const uid = asString(fm["exo__Asset_uid"]);
    const label = asString(fm["exo__Asset_label"]);
    if (!uid || !label) {
      onSkip({
        path: filePath,
        reason: uid ? "missing_label" : "missing_uid",
      });
      continue;
    }
    entries.push({
      uid,
      label,
      path: filePath,
      classUuid: EXOCMD_COMMAND_CLASS_UUID,
      icon: asString(fm["exocmd__Command_icon"]),
      category: asString(fm["exocmd__Command_category"]),
      grounding: asString(fm["exocmd__Command_grounding"]),
      precondition: asString(fm["exocmd__Command_precondition"]),
      targetClass: asString(fm["exocmd__Command_targetClass"]),
      raw: fm,
    });
  }

  entries.sort((a, b) => a.uid.localeCompare(b.uid));
  return entries;
}

/**
 * Classify a `CommandCatalogEntry` into a lifecycle state. Phase 2 resolves in
 * precedence order:
 *
 *   1. Explicit `exocmd__Command_state` (reserved for the RFC v4 §4.0 future
 *      starter-kit property addition — not currently emitted by fixtures).
 *   2. Membership in the hardcoded `KNOWN_BROKEN_UUIDS` set → `"broken"`.
 *   3. Default → `"active"`.
 *
 * The explicit-property branch is load-bearing: once starter-kit adds the
 * property, `loadActiveCommandCatalog` transparently switches without needing
 * a second cleanup PR (RFC v4 §7.4a transition plan).
 */
export function classifyCommand(entry: CommandCatalogEntry): CommandState {
  const explicit = entry.raw["exocmd__Command_state"];
  if (explicit === "broken" || explicit === "deprecated" || explicit === "active") {
    return explicit;
  }
  if (KNOWN_BROKEN_UUIDS.has(entry.uid)) return "broken";
  return "active";
}

/**
 * Return only the `"active"` slice of the Command catalog — Phase 2's
 * parametrized-suite entry point (RFC v4 §8 Phase 2 item 7).
 *
 * The underlying `loadCommandCatalog()` output is deterministic, so the
 * filtered view is also deterministic and stable across runs. `options` are
 * passed straight through for test-isolation DI.
 */
export function loadActiveCommandCatalog(
  options: LoadOptions = {},
): CommandCatalogEntry[] {
  return loadCommandCatalog(options).filter(
    (entry) => classifyCommand(entry) === "active",
  );
}
