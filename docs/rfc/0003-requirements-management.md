# RFC 0003 — Requirements management (Spec-Driven Development for Exocortex)

| | |
| --- | --- |
| **Status** | Proposed |
| **Author** | Requirements-management research (al-reqmgmt child, AI) + Andrey interview, 2026-06-19/20 |
| **Scope** | Cross-cutting process + a small vault ontology (`req`). Defines *where business requirements live, in what format, how they trace to tests/code, and how CI enforces that every change updates them*. Not an implementation — implementation is tracked as a vault subproject (§8). |
| **Supersedes** | — |
| **Tracking** | "Exocortex requirements-management system" `ems__Project`, child of Alpha Launch `[[f33732f4-410e-424a-91e2-9e894f68e2de]]` |

> **Why in-repo:** this RFC proposes both a vault ontology (`req__Requirement`)
> *and* repo-side enforcement (CI gate, archgate rule, Pages publication). It is
> versioned next to the CI/Pages machinery it changes, following RFC 0001/0002
> precedent for repo-touching proposals. The `req` ontology *assets* are created
> during implementation (not by this docs-only RFC).

> **Grounding:** every decision is traceable to (a) the 2026 community/official
> consensus on Spec-Driven Development and (b) Andrey's interview (§9). Reality
> claims are grounded against `origin/main` (`1ada25cb`, verified current).

> **Revision 2 (2026-06-20):** rewritten after a 3-lens adversarial panel
> (requirements-engineering rigor · engineering-feasibility/source-accuracy ·
> failure-mode skeptic) + an interview-per-finding pass with Andrey. The panel's
> two CRITICAL findings drove the biggest changes: (1) **a `@req` tag proves
> *association*, not *exercise*** — green+tagged ≠ behavior tested — so v2 adds a
> **revert-verify binding gate + binding-class** (§3.6); (2) **AI authoring the
> requirement, the test, and the tag is a self-consistent-but-wrong loop** — so
> the `Draft→Verified` transition now requires falsifiable revert-verify
> evidence, decoupling authorship from verification. Andrey's two design
> decisions reshaped the rest: **(a)** division of labor — **ADR/archgate own
> architectural + non-functional requirements; BDD `req__Requirement` owns
> functional requirements** (eliminates the four-places-of-truth duplication and
> the NFR gap in one stroke, §3.9); **(b)** storage = **per-module requirement
> assetspaces** (`exoas-req` TBox + `exoas-<module>-reqs` ABox), which also makes
> GitHub Pages privacy **fail-closed by repo visibility** (§3.2). Plus: dated
> auto-flip + soft-gate expiry (§3.7), requirement versioning/approval-provenance
> (§3.3), EARS corrected and relocated to the ADR domain, archgate's no-vault-graph
> constraint fixed (§3.7), corrected test counts, and an integrity metric (§7).

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
| `.archgate/` ADRs (`.md` + `.rules.ts`) | Architecture Decision Records as machine-enforced rules (e.g. ARCH-001 "all vault files UUID-named", ARCH-007 "commands appear only when applicable"). `archgate` is a required CI check. These **are** the project's architectural + non-functional requirements. | Active enforcement — in v2, the **canonical home for architectural/NFR requirements** (see §3.9). |
| `uj__UserJourney` (ns `uj`) | Vault BDD combo-format: Job Story + Gherkin body + acceptance gates. Run via `/user-journey` + computer-control. | Exists in **starter-kit only**, **manual**, **Andrey never used it** — superseded. The *format insight* is reused; the class is not carried forward. |
| `eka-gui-e2e` workflow | Formalizes prose Gherkin scenarios as repeatable Playwright e2e against a fresh ephemeral vault on native-amd64 CI. | Active release-gate. Real-prod execution — a **valid `_verifiedBy` binding target** for functional requirements. |
| Playwright e2e `.spec.ts` (~24), Jest unit/component/integration (~720 `.test.ts` + ~20 `.test.tsx`) | Where functional behavior is *actually* specified today — as code, not readable requirements. | Active. Functional requirements are **implicit and scattered** here + in RFCs. |
| `parity-gate` | CLI↔plugin behavioral parity (replaced retired `test-bdd`). | Required CI check. |

