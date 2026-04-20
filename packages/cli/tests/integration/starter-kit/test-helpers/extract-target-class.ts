/**
 * `extractTargetClassFromCommand` — RFC v4 §7.1a 5-strategy resolution ladder.
 *
 * Pure classifier over the starter-kit submodule: given a parametrized
 * `CommandCatalogEntry` plus a pre-scanned `StarterKitContext` (preconditions,
 * groundings, and class-label reverse index), returns the host class on which
 * a test fixture should be materialised. Mirrors the Python classifier used in
 * the Phase 0 report so the Strategy distribution held across implementations
 * is load-bearing — any drift surfaces in the aggregate assertions below.
 *
 *   S1 — Explicit `exocmd__Command_targetClass`                          (8 cmds)
 *   S2 — Precondition SPARQL `$target <ns:Class_prop>` / `rdf:type`    (19 cmds)
 *   S3 — Grounding `targetProperty` RDFS:domain heuristic               (5 cmds)
 *   S4 — Grounding `targetValue` class-flip pivot                       (2 cmds)
 *   S5 — Fallback `ems__Task` (dispatch-only)                         (≤10 cmds)
 *
 * Aggregate gate (RFC §7.1a): S5 ratio ≤ 30% of the 44-Command catalog. At
 * 2026-04-20 the post-Option-C ratio is 22.7% (10/44). The companion
 * `loadStarterKitContext` loader scans the submodule once and builds the
 * maps every downstream helper needs — keeping the ladder itself a pure
 * function over pre-resolved data.
 *
 * RFC v4 §12 gate: matching unit test lives at
 * `packages/cli/tests/unit/test-helpers/extract-target-class.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import type { CommandCatalogEntry } from "./command-catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolutionStrategy = "S1" | "S2" | "S3" | "S4" | "S5";

export interface ExtractTargetClassResult {
  /** Selected host class label (e.g. `"ems__Task"`). */
  readonly targetClass: string;
  /** Which ladder step selected the class. */
  readonly strategy: ResolutionStrategy;
  /** Short free-form reason (classifier note — for debug output / audits). */
  readonly reason: string;
  /**
   * True when the strategy cannot anchor a frontmatter-mutation assertion —
   * test harness should downgrade to P-dispatch only. Currently means `S5`.
   */
  readonly dispatchOnly: boolean;
}

export interface PreconditionData {
  readonly uid: string;
  readonly label: string;
  readonly sparqlAsk?: string;
  readonly hostFunction?: string;
}

export interface GroundingData {
  readonly uid: string;
  readonly label: string;
  /** `property_set` | `property_delete` | `composite` | `service_call` | `create_instance` | `sparql_update`. */
  readonly type?: string;
  readonly targetProperty?: string;
  readonly targetValue?: string;
  readonly serviceId?: string;
  readonly inputSchema?: string;
  readonly targetClass?: string;
  /** Resolved step groundings (flattened from `exocmd__Grounding_steps` wikilinks). */
  readonly steps?: readonly GroundingData[];
  readonly raw: Record<string, unknown>;
}

export interface StarterKitContext {
  readonly preconditions: ReadonlyMap<string, PreconditionData>;
  readonly groundings: ReadonlyMap<string, GroundingData>;
  /** `classUuid → classLabel` — used to resolve UUID-wikilinks back to labels. */
  readonly classLabelByUuid: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Context loader — one pass over the submodule
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const EXO_CLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
const PRECONDITION_CLASS_UID = "15d119b5-9636-431e-9e91-1f140107d059";
const GROUNDING_CLASS_UID = "11579feb-2e42-491c-af59-b89b1129a539";

export interface LoadContextOptions {
  readonly fixturesRoot?: string;
  readonly listMarkdownFiles?: (root: string) => string[];
  readonly readFile?: (filePath: string) => string;
}

function defaultFixturesRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "starter-kit-fixtures",
  );
}

function defaultList(root: string): string[] {
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
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out;
}

