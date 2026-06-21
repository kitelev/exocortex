# RFC 0004 — Living Documentation (GitHub Pages, per-repo, fail-closed by PAT-less build)

|                 |                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**      | **Proposed** — design decisions Andrey-approved via interview (2026-06-21); **implementation gated on Andrey's review of this written RFC** (no code is built by this docs-only RFC; impl is a separate follow-up — §8).                                                                                                                  |
| **Author**      | Living-Documentation design (`al-livingdocs-spike` + `al-livingdocs` child, AI) + Andrey interview, 2026-06-21                                                                                                                                                                                                                            |
| **Scope**       | A **publication layer**: render the _public_ requirements + architectural decisions of a git repo into a browsable static site on GitHub Pages, **per-repo**, with privacy guaranteed **by construction** (a PAT-less build physically cannot fetch private repos). MVP = `kitelev/exocortex`. Not a new ontology class (no `/onto-rfc`). |
| **Supersedes**  | —                                                                                                                                                                                                                                                                                                                                         |
| **Carved from** | **RFC 0003 §6 (P4) / D4 (Revision-3)** — Living Documentation was carved out of the requirements-management RFC because its privacy model is non-trivial (one mis-scoped publish leaks T-Bank/personal data) and a non-blocker for the core machinery. This RFC owns that carved scope.                                                   |
| **Tracking**    | "Living Documentation" subproject under "Exocortex requirements-management system" `[[89728805-bd0e-4c02-a158-8c60593aff0d]]` → Alpha Launch `[[f33732f4-410e-424a-91e2-9e894f68e2de]]`. Carved WBS node `[[2efdb0b3-83f0-4f62-9072-eb5b47913558]]`.                                                                                      |

> **Why in-repo (not a vault asset):** like RFC 0001/0002/0003, this proposal
> touches **repo-side machinery** — a docs generator, a `.github/workflows/`
> build, GitHub Pages config, and new git submodules. It is versioned next to the
> CI it changes. (RFC 0003 is the precedent: a docs-only RFC that designs both a
> vault ontology and repo enforcement.)

> **Grounding (verify-before-assert):** every reality claim is grounded against
> `origin/main` (`638ad676`, verified current) and against **live GitHub repo
> visibility** queried 2026-06-21 (`gh repo view`). The spike's three load-bearing
> findings were independently re-verified at the start of this session (§7). Where
> a claim is design intent rather than verified fact, it is marked as such.

> **Decision provenance:** the privacy model is **Andrey's call** (high-stakes:
> one mis-scoped publish is an irreversible T-Bank/personal-data leak). It was
> settled in a 2026-06-21 interview (Q1–Q7), recorded verbatim in §9. The single
> most consequential decision — _the build has no PAT, so it physically cannot
> reach private data_ — is Andrey's, and it reframes the whole design from
> "filter carefully" to "**fail-closed by absence**."

---

## 1. Context & problem

### 1.1 What P4 (the carved scope) wanted

From RFC 0003 (§3.9, §6, §8) and the carved node `2efdb0b3`: take the **public**
requirements of Exocortex — functional requirements (`req__Requirement`, Gherkin
Given/When/Then), their test-coverage and traceability — **and** the
architectural / non-functional decisions (`.archgate` ADRs) — and present them as
**one browsable site** on **GitHub Pages**. Rendered **from the graph** (RFC 0003
§5 rejected rendering from `.feature` files). Hosting: GitHub Pages (free,
indexed by search engines).

RFC 0003 §3.9 already established the _content_ federation: functional
requirements live in vault BDD `req__Requirement`; architectural/NFR requirements
live in `.archgate` ADRs. RFC 0003 made both SPARQL-/CI-queryable. _"Presenting
them as one browsable site is the carved Living-Documentation RFC's job"_ — this
RFC.

### 1.2 The privacy threat (why this is its own RFC)

