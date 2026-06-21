import { Command } from "commander";
import { existsSync, statSync } from "fs";
import fs from "fs-extra";
import { resolve } from "path";
import * as glob from "glob";
import { CachingNodeFsAdapter } from "../adapters/CachingNodeFsAdapter.js";
import { ErrorHandler, type OutputFormat } from "../utils/ErrorHandler.js";
import { VaultNotFoundError } from "../utils/errors/index.js";

/**
 * RFC 0003 (requirements management) P1 — traceability checker.
 *
 * `exocortex requirements audit` is the executable mechanism behind the
 * spec→test traceability model. It loads the functional `req__Requirement`
 * assets, greps the test corpus for the `@req:<uid>` tokens that bind tests to
 * requirements, and reports:
 *
 *  - **orphan requirements** — a requirement with no `@req:` binding in any
 *    test (warning: expected during migration);
 *  - **dangling tags** — a `@req:<uid>` token whose uid resolves to no
 *    requirement (hard finding: typo or a deleted/renamed requirement);
 *  - **duplicate bindings** — one uid claimed by more than one distinct test
 *    occurrence (warning: copy-paste contamination signal);
 *  - **binding-class floor violations** — a `P0` requirement bound *solely* to
 *    a `unit` binding-class, violating RFC 0003 §3.6 (hard finding: P0 must hit
 *    at least one integration/e2e/gui-bdd binding);
 *  - **coverage** — % of requirements with ≥1 binding.
 *
 * The report is emitted as text (human) or json (CI comment + Pages generator).
 * Exit code: 0 when there are no *hard* findings, 1 otherwise — so P3 can flip
 * the soft `requirements-trace` CI job to a required gate without code changes.
 * Orphans + duplicates are warnings and never affect the exit code by default.
 */

/** UUID v4-ish syntax used by `@req:<uid>` tokens and req asset filenames. */
export const REQ_UID_PATTERN =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Global matcher for a `@req:<uid>` token (used over test-file content). */
const REQ_TAG_RE = new RegExp(`@req:(${REQ_UID_PATTERN})`, "g");

/** Default test-corpus globs (jest + playwright), relative to `--tests`. */
const DEFAULT_TEST_GLOBS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

const TEST_GLOB_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/**
 * Maps a `req__RequirementBindingClass<Token>` capture (the local-name suffix of
 * the enum wikilink) to the canonical binding-class token. Falls back to the
 * lower-cased capture for any future class not enumerated here.
 */
const BINDING_CLASS_MAP: Record<string, string> = {
  unit: "unit",
  integration: "integration",
  e2e: "e2e",
  guibdd: "gui-bdd",
};

/** A binding class that exercises production beyond a pure unit test. */
const REAL_PROD_CLASSES = new Set(["integration", "e2e", "gui-bdd"]);

export interface RequirementRecord {
  uid: string;
  label: string;
  /** Vault-relative path of the requirement asset. */
  path: string;
  /** `P0`..`P3`, or null when the priority wikilink could not be parsed. */
  priority: string | null;
  /** Canonical binding classes declared on the requirement (may be empty). */
  bindingClasses: string[];
  /** `Draft`|`Approved`|`Deprecated`, or null when unparseable. */
  status: string | null;
}

export interface TagOccurrence {
  uid: string;
  /** Test file path (as scanned). */
  file: string;
  /** 1-based line number of the tag occurrence. */
  line: number;
}

export interface OrphanFinding {
  uid: string;
  label: string;
  path: string;
}

export interface DuplicateFinding {
  uid: string;
  occurrences: TagOccurrence[];
}

export interface FloorViolationFinding {
  uid: string;
  label: string;
  priority: string;
  bindingClasses: string[];
}

