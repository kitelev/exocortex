import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, resolve } from "path";
import * as glob from "glob";
import { loadMarkdownAssets } from "./assets.js";

/**
 * RFC 0003 (requirements management) P1 — traceability checker.
 *
 * The `requirements-audit` tool is the executable mechanism behind the
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
 *    below-floor binding-classes (`unit` and/or `component` — jsdom, not
 *    real-prod), violating RFC 0003 §3.6 (hard finding: P0 must hit at least one
 *    integration/e2e/gui-bdd/ui-acceptance binding);
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
 *
 * `component` (`.test.tsx` / jsdom) is a distinct tier from `unit`: it is parsed
 * to its own token here (the `?? token` fallback already produced `"component"`;
 * this explicit entry completes + documents the canonical set) and is classified
 * BELOW the real-prod floor — see REAL_PROD_CLASSES (component is intentionally
 * absent there, like `unit`).
 */
const BINDING_CLASS_MAP: Record<string, string> = {
  unit: "unit",
  component: "component",
  integration: "integration",
  e2e: "e2e",
  guibdd: "gui-bdd",
  uiacceptance: "ui-acceptance",
};

/**
 * The manual-acceptance binding class (RFC 0003 §3.6 verification tier): a
 * requirement verified by computer-control evidence (live UI), NOT by a `@req`
 * jest tag. Such requirements are exempt from the orphan / jest-binding check —
 * their verification path is the recorded computer-control evidence, not a tag.
 */
const UI_ACCEPTANCE = "ui-acceptance";

/**
 * GUI-in-CI runner spec path (al-gui-ci-runner — dedup of `eka-gui-e2e`).
 *
 * A `@req:<uid>` tag whose test file lives under `tests/e2e/eka-gui/` is an
 * **automated GUI verification**: it binds the requirement to a scenario of the
 * `eka-gui-e2e` suite, which drives the REAL plugin UI against a fresh vault on
 * native-amd64 CI and asserts real on-disk frontmatter. For the `ui-acceptance`
 * tier this is the *automated* sub-mode: the eka-gui run auto-produces the
 * evidence (screenshot / DOM snapshot / per-`@req` manifest), deduplicating the
 * hand-written committed evidence-attestation. A `@req` tag in any OTHER test
 * (a jsdom unit/component test, a CLI integration test) is NOT a GUI-in-CI run
 * and so does NOT auto-evidence a `ui-acceptance` requirement.
 *
 * Scoped deliberately to `eka-gui` (public repos, always-runs) — NOT its sibling
 * `eka-obsidian-leg` (private repos, PAT-gated, self-skips), which is not a
 * reliable always-on auto-evidence source.
 */
const GUI_RUNNER_SPEC_RE = /(^|[\\/])tests[\\/]e2e[\\/]eka-gui[\\/]/;

/** True iff a scanned test-file path is a GUI-in-CI runner (`eka-gui`) spec. */
export function isGuiRunnerSpec(file: string): boolean {
  return GUI_RUNNER_SPEC_RE.test(file);
}

/**
 * A binding class that exercises production beyond a pure unit test. `ui-acceptance`
 * is included: a manual live-UI acceptance check exercises real production more
 * than a unit test, so it satisfies the P0 binding-class floor.
 *
 * ⛔ `unit` and `component` are intentionally ABSENT — both are below-real-prod
 * (a `component` test runs a UI component under jsdom, NOT against live Obsidian /
 * a real desktop UI), so neither satisfies the P0 floor alone. Do NOT add
 * `component` here: a jsdom binding must not be able to satisfy the real-prod
 * floor (req__RequirementBindingClassComponent, RFC 0003 §3.6).
 */
const REAL_PROD_CLASSES = new Set([
  "integration",
  "e2e",
  "gui-bdd",
  UI_ACCEPTANCE,
]);

/** True iff a requirement is verified manually (computer-control), not via a jest @req tag. */
function isManuallyVerified(r: RequirementRecord): boolean {
  return r.bindingClasses.includes(UI_ACCEPTANCE);
}