The vault is a **mixed** public/private graph. A naive generator that iterates
"the graph" can, with one mis-scoped query, publish a **private** asset (T-Bank
work data, personal notes) to the open internet. GitHub Pages is **indexed and
cached** → the leak is **irreversible**. Blast-radius: reputational + compliance
(T-Bank work data).

RFC 0003 §3.2 already pre-resolved _half_ the model at the **storage** layer:
the audience boundary is set **per repository** — public-module requirements
(`exoas-exo-reqs`) are public git repos; private-module requirements (T-Bank
commands) live in **private** `exoas-*-reqs` repos. Quote: the per-module split
_"pre-resolves the future Pages-privacy model fail-closed: any publication layer
iterates only over explicitly public reqs assetspaces (default-deny), strictly
safer than a query-time allowlist."_ This RFC builds the _publication_ layer on
top of that storage boundary.

### 1.3 The decisive reframing (Andrey, Q1)

The interview converged on a principle stronger than "filter carefully":

> **Requirements about Exocortex describe a public product. T-Bank work data and
> personal notes must not participate in requirements at all** — and the build
> that produces the docs **has no PAT**, so it **physically cannot fetch
> non-public knowledge.**

This turns privacy from a _runtime check you might forget_ into a _structural
property you cannot bypass_: the docs build runs with **no credential** granting
access to private repos, therefore the private graph is **absent** from the build
context. You cannot leak what was never fetched. (cf. the EKA Profile apply-model,
where sensitive assetspaces are physically absent on disk outside an active
profile — the same primitive, reused.)

### 1.4 Andrey's architecture (Q2 — per-repo docs + submodules)

Two further decisions shaped the build:

1. **Per-repo documentation.** _Each git repo has its own documentation._ The
   Living-Doc site is **not** one mega-aggregation across all `exoas-*` repos; it
   is per-repo. This is also the cleanest privacy story: a public repo's doc site
   is built from that public repo's own content, so there is no cross-repo
   aggregation step that could contaminate.