function readFrontmatter(raw: string): Record<string, unknown> | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Strip Obsidian wikilink wrapper; accept `[[X]]`, `"[[X]]"`, `[[X|alias]]`, or `X`. */
function unwrapWikilink(raw: string): string {
  const match = raw.match(/^"?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"?$/);
  return match ? match[1] : raw;
}

function hasInstanceClass(fm: Record<string, unknown>, uid: string): boolean {
  for (const raw of toArray(fm["exo__Instance_class"])) {
    if (typeof raw !== "string") continue;
    if (raw === `[[${uid}]]` || raw === `"[[${uid}]]"`) return true;
  }
  return false;
}

/**
 * Scan the starter-kit fixture tree and build the `StarterKitContext`
 * consumed by `extractTargetClassFromCommand` (and indirectly by
 * `execute-command.ts`). One O(n) walk over the submodule.
 */
export function loadStarterKitContext(
  options: LoadContextOptions = {},
): StarterKitContext {
  const root = options.fixturesRoot ?? defaultFixturesRoot();
  const listFiles = options.listMarkdownFiles ?? defaultList;
  const readFile = options.readFile ?? ((p) => fs.readFileSync(p, "utf8"));

  const preconditions = new Map<string, PreconditionData>();
  const groundings = new Map<string, GroundingData>();
  const classLabelByUuid = new Map<string, string>();
  const groundingFM: Array<{ uid: string; fm: Record<string, unknown> }> = [];

  for (const filePath of listFiles(root).slice().sort()) {
    let raw: string;
    try {
      raw = readFile(filePath);
    } catch {
      continue;
    }
    const fm = readFrontmatter(raw);
    if (!fm) continue;
    const uid = asString(fm["exo__Asset_uid"]);
    const label = asString(fm["exo__Asset_label"]) ?? "";
    if (!uid) continue;

    if (hasInstanceClass(fm, EXO_CLASS_UID) && label) {
      if (!classLabelByUuid.has(uid)) classLabelByUuid.set(uid, label);
    }
    if (hasInstanceClass(fm, PRECONDITION_CLASS_UID)) {
      preconditions.set(uid, {
        uid,
        label,
        sparqlAsk: asString(fm["exocmd__Precondition_sparqlAsk"]),
        hostFunction: asString(fm["exocmd__Precondition_hostFunction"]),
      });
    }
    if (hasInstanceClass(fm, GROUNDING_CLASS_UID)) {
      groundingFM.push({ uid, fm });
    }
  }

  // Second pass: groundings reference other groundings via `_steps`. Resolve
  // once the uid → frontmatter map is complete.
  const groundingFMMap = new Map(groundingFM.map(({ uid, fm }) => [uid, fm]));
  for (const { uid, fm } of groundingFM) {
    groundings.set(uid, buildGroundingData(uid, fm, groundingFMMap));
  }

  return { preconditions, groundings, classLabelByUuid };
}

function buildGroundingData(
  uid: string,
  fm: Record<string, unknown>,
  fmMap: Map<string, Record<string, unknown>>,
): GroundingData {
  const label = asString(fm["exo__Asset_label"]) ?? "";
  const stepsRaw = toArray(fm["exocmd__Grounding_steps"]);
  const steps: GroundingData[] = [];
  for (const stepWl of stepsRaw) {
    if (typeof stepWl !== "string") continue;
    const stepUid = unwrapWikilink(stepWl);
    const stepFm = fmMap.get(stepUid);
    if (stepFm) steps.push(buildGroundingData(stepUid, stepFm, fmMap));
  }
  return {
    uid,
    label,
    type: asString(fm["exocmd__Grounding_type"]),
    targetProperty: asString(fm["exocmd__Grounding_targetProperty"]),
    targetValue: asString(fm["exocmd__Grounding_targetValue"]),
    serviceId: asString(fm["exocmd__Grounding_serviceId"]),
    inputSchema: asString(fm["exocmd__Grounding_inputSchema"]),
    targetClass: asString(fm["exocmd__Grounding_targetClass"]),
    steps: steps.length > 0 ? steps : undefined,
    raw: fm,
  };
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/**
 * Resolve class from a wikilink value that may be either a UUID ref or a
 * class label. Returns the class label for both shapes, or undefined if the
 * UUID does not resolve.
 */
function resolveClassFromWikilink(
  value: string,
  classLabelByUuid: ReadonlyMap<string, string>,
): string | undefined {
  const inner = unwrapWikilink(value);
  // UUID → resolve via reverse index
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inner)) {
    return classLabelByUuid.get(inner);
  }
  // Label (e.g. "ems__Task")
  return inner;
}