/**
 * True iff the requirement declares ≥1 evidence link that RESOLVES to a committed
 * artifact (declared minus missing). The `ui-acceptance` tier's verification
 * binding IS the recorded computer-control evidence (RFC 0003 §3.6); this makes
 * "recorded" mean "committed + linked + present", not "trust the prose".
 */
function hasResolvingEvidence(r: RequirementRecord): boolean {
  return r.evidence.length - r.evidenceMissing.length > 0;
}

export interface RequirementRecord {
  uid: string;
  label: string;
  /** Vault-relative path of the requirement asset. */
  path: string;
  /** `P0`..`P3`, or null when the priority wikilink could not be parsed. */
  priority: string | null;
  /** Canonical binding classes declared on the requirement (may be empty). */
  bindingClasses: string[];
  /**
   * Lifecycle status local-name: `Proposed`|`Approved`|`Active`|`Deprecated`
   * (legacy `Draft` still parses → treated like `Proposed`), or null when
   * unparseable. SDD feature-lifecycle: `proposed → approved → active →
   * deprecated`. `Active` = in-force, CI-hard-gated (see ActiveViolationFinding).
   */
  status: string | null;
  /**
   * Declared `req__Requirement_evidence` paths — links to committed evidence
   * artifacts (screenshot / attestation `.md`) for the `ui-acceptance`
   * verification tier (RFC 0003 §3.6). Each is resolved (in `loadRequirements`)
   * relative to the requirement asset's own directory. Empty when none declared.
   */
  evidence: string[];
  /**
   * Subset of `evidence` whose path did NOT resolve to a committed file inside
   * the reqs tree — the broken-link / not-committed set. Resolved by the IO
   * layer (`loadRequirements`) so `auditTraceability` stays pure. Empty when all
   * declared evidence resolves (or none is declared).
   */
  evidenceMissing: string[];
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

/**
 * An `active` requirement that is not satisfied by a verification binding — the
 * SDD feature-lifecycle invariant violation (Andrey, 2026-06-21): *an active
 * requirement is either satisfied or explicitly withdrawn (Deprecated).*
 *
 * The checker enforces the binding-existence half of the invariant: an `active`
 * requirement MUST carry ≥1 `@req` binding (or be `ui-acceptance` manual). The
 * other half — that the bound test is GREEN — is enforced by the test suite
 * itself (the bound test runs in CI; if the behavior breaks, that test goes
 * red). Together: an active requirement whose behavior is broken turns CI red,
 * unless it is explicitly moved to `Deprecated`. This is an ALWAYS-ON hard
 * finding (independent of the soft→hard P0 ramp): it is vacuous while zero
 * requirements are `active`, and arms per-requirement the moment one is flipped
 * to `active`.
 */
export interface ActiveViolationFinding {
  uid: string;
  label: string;
  path: string;
  /** Why the active requirement is unsatisfied (e.g. "no @req binding"). */
  reason: string;
}

/**
 * A requirement that declares `req__Requirement_evidence` whose path(s) do not
 * resolve to a committed file inside the reqs tree (RFC 0003 §3.6
 * evidence-attestation). Exactly symmetric with a dangling `@req` tag: a
 * typo / deleted / not-committed evidence artifact. HARD finding (folds into
 * `clean`) — opt-in (only bites a requirement that *declares* an evidence link).
 */
export interface DanglingEvidenceFinding {
  uid: string;
  label: string;
  path: string;
  /** The declared evidence path(s) that did not resolve to a committed file. */
  missing: string[];
}

export interface TraceabilityReport {
  requirementCount: number;
  tagCount: number;
  /** Requirements with ≥1 jest `@req` binding. */
  bound: number;
  /**
   * Requirements verified manually via computer-control (binding class
   * `ui-acceptance`, no jest tag expected) — RFC 0003 §3.6 verification tier.
   */
  manuallyVerified: number;
  /** (bound + manuallyVerified) / requirementCount, 0..1 (1 when none). */
  coverage: number;
  orphans: OrphanFinding[];
  dangling: TagOccurrence[];
  duplicates: DuplicateFinding[];
  floorViolations: FloorViolationFinding[];
  /**
   * Requirements declaring a `req__Requirement_evidence` link that does not
   * resolve to a committed file (RFC 0003 §3.6) — HARD, folds into `clean`,
   * symmetric with dangling `@req` tags.
   */
  danglingEvidence: DanglingEvidenceFinding[];
  /** Total `ui-acceptance`-bound requirements (the evidence-attestation tier). */
  uiAcceptanceTotal: number;
  /** `ui-acceptance` requirements with ≥1 resolving committed evidence link. */
  uiAcceptanceEvidenced: number;
  /**
   * `ui-acceptance` requirements verified by the AUTOMATED sub-mode — a `@req`
   * binding in a GUI-in-CI runner (`eka-gui`) spec (al-gui-ci-runner dedup).
   * The eka-gui run auto-produces the evidence; no committed attestation needed.
   */
  uiAcceptanceAutomated: number;
  /**
   * `ui-acceptance` requirements verified by the MANUAL sub-mode — a resolving
   * committed evidence-attestation (computer-control), WITHOUT a GUI-runner
   * `@req` binding. The genuinely-not-automatable tier (RFC 0003 §3.6).
   */
  uiAcceptanceManual: number;
  /**
   * `ui-acceptance` requirements with NO resolving evidence — evidence-coverage
   * gap (reported for visibility; HARD only for the `active` subset, via
   * `activeViolations`, RFC 0003 §3.6 + the always-on active-requirement gate).
   */
  uiAcceptanceMissingEvidence: number;
  /** Requirements whose priority could not be parsed (floor check skipped). */
  unknownPriority: number;
  /**
   * True iff there are no hard findings (no dangling tags, no floor violations,
   * no active-requirement invariant violations, no dangling evidence links).
   */
  clean: boolean;
  /** Total `active`-status requirements (the always-on hard-gated set). */
  activeTotal: number;
  /**
   * `active` requirements with no verification binding — the SDD-lifecycle
   * invariant violation (always a hard finding, any gate mode). Empty (vacuous)
   * until the first requirement is flipped to `active`.
   */
  activeViolations: ActiveViolationFinding[];
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

/**
 * Parse the lifecycle status local-name: `Proposed`/`Approved`/`Active`/
 * `Deprecated` (legacy `Draft` → treated like `Proposed`). Original case is
 * preserved; consumers comparing to `Active` normalize case (see auditTraceability).
 */
export function parseStatus(value: unknown): string | null {
  const raw = asStringArray(value)[0];
  if (!raw) return null;
  const m = raw.match(/RequirementStatus([A-Za-z]+)/);
  return m ? m[1] : null;
}

/**
 * Parse `req__Requirement_evidence` values (scalar or list) into committed
 * evidence-artifact paths (RFC 0003 §3.6 evidence-attestation). Each path is a
 * repo-relative reference to a committed screenshot / attestation `.md`, resolved
 * (in `loadRequirements`) relative to the requirement asset's own directory.
 * Blank entries are dropped; returns [] when none parse.
 */
export function parseEvidence(value: unknown): string[] {
  return asStringArray(value)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
  const assets = await loadMarkdownAssets(reqsPath);
  const requirements: RequirementRecord[] = [];
  // Resolve evidence paths against the committed reqs tree. An evidence path
  // counts as resolving ONLY when it points to an existing file INSIDE the reqs
  // root (a committed artifact) — a path escaping the tree (`../…`) or a missing
  // file is "missing" (→ danglingEvidence). `resolve` collapses `..`, so the
  // containment check is a prefix test against the absolute reqs root.
  const reqsRootAbs = resolve(reqsPath);
  const reqsRootPrefix = reqsRootAbs.endsWith("/")
    ? reqsRootAbs
    : `${reqsRootAbs}/`;

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

    const evidence = parseEvidence(metadata["req__Requirement_evidence"]);
    const reqDirAbs = dirname(resolve(reqsPath, relPath));
    const evidenceMissing = evidence.filter((rel) => {
      const abs = resolve(reqDirAbs, rel);
      // Must be a committed regular FILE inside the reqs tree (not an escape,
      // not a directory). `existsSync` alone is true for a directory / `.` — a
      // dir-as-evidence would satisfy the gate with no real artifact, exactly
      // the "trust me" loophole this feature closes. `existsSync` first so
      // `statSync` never throws on a broken path.
      return !(
        abs.startsWith(reqsRootPrefix) &&
        existsSync(abs) &&
        statSync(abs).isFile()
      );
    });

    requirements.push({
      uid,
      label,
      path: relPath,
      priority: parsePriority(metadata["req__Requirement_priority"]),
      bindingClasses: parseBindingClasses(
        metadata["req__Requirement_bindingClass"],
      ),
      status: parseStatus(metadata["req__Requirement_status"]),
      evidence,
      evidenceMissing,
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
    const content = await readFile(file, "utf-8");
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

  // True iff the requirement is bound by a `@req` tag living in a GUI-in-CI
  // runner (`eka-gui`) spec — the AUTOMATED ui-acceptance sub-mode
  // (al-gui-ci-runner dedup). The eka-gui run is the auto-evidence.
  const hasGuiRunnerBinding = (r: RequirementRecord): boolean =>
    (occByUid.get(r.uid.toLowerCase()) ?? []).some((o) =>
      isGuiRunnerSpec(o.file),
    );

  const orphans: OrphanFinding[] = [];
  let bound = 0;
  let manuallyVerified = 0;
  for (const r of requirements) {
    if (occByUid.has(r.uid.toLowerCase())) {
      bound++;
    } else if (isManuallyVerified(r)) {
      // ui-acceptance: verified by computer-control evidence, no jest tag
      // expected → covered, NOT an orphan (RFC 0003 §3.6 verification tier).
      manuallyVerified++;
    } else {
      orphans.push({ uid: r.uid, label: r.label, path: r.path });
    }
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
    // A P0 req is covered by a jest binding OR by manual ui-acceptance evidence.
    if (occByUid.has(r.uid.toLowerCase()) || isManuallyVerified(r)) p0Bound++;
  }
  const p0Orphans = p0Total - p0Bound;

  // Active-requirement invariant (SDD feature-lifecycle, Andrey 2026-06-21): an
  // `active` requirement MUST carry a verification binding (a `@req` jest tag OR
  // ui-acceptance manual evidence). An unbound active requirement is an
  // always-on hard finding — vacuous while zero requirements are `active`.
  const activeViolations: ActiveViolationFinding[] = [];
  let activeTotal = 0;
  for (const r of requirements) {
    // Case-insensitive so a non-canonically-cased status (e.g. a hand-authored
    // `...Statusactive`) cannot silently escape this always-on safety gate.
    if (r.status?.toLowerCase() !== "active") continue;
    activeTotal++;
    const isBound = occByUid.has(r.uid.toLowerCase());
    if (isManuallyVerified(r)) {
      // ui-acceptance tier — TWO satisfaction sub-modes (al-gui-ci-runner dedup,
      // RFC 0003 §3.6). The verification of a `ui-acceptance` (live-UI) req is a
      // REAL UI run, not "any @req tag":
      //   • AUTOMATED — a `@req` binding in a GUI-in-CI runner (`eka-gui`) spec.
      //     The eka-gui run (real plugin UI, native-amd64 CI) auto-produces the
      //     evidence; no committed attestation needed (the dedup — ONE engine).
      //   • MANUAL — a resolving committed evidence-attestation (computer-control)
      //     for the genuinely-not-automatable case.
      // A `@req` tag in a NON-GUI test (jsdom unit/component, CLI integration) is
      // NOT a live-UI verification, so it does NOT auto-evidence a ui-acceptance
      // req — closing the `if (isBound)` hole where a unit-test tag faked an
      // acceptance. This binds the WHOLE req: a combination-classed req (e.g.
      // [ui-acceptance, integration]) is governed by these two sub-modes, NOT by
      // its other class's plain `@req` tag — a non-GUI tag alone never satisfies a
      // req that carries `ui-acceptance` (the live-UI tier wins). Proposed/Draft
      // ui-acceptance reqs are NOT gated (migration-friendly) — only `active`.
      if (hasGuiRunnerBinding(r) || hasResolvingEvidence(r)) continue;
      activeViolations.push({
        uid: r.uid,
        label: r.label,
        path: r.path,
        reason:
          "active ui-acceptance requirement is not verified — bind it to an eka-gui GUI-in-CI scenario (@req in tests/e2e/eka-gui/, automated evidence) OR commit + link a req__Requirement_evidence attestation (manual), OR move it to Deprecated. A @req tag in a non-GUI test does not auto-evidence a live-UI acceptance.",
      });
      continue;
    }
    // Non-ui-acceptance reqs: any `@req` jest binding satisfies (unchanged —
    // "jest tag takes precedence" count semantics).
    if (isBound) continue;
    activeViolations.push({
      uid: r.uid,
      label: r.label,
      path: r.path,
      reason:
        "active requirement has no @req binding (and is not ui-acceptance) — fix the binding or move it to Deprecated",
    });
  }

  // Evidence-attestation findings (RFC 0003 §3.6 — al-night-uiaccept). A
  // declared evidence link that doesn't resolve to a committed file is HARD
  // (symmetric with dangling @req tags); ui-acceptance evidence coverage is
  // reported for visibility (HARD only for the active subset, above).
  const danglingEvidence: DanglingEvidenceFinding[] = [];
  let uiAcceptanceTotal = 0;
  let uiAcceptanceEvidenced = 0;
  // al-gui-ci-runner dedup: split the ui-acceptance tier into the AUTOMATED
  // sub-mode (verified by a GUI-in-CI runner `@req` binding — the eka-gui run is
  // the auto-evidence) vs the MANUAL sub-mode (committed attestation only, no
  // GUI-runner binding). A req with BOTH counts as automated (the stronger,
  // reproducible verification).
  let uiAcceptanceAutomated = 0;
  let uiAcceptanceManual = 0;
  for (const r of requirements) {
    if (r.evidenceMissing.length > 0) {
      danglingEvidence.push({
        uid: r.uid,
        label: r.label,
        path: r.path,
        missing: r.evidenceMissing,
      });
    }
    if (isManuallyVerified(r)) {
      uiAcceptanceTotal++;
      if (hasResolvingEvidence(r)) uiAcceptanceEvidenced++;
      if (hasGuiRunnerBinding(r)) uiAcceptanceAutomated++;
      else if (hasResolvingEvidence(r)) uiAcceptanceManual++;
    }
  }
  const uiAcceptanceMissingEvidence = uiAcceptanceTotal - uiAcceptanceEvidenced;

  const requirementCount = requirements.length;
  // Coverage = fraction of requirements with a declared verification path
  // (a jest `@req` binding OR manual ui-acceptance). Backward-compatible when
  // there are no ui-acceptance reqs (manuallyVerified === 0).
  const coverage =
    requirementCount === 0 ? 1 : (bound + manuallyVerified) / requirementCount;
  const clean =
    dangling.length === 0 &&
    floorViolations.length === 0 &&
    activeViolations.length === 0 &&
    danglingEvidence.length === 0;

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
    manuallyVerified,
    coverage,
    orphans,
    dangling,
    duplicates,
    floorViolations,
    danglingEvidence,
    uiAcceptanceTotal,
    uiAcceptanceEvidenced,
    uiAcceptanceAutomated,
    uiAcceptanceManual,
    uiAcceptanceMissingEvidence,
    unknownPriority,
    clean,
    activeTotal,
    activeViolations,
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
      `ui-acceptance: ${report.manuallyVerified} | ` +
      `coverage: ${formatPercent(report.coverage)} | tags: ${report.tagCount}`,
  );
  console.log(
    `P0 checklist: ${report.p0Bound}/${report.p0Total} bound | ` +
      `ramp-ready: ${report.rampReady ? "yes" : "no"} | gate: ${gate}`,
  );
  console.log(
    `Active requirements: ${report.activeTotal} | ` +
      `invariant violations: ${report.activeViolations.length}`,
  );
  console.log(
    `ui-acceptance: ${report.uiAcceptanceTotal} | ` +
      `automated (eka-gui runner): ${report.uiAcceptanceAutomated} | ` +
      `manual (committed evidence): ${report.uiAcceptanceManual} | ` +
      `missing evidence: ${report.uiAcceptanceMissingEvidence}`,
  );

  if (report.activeViolations.length > 0) {
    console.error(
      `\nActive-requirement invariant violations (${report.activeViolations.length}) — ` +
        `an active requirement has no verification binding (HARD, always blocks):`,
    );
    for (const a of report.activeViolations) {
      console.error(`  ${a.uid}  ${a.label}\n    → ${a.reason}`);
    }
  }

  if (report.dangling.length > 0) {
    console.error(`\nDangling @req tags (${report.dangling.length}) — uid has no requirement:`);
    for (const d of report.dangling) {
      console.error(`  @req:${d.uid}  ${d.file}:${d.line}`);
    }
  }

  if (report.floorViolations.length > 0) {
    console.error(
      `\nBinding-class floor violations (${report.floorViolations.length}) — P0 bound solely to below-floor classes (unit/component):`,
    );
    for (const f of report.floorViolations) {
      console.error(`  ${f.uid}  [${f.bindingClasses.join(", ")}]  ${f.label}`);
    }
  }

  if (report.danglingEvidence.length > 0) {
    console.error(
      `\nDangling evidence links (${report.danglingEvidence.length}) — req__Requirement_evidence path does not resolve to a committed file (HARD):`,
    );
    for (const e of report.danglingEvidence) {
      console.error(`  ${e.uid}  [${e.missing.join(", ")}]  ${e.label}`);
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
      `\nFAIL: ${report.dangling.length} dangling + ${report.floorViolations.length} floor violation(s)` +
        ` + ${report.activeViolations.length} active-requirement invariant violation(s)` +
        ` + ${report.danglingEvidence.length} dangling evidence link(s).`,
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
 *    binding-class floor violations + active-requirement invariant violations).
 *    P0 coverage gaps are warnings. The dangling/floor part is swallowed by the
 *    `requirements-trace` CI job's `continue-on-error` (Phase-1/2); the
 *    **active-requirement invariant** is enforced by a SEPARATE blocking CI
 *    step (no `continue-on-error`) so an unbound `active` requirement blocks a
 *    merge in any phase (always-on, vacuous at zero active reqs).
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

/** Report format: human-readable text or machine-readable JSON. */
export type OutputFormat = "text" | "json";

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
 * RFC 0003 P1/P3 — the audit run (IO + report + exit-code contract), shared by
 * the `bin.ts` entrypoint and the tests.
 *
 * Soft by default (`--gate soft`); the `requirements-trace` CI job runs it
 * `continue-on-error`, so a red report never blocks a merge in Phases 1–2. The
 * tool sets a meaningful exit code in every mode so the P3 hard-gate flip is a
 * one-flag CI-config change (`--gate soft` → `--gate hard`, drop
 * `continue-on-error`, add to required checks), not a code change.
 *
 * @returns the process exit code (0 = no hard findings, 1 = hard fail).
 */
export async function runAudit(
  options: RequirementsAuditOptions,
): Promise<number> {
  const outputFormat = (options.output ?? "text") as OutputFormat;
  const gate: GateMode = options.gate === "hard" ? "hard" : "soft";

  const reqsPath = resolve(options.reqs);
  if (!existsSync(reqsPath) || !statSync(reqsPath).isDirectory()) {
    throw new Error(`Vault not found: ${reqsPath}`);
  }
  const testsPath = resolve(options.tests ?? ".");
  if (!existsSync(testsPath) || !statSync(testsPath).isDirectory()) {
    throw new Error(`Vault not found: ${testsPath}`);
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

  return isHardFail(report, gate, options.strict === true) ? 1 : 0;
}
