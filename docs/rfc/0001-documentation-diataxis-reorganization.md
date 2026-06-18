# RFC 0001 — Documentation reorganization (Diátaxis)

| | |
| --- | --- |
| **Status** | Proposed |
| **Author** | Documentation full-audit (AI), 2026-06-17 |
| **Scope** | `kitelev/exocortex` repo documentation (not vault, not Claude-infra) |
| **Supersedes** | — |
| **Tracking** | [#3592](https://github.com/kitelev/exocortex/issues/3592) · shipped P0 in [#3591](https://github.com/kitelev/exocortex/pull/3591) |

> **Why in-repo:** this is a repo-governance / contributor-facing artifact about the
> *documentation architecture*. It is versioned in-repo alongside the docs it
> reorganizes (OSS best-practice), unlike feature/ontology RFCs that live in the vault.

> **Revision 2 (2026-06-18):** refined after a 3-lens adversarial review (taxonomy/phase
> plan · dedup/migration-risk · philosophy/DoD). Direction unchanged (no CRITICAL/HIGH);
> tightened §3 taxonomy completeness + package-local move-vs-index, §5 migration-safety
> (link-check is `docs/`-scoped & non-required; config-refs need same-PR updates), and §7
> DoD into mechanical predicates. Two factual corrections (v14.81 pin location; ADR_FLAKY_X11
> is referenced only by a `docker-entrypoint-e2e.sh` comment, not `ci.yml`).

---

## 1. Context & problem

A full critical audit (2026-06-17, `origin/main` @ `8e983aaf`) of all ~98 prose docs
found that the **user/architecture `docs/` tree is healthy** (well-indexed, current,
RFC-cross-referenced), but the documentation set has three structural problems that
recur and resist point-fixes:

1. **No single entry point / no taxonomy.** There are two doc populations — the
   curated `docs/` tree and a sprawling root "process" cluster (`AGENTS.md` 1743 ln,
   `PATTERNS.md` 7598 ln, `TROUBLESHOOTING.md` 1997 ln, `TESTING.md` 1112 ln,
   `AI-DEVELOPMENT-PATTERNS.md`). `docs/README.md` does not index the root docs, so a
   contributor cannot discover that the real dev guide is `AGENTS.md`/`PATTERNS.md`.
2. **Redundancy.** Two "Troubleshooting Guide" docs (root dev-CI vs `docs/` user);
   **four** testing docs (`TESTING.md`, `.github/TESTING.md`,
   `packages/obsidian-plugin/docs/TESTING.md`, `docs/TEST-PYRAMID.md`) + an `AGENTS.md`
   section; **two** near-duplicate `NL-TO-SPARQL.md`.
3. **Monoliths & drift.** `PATTERNS.md` and root `TROUBLESHOOTING.md` are append-only
   incident bins; the "13 required CI checks" fact is asserted in 6+ places (already
   drifted in a phase3 ADR); `/Users/<user>/...` absolute paths are hardcoded in
   `AGENTS.md` (13×) and `TROUBLESHOOTING.md` (11×).

The full findings (9 dimensions, per-doc verdicts) are in the audit report
(`doc-audit-report-2026-06-17.md`, attached to the originating session/PR).

**Out of scope of this RFC** (already shipped in the P0 docs-PR that accompanies it):
CLI README command-surface fix, CHANGELOG retirement, CONTRIBUTING/SECURITY/CoC +
templates, the Obsidian-version and issue-count contradiction fixes, the VISION
Desktop↔Mobile-parity invariant, and the 2 missing index links.

## 2. Goals

- One discoverable **single entry point** + audience taxonomy.
- Each topic has **one canonical doc** (no 4× testing, no 2× troubleshooting).
- Monoliths pruned/split to scannable size.
- Drift-prone facts (CI-check list, test counts) single-sourced.
- Public docs free of machine-specific absolute paths.

**Non-goals:** a hosted docs-site (deferred — see §6 Alternatives); rewriting the
healthy reference docs; touching vault/Claude-infra docs.

## 3. Proposal — Diátaxis taxonomy

Adopt the [Diátaxis](https://diataxis.fr/) four-mode split, plus a `contributing/`
bucket, with `docs/README.md` as the **single index**. Folder names are illustrative;
the taxonomy + single index + de-duplication matter more than literal paths.

```
README.md                      front door (keep)
CONTRIBUTING.md / SECURITY.md / CODE_OF_CONDUCT.md   (shipped in P0 PR)
docs/
  README.md                    THE index — links every doc incl. root docs
  tutorials/    Getting-Started
  how-to/       Troubleshooting (user), WORKFLOW_CUSTOMIZATION, ONTOLOGY_EXTENSION,
                exosync (usage), release-checklist-mobile
  reference/    PROPERTY_SCHEMA, api/Core-API, CLI command ref, ONTOLOGY_REFERENCE,
                SPARQL_GUIDE/COOKBOOK, SHACL_LITE_MAPPING, NL-TO-SPARQL (one doc)
  explanation/  VISION, ARCHITECTURE, profile, ExoRDF-Mapping, CROSS_RUNTIME_PARITY,
                settings-homoiconization, exosync (internals)
  contributing/ AGENTS (slimmed), PATTERNS (pruned), TESTING (unified), DEV-TROUBLESHOOTING
  history/      frozen archive (stamp "as-of <date>")
```

**Taxonomy mapping notes** (added after adversarial review — the bucket list above is
illustrative and not exhaustive; these rules bind the Phase-2 executor):
- **Package-local docs stay physical.** `packages/cli/docs/*` (CLI_API_REFERENCE,
  ONTOLOGY_REFERENCE, SPARQL_GUIDE/COOKBOOK) and other `packages/*/docs/*` are
  **npm-shipped** with their package — they are **only logically grouped** under
  `reference/` *in the `docs/README.md` index*, **not** physically relocated across
  package boundaries.
- **Complete doc→mode table is a Phase-2 deliverable.** ~7 top-level `docs/*` not named
  above (e.g. `Performance-Guide`, `Plugin-Development-Guide`, `AI-DEVELOPMENT-PATTERNS`,
  `FLAKY_POLICY`, `e2e-desktop`, `exosync-parallel-run`, `ROLLBACK_EXOQL_EVAL`) must each
  get an explicit bucket in a full mapping table produced *before* Phase-2 moves — no
  doc may be left unclassified at move time.
- **Mode straddle is acceptable, classification must be explicit.** `WORKFLOW_CUSTOMIZATION`
  / `ONTOLOGY_EXTENSION` are step-by-step (lean tutorial) yet placed in `how-to/`;
  `ARCHITECTURE` / `AGENTS` are reference-heavy yet kept whole under `explanation/` /
  `contributing/`. These are deliberate (cohesion over purity) — the mapping table states
  the chosen mode + one-line rationale for each straddle doc rather than silently asserting
  a clean fit.

### Consolidations
- **Testing (4 → 1):** one canonical testing doc — **root `TESTING.md`** (justified: it
  is the largest at 1112 ln *and* the only one with a TOC, i.e. already the most complete
  and scannable) + thin package-specific pointers; fold `TEST-PYRAMID`, `.github/TESTING.md`,
  plugin `TESTING.md`, and the `AGENTS.md §Testing` section into it (or leave stubs that
  link). **Fold *current* content only** — `.github/TESTING.md:137-148` carries a stale
  generic 7-step CI description that contradicts the "13 required checks" single-source goal;
  drop it on fold, reference the single-sourced CI paragraph instead of merging verbatim.
  The unified doc must **enumerate all e2e suites, including the recently-added `eka-gui`
  GUI-BDD and `eka-obsidian-leg` suites** (audit §b3 flagged these as 0-prose-doc; the
  consolidation closes that gap rather than inheriting it).
- **Troubleshooting (2 → disambiguated):** user `docs/Troubleshooting.md` stays
  (drop **its** stale v14.81.0 pin — verified at `docs/Troubleshooting.md:186,194`,
  **not** the root doc); rename root `TROUBLESHOOTING.md` → `DEV-TROUBLESHOOTING.md`
  (or move to `contributing/`) to end the identical-title collision, and drop the
  root doc's personal-path content. *(Audit §d8 located the pin correctly in the user
  doc; the prior draft of this RFC mis-attributed it to root — corrected.)*
- **NL-TO-SPARQL (2 → 1):** **content-fold before stub** — each copy has concentrated
  *unique* sections (user `docs/`: Known Prototypes, Configuration, Adding Custom
  Templates, API Reference; `packages/exocortex/docs/`: Date Filtering, Confidence
  Scoring, Advanced Usage, Template Library Reference, Best Practices), so the ~20%
  delta is not cosmetic. First migrate the unique sections into the one canonical
  user how-to in `docs/`, *then* replace the `packages/exocortex/docs/` copy with a
  short "engine internals" pointer. A diff-based "no orphaned section" check gates this.
- **ARCHITECTURE:** merge the two adjacent "Current State"/"Current Architecture"
  sections.

### Monolith hygiene
- **PATTERNS.md:** separate genuinely-reusable patterns from one-off incident
  write-ups; archive the latter (or move to `history/`). Add a TOC.
- **AGENTS.md:** move embedded example post-mortems → `TEMPLATES.md`; de-duplicate
  worktree/naming/merge rules against `CLAUDE.md`.

### Single-sourcing & cleanup
- **CI-check list:** one authoritative paragraph (cite
  `gh api …/required_status_checks`), referenced from elsewhere instead of restated.
  The stale `test-bdd`-in-13 claim lives specifically in
  `packages/obsidian-plugin/docs/phase3/ADR_FLAKY_X11_STRATEGY.md:28,236` (note: under
  `phase3/`, **not** `docs/history/`) — fix or freeze it there. Stamp `docs/history/` +
  `packages/obsidian-plugin/docs/phase3/` as frozen/as-of-date. Blast radius: `13
  required`/`test-bdd` is currently asserted in ~9 `.md` files (4 active:
  AGENTS/CLAUDE/TESTING/TROUBLESHOOTING + history/phase3) — all active ones reference the
  single paragraph after this lands.
- **De-personalize** via a **predicate**, not an enumerated file-list (enumeration
  already missed `packages/obsidian-plugin/tests/e2e/specs/README.md` and the
  `WORKTREE_COORDINATION.md` tombstone): rewrite every `/Users/<user>/...` →
  `$REPO`/relative such that `grep -rln '/Users/<user>' --include='*.md' | grep -v
  'docs/history' | grep -v '/phase3/'` returns nothing. (Decide explicitly whether
  `.claude/agents/*` count as in-scope "prose docs" — recommend yes.)
- Document the **exo-as-SDK / AssetSpace topology** for contributors (what an AssetSpace
  is, why many `exoas-*` repos exist, what a Profile is — *without* referencing private
  vault UIDs) in `explanation/` or ARCHITECTURE. This is a **content** deliverable with
  its own DoD line (§7), not a one-line file-move — Phase 4 must not ship a hollow stub.
- Remove the `WORKTREE_COORDINATION.md` tombstone in **Phase 1** — verified it has **zero
  inbound links** (only this RFC references it), so its removal is already unblocked (no
  need to defer to "once no inbound links remain").

## 4. Migration plan (phased, low-churn)

Each phase is one PR; cross-links updated within the same PR; redirect stubs left at
old paths for one release where external links may exist.

- **Phase 1 — Index + de-dup (no moves):** extend `docs/README.md` to the single
  index; consolidate the 4 testing docs → 1 (+stubs); disambiguate the 2
  Troubleshooting docs; **content-fold then** merge the 2 NL-TO-SPARQL; merge
  ARCHITECTURE's two "Current" sections; delete the `WORKTREE_COORDINATION.md`
  tombstone (zero inbound links). *Highest value / lowest risk.*
  > **Avoid Phase-1→Phase-2 double-churn:** where the canonical doc's *final* home is a
  > taxonomy folder (testing → `contributing/`, root Troubleshooting → `contributing/`),
  > consolidate **directly into the target path** in Phase 1 rather than into the root and
  > re-homing in Phase 2 — otherwise Phase-1 stubs/links get rewritten twice.
- **Phase 2 — Taxonomy moves:** introduce `tutorials/how-to/reference/explanation/
  contributing/` and move files in; leave redirect stubs; bulk-fix cross-links.
- **Phase 3 — Monolith hygiene:** prune/split PATTERNS + root TROUBLESHOOTING;
  de-personalize paths; freeze `history/`.
- **Phase 4 — Single-sourcing:** CI-check single source; SDK/AssetSpace explainer;
  remove tombstones.

## 5. Risks & mitigations
- **Cross-link churn / broken links.** The repo's existing link-check is **narrower than
  it appears**: `ci.yml`'s `docs-link-check` job is scoped `folder-path: "docs"` (it does
  **not** see root docs, `.github/*`, or `packages/*` — exactly where Phase-1/2 churn lands)
  **and is not among the 13 required checks** (a red link-check does not block merge). So
  it cannot gate the move PRs by itself. Mitigation: (a) for the duration of the reorg,
  widen the check (e.g. run `markdown-link-check` over `find . -name '*.md'` minus
  `node_modules`) **or** run a per-phase manual broken-link sweep across root/`.github/`/
  `packages/`; (b) redirect stubs at old paths for one release (markdown stubs help *human/
  markdown* inbound links only).