### ⛔ The decisive lesson (the failure mode this RFC must not repeat)

Exocortex **already tried** Cucumber/Gherkin and removed it **twice**:

- #3401 — *"delete plugin-BDD harness-theater: 204 self-asserting scenarios that
  imported only `@cucumber/cucumber` and asserted self-set world state (no
  production renderer / CommandManager / DOM invoked → zero prod exercised)"*.
- #3433 removed the vestigial CLI BDD infrastructure; #3545 deleted the cucumber
  deps.

The failure was **not** Given/When/Then as a format — it was that the tests
**never exercised production**. The panel sharpened this: a parallel *runner* is
one way to get there, but **so is a `@req` tag pointing at a green test that
doesn't exercise the behavior**. v2 therefore forbids the runner **and** makes
"the cited test fails when the behavior is reverted" the validity condition of a
binding (§3.6). (cf. internal rules `test-fixture-realism`,
`integration-test-revert-verify`.)

### Why now / why it matters

- Exocortex is **AI-driven** (Claude Code child sessions implement most changes).
  The 2026 consensus is that a written spec — not chat history — must be the
  single source of truth for coding agents, because LLMs are good at "pattern
  completion, but not at mind reading" ([GitHub Spec Kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)).
- Today there is **no single, queryable, browsable statement of what Exocortex
  must do**. Functional behavior is reverse-engineerable only by reading ~720
  test files; architectural rules live in ADRs but aren't presented as
  requirements. Regressions and scope-drift (Fowler's documented SDD failure
  mode: AI "generates features not requested, claims success when builds failed")
  are caught late.

## 2. Goals

1. A **single source of truth** for requirements — realized as a **federation of
   two canonical homes by requirement type** (§3.9): functional → vault BDD
   `req__Requirement`; architectural/non-functional → `.archgate` ADRs. No
   duplication between them.
2. Functional requirements in a **readable, verification-bound** format (BDD)
   that humans and AI agents consume.
3. **Traceability**: requirement ↔ test ↔ code ↔ commit, SPARQL-queryable.
4. **Every codebase change flows through the requirements base** — enforced
   deterministically (soft→hard ramp with a real flip-trigger), not advisory.
5. **No new test runner**, and a binding is valid **only** if the cited test
   *fails when the behavior is reverted* — the harness-theater path is
   structurally closed.
6. (Target, non-blocking) Public requirements **published to GitHub Pages** as
   Living Documentation, **fail-closed by repo visibility**.

## 3. Proposed solution

### 3.1 Paradigm — Spec-Driven Development, spec = single source of truth