export interface TraceabilityReport {
  requirementCount: number;
  tagCount: number;
  /** Requirements with ≥1 binding. */
  bound: number;
  /** bound / requirementCount, 0..1 (1 when there are no requirements). */
  coverage: number;
  orphans: OrphanFinding[];
  dangling: TagOccurrence[];
  duplicates: DuplicateFinding[];
  floorViolations: FloorViolationFinding[];
  /** Requirements whose priority could not be parsed (floor check skipped). */
  unknownPriority: number;
  /** True iff there are no hard findings (no dangling tags, no floor violations). */
  clean: boolean;
  /**
   * Enumerated P0 checklist — total P0-priority requirements (the set that arms
   * the hard-gate flip, RFC 0003 §3.7).
   */
  p0Total: number;
  /** P0 requirements with ≥1 binding. */
  p0Bound: number;
  /** P0 requirements with NO binding — the coverage gap that blocks the ramp. */
  p0Orphans: number;
  /**
   * Ramp-ready (RFC 0003 §3.7 auto-flip criterion): every enumerated P0
   * requirement is bound, all P0 binding-class floors are met, and no tag is
   * dangling — i.e. the P0 checklist is fully (revert-verified-)bound and the
   * `requirements-trace` CI gate is safe to flip from soft to hard. False when
   * there are no P0 requirements (nothing to certify — fail-safe so `--gate hard`
   * blocks rather than passes vacuously on an empty / failed-to-clone reqs set).
   */
  rampReady: boolean;
}

/** Normalize a frontmatter value that may be a scalar or list into a string[]. */
function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Parse the priority token (`P0`..`P3`) from a `req__Requirement_priority`
 * wikilink value, e.g. `"[[uid|req__RequirementPriorityP0]]"` → `"P0"`. Returns
 * null when no priority enum local-name is present (fail-open).
 */
export function parsePriority(value: unknown): string | null {
  const raw = asStringArray(value)[0];
  if (!raw) return null;
  const m = raw.match(/RequirementPriority(P[0-3])\b/);
  return m ? m[1] : null;
}

/**
 * Parse the canonical binding-class tokens from a `req__Requirement_bindingClass`
 * value (scalar or list of enum wikilinks). Non-enum strings (free-text prose
 * bindings authored before the enum existed) are ignored. Returns [] when none
 * parse.
 */
export function parseBindingClasses(value: unknown): string[] {
  const out: string[] = [];
  for (const raw of asStringArray(value)) {
    const m = raw.match(/RequirementBindingClass([A-Za-z0-9]+)/);
    if (!m) continue;
    const token = m[1].toLowerCase();
    out.push(BINDING_CLASS_MAP[token] ?? token);
  }
  return out;
}

/** Parse the lifecycle status local-name (`Draft`/`Approved`/`Deprecated`). */
export function parseStatus(value: unknown): string | null {
  const raw = asStringArray(value)[0];
  if (!raw) return null;
  const m = raw.match(/RequirementStatus([A-Za-z]+)/);
  return m ? m[1] : null;
}

/**
 * Load `req__Requirement` instances from a directory tree. An asset is treated
 * as a functional requirement iff it carries a `req__Requirement_status`
 * frontmatter property (namespace-unambiguous: the assetspace anchor and TBox
 * enum assets do not have it).
 */
export async function loadRequirements(
  reqsPath: string,
): Promise<RequirementRecord[]> {
  const adapter = new CachingNodeFsAdapter(reqsPath);
  const assets = await adapter.indexedAssets();
  const requirements: RequirementRecord[] = [];

  for (const { path: relPath, metadata } of assets) {
    // Skip vendored / VCS dirs — each per-module reqs clone carries its own
    // `.git/` when the CI job clones several into one parent (RFC 0003 §3.2).
    const segments = relPath.split("/");
    if (segments.includes("node_modules") || segments.includes(".git")) continue;
    if (metadata["req__Requirement_status"] === undefined) continue;

    const uid =
      typeof metadata["exo__Asset_uid"] === "string"
        ? (metadata["exo__Asset_uid"] as string)
        : relPath.replace(/^.*\//, "").replace(/\.md$/, "");
    const label =
      typeof metadata["exo__Asset_label"] === "string"
        ? (metadata["exo__Asset_label"] as string)
        : uid;

    requirements.push({
      uid,
      label,
      path: relPath,
      priority: parsePriority(metadata["req__Requirement_priority"]),
      bindingClasses: parseBindingClasses(
        metadata["req__Requirement_bindingClass"],
      ),
      status: parseStatus(metadata["req__Requirement_status"]),
    });
  }

  return requirements;
}

/**
 * Extract every `@req:<uid>` token from a single test file's content, with
 * 1-based line numbers. Exported for unit testing of the line-attribution.
 */
export function extractReqTags(file: string, content: string): TagOccurrence[] {
  const occurrences: TagOccurrence[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    REQ_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REQ_TAG_RE.exec(lines[i])) !== null) {
      occurrences.push({ uid: m[1].toLowerCase(), file, line: i + 1 });
    }
  }
  return occurrences;
}

