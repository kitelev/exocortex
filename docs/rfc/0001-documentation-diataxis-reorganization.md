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
   drifted in a phase3 ADR); `/Users/kitelev/...` absolute paths are hardcoded in
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

### Consolidations
- **Testing (4 → 1):** one canonical testing doc (proposed: root `TESTING.md`) + thin
  package-specific pointers; fold `TEST-PYRAMID`, `.github/TESTING.md`, plugin
  `TESTING.md`, and the `AGENTS.md §Testing` section into it (or leave stubs that link).
- **Troubleshooting (2 → disambiguated):** user `docs/Troubleshooting.md` stays;
  rename root `TROUBLESHOOTING.md` → `DEV-TROUBLESHOOTING.md` (or move to
  `contributing/`) to end the identical-title collision. Also drop its stale
  v14.81.0 pin and `Two-Vault`/personal-path content.
- **NL-TO-SPARQL (2 → 1):** keep one user how-to in `docs/`; replace the
  `packages/exocortex/docs/` copy with a short "engine internals" pointer.
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
  Fix the phase3 ADR's stale `test-bdd`-in-13 claim; stamp `history/`+`phase3/` as
  frozen/as-of-date.
- **De-personalize** `/Users/kitelev/...` → `$REPO`/relative across AGENTS,
  DEV-TROUBLESHOOTING, `.github/*`, CLAUDE.
- Document the **exo-as-SDK / AssetSpace topology** for contributors (why many
  `exoas-*` repos exist) in `explanation/` or ARCHITECTURE.
- Remove the `WORKTREE_COORDINATION.md` tombstone once no inbound links remain.

## 4. Migration plan (phased, low-churn)

Each phase is one PR; cross-links updated within the same PR; redirect stubs left at
old paths for one release where external links may exist.

- **Phase 1 — Index + de-dup (no moves):** extend `docs/README.md` to the single
  index; consolidate the 4 testing docs → 1 (+stubs); disambiguate the 2
  Troubleshooting docs; merge the 2 NL-TO-SPARQL; merge ARCHITECTURE's two "Current"
  sections. *Highest value / lowest risk.*
- **Phase 2 — Taxonomy moves:** introduce `tutorials/how-to/reference/explanation/
  contributing/` and move files in; leave redirect stubs; bulk-fix cross-links.
- **Phase 3 — Monolith hygiene:** prune/split PATTERNS + root TROUBLESHOOTING;
  de-personalize paths; freeze `history/`.
- **Phase 4 — Single-sourcing:** CI-check single source; SDK/AssetSpace explainer;
  remove tombstones.

## 5. Risks & mitigations
- **Cross-link churn / broken links.** Mitigation: a link-check (the repo already has
  a "Documentation Link Validation" practice) run per phase; redirect stubs at old
  paths for one release.
- **External deep-links break** (CI/scripts reference some docs by path — e.g.
  `ADR_FLAKY_X11_STRATEGY.md` is referenced by `ci.yml`/`docker-entrypoint-e2e.sh`).
  Mitigation: grep for path references before moving; keep referenced files in place
  or update the referencing config in the same PR.
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
- `docs/README.md` indexes every doc (root + package) — single entry point.
- Exactly one canonical doc per topic (testing, troubleshooting, NL-TO-SPARQL).
- PATTERNS + root TROUBLESHOOTING scannable (TOC; historical content archived).
- No `/Users/kitelev/...` paths in non-history prose docs.
- CI-check list asserted in exactly one place.
- All internal doc links resolve (link-check green).