Adopt **Spec-Driven Development (SDD)**, the 2026 default for AI coding
([GitHub Spec Kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/);
[Anthropic best-practices](https://code.claude.com/docs/en/best-practices); Thoughtworks/Fowler).
Exocortex already performs most of the SDD loop informally — RFCs are
*Specify+Plan*, PMBOK WBS / `ems__Task` are *Tasks*, child sessions are
*Implement*, `.archgate` ADRs are the *Constitution*. The **missing layer** is a
persistent, enforced **functional-requirements base** the loop reads from and
writes back to. This RFC adds exactly that layer; it complements RFCs/PMBOK/ADRs.

**Two regimes, named honestly** (panel finding): for the **migration back-fill**,
requirements are *reverse-documented* from already-written tests
(test-first-then-spec) — Specification-by-Example applied to existing behavior.
For **net-new** work, requirements are genuinely *spec-first* (the real SDD
loop). The Phase-2 hard-gate (§3.7) requires net-new behavior to be **spec-first**.

### 3.2 Storage — per-module requirement assetspaces; Pages fail-closed by repo visibility

Requirements are first-class vault RDF assets (Homoiconicity Invariant; RDF is
purpose-built for machine-readable requirements + traceability — ontology-based
requirements-traceability literature, INCOSE / Mark Austin et al.).
Following the EKA audience-layered + per-module assetspace pattern (verified
against the live structure):

- **`exoas-req`** — the `req` **TBox** only: class `req__Requirement` + properties
  + enums. Namespace `req` (naming=namespace invariant ✓). Other reqs assetspaces
  `dependsOn exoas-req` in `exoas-registry`.
- **`exoas-<module>-reqs`** — the **ABox**: functional requirement *instances*
  about one module. First: **`exoas-exo-reqs`** (requirements for the `exo`
  module = Alpha-critical, migrated first). Each instance:
  `exo__Asset_isDefinedBy → the assetspace's own anchor` (co-location key, so it
  lands here — verified: EKA instances are `isDefinedBy` their owner-assetspace
  anchor, e.g. `exoas-exodev/exodev/* → [[32d2374c]]`), `exo__Instance_class →
  req__Requirement` (the class in `exoas-req`, a cross-assetspace `rdf:type`
  edge), `req__Requirement_covers → exo command/feature`.
- **Future, conditional**: `exoas-ems-cmd-reqs` for requirements about `ems`-class
  commands — *iff* those commands live in an `exoas-ems-cmds` assetspace (does not
  exist yet; not created now).

**GitHub Pages privacy = solved at the storage layer.** Public-module reqs
assetspaces (`exoas-exo-reqs`, …) are public git repos → published to Pages **by
repo visibility**; requirements about private modules (e.g. T-Bank commands) live
in a **private** `exoas-*-reqs` repo → never published. This is **fail-closed by
repo visibility**, strictly safer than a query-time allowlist (panel's
highest-blast-radius concern). The Pages generator iterates only over
**explicitly public** reqs assetspaces (default-deny).

The assetspaces themselves are created in **implementation** (§8), not by this RFC.

### 3.3 Ontology (`req` namespace) — functional requirements only

`req__Requirement` (`exo__Class`, superclass `exo__Asset`) — design intent;
final shapes refined in implementation:

| Property | Card. | Range / values | Purpose |
| --- | --- | --- | --- |
| `req__Requirement_statement` (body) | 1 | **Gherkin Given/When/Then** in the asset body | The functional spec (human + AI readable) |
| `req__Requirement_jobStory` | 0..1 | "When ⟨situation⟩, I want ⟨motivation⟩, so ⟨outcome⟩" | Optional user-value framing |
| `req__Requirement_covers` | 1..N | wikilink → command / feature | What behavior this is *about* |
| `req__Requirement_verifiedBy` | 0..N | (derived) test-ID(s) the checker resolves from `@req:<uid>` tags | The existing real test(s) that exercise it |
| `req__Requirement_bindingClass` | 0..N | `unit` \| `integration` \| `e2e` \| `gui-bdd` | Class of each binding (gates P0, §3.6) |
| `req__Requirement_implementedBy` | 0..N | wikilink → command / PR# / code ref | Implementation pointer |
| `req__Requirement_refines` | 0..1 | wikilink → parent `req__Requirement` (UWI child→parent) | Decomposition / acceptance↔system layering |
| `req__Requirement_status` | 1 | `Draft` \| `Approved` \| `Deprecated` (enum assets) — **human-authored** | Lifecycle |
| `req__Requirement_priority` | 1 | `P0`..`P3` (enum) | Migration & gate ordering |
| `req__Requirement_area` | 0..1 | wikilink → `ems__Area` | Grouping (Alpha-critical, etc.) |
| `req__Requirement_author` | 1 | wikilink → person/ExoAssistant | Drafter provenance |
| `req__Requirement_approvedBy` | 0..1 | wikilink → person | Approver (≠ drafter) |
| `req__Requirement_approvedAt` | 0..1 | dateTime | When approved (for re-approval-on-change) |
| `req__Requirement_baseline` | 0..1 | wikilink → approved snapshot / `pmbok__ChangeRequest` | Versioning / change-history |

- **`verified` is runtime-derived, never persisted** (precedent:
  `exo__AssetSpace_materialized`): a requirement is *verified* iff it has ≥1
  revert-verified `_verifiedBy` test passing in CI. The read-only checker computes
  it; it is **not** a stored `_status` value (that mix was ill-typed — panel).
- **Re-approval on change**: any diff to an `Approved` requirement's statement
  body resets `_status → Draft` (baseline-freeze-on-change; §3.5).
- **EARS is *not* used here** — EARS "THE SYSTEM SHALL…" (Ubiquitous pattern for
  invariants/NFRs) belongs to the **ADR domain** (§3.9), not to functional BDD.

UID-canon filenames, UWI (`_refines` child→parent), co-located per CR-1.

### 3.4 Format — Gherkin (functional) + optional Job Story

- **Functional** requirements: **Gherkin Given/When/Then** in the asset body
  (the format Andrey's own example uses). Example (Andrey's):
  > Given asset A has a wikilink to a non-existent asset B (alias "Daily") in an
  > unmaterialized assetspace, and the link renders as a bare uid · When I
  > materialize the missing assetspace · Then the link renders as "Daily".
- Optional **Job Story** header for user-facing requirements.
- **Architectural / non-functional** requirements are **not** written here — they
  live as ADRs (§3.9), where EARS is the recommended phrasing.

### 3.5 Granularity & authorship

- **One `req__Requirement` = one verifiable functional behavior**, linked via
  `_covers`. `_refines` carries acceptance↔system layering (a stakeholder-level
  requirement refined into system-level testable ones) and decomposition.
- **Authorship: AI drafts, Andrey approves** (`_status: Draft → Approved`,
  `_approvedBy`/`_approvedAt` recorded). **But** — the panel's CRITICAL loop
  warning — the same agent must not silently author the requirement, the test,
  and the binding and then self-certify. Therefore authorship of the requirement
  is **decoupled from verification of its binding**: the `Approved → verified`
  fact is established **only** by falsifiable revert-verify evidence (§3.6), not
  by drafting. Human approval covers the *prose*; revert-verify covers the *bind*.

### 3.6 Executable — bind to existing tests, revert-verified, NO new runner

⛔ **No Cucumber, no parallel step-definition runner.** Each requirement binds to
**already-existing real tests** via a **`@req:<uid>` token placed inside the
`it(...)`/`test(...)` title** (so it travels with the assertion across refactors,
not a detachable comment). The CLI **traceability checker** (`exocortex-cli
requirements audit` — the established `audit`-subcommand pattern, feasibility
confirmed) is the executable mechanism:

1. Loads `req__Requirement` assets (`--also <reqs-assetspaces>`).
2. Greps the test corpus for `@req:<uid>` in test titles; derives `_verifiedBy`.
3. Reports **orphan requirements** (no binding), **dangling tags** (tag → missing
   req), **duplicate bindings** (one uid claimed by >1 test → copy-paste
   contamination warning), and (best-effort) **untraced behaviors**.
4. Emits a machine-readable report for CI + the Pages generator.

**The binding-validity rule (closes harness-theater 2.0):**

- A binding is **valid** only with **revert-verify evidence**: the cited test
  must **fail when the production behavior is reverted**. The checker can't run
  this automatically, so the RFC mandates it as an authoring gate and makes it a
  **machine-checkable token** — a `Revert-verified: @req:<uid> reverting <ref> →
  <test> RED` line in the PR/commit body (borrowing the internal
  `integration-test-revert-verify` discipline). `verified` (§3.3) requires this
  token to exist.
- **Binding-class gate for P0**: a `P0` requirement may **not** be bound *solely*
  to a `unit` test — at least one `_verifiedBy` must be `integration`, `e2e`, or
  `gui-bdd` (real-prod-exercising, e.g. `eka-gui` / Playwright). `req__Requirement_bindingClass`
  records each binding's class; the checker enforces the floor.

This structurally cannot become harness-theater: there is no second assertion
layer, the only tests are the real ones already in CI, and a binding that doesn't
fail-on-revert is invalid by definition.

### 3.7 Enforcement — soft→hard ramp with a real flip-trigger

Anthropic: *hooks/CI gates are deterministic guarantees; CLAUDE.md is advisory.*

- **Phase 1 (soft):** a new CI job **`requirements-trace`** runs the checker
  **non-blocking** — posts the report (orphans, dangling, duplicates, coverage %)
  as a PR comment. The diff-scoped check "behavior code changed but no
  `req__Requirement` added/updated" lives **in this CI job** (it has
  `git diff origin/main...HEAD` + `--also <vault>` graph access). **`archgate`
  keeps only whole-tree, repo-expressible invariants** (e.g. "every `@req:` tag
  resolves" via grep) — because archgate's `RuleContext` is repo-scoped
  (`glob`/`grep`/`readFile`) with **no vault-graph access** and CI runs it
  whole-tree (verified: `.archgate` rules can't see vault assets nor a diff
  delta). Behavior PRs carry a repo-visible **`Req: <uid>`** token archgate *can*
  grep; the CI job validates the token resolves.
- **Phase 2 (hard) — with a forced flip:** the Alpha-critical (exo) requirement
  set is an **enumerated checklist** in the implementation subproject. When every
  enumerated `P0` requirement has a **revert-verified** binding, the checker emits
  `ramp-ready: true` and `requirements-trace` **auto-becomes required**. Plus a
  **soft-gate expiry**: if the flip hasn't happened by **Alpha GA**, the job
  auto-escalates to blocking (requiring explicit user dispensation to stay soft).
  Staying soft costs something — this is what `uj__UserJourney` lacked. Optional
  PreToolUse/Stop hook for local fast feedback.

### 3.8 Migration — incremental, exo (Alpha-critical) first, functional only

Back-fill **functional** requirements incrementally, **the `exo` module first**
(→ `exoas-exo-reqs`), then expand by module/area. Source: existing tests, RFCs,
`eka-gui` scenarios. Each migrated requirement is bound (`_verifiedBy`) to the
test(s) it was distilled from, **revert-verified**. Architectural/NFR
requirements are **not** migrated into `req` — they are already ADRs (§3.9).

## 3.9 Division of labor — ADR/archgate (architectural + NFR) vs BDD req (functional)

The single most important v2 decision (Andrey): **two requirement homes by
type**, no overlap:

| Requirement type | Canonical home | Format | Enforcement |
| --- | --- | --- | --- |
| **Architectural + non-functional** (NFR: performance, security, reliability; structural invariants like UUID-filenames, command-visibility) | **`.archgate` ADRs** | EARS "THE SYSTEM SHALL…" / ADR prose + `.rules.ts` | `archgate` (existing required check) |
| **Functional** (user-facing behaviors, command outcomes, the link-renders-"Daily" example) | **vault BDD `req__Requirement`** | Gherkin Given/When/Then | `requirements-trace` (new) |

This eliminates the four-places-of-truth duplication (an invariant is **not**
restated as a `req` asset — it *is* the ADR) **and** fills the NFR gap (NFRs have
a home — the ADR — so the `req` ontology needs no NFR slot). The
requirements-management **system** is the *federation*: the Living Documentation
site (§3.2 Pages) presents **both** — functional requirements from the vault +
architectural/NFR from ADRs — as one browsable, traceable base.

## 4. Traceability model (RDF + repo edges)

```
req__Requirement --_covers-->        command / feature
req__Requirement --_refines-->       parent req__Requirement (acceptance↔system, UWI)
req__Requirement --_verifiedBy-->    test-ID (derived from @req:<uid> in it() title)
req__Requirement --_implementedBy--> command / PR# / code ref
test  --@req:<uid> in it() title-->  req__Requirement      (canonical back-edge)
PR/commit body --Req:<uid>-->        req__Requirement      (archgate-greppable token)
PR/commit body --Revert-verified:--> binding validity      (falsifiable evidence)
ADR  --archgate rule-->              architectural/NFR enforcement (separate lane)
```

SPARQL answers: *which Alpha-critical functional requirements have no
revert-verified test?*, *which commands have zero covering requirement?*, *what
requirements does PR #N touch?*, *which `Approved` requirements changed without
re-approval?*

## 5. Alternatives considered (rejected)

| Alternative | Why rejected |
| --- | --- |
| **Cucumber/Gherkin step-def runner** | Proven failure here (#3401: 204 self-asserting scenarios, zero prod). Format kept; runner forbidden. |
| **`@req` tag = sufficient binding** (v1's implicit assumption) | Tag proves *association*, not *exercise* — would reproduce harness-theater at the traceability layer. v2 requires revert-verify + binding-class. |
| **All requirements as new `req` assets incl. architectural/NFR** (v1) | Four-places-of-truth duplication, unjustified per-PR tax for a solo+AI dev. v2 federates: ADR owns architectural/NFR, BDD owns functional. |
| **`.feature`/markdown spec files in-repo as canon** | Duplicates the vault graph; non-SPARQL-queryable; disconnected from homoiconic model. Pages is generated *from* the graph instead. |
| **Single shared `req` assetspace for all instances** | Loses profile-scoped mount + audience-layered privacy. Per-module `exoas-<m>-reqs` gives both, and makes Pages fail-closed by repo visibility. |
| **Pages via query-time public/private allowlist** | One mis-scoped query leaks private requirements. Repo-visibility fail-closed (§3.2) is default-deny. |
| **Soft-only / manual-flip enforcement** | Becomes shelfware (the `uj` death). v2 adds a dated auto-flip criterion + soft-gate expiry. |
| **ReqIF** | XML, heavyweight, non-RDF, non-executable. No interop need. |
| **Big-bang migration** | Disproportionate; gating an empty base deadlocks. Incremental, exo-first. |
| **Keep/extend `uj__UserJourney`** | Unused, manual, starter-kit-scoped. Format insight reused under a fresh, CI-bound `req` class. |

## 6. Phasing

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **P0 — Ontology & storage** | `exoas-req` (TBox: class + props + enums) + `exoas-exo-reqs` (ABox repo), registry `dependsOn`, authoring guidance, 3–5 seed `exo` requirements incl. Andrey's link-label example, each **revert-verified**. | — |
| **P1 — Checker + soft CI** | `exocortex-cli requirements audit` (orphans/dangling/duplicates/coverage + binding-class) + `@req:<uid>`-in-`it()` convention + `requirements-trace` CI job **(soft)** + archgate whole-tree `@req`-resolves rule + `Req:`/`Revert-verified:` PR-body tokens. **Bring the read-surface carrot forward**: the audit report ("what behaviors have no test / my coverage") ships here so writing a requirement pays back immediately, before any gate. | soft CI |
| **P2 — Migrate exo (Alpha-critical)** | Distill `exo`-module functional behaviors into `exoas-exo-reqs`, each revert-verified-bound. Enumerate the P0 checklist that arms the flip. | soft→ |
| **P3 — Hard-gate** | Auto-flip `requirements-trace` to **required** when the P0 checklist is fully revert-verified, **or** soft-gate expiry at Alpha GA. New behavior must be spec-first. | **hard CI** |
| **P4 — Living Documentation (GitHub Pages)** | Generator: public reqs assetspaces + ADRs → static site (requirements, scenarios, coverage, traceability matrix). **Fail-closed by repo visibility** (default-deny, no-private-leak is the P4 acceptance gate). | — |
| **P5 — Expand** | Add further `exoas-<module>-reqs` per module (e.g. `exoas-ems-cmd-reqs` once `exoas-ems-cmds` exists); raise coverage thresholds. | hard CI |

## 7. Success metrics

- **Coverage:** % of `req__Requirement` with ≥1 **revert-verified** `_verifiedBy`
  (target P3: 100% for the enumerated exo P0 set).
- **Binding quality:** % of P0 requirements whose bindings include an
  `integration`/`e2e`/`gui-bdd` test (target 100%).
- **Integrity (leading, can-fail):** % of `Approved` requirements whose statement
  changed without re-approval (target **0**); # of duplicate/conflicting
  requirement pairs flagged (trend → 0). These measure the discipline, not just
  bookkeeping (so 100% coverage can't hide uniformly-stale prose).
- **Process adherence:** % of behavior-changing PRs that add/update a
  `req__Requirement` (Phase 2: 100%, enforced).
- **Browsability:** public Pages site live and current, **zero private leak** (P4).

## 8. Definition of Done (this RFC's scope = design only)

- [ ] RFC merged (docs-only, CI green).
- [ ] Implementation tracked as a vault `ems__Project` subproject under Alpha
      Launch with leaf `ems__Task`s for P0–P5 (created by this work; **no
      implementation started**).

(Implementation DoD lives in the subproject tasks, not here.)

## 9. Interview record (Andrey, 2026-06-19/20)

**STEP B (pre-RFC):**
1. **Storage** → vault RDF canon + GitHub Pages; open to abandoning `uj`; "all
   changes through one process"; Pages "не блокер". → refined in STEP E to
   **per-module assetspaces** (below).
2. **Enforcement** → soft→hard ramp.
3. **Migration** → incremental, Alpha-critical first.
4–9. Gherkin format, per-behavior granularity, RDF traceability,
   bind-to-existing-tests (no Cucumber), AI-drafts/user-approves, MVP→target —
   confirmed.

**STEP E (interview-per-finding, after the adversarial panel):**
- **D1** (CRITICAL — tag proves association not exercise): **revert-verify evidence
  + binding-class for P0** (P0 must hit e2e/integration/gui-bdd).
- **D2 + D5** (duplication + NFR gap): Andrey's decision — **ADR/archgate own
  architectural + NFR; BDD `req` owns functional**. One stroke, no duplication.
- **D3** (ramp never flips): **dated auto-flip criterion + soft-gate expiry**.
- **D4** (Pages privacy): **fail-closed by repo visibility** — resolved by the
  storage design.
- **Storage refinement** (Andrey): **per-module requirement assetspaces** —
  `exoas-req` (TBox), `exoas-exo-reqs` (exo ABox, first), future
  `exoas-ems-cmd-reqs`. Verified to compose with EKA co-location/profile-mount.

## 10. Open questions / risks

- **Untraced-behavior detection** is best-effort (needs a command/feature
  registry to enumerate against) — P1 ships orphan + dangling + duplicate; defer
  full untraced-behavior to a later phase.
- **Acceptance↔system layering** via `_refines` is provided; the *boundary* of
  "one verifiable behavior" stays a human judgment (guidance, not a checker rule).
- **`req` namespace registration** in `exoas-registry` + `dependsOn exoas-req` —
  settle the exact anchor names for each `exoas-<module>-reqs` in P0.
- **ARCH-002 allowlist** — add `req__` when/if `req__*` constants land in domain
  TS (else a CI warning).

## Sources

- [GitHub Spec Kit — official blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/) · [repo](https://github.com/github/spec-kit)
- [Anthropic — Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [AWS Kiro — feature specs / EARS](https://kiro.dev/docs/specs/feature-specs/) (EARS = Easy Approach to Requirements Syntax, 5 patterns; Ubiquitous = invariants/NFR)
- [Gojko Adzic — Specification by Example, 10 years later](https://gojko.net/2020/03/17/sbe-10-years.html)
- Ontology-based requirements traceability (INCOSE; Mark Austin et al., "Ontology-Enabled Traceability Mechanisms")
- Repo grounding: `origin/main` (`1ada25cb`) — #3401/#3433/#3545 (Cucumber removal), `.archgate` ADRs, `eka-gui-e2e`, `uj__UserJourney` (starter-kit), CLI `audit` dispatcher, EKA per-module assetspaces (`exoas-exo`, …, verified live).