/**
 * Scan a test-corpus root for `@req:<uid>` bindings across the default
 * jest/playwright test globs.
 */
export async function scanTestTags(
  testRoot: string,
  globs: string[] = DEFAULT_TEST_GLOBS,
): Promise<TagOccurrence[]> {
  const files = await glob.glob(globs, {
    cwd: testRoot,
    nodir: true,
    ignore: TEST_GLOB_IGNORE,
    absolute: true,
  });
  // Deterministic order so duplicate/occurrence reporting is stable.
  files.sort();

  const occurrences: TagOccurrence[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    // Cheap pre-filter — skip files with no tag at all.
    if (!content.includes("@req:")) continue;
    occurrences.push(...extractReqTags(file, content));
  }
  return occurrences;
}

/**
 * Pure traceability audit over already-loaded requirements + tag occurrences.
 * No IO — the unit of behavior the tests pin.
 */
export function auditTraceability(
  requirements: RequirementRecord[],
  tags: TagOccurrence[],
): TraceabilityReport {
  const reqByUid = new Map<string, RequirementRecord>();
  for (const r of requirements) reqByUid.set(r.uid.toLowerCase(), r);

  // uid → occurrences
  const occByUid = new Map<string, TagOccurrence[]>();
  for (const t of tags) {
    const key = t.uid.toLowerCase();
    const list = occByUid.get(key);
    if (list) list.push(t);
    else occByUid.set(key, [t]);
  }

  const orphans: OrphanFinding[] = [];
  let bound = 0;
  for (const r of requirements) {
    if (occByUid.has(r.uid.toLowerCase())) bound++;
    else orphans.push({ uid: r.uid, label: r.label, path: r.path });
  }

  const dangling: TagOccurrence[] = [];
  for (const t of tags) {
    if (!reqByUid.has(t.uid.toLowerCase())) dangling.push(t);
  }

  const duplicates: DuplicateFinding[] = [];
  for (const [uid, occ] of occByUid) {
    // Only a uid that IS a real requirement can be a "duplicate binding"; a uid
    // with no requirement is reported as dangling instead.
    if (occ.length > 1 && reqByUid.has(uid)) {
      duplicates.push({ uid: reqByUid.get(uid)!.uid, occurrences: occ });
    }
  }

  const floorViolations: FloorViolationFinding[] = [];
  let unknownPriority = 0;
  for (const r of requirements) {
    if (r.priority === null) {
      unknownPriority++;
      continue;
    }
    if (r.priority !== "P0") continue;
    // Floor only enforced when the binding-class set is declared and contains
    // ONLY unit (fail-open on an empty set — nothing to judge yet).
    if (r.bindingClasses.length === 0) continue;
    const hasRealProd = r.bindingClasses.some((c) => REAL_PROD_CLASSES.has(c));
    if (!hasRealProd) {
      floorViolations.push({
        uid: r.uid,
        label: r.label,
        priority: r.priority,
        bindingClasses: r.bindingClasses,
      });
    }
  }

  // Enumerated P0 checklist (RFC 0003 §3.7): the set whose full revert-verified
  // binding arms the soft→hard gate flip. A P0 requirement is "covered" for the
  // ramp when it has ≥1 binding; the binding-class floor + dangling checks above
  // certify the *quality* of those bindings.
  let p0Total = 0;
  let p0Bound = 0;
  for (const r of requirements) {
    if (r.priority !== "P0") continue;
    p0Total++;
    if (occByUid.has(r.uid.toLowerCase())) p0Bound++;
  }
  const p0Orphans = p0Total - p0Bound;

  const requirementCount = requirements.length;
  const coverage = requirementCount === 0 ? 1 : bound / requirementCount;
  const clean = dangling.length === 0 && floorViolations.length === 0;

  // The auto-flip criterion: every enumerated P0 req bound, all P0 floors met,
  // no dangling tags. Requires p0Total > 0 so `--gate hard` fails-safe (blocks)
  // on an empty / failed-to-clone reqs set rather than passing vacuously.
  const rampReady =
    p0Total > 0 &&
    p0Orphans === 0 &&
    floorViolations.length === 0 &&
    dangling.length === 0;

  return {
    requirementCount,
    tagCount: tags.length,
    bound,
    coverage,
    orphans,
    dangling,
    duplicates,
    floorViolations,
    unknownPriority,
    clean,
    p0Total,
    p0Bound,
    p0Orphans,
    rampReady,
  };
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Render a human-readable report to stdout/stderr (stderr for findings). */
function renderText(report: TraceabilityReport, gate: GateMode = "soft"): void {
  console.log(
    `Requirements: ${report.requirementCount} | bound: ${report.bound} | ` +
      `coverage: ${formatPercent(report.coverage)} | tags: ${report.tagCount}`,
  );
  console.log(
    `P0 checklist: ${report.p0Bound}/${report.p0Total} bound | ` +
      `ramp-ready: ${report.rampReady ? "yes" : "no"} | gate: ${gate}`,
  );

  if (report.dangling.length > 0) {
    console.error(`\nDangling @req tags (${report.dangling.length}) — uid has no requirement:`);
    for (const d of report.dangling) {
      console.error(`  @req:${d.uid}  ${d.file}:${d.line}`);
    }
  }

  if (report.floorViolations.length > 0) {
    console.error(
      `\nBinding-class floor violations (${report.floorViolations.length}) — P0 bound solely to unit:`,
    );
    for (const f of report.floorViolations) {
      console.error(`  ${f.uid}  [${f.bindingClasses.join(", ")}]  ${f.label}`);
    }
  }

  if (report.orphans.length > 0) {
    console.error(`\nOrphan requirements (${report.orphans.length}) — no @req binding (warning):`);
    for (const o of report.orphans) {
      console.error(`  ${o.uid}  ${o.label}`);
    }
  }

  if (report.duplicates.length > 0) {
    console.error(
      `\nDuplicate bindings (${report.duplicates.length}) — uid claimed by >1 test (warning):`,
    );
    for (const d of report.duplicates) {
      console.error(`  ${d.uid}:`);
      for (const o of d.occurrences) console.error(`    ${o.file}:${o.line}`);
    }
  }

  if (report.unknownPriority > 0) {
    console.error(
      `\nSkipped floor check for ${report.unknownPriority} requirement(s) with unparseable priority (fail-open).`,
    );
  }

  if (!report.clean) {
    console.error(
      `\nFAIL: ${report.dangling.length} dangling + ${report.floorViolations.length} floor violation(s).`,
    );
  } else if (gate === "hard" && !report.rampReady) {
    // clean (no dangling/floor) but the P0 checklist is not fully bound — the
    // hard gate blocks on the coverage gap (RFC 0003 §3.7 ramp criterion).
    console.error(
      `\nFAIL (hard gate): ramp not ready — ${report.p0Orphans} P0 requirement(s) unbound` +
        (report.p0Total === 0 ? " (no P0 requirements found)" : "") +
        ".",
    );
  } else {
    console.log(`\nOK: no hard findings (dangling tags + binding-class floor are clean).`);
  }
}

/**
 * Gate mode (RFC 0003 §3.7 soft→hard ramp):
 *  - `soft` (default): exit 1 only on *hard findings* (dangling tags + P0
 *    binding-class floor violations). P0 coverage gaps are warnings. This is
 *    the Phase-1/2 behaviour — the `requirements-trace` CI job swallows the exit
 *    via `continue-on-error`, so it never blocks a merge.
 *  - `hard`: additionally exit 1 when the report is **not ramp-ready** (any
 *    enumerated P0 requirement unbound). This is the Phase-3 gate — at the
 *    M3-closure flip the CI job switches to `--gate hard`, drops
 *    `continue-on-error`, and joins branch-protection required checks.
 */
export type GateMode = "soft" | "hard";

/**
 * True iff the report should cause a non-zero exit under the given gate mode.
 * Exported so the unit tests pin the exact soft/hard exit-code contract that
 * the P3 CI flip depends on.
 */
export function isHardFail(
  report: TraceabilityReport,
  gate: GateMode,
  strict: boolean,
): boolean {
  return (
    !report.clean ||
    (strict && report.orphans.length > 0) ||
    (gate === "hard" && !report.rampReady)
  );
}

export interface RequirementsAuditOptions {
  reqs: string;
  tests?: string;
  output?: OutputFormat;
  /** Also fail (exit 1) on orphan requirements (any priority). */
  strict?: boolean;
  /** Gate mode: `soft` (default) | `hard`. RFC 0003 §3.7. */
  gate?: GateMode;
}

/**
 * RFC 0003 P1/P3 — `exocortex requirements audit --reqs <dir> --tests <dir>`.
 *
 * Soft by default (`--gate soft`); the `requirements-trace` CI job runs it
 * `continue-on-error`, so a red report never blocks a merge in Phases 1–2. The
 * CLI sets a meaningful exit code in every mode so the P3 hard-gate flip is a
 * one-flag CI-config change (`--gate soft` → `--gate hard`, drop
 * `continue-on-error`, add to required checks), not a code change.
 */
export function requirementsAuditCommand(): Command {
  return new Command("audit")
    .description(
      "Audit requirement↔test traceability: orphans, dangling @req tags, duplicate bindings, binding-class floor, coverage, P0 ramp-readiness",
    )
    .requiredOption(
      "--reqs <path>",
      "Directory tree containing req__Requirement assets (a vault or a reqs assetspace clone)",
    )
    .option(
      "--tests <path>",
      "Test-corpus root scanned for @req:<uid> tags",
      ".",
    )
    .option("--output <type>", "Response format: text|json", "text")
    .option("--strict", "Also exit 1 on orphan requirements", false)
    .option(
      "--gate <mode>",
      "Gate mode: soft (warn only on hard findings) | hard (also block when the P0 checklist is not ramp-ready)",
      "soft",
    )
    .action(async (options: RequirementsAuditOptions) => {
      const outputFormat = (options.output ?? "text") as OutputFormat;
      ErrorHandler.setFormat(outputFormat);

      const gate: GateMode = options.gate === "hard" ? "hard" : "soft";

      try {
        const reqsPath = resolve(options.reqs);
        if (!existsSync(reqsPath) || !statSync(reqsPath).isDirectory()) {
          throw new VaultNotFoundError(reqsPath);
        }
        const testsPath = resolve(options.tests ?? ".");
        if (!existsSync(testsPath) || !statSync(testsPath).isDirectory()) {
          throw new VaultNotFoundError(testsPath);
        }

        const [requirements, tags] = await Promise.all([
          loadRequirements(reqsPath),
          scanTestTags(testsPath),
        ]);
        const report = auditTraceability(requirements, tags);

        if (outputFormat === "json") {
          console.log(JSON.stringify({ ...report, gate }, null, 2));
        } else {
          renderText(report, gate);
        }

        if (isHardFail(report, gate, options.strict === true)) {
          process.exitCode = 1;
        }
      } catch (error) {
        ErrorHandler.handle(error as Error);
      }
    });
}
