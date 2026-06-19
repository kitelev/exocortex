# RFC 0003 — Requirements management (Spec-Driven Development for Exocortex)

| | |
| --- | --- |
| **Status** | Proposed |
| **Author** | Requirements-management research (al-reqmgmt child, AI) + Andrey interview, 2026-06-19 |
| **Scope** | Cross-cutting process + a small vault ontology (`req`). Defines *where business requirements live, in what format, how they trace to tests/code, and how CI enforces that every change updates them*. Not an implementation — implementation is tracked as a vault subproject (§8). |
| **Supersedes** | — |
| **Tracking** | "Exocortex requirements-management system" `ems__Project`, child of Alpha Launch `[[f33732f4-410e-424a-91e2-9e894f68e2de]]` |

> **Why in-repo:** this RFC proposes both a vault ontology (`req__Requirement`)
> *and* repo-side enforcement (CI gate, archgate rule, Pages publication). It is
> versioned next to the CI/Pages machinery it changes, following RFC 0001/0002
> precedent for repo-touching proposals. The `req` ontology *assets* are created
> during implementation (not by this docs-only RFC).

> **Grounding:** every decision below is traceable to (a) the 2026 community/official
> consensus on Spec-Driven Development and (b) Andrey's interview (2026-06-19,
> recorded in §9). Reality claims about the current codebase are grounded against
> `origin/main` (commit `1ada25cb`).

---

## 1. Context & problem

Andrey's vision (verbatim, 2026-06-19): **(1)** all business requirements to
Exocortex are described in a BDD-style executable format; **(2)** all *existing*
requirements are migrated into that base; **(3)** every codebase change
updates/enriches the requirements base — likely via CI/archgate gating. Target
(not a current blocker): browse the requirements as a published site on **GitHub
Pages**. Core: *everything works, and all changes flow through one requirements
process.*

### What exists today (credited — reuse the lessons, not the cruft)

| Artifact | Role | Status |
| --- | --- | --- |
| `uj__UserJourney` (ns `uj`) | Vault BDD combo-format: **Job Story** frontmatter + **Gherkin** body + **acceptance gates** (`maxClicks`, `priority`, `baseline`). Run via `/user-journey` + computer-control. | Exists in **starter-kit only**, **manual**, **Andrey never used it** — to be superseded. The *format insight* is proven and reused; the class is not carried forward. |
| `eka-gui-e2e` workflow | Formalizes prose Gherkin scenarios as repeatable Playwright e2e against a fresh ephemeral vault on native-amd64 CI. | Active release-gate. Real-prod execution — a valid binding target for `_verifiedBy`. |
| Playwright e2e `.spec.ts` (~28), Jest unit/component/integration (~600 files) | Where behavior is *actually* specified today — but as code, not readable requirements. | Active. Requirements are **implicit and scattered** here + in ADRs + RFCs. |
| `.archgate/` ADRs (`.md` + `.rules.ts`) | Architecture Decision Records as machine-enforced rules. `archgate` is a required CI check. | Active enforcement substrate — the natural home for a requirements-coverage rule. |
| `parity-gate` | CLI↔plugin behavioral parity (replaced retired `test-bdd`). | Required CI check. |

### ⛔ The decisive lesson (the failure mode this RFC must not repeat)

Exocortex **already tried** Cucumber/Gherkin and removed it **twice**:

- #3401 — *"delete plugin-BDD harness-theater: 204 self-asserting scenarios that
  imported only `@cucumber/cucumber` and asserted self-set world state (no
  production renderer / CommandManager / DOM invoked → zero prod exercised)"*.
- #3433 removed the vestigial CLI BDD infrastructure; #3545 deleted the cucumber
  deps entirely.

The failure was **not** Given/When/Then as a format — it was the **parallel
step-definition runner** that re-implemented assertions against mock world state
and never touched production. This is the "harness-theater" anti-pattern
(cf. internal rules `test-fixture-realism`, `integration-test-revert-verify`).
**This RFC reuses the format and forbids a parallel runner.**

### Why now / why it matters

- Exocortex is **AI-driven** (Claude Code child sessions implement most changes).
  The 2026 consensus is that a written spec — not chat history — must be the
  single source of truth for coding agents, because LLMs are good at "pattern
  completion, but not at mind reading" ([GitHub Spec Kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)).
- Today there is **no single, queryable, browsable statement of what Exocortex
  must do**. Behavior is reverse-engineerable only by reading ~600 test files.
  Regressions and scope-drift (Fowler's documented SDD failure mode: AI
  "generates features not requested, claims success when builds failed") are
  caught late.

## 2. Goals

1. A **single source of truth** for business requirements: first-class, queryable,
   browsable, and bound to verification.
2. Requirements in a **readable, executable-by-reference** format (BDD/EARS) that
   both humans and AI agents consume.