/**
 * Extract `ns__Class` from a SPARQL property-prefix token `ns:Class_prop` or
 * `rdf:type <ns#Class>`. Used by Strategy 2 to infer host class from the
 * precondition SPARQL.
 */
export function extractClassFromSparql(
  sparqlAsk: string,
): { class: string; reason: string } | undefined {
  const body = sparqlAsk.replace(/\s+/g, " ");
  // Prefer explicit `$target rdf:type <ns#Class>` if present.
  const rdfType = body.match(
    /\$target\s+(?:a|rdf:type)\s+<[^>]*[#\/](\w+)>/,
  );
  if (rdfType) {
    return {
      class: rdfType[1].replace(/__+/g, "__"),
      reason: `precond rdf:type match (${rdfType[1]})`,
    };
  }
  // Property-prefix form: $target ns:Class_prop <value>. Excludes
  // exo:Instance_class (class-flip hint belongs to S4).
  const propRe =
    /\$target\s+([A-Za-z][\w-]*):([A-Za-z][\w-]*)_([A-Za-z][\w-]*)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(body)) !== null) {
    const [, ns, klass, prop] = m;
    if (ns === "exo" && klass === "Instance" && prop === "class") continue;
    const label = `${ns}__${klass}`;
    seen.add(label);
  }
  if (seen.size === 1) {
    const [label] = seen;
    return { class: label, reason: `precond property-prefix (${label})` };
  }
  return undefined;
}

/**
 * Extract the single class label from a set of grounding `targetProperty`
 * IRIs (S3 heuristic). Accepts property labels in `ns__Class_prop` form.
 */
function extractClassFromTargetProperty(
  targetProperties: readonly string[],
): { class: string; reason: string } | undefined {
  const classes = new Set<string>();
  for (const prop of targetProperties) {
    const match = prop.match(/^([A-Za-z][\w-]*)__([A-Za-z][\w-]*)_/);
    if (!match) continue;
    classes.add(`${match[1]}__${match[2]}`);
  }
  if (classes.size === 1) {
    const [label] = classes;
    return {
      class: label,
      reason: `grounding targetProperty domain (${label})`,
    };
  }
  return undefined;
}

/**
 * Collect `targetProperty` tokens from a grounding and its composite children,
 * plus nested `"property"` keys inside JSON `targetValue` blocks (e.g. the
 * `Set Planned Start` family).
 */
function collectTargetProperties(grounding: GroundingData): string[] {
  const out: string[] = [];
  const visit = (g: GroundingData): void => {
    if (g.targetProperty) out.push(g.targetProperty);
    if (g.targetValue) {
      try {
        const parsed = JSON.parse(g.targetValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const prop = (parsed as { property?: unknown }).property;
          if (typeof prop === "string") out.push(prop);
        }
      } catch {
        /* ignore — plain wikilink / literal targetValue */
      }
    }
    for (const step of g.steps ?? []) visit(step);
  };
  visit(grounding);
  return out;
}

/**
 * Determine if the grounding encodes a Convert class-flip (S4). Returns the
 * "pre-flip" host class (i.e. the source fixture class that the button
 * converts AWAY from).
 */