- **External deep-links break** — **non-markdown references** (CI/scripts/config) are
  *not* protected by redirect stubs and must be updated in the same PR as the move.
  Verified config refs (mostly comments, so a move staled them rather than breaking the
  pipeline): `packages/obsidian-plugin/docker-entrypoint-e2e.sh:5` → `ADR_FLAKY_X11_STRATEGY.md`
  (a **comment**, not loaded by CI — `ci.yml` has **zero** references to it, correcting an
  earlier over-claim), `.github/workflows/e2e-desktop.yml:17` → `docs/e2e-desktop.md`,
  `scripts/test-ci-batched.sh:89` → `packages/obsidian-plugin/CLAUDE.md`, and
  `.claude/agents/release.sh:102` — an **executable** `grep -q … CHANGELOG.md` (the one
  functional, not comment, dependency). Mitigation: before any move, run
  `grep -rhoE '[A-Za-z0-9._/-]+\.md' .github/workflows/ scripts/ **/*.sh` and update every
  referencing config in the same PR. Note `ADR_FLAKY_X11_STRATEGY.md` is under
  `phase3/` (frozen) and should not move at all.
- **Reviewer load** of large move PRs. Mitigation: phasing; moves separate from
  content edits.

## 6. Alternatives considered
- **Targeted fixes only (no reorg).** Rejected for the architecture decision (chosen:
  full Diátaxis) but its low-risk subset (index + de-dup) is exactly Phase 1.