2. **MVP = `kitelev/exocortex` only**, and the requirements + ontology are brought
   into it as **public git submodules** (Andrey's idea, Q2). Crucially, **the
   submodule mechanism is already in use in this repo** (verified): `exoas-exo` is
   _already_ a submodule (`packages/exoas-exo`, PUBLIC), as is `exoas-exocmd`. So
   the only **new** wiring is adding **`exoas-exo-reqs`** (the functional-
   requirement ABox) as a submodule. The docs build does one `git submodule update
--init`, gets the **public** submodules, and renders ADRs (in-repo) + ontology
   (`exoas-exo`, already present) + requirements (`exoas-exo-reqs`, new) from a
   **single checkout**. That the pattern is already proven here _de-risks_ the
   proposal.

The submodule idea is what makes "per-repo docs" and "include the requirements"
compatible: the requirements physically _become part of_ the main repo's checkout
(by reference), so the main-repo site documents them without any cross-repo fetch
of a _separate_ source — and **only public repos are ever added as submodules**.

### 1.5 What exists today (verified, 2026-06-21)

| Fact                                                           | Verified value                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kitelev/exoas-exo-reqs` visibility                            | **PUBLIC** (functional requirements ABox; RFC 0003 P0)                                                                                                                                                                                                             |
| `kitelev/exoas-req` visibility                                 | **PUBLIC** (the `req` TBox)                                                                                                                                                                                                                                        |
| `kitelev/exoas-exo` visibility                                 | **PUBLIC** (the `exo` ontology)                                                                                                                                                                                                                                    |
| `kitelev/exocortex` existing submodules                        | **`exoas-exo`** (`packages/exoas-exo`) + **`exoas-exocmd`** (`packages/exoas-exocmd`), both **PUBLIC**, HTTPS URLs (`.gitmodules`, `origin/main`) → **the submodule mechanism is already in use in this repo.** Only `exoas-exo-reqs` is a _new_ submodule to add. |
| `ci.yml` checkout                                              | already uses **`submodules: recursive`** in 6 checkout steps → existing CI **already fetches all submodules** (so the only-public-submodule invariant is already **repo-wide**, not docs-job-scoped)                                                               |
| `kitelev/exocortex` GitHub Pages                               | **Not configured** (`GET /repos/.../pages` → 404) → first publish is a genuinely fresh outward-facing action                                                                                                                                                       |
| Existing docs-site generator / Pages workflow on `origin/main` | **None** (no mkdocs/docusaurus/`.nojekyll`/gh-pages)                                                                                                                                                                                                               |
| Existing workflows                                             | `ci.yml`, `ci-image.yml`, `auto-release.yml`, `codeql.yml`, `e2e-desktop.yml`, `eka-gui-e2e.yml`, `eka-obsidian-leg-e2e.yml`, `npm-publish-cli.yml`, `security.yml` — a **new** `living-docs.yml` is needed                                                        |

## 2. Goals

1. **A browsable per-repo documentation site** on GitHub Pages for
   `kitelev/exocortex` (MVP): its architectural decisions (`.archgate` ADRs) +
   its functional requirements (via the `exoas-exo-reqs` submodule) +
   ontology (via the `exoas-exo` submodule), rendered **from the graph**.
2. **Privacy guaranteed by construction**: a **PAT-less** build that physically
   cannot fetch any **separately-private** repo. Leak of separately-private
   knowledge is impossible because that private graph is **absent** from the build
   context — not because a filter was applied. (Data already committed to a
   _public_ repo/submodule is out of scope — it is already public; §5.)
3. **Per-repo model**: documentation is scoped to one repo + its **public**
   submodules. No cross-repo aggregation that could mix audiences. (Other repos
   get their own docs in a later, post-MVP phase.)
4. **Explicit, reversible-by-design publication control**: the site re-publishes
   only when a **pinned submodule pointer is bumped** (a conscious act), and the
   **first** Pages enablement / first publish requires **explicit Andrey
   confirmation** (outward-facing + irreversible).
5. **No new ontology class** (this is a publication layer, not a model change) —
   `/rfc`, not `/onto-rfc`. No `exo__AssetSpace_visibility` property is introduced
   (Q3): "publishable" is defined by "is a public submodule," which the PAT-less
   build enforces for free.

## 3. Proposed solution

### 3.1 Principle — fail-closed by absence (PAT-less air-gap)

The privacy model is **one mechanism, structural**: the docs-build workflow runs
with **no credential that grants access to any private repo**. Concretely:

- The workflow checks out `kitelev/exocortex` (public) and runs `git submodule
update --init` over **HTTPS without authentication** to a private repo.
- Public submodules (`exoas-exo`, `exoas-exo-reqs`) fetch fine (no auth needed).
- A **private** submodule, were one ever added, would require credentials the
  workflow does not have → `git submodule update` **fails** → the build **fails**
  → **nothing is published**. This is **fail-closed by construction** (§5
  acceptance gate).

> **The default `GITHUB_TOKEN` does not weaken this.** A workflow's automatic
> `GITHUB_TOKEN` is scoped to the _repo running the workflow_; it cannot read
> _other_ private `kitelev/*` repos. So even the default token preserves the
> air-gap for cross-repo private access. The workflow additionally **must not**
> inject any user PAT with broad scope (that would be the one way to break the
> air-gap — forbidden, §5).

This is exactly the `default-deny` boundary RFC 0003 §3.2 anticipated, realized
as **absence** rather than **allowlist**: there is no list to keep in sync, no
filter to forget. The set of publishable repos _is_ the set of public submodules,
and that set is enforced by the credential-free fetch.

### 3.2 Content — per-repo: ADRs (in-repo) + requirements + ontology (public submodules)

For the MVP repo `kitelev/exocortex`, the site renders three sources from a single
checkout:

| Source                            | Where it lives                                                | Rendered as                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Architectural / NFR decisions** | `.archgate/*.md` (in the main repo)                           | ADR pages (the architectural requirements — RFC 0003 §3.9)                                                                                |
| **Functional requirements**       | `exoas-exo-reqs` **submodule** (`req__Requirement` instances) | Requirement pages: Gherkin Given/When/Then body, status (Draft/Approved/Deprecated — Q6), `_covers`, `_verifiedBy` coverage, traceability |
| **Ontology**                      | `exoas-exo` **submodule** (`req`/`exo` classes + properties)  | Browsable class/property reference the requirements link into                                                                             |

Rendering is **from the graph** (RFC 0003 §5): the generator parses the RDF
frontmatter of the requirement/ontology assets (the same parse the
`@kitelev/exocortex-cli` already does) and the ADR markdown, and emits static
HTML/markdown. It does **not** render `.feature` files (none exist; RFC 0003 §1).

### 3.3 Submodule wiring — only public repos, pinned pointers

- `exoas-exo` is **already** a submodule (`packages/exoas-exo`, HTTPS, PUBLIC), as
  is `exoas-exocmd`. The **only new** wiring is adding **`exoas-exo-reqs`** to
  `.gitmodules` with an **HTTPS** URL
  (`https://github.com/kitelev/exoas-exo-reqs.git`) — HTTPS is the
  PAT-less-friendly transport for _public_ repos (no auth needed to clone). The
  existing submodules confirm the transport already works here.
- **Invariant (privacy-critical, repo-wide):** _only public repos are ever added
  as submodules of a repo whose docs are published._ Because `ci.yml` already
  checks out `submodules: recursive` (§3.4), this invariant is **enforced
  repo-wide**, not just for the docs job — and it is **self-enforcing under
  credential-free fetch**: a private submodule fails the credential-free fetch and
  breaks **every** recursive-checkout job (fail-closed), so a violation cannot
  silently ship.
- **Pinned pointers + bump-to-publish.** The submodule pointer pins an exact
  commit → the docs build is **reproducible**, and re-publishing the site is a
  **conscious act** (bump the pointer) rather than an automatic side effect of an
  upstream commit. This gives Andrey explicit control over _what_ is published and
  _when_ — which is exactly the "first/each publish is deliberate" property Goal 4
  wants. (Alternative `git submodule update --remote` = always-latest but
  non-reproducible and auto-publishing — rejected for MVP, §5.)

### 3.4 Build — PAT-less GitHub Action

A **new** workflow `.github/workflows/living-docs.yml` (name TBD in impl):

- **Trigger:** `workflow_dispatch` (manual — the first publish; see §5) and, post-
  greenlight, `push` to `main` filtered to paths that affect the docs
  (`.archgate/**`, `docs/**`, the submodule pointers, the generator).
- **Checkout:** `actions/checkout` with `submodules: recursive`. This fetches the
  **public** submodules over HTTPS with the default token only.
  ⛤ **Reality check (verified):** `ci.yml` _already_ checks out
  `submodules: recursive` in **6 jobs** (it already consumes `exoas-exo` /
  `exoas-exocmd`). So adding a public `exoas-exo-reqs` submodule means those
  **existing recursive jobs will also fetch it** — which is fine because it is
  public. Consequence: the only-public-submodule invariant is **repo-wide** (any
  submodule must be public), not docs-job-scoped. **Safety upside:** a private
  submodule would break **all** recursive CI jobs (fail-closed repo-wide) — an
  even stronger guard than a docs-job-only check. (The general fact that
  `actions/checkout` defaults to _not_ fetching submodules holds — it's just that
  this repo's jobs already opt in.)
- **No PAT.** The workflow injects **no** user PAT / no broad-scope secret into
  git or the generator. The default `GITHUB_TOKEN` (repo-scoped) is the only
  credential, and it cannot reach other private repos (§3.1).
- **Generate:** run the docs generator (§3.5) → static site into `./_site`.
- **Deploy:** `actions/upload-pages-artifact` + `actions/deploy-pages` →
  GitHub Pages.

### 3.5 Generator — a CLI subcommand or a small docs-site builder

Design intent (final shape settled in implementation): the generator is most
naturally an `@kitelev/exocortex-cli` subcommand (the established `audit`-/
`requirements`-subcommand pattern, RFC 0003 §3.6/P1), e.g. `exocortex-cli
requirements pages --vault <checkout> --archgate .archgate --out ./_site`. It:

1. Loads the `req__Requirement` ABox from the `exoas-exo-reqs` submodule +
   the `exoas-exo` ontology submodule (single checkout; no cross-repo fetch).
2. Loads `.archgate/*.md` ADRs from the in-repo path.
3. Renders requirement pages (Gherkin body + status label + coverage/traceability
   derived from the same `requirements audit` data RFC 0003 P1 produces) + ADR
   pages + an ontology reference + an index/landing page.
4. Emits a static, Jekyll-free site (`.nojekyll`) into `--out`.

Reusing the CLI keeps the render **from the graph** (Goal 1) and reuses the
existing RDF parse + `requirements audit` coverage data, rather than a parallel
parser.

### 3.6 Status labels (Q6 — publish all statuses, marked)

All requirement statuses are published — `Draft`, `Approved`, `Deprecated` —
each **explicitly labelled** on its page (badge/marker). Rationale: every
requirement here comes from a **public** repo (no privacy concern; the air-gap
already guarantees that), so showing in-progress work is a _transparency_ choice,
not a privacy one. Andrey chose maximum process transparency. (The generator must
render the status prominently so a reader never mistakes a `Draft` for an
approved requirement.)

## 4. Architecture (data + repo edges)

```
kitelev/exocortex (PUBLIC, the published repo)
├── .archgate/*.md ───────────────► ADR pages (architectural / NFR requirements)
├── docs/rfc/000N ────────────────► (existing repo docs; in scope as repo docs)
├── submodule exoas-exo      (PUBLIC, ALREADY present) ─► ontology class/property reference
└── submodule exoas-exo-reqs (PUBLIC, NEW)             ─► req__Requirement pages (Gherkin + status + coverage + traceability)
                                          │
       generator (exocortex-cli, from-graph) ──► ./_site (static)
                                          │
       living-docs.yml  (PAT-less: no private-repo credential) ──► GitHub Pages
                                          │
       fail-closed: a private submodule → credential-free fetch FAILS → build FAILS → no publish
```

The **only** trust boundary is the credential set of the build: with no PAT, the
private graph is unreachable. Everything downstream (which queries run, how pages
render) operates on a checkout that **contains only public data**, so it cannot
leak private data even if a query is wrong.

## 5. Acceptance gate — ZERO leak of separately-private data, by construction (BLOCKING)

> This is the load-bearing gate. It is **blocking**: a violation prevents
> publication. **Scope (honest):** it guarantees zero leak of _separately-private_
> data (anything in a private repo); data accidentally committed to a _public_
> repo/submodule is out of scope — it is already public at commit time and Pages
> adds no net exposure (see the output-scan rejection below).

**Guarantee (structural, fail-closed):** the docs-build workflow runs with **no
credential granting access to any private repo**. Therefore:

1. **Build-time air-gap.** `git submodule update --init` runs with only the
   repo-scoped `GITHUB_TOKEN` (no user PAT). Public submodules fetch; a **private**
   submodule **cannot** be fetched → the step **fails** → the workflow **fails** →
   **no deploy**. The leak path is closed by _absence of the data_, not by a check
   that could be forgotten. Because `ci.yml` **already** fetches submodules
   recursively (§3.4), this fail-closed property protects the **whole** repo's CI,
   not only the docs job — any private submodule breaks **every** recursive job.
2. **Verifiable, not assumed.** The guarantee is auditable by inspecting the
   workflow YAML: it MUST contain **no** PAT / broad-scope secret passed to git or
   the generator. This is a one-line review check (and a candidate `archgate`
   whole-tree rule: "`living-docs.yml` references no `secrets.*` token beyond the
   default `GITHUB_TOKEN`"). "Verified" here means _the absence of the credential
   is inspectable in the build config_ — a structural fact, not a runtime hope.
3. **First publish = explicit Andrey confirmation.** Pages is **not yet enabled**
   on `kitelev/exocortex` (verified: 404). Enabling Pages and the **first** deploy
   are **outward-facing and irreversible** (indexed/cached). They require
   **explicit Andrey confirmation** — they are **not** done autonomously. The MVP
   workflow ships behind `workflow_dispatch` (manual) so the first run is a
   deliberate human act; auto-on-push is enabled only after Andrey greenlights it.

**Output-scan considered and rejected (Q4 — Andrey's decision).** A third layer —
scanning the _generated output_ for private markers (known private UIDs,
denylisted T-Bank terms) — was proposed (spike Option D1, layer 3) and **rejected**:

- The PAT-less air-gap already closes the boundary at the **repo level** — the
  unit at which audience is actually decided (RFC 0003 §3.2).
- The _only_ residual an output-scan would catch is private data **accidentally
  committed to a public repo**. But such data is **already public the moment it
  was committed** — Pages does not increase its exposure, and a scan at publish-
  time adds no net protection over ordinary public-repo data hygiene. (It would
  also carry an ongoing denylist-maintenance cost.)
- Therefore "ZERO private leak, verified" is delivered by the **structural** gate
  (1)+(2), not by an output filter. This honors the RFC-0003 "verified, not
  assumed" intent: the verification is the _inspectable absence of a private-repo
  credential_, which is stronger than a best-effort string scan.

## 6. Phasing — implementation plan (sequential PRs, for the follow-up child)

> ⛔ **None of this is built by this RFC.** Implementation is a **separate
> follow-up child session, after Andrey reviews this written RFC** (§8). The
> phases below are the decomposed plan that child will execute.

| Phase                                                 | Deliverable                                                                                                                                                                                                                                                                                                                                                     | Privacy invariant                                  | Gate               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| **MVP-1 — Submodule wiring**                          | Add **`exoas-exo-reqs`** as a **public** HTTPS submodule of `kitelev/exocortex` (`.gitmodules`, pinned pointer). `exoas-exo` is **already** present (`packages/exoas-exo`). Verify the new public submodule fetches cleanly in **all** `submodules: recursive` jobs (`ci.yml` already opts in — 6 jobs); confirm the repo-wide only-public-submodule invariant. | only-public-submodules (repo-wide, self-enforcing) | CI green           |
| **MVP-2 — Generator**                                 | `exocortex-cli requirements pages` (or equivalent): from-graph render of ADRs + requirements (Gherkin + status labels + coverage/traceability) + ontology reference → static `_site`. **Local only — no publish.** Unit-tested against the submodule fixtures.                                                                                                  | reads only the (public) checkout                   | CI green           |
| **MVP-3 — PAT-less build (no publish yet)**           | `living-docs.yml` with `submodules: recursive`, **no PAT**, builds `_site` as a CI artifact. Add the `archgate`/review check "no private-repo credential in the workflow." Prove fail-closed: a test private-submodule (or a unit test of the invariant) makes the build fail.                                                                                  | **fail-closed PAT-less air-gap** (§5)              | CI green           |
| **MVP-4 — Pages deploy (⛔ explicit Andrey confirm)** | Enable GitHub Pages on `kitelev/exocortex`; `workflow_dispatch` deploy. **First enable + first publish require explicit Andrey confirmation** (outward-facing, irreversible). After greenlight, optionally add path-filtered `push`-to-`main` auto-deploy on submodule-pointer bumps.                                                                           | first-publish human gate                           | **Andrey confirm** |
| **EXPAND — per-repo docs (post-MVP)**                 | Extend the per-repo model to other **public** repos (each `exoas-*` public repo gets its own docs site/section). Same PAT-less invariant per repo.                                                                                                                                                                                                              | per-repo air-gap                                   | —                  |

(The original carved plan's "visibility-allowlist" sub-step is **superseded** by
the submodule model — "publishable" = "is a public submodule", no separate
allowlist. The "output-scan gate" sub-step is **rejected**, §5.)

## 7. Verify-before-assert — the three spike findings (re-verified 2026-06-21)

The spike's safety argument rests on three findings; all three were independently
re-verified at the start of this session (`gh repo view --json visibility`):

1. **Name-based allowlist is UNSAFE.** `exoas-concepts-public` is named "public"
   but is **PRIVATE** (re-verified). → Publishing "everything `*-public`" would
   leak a private repo. **Repo name is not a source of truth.** The submodule
   model sidesteps this entirely: a repo is published only if it's an _actual
   public submodule_ that a credential-free fetch can pull.
2. **Doc annotations drift from reality.** `exoas-shared-identities` is documented
   in CLAUDE.md (EKA + Profile sections) as part of the 🌐 TS-floor, but is
   **PRIVATE** (re-verified). → CLAUDE.md `🌐/🔒` markings are not a source of
   truth either.
3. **Registry descriptors carry no visibility field.** `exo__AssetSpace`
   descriptors have `_source`/`_namespace`/`_dependsOn` but **no `_visibility`**
   (spike finding). → A declarative homoiconic allowlist does not exist today. The
   submodule model means we don't need to introduce one (Q3): publishability is
   defined operationally by the credential-free fetch, not declaratively.

**Conclusion:** the only trustworthy "is this public?" signal is **actual GitHub
repo visibility / clone-ability without credentials** — which the PAT-less
submodule build consumes _directly_ (a private repo simply won't fetch), with no
intermediary list of names, doc markings, or descriptor properties to drift.

## 8. Definition of Done (this RFC's scope = design only)

- [ ] This RFC merged into `kitelev/exocortex` (docs-only, CI green).
- [ ] Implementation tracked as WBS nodes under the "Living Documentation"
      subproject (carved node `2efdb0b3`): **interview** node (Done), **RFC**
      node (Done after merge), **impl** phases MVP-1…MVP-4 + EXPAND (Backlog).
- [ ] **Andrey reviews this written RFC.** Implementation starts only **after**
      his approval (a separate follow-up child) — this RFC builds **no code**.

(Implementation DoD lives in the impl-phase tasks, not here. The first live
publish — MVP-4 — additionally requires explicit Andrey confirmation, §5.)

## 9. Interview record (Andrey, 2026-06-21) — Q1–Q7 locked

The interview was conducted one question at a time (Andrey's request). Decisions:

| #      | Question                                                                         | Andrey's decision (verbatim intent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | Privacy model — how many independent locks between private data and publication? | **"У CI, который собирает документацию, не будет PAT, таким образом риск утечки непубличных знаний будет исключён."** → **PAT-less air-gap as the single structural guarantee** (fail-closed by absence). Reframed the model from "filter" to "the private graph is never fetched." Earlier in the same answer: **"рабочие данные T-Bank, личные заметки не должны как-либо использоваться в требованиях"** — the governing principle.                                                                                                         |
| **Q2** | Scope — what to publish among public content?                                    | **"Для каждого гит-репо должна быть отдельная документация. Для MVP она должна быть только в основном гит-репо kitelev/exocortex."** + **"добавить гит-репо exoas-exo и exoas-exo-req сабмодулями в kitelev/exocortex"** → **per-repo docs; MVP = `kitelev/exocortex` with `exoas-exo` + `exoas-exo-reqs` as public submodules.** _Factual note:_ `exoas-exo` is _already_ a submodule of the repo (`packages/exoas-exo`), so only `exoas-exo-reqs` is newly added — the submodule pattern is already proven here, which strengthens the idea. |
| **Q3** | Source of truth for "public"?                                                    | Subsumed by Q2: **the set of public submodules** is the source of truth. **No new `exo__AssetSpace_visibility` property** is introduced — PAT-less + public-submodule-only is self-sufficient.                                                                                                                                                                                                                                                                                                                                                 |
| **Q4** | Add a fail-closed output-scan acceptance gate?                                   | **"Нет — PAT-less достаточно."** → **Output-scan rejected.** Acceptance = the structural fail-closed PAT-less build (§5). Rationale recorded: the air-gap closes the repo-level boundary, and the only residual (private data committed to a _public_ repo) is already public at commit time.                                                                                                                                                                                                                                                  |
| **Q5** | Where does the build run?                                                        | **PAT-less GitHub Action** (answered within Q1: "у CI … не будет PAT").                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Q6** | Only `Approved` requirements, or all statuses?                                   | **"Все статусы (с явной пометкой)."** → publish `Draft`/`Approved`/`Deprecated`, each explicitly labelled. (Transparency choice; no privacy impact since all sources are public.)                                                                                                                                                                                                                                                                                                                                                              |
| **Q7** | RFC type / author?                                                               | `/rfc` structure, **in-repo `docs/rfc/0004-living-documentation.md`**, written by the `al-livingdocs` child (this session). Not `/onto-rfc` (no new ontology class).                                                                                                                                                                                                                                                                                                                                                                           |

## 10. Open questions / risks (for implementation)

- **Submodule freshness vs reproducibility.** Pinned pointer (chosen for MVP:
  reproducible + deliberate publish) means the site goes stale until a pointer
  bump. A periodic/triggered "bump-to-publish" job could automate freshness while
  keeping the explicit-publish property — settle in impl.
- **Generator shape.** CLI subcommand (`requirements pages`) vs a standalone
  `docs-site/` builder — settle in MVP-2; CLI is recommended (reuses the graph
  parse + `requirements audit` coverage data).
- **`req__Requirement` ABox readiness.** RFC 0003 P0 created `exoas-exo-reqs` and
  seeded requirements; P1/P2 (the checker + migration) populate coverage data.
  The Pages coverage/traceability rendering is richest once RFC 0003 P1 ships —
  MVP can render requirements + ADRs first and add coverage as P1 lands.
- **`archgate` rule for the credential invariant.** A whole-tree rule
  ("`living-docs.yml` carries no broad-scope secret") would make the air-gap a
  _required CI check_ — recommended hardening, settle in MVP-3.
- **Default-token reach.** Re-confirm at impl time that the repo's default
  `GITHUB_TOKEN` cannot read other private `kitelev/*` repos under the org/user
  settings in force (it should not — token is repo-scoped — but verify, don't
  assume).

## Sources

- **RFC 0003** (`docs/rfc/0003-requirements-management.md`, `origin/main`): §3.2
  (per-module storage boundary pre-resolves Pages fail-closed), §3.9 (ADR vs BDD
  federation), §5 (query-time allowlist rejected for storage), §6 (P4 carved), §8
  (follow-up: create the separate Living-Documentation RFC).
- **Design spike** (`al-livingdocs-spike`, 2026-06-21): options A–D, recommendation
  D1, the three verify-before-assert findings, verified visibility of 62 repos.
- **Live verification (2026-06-21, this session):** `gh repo view` — `exoas-exo`,
  `exoas-exo-reqs`, `exoas-req` PUBLIC; `exoas-concepts-public`,
  `exoas-shared-identities` PRIVATE; `kitelev/exocortex` Pages = 404 (not enabled);
  no existing Pages workflow/generator on `origin/main` (`638ad676`).
- **EKA Profile apply-model** (CLAUDE.md): sensitive assetspaces physically absent
  outside an active profile — the "fail-closed by absence" primitive reused here.
- **GitHub Actions**: `actions/checkout` (`submodules:` opt-in), default
  `GITHUB_TOKEN` repo-scoping, `actions/deploy-pages` — to be grounded against the
  current action docs at implementation time.