function classFlipPreFlip(
  grounding: GroundingData,
  classLabelByUuid: ReadonlyMap<string, string>,
): { class: string; reason: string } | undefined {
  // Only serviceId=updateProperty with a class targetValue counts as a
  // class-flip in the current executor (see GroundingExecutor:368-376).
  // Starter-kit fixtures may split serviceId into `exocmd__Grounding_serviceId`
  // (parsed as `grounding.serviceId`) OR collapse it onto `targetProperty`
  // (vault shape). Accept both — CommandResolver.loadGrounding does the same
  // resolution (CommandResolver:465-468).
  const effectiveServiceId =
    grounding.serviceId ?? grounding.targetProperty;
  if (
    grounding.type !== "service_call" ||
    effectiveServiceId !== "updateProperty" ||
    !grounding.targetValue
  ) {
    return undefined;
  }
  // Class-flip targetValues are wrapped wikilinks (`[[X]]` / `"[[X]]"`).
  // JSON-object targetValues (e.g. `{"property":"ems__Effort_..."}`) belong
  // to S3 property-domain heuristic, not S4.
  if (!/^"?\[\[/.test(grounding.targetValue.trim())) {
    return undefined;
  }
  const dest = resolveClassFromWikilink(
    grounding.targetValue,
    classLabelByUuid,
  );
  if (!dest) return undefined;
  // Symmetric mapping: Convert-to-Task fixture starts as ems__Project, and
  // vice-versa. Anything else falls back to ems__Effort (broadest pre-flip).
  let pre: string;
  if (dest === "ems__Task") pre = "ems__Project";
  else if (dest === "ems__Project") pre = "ems__Task";
  else pre = "ems__Effort";
  return { class: pre, reason: `class-flip dest=${dest}; fixture pre-flip=${pre}` };
}

/**
 * Apply the RFC §7.1a ladder to a single Command, returning the chosen host
 * class + strategy + reason. Pure function over the pre-resolved context.
 */
export function extractTargetClassFromCommand(
  cmd: CommandCatalogEntry,
  ctx: StarterKitContext,
): ExtractTargetClassResult {
  // --- S1: explicit frontmatter declaration -------------------------------
  if (cmd.targetClass) {
    const cls = resolveClassFromWikilink(cmd.targetClass, ctx.classLabelByUuid);
    if (cls) {
      return {
        targetClass: cls,
        strategy: "S1",
        reason: `explicit exocmd__Command_targetClass=${cls}`,
        dispatchOnly: false,
      };
    }
  }

  // --- S2: precondition SPARQL inspection ---------------------------------
  if (cmd.precondition) {
    const uid = unwrapWikilink(cmd.precondition);
    const pre = ctx.preconditions.get(uid);
    if (pre?.sparqlAsk) {
      const hit = extractClassFromSparql(pre.sparqlAsk);
      if (hit) {
        return {
          targetClass: hit.class,
          strategy: "S2",
          reason: hit.reason,
          dispatchOnly: false,
        };
      }
    }
  }

  // --- S3 / S4 require grounding resolution -------------------------------
  const groundingUid = cmd.grounding ? unwrapWikilink(cmd.grounding) : undefined;
  const grounding = groundingUid ? ctx.groundings.get(groundingUid) : undefined;

  // --- S4: class-flip pivot (checked before S3 so convert commands beat
  //         property-heuristic) ------------------------------------------
  if (grounding) {
    const flip = classFlipPreFlip(grounding, ctx.classLabelByUuid);
    if (flip) {
      return {
        targetClass: flip.class,
        strategy: "S4",
        reason: flip.reason,
        dispatchOnly: false,
      };
    }
  }

  // --- S3: grounding targetProperty RDFS:domain heuristic -----------------
  if (grounding) {
    const props = collectTargetProperties(grounding);
    const hit = extractClassFromTargetProperty(props);
    if (hit) {
      return {
        targetClass: hit.class,
        strategy: "S3",
        reason: hit.reason,
        dispatchOnly: false,
      };
    }
  }

  // --- S5: fallback -------------------------------------------------------
  return {
    targetClass: "ems__Task",
    strategy: "S5",
    reason: "fallback (no ladder match)",
    dispatchOnly: true,
  };
}