3. **Traceability**: requirement ↔ test ↔ code ↔ commit, queryable.
4. **Every codebase change flows through the requirements base** — enforced
   deterministically (soft→hard ramp), not advisory.
5. **No new test runner** — requirements bind to the *existing* real tests; the
   harness-theater path is structurally impossible.
6. (Target, non-blocking) Requirements **published to GitHub Pages** as Living
   Documentation.

## 3. Proposed solution

### 3.1 Paradigm — Spec-Driven Development, spec = single source of truth

Adopt **Spec-Driven Development (SDD)**, the 2026 default for AI coding
([GitHub Spec Kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/);
[Anthropic best-practices](https://code.claude.com/docs/en/best-practices); Thoughtworks/Fowler).
Exocortex already performs most of the SDD loop informally — RFCs are
*Specify+Plan*, PMBOK WBS / `ems__Task` are *Tasks*, child sessions are
*Implement*, `.archgate` ADRs are the *Constitution*. The **missing layer** is a
persistent, enforced **requirements base** that the loop reads from and writes
back to. This RFC adds exactly that layer; it does **not** replace RFCs, PMBOK,
or ADRs — it complements them (a `req__Requirement` is the durable, test-bound
distillation of a behavior; an RFC is the change proposal that introduces it).

### 3.2 Storage — vault RDF canon + generated GitHub Pages

**Requirements are first-class vault RDF assets** (`req__Requirement`), the
canonical single source of truth. This satisfies the **Homoiconicity Invariant**
(user-configurable semantics live in the RDF graph, not hardcoded) and makes
traceability **SPARQL-queryable** natively — RDF is purpose-built for
machine-readable requirements + traceability
([ontology-based requirements traceability](https://www.researchgate.net/publication/332311255_An_Ontology-based_Approach_to_Support_for_Requirements_Traceability_in_Agile_Development)).

A CI job **generates a static GitHub Pages site** from the requirement graph
(Living Documentation — [Specification by Example, Adzic](https://gojko.net/2020/03/17/sbe-10-years.html):
"a single document represents both a specification and a test"). The graph is
canon; Pages is a derived read-surface. (Rejected: `.feature`/markdown spec files
in-repo as canon — see §5.)

### 3.3 Ontology (`req` namespace) — to be created in implementation

Minimal first cut (final shapes refined in the implementation subproject; this is
the design intent, not the asset):

`req__Requirement` (`exo__Class`, superclass `exo__Asset`):

| Property | Card. | Range / values | Purpose |
| --- | --- | --- | --- |
| `req__Requirement_kind` | 1 | `behavioral` \| `invariant` \| `journey` | Selects format (Gherkin / EARS / combo) |
| `req__Requirement_statement` (body) | 1 | Given/When/Then **or** EARS text in the asset body | The spec itself (human + AI readable) |
| `req__Requirement_covers` | 1..N | wikilink → command / feature / area | What behavior this is *about* |
| `req__Requirement_verifiedBy` | 0..N | stable test-ID(s) | Links to the **existing real test(s)** that exercise it |
| `req__Requirement_implementedBy` | 0..N | wikilink → command / PR# / code ref | Implementation pointer |
| `req__Requirement_status` | 1 | `Draft` \| `Approved` \| `Verified` \| `Deprecated` (enum assets) | Lifecycle |
| `req__Requirement_priority` | 1 | `P0`..`P3` (enum) | Migration & gate ordering |
| `req__Requirement_area` | 0..1 | wikilink → `ems__Area` | Grouping (Alpha-critical, etc.) |
| `req__Requirement_author` | 1 | wikilink → person/ExoAssistant | Provenance (AI draft vs user) |

UID-canon filenames, UWI (child→parent), co-located with the `req` ontology per
CR-1. `Verified` = status derived/asserted when ≥1 `_verifiedBy` test exists and
passes (the traceability checker, §3.6, maintains this).

### 3.4 Format — Gherkin + EARS + Job Story

- **Behavioral** requirements: **Gherkin Given/When/Then** in the asset body
  (the format Andrey's own example uses; proven via `uj`). Example (Andrey's):
  > Given asset A has a wikilink to a non-existent asset B (alias "Daily") in an
  > unmaterialized assetspace, and the link renders as a bare uid · When I
  > materialize the missing assetspace · Then the link renders as "Daily".
- **Invariant** requirements: **EARS** — "WHEN ⟨event⟩ THE SYSTEM SHALL
  ⟨behavior⟩" ([AWS Kiro / Rolls-Royce EARS](https://kiro.dev/docs/specs/feature-specs/)).
  Compact, machine-readable, ideal for the dozens of "the system shall…"
  invariants Exocortex already encodes as archgate ADRs.
- **User-value framing**: an optional **Job Story** ("When ⟨situation⟩, I want
  ⟨motivation⟩, so ⟨outcome⟩") header for user-facing requirements (reused from
  `uj`).

### 3.5 Granularity & authorship

- **One `req__Requirement` = one verifiable behavior**, linked via `_covers` to a
  command / feature / invariant + (optionally) an area. Not per-file, not
  per-epic.
- **Authorship: both.** AI drafts requirements as part of RFC/child work; Andrey
  reviews/approves (`_status: Draft → Approved`). Mirrors Anthropic's
  interview→SPEC.md→execute loop and keeps a human in the loop (Fowler caveat).

### 3.6 Executable — bind to existing tests, NO new runner

⛔ **No Cucumber, no parallel step-definition runner.** Each requirement's
`_verifiedBy` points at one or more **already-existing real tests** (Jest unit /
integration, Playwright `.spec.ts`, `eka-gui` GUI-BDD) via a **stable
requirement-ID tag** placed in the test (e.g. `// @req <req-uid>` near the
`it(...)`, or a `@req:<uid>` token in the test title). "Executable" therefore
means: *this requirement has ≥1 passing test that exercises real production code*
— exactly Anthropic's "give Claude a check it can run; if you can't verify it,
don't ship it."

A **traceability checker** (CLI command, e.g. `exocortex-cli requirements
audit`) is the executable mechanism. It:
1. Loads `req__Requirement` assets from the graph.
2. Greps the test corpus for `@req:<uid>` tags.
3. Reports **orphan requirements** (no verifying test), **dangling tags** (tag →
   missing requirement), and (best-effort) **untraced behaviors** (commands/
   features with no covering requirement).
4. Emits a machine-readable report consumed by CI and the Pages generator.

This structurally **cannot** become harness-theater: there is no second
assertion layer; the only tests that exist are the real ones already in CI.

### 3.7 Enforcement — soft→hard ramp (deterministic, not advisory)

Anthropic: *hooks/CI gates are deterministic guarantees; CLAUDE.md is advisory.*
Therefore enforcement is a real gate, ramped to avoid the chicken-egg deadlock of
gating against an empty base (`pr-auto-merge-chicken-egg` rule; Fowler "don't
block before the base is populated"):

- **Phase 1 (soft):** new CI job `requirements-trace` runs the checker
  **non-blocking** — posts the report (orphans, dangling, coverage %) as a PR
  comment / summary. An `archgate` advisory rule flags PRs that change behavior
  code (`packages/*/src/**` commands/services) without adding/updating a
  `req__Requirement`.
- **Phase 2 (hard, after Alpha-critical migration):** `requirements-trace`
  becomes **required** — a behavior-changing PR with no req add/update, or a new
  requirement with no `_verifiedBy`, fails CI. Optional PreToolUse/Stop hook for
  local fast-feedback.

### 3.8 Migration — incremental, Alpha-critical first

Back-fill existing implicit requirements **incrementally**, **Alpha-critical
behaviors first** (commands, profile mount/apply, sync, create-instance), then
expand by area. Source material: existing tests, `.archgate` ADRs, RFCs, the
`eka-gui` scenarios. Each migrated requirement is bound (`_verifiedBy`) to the
test(s) it was distilled from. (Rejected: big-bang — see §5.) This achieves
Andrey's "all current requirements" goal over time while shipping value
immediately and keeping the Phase-2 hard-gate honest.

## 4. Traceability model (RDF edges)

```
req__Requirement --_covers-->        command / feature / ems__Area
req__Requirement --_verifiedBy-->    test-ID (in Jest/Playwright/eka-gui)
req__Requirement --_implementedBy--> command / PR# / code ref
test  --@req:<uid> tag-->            req__Requirement      (the back-edge in code)
commit/PR --(conventional body)-->   req-uid               (audit trail)
```

SPARQL answers, e.g.: *which Alpha-critical requirements have no passing test?*,
*which commands have zero covering requirements?*, *what requirements does PR #N
touch?* — all queryable because the canon is RDF.

## 5. Alternatives considered (rejected)

| Alternative | Why rejected |
| --- | --- |
| **Cucumber/Gherkin step-def runner** (re-introduce `@cucumber/cucumber`) | **Proven failure here** (#3401: 204 self-asserting scenarios, zero prod exercised). Recreates harness-theater + double-implementation maintenance. Format kept; runner forbidden. |
| **`.feature`/markdown spec files in-repo as canon** (pure GitHub Spec Kit) | Duplicates what the vault graph already provides; requirements would be non-SPARQL-queryable and disconnected from the homoiconic model. Pages is still served — but generated *from* the graph, not authored in-repo. |
| **ReqIF** | XML interchange standard, heavyweight, non-RDF, non-executable. Overkill; no interop need. |
| **Big-bang migration** of all ~600 tests before enforcement | Disproportionate effort, delays value, burnout risk, and gating an empty/partial base deadlocks (chicken-egg). Incremental chosen. |
| **Amazon Working-Backwards / PR-FAQ only** | Narrative, not executable, wrong granularity. Useful at *project/vision* level (RFC Context) but not as the requirement substrate. |
| **Keep/extend `uj__UserJourney` as-is** | Unused by Andrey, starter-kit-scoped, manual computer-control execution (not CI-cheap), not all-requirements. Format insight reused under a fresh, CI-bound `req` class. |
| **Soft-only enforcement** (warn forever) | Fails Andrey's core "every change flows through one process"; advisory ≠ guaranteed (Anthropic). Hard-gate is the Phase-2 target. |

## 6. Phasing

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **P0 — Format & ontology** | `req` ontology (class + properties + enums), authoring guidance, 3–5 seed requirements incl. Andrey's link-label example, each `_verifiedBy` a real test. | — |
| **P1 — Traceability checker** | `exocortex-cli requirements audit` (orphans/dangling/coverage) + `@req:<uid>` test-tag convention + `requirements-trace` CI job **(soft)** + archgate advisory rule. | soft CI |
| **P2 — Migrate Alpha-critical** | Distill Alpha-critical behaviors into `req__Requirement` assets, bound to existing tests. Coverage threshold for the Alpha-critical area. | soft→ |
| **P3 — Hard-gate** | Flip `requirements-trace` to **required**; behavior-PR-without-req fails CI; new-req-without-`_verifiedBy` fails. | **hard CI** |
| **P4 — Living Documentation (GitHub Pages)** | Generator: graph → static site (requirements, scenarios, coverage, traceability matrix), published on Pages. | — |
| **P5 — Expand** | Migrate remaining areas incrementally; raise coverage thresholds. | hard CI |

## 7. Success metrics

- **Coverage:** % of `req__Requirement` with ≥1 passing `_verifiedBy` test
  (target P3: 100% for Alpha-critical area; mechanically computed by the checker).
- **Orphan behaviors:** # of commands/features with zero covering requirement
  (trend → 0 for migrated areas).
- **Process adherence:** % of behavior-changing PRs that add/update a
  `req__Requirement` (Phase 2: 100%, enforced).
- **Drift caught:** regressions/scope-creep caught by `requirements-trace` before
  merge (qualitative, logged).
- **Browsability:** Pages site live and current (P4).

## 8. Definition of Done (this RFC's scope = design only)

- [ ] RFC merged (docs-only, CI green).
- [ ] Implementation tracked as a vault `ems__Project` subproject under Alpha
      Launch with leaf `ems__Task`s for P0–P4 (created by this work; **no
      implementation started**).

(Implementation DoD lives in the subproject tasks, not here.)

## 9. Interview record (Andrey, 2026-06-19)

1. **Storage** → delegated to recommendation → **vault RDF canon + GitHub Pages
   export**. ("Можно вообще отказаться от `uj__UserJourney`… главное чтобы все
   изменения проходили через единый процесс… хочу читать требования через GitHub
   Pages, но это не блокер.")
2. **Enforcement** → **soft→hard ramp**.
3. **Migration** → **incremental, Alpha-critical first → expand**.
4–9. Format (Gherkin+EARS+Job Story), per-behavior granularity, RDF traceability,
   bind-to-existing-tests (no Cucumber), AI-drafts/user-approves authorship,
   MVP→target phasing — **confirmed** ("Да, пиши RFC v1").

## 10. Open questions / risks

- **`@req:<uid>` tag convention** vs a separate manifest — settle in P1 (tag in
  test is lowest-friction, survives refactors if grep-based).
- **Untraced-behavior detection** is best-effort (needs a command/feature
  registry to enumerate against) — P1 may ship orphan-requirement + dangling-tag
  only, defer untraced-behavior to P3.
- **Chicken-egg on hard-gate** — mitigated by the ramp + per-area coverage
  thresholds (`pr-auto-merge-chicken-egg` rule).
- **Pages from a private vault** — the generator must export only shareable
  (public-AS) requirements, or run from a sanitized projection (P4 design).

## Sources

- [GitHub Spec Kit — official blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/) · [repo](https://github.com/github/spec-kit)
- [Anthropic — Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [AWS Kiro — feature specs / EARS](https://kiro.dev/docs/specs/feature-specs/)
- [Gojko Adzic — Specification by Example, 10 years later](https://gojko.net/2020/03/17/sbe-10-years.html)
- [Ontology-based requirements traceability](https://www.researchgate.net/publication/332311255_An_Ontology-based_Approach_to_Support_for_Requirements_Traceability_in_Agile_Development)
- Repo grounding: `origin/main` #3401/#3433/#3545 (Cucumber removal), `uj__UserJourney` (starter-kit), `eka-gui-e2e` workflow, `.archgate` ADRs.