- **Hosted docs-site (mkdocs/Docusaurus).** Deferred to a future RFC — it improves
  discoverability but does not fix staleness/redundancy and adds build/deploy surface.
  Revisit after the in-repo reorg lands.
- **Keep CHANGELOG hand-maintained.** Rejected — it had drifted ~8 months; retired to
  GitHub Releases in the P0 PR.

## 7. Definition of Done

*Each item below is phrased as a mechanical predicate so a reviewer can decide pass/fail
objectively (adversarial-review finding: the prior DoD's "every doc" / "exactly one
canonical" / "link-check green" were judgment calls).*

- **Single index:** every prose doc in the audit inventory (§a, ~98 docs) is either linked
  from `docs/README.md` **or** explicitly listed under a `history/`/`archive` heading. A
  helper diffs `find . -name '*.md'` (minus `node_modules`/fixtures) against the index's
  links; the diff is empty modulo the documented exclusions.
- **One canonical per topic:** for testing, troubleshooting, and NL-TO-SPARQL there is
  **exactly one substantive doc**; all other former copies are ≤N-line pointer stubs
  (grep-detectable, e.g. body matches `^> Moved to ` / `^See `). "Canonical" ≡ "the one
  non-stub".
- **Monolith scannability:** `PATTERNS.md` and root `TROUBLESHOOTING.md` each have a TOC;
  one-off historical incident write-ups are moved to `history/` (or pruned).
- **De-personalized:** `grep -rln '/Users/<user>' --include='*.md' | grep -v 'docs/history'
  | grep -v '/phase3/'` returns nothing (`.claude/agents/*` included as prose docs).
- **CI-check single source:** `grep -rniE '13 (required|mandatory)' --include='*.md'`
  returns exactly one non-history/non-phase3 hit (the canonical paragraph); `test-bdd`
  appears only in frozen archive prose.
- **exo-as-SDK explainer:** a contributor-facing doc answers *what is an AssetSpace, why
  there are many `exoas-*` repos, what a Profile is* — without referencing private vault
  UIDs. (Closes audit §9 — not satisfied by a file-move stub.)
- **Links resolve:** a link-check covering **root + `docs/` + `.github/` + `packages/`**
  (widened scope or per-phase manual sweep, per §5) reports zero broken internal links;
  all non-markdown config refs to moved docs (§5 list) updated in the same PR.
