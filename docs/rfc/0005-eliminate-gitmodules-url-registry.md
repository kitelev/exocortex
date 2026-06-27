# RFC 0005 — Eliminate the `.gitmodules` URL-registry (derive AssetSpace URL from its folder path)

|                 |                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**      | **v2 — Accepted (Phase 0 → Phase 1); prerequisites DONE.** v1 was design-only, gated on Andrey's scope decision; that gate is now **resolved** — both grounding prerequisites landed (all canonical vaults are git-free, §0) and the orchestrator (under Andrey's delegation) elected the RFC's own recommended path **Phase 0 → Phase 1**. **Phase 0** (the `deriveUrl` enabling primitive) is being built **this cycle** under req-first SDD; **Phase 1** (stop writing `.gitmodules` on the REST path) is the next follow-up. **Phase 2 is now N/A** (no git-superproject vaults remain to de-submodule, §6).                                                                   |
| **Author**      | `.gitmodules` distribution investigation (`al-gitmodules-distrib` child, AI) + Andrey interview, 2026-06-27. **v2** (`al-rfc0005-gitmodules` child): prerequisites recorded DONE + git-free grounding corrected, 2026-06-27.                                                                                                                                                                                                                  |
| **Scope**       | The **device-side role** of `.gitmodules` in AssetSpace distribution, and whether it can be removed by deriving the git URL from an AssetSpace's folder path. Not a new ontology class (no `/onto-rfc`). Touches repo-side machinery (`derivePath`/`deriveUrl`, REST/git mount adapters, bootstrap re-fetch) → lives in-repo. |
| **Supersedes**  | —                                                                                                                                                                                                                                                                                                                          |
| **Revises**     | Re-opens the **D6 triage** (`794a95ae`, PR #3582, 2026-06-16) which closed "is `.gitmodules` vestigial?" as **not-a-bug**. That triage's premise — _"there is no other source of remote URL after a fresh clone"_ — is **incomplete**: it did not consider the folder path itself as a derivable URL source (§4).             |
| **Tracking**    | `al-gitmodules-distrib` child investigation under **Exocortex Alpha Launch** `[[f33732f4-410e-424a-91e2-9e894f68e2de]]`. (Orchestrator owns the WBS-node placement for this investigation/RFC.)                                                                                                                               |

> **Why in-repo (not a vault asset):** like RFC 0001–0004, this proposal touches
> **repo-side machinery** — a pure derivation function in `packages/core`, the
> REST/git mount adapters in `packages/obsidian-plugin`, the CLI bootstrap/
> assetspace commands, and the git-superproject structure of the vaults. It is
> versioned next to the code it changes.

> **Grounding (verify-before-assert), v2:** every reality claim is grounded against
> exocortex `origin/main` (`c9f012f9`, verified current 2026-06-27) and against the
> **live canonical vaults** under `/Users/kitelev/vaults/` (`vault-my`, `vault-tbank`,
> `vault-exodev`) — **all git-free** (tarball mounts, no `.git`; verified 2026-06-27)
> — plus the live GitHub AssetSpace repos (`gh api`, 2026-06-27). The legacy git-vault
> `/Users/kitelev/vault-2025` referenced by v1 is **decommissioned** (graveyard,
> reversible) and is no longer a live path (§0). Where a claim is design intent rather
> than verified fact, it is marked as such.

> **Decision provenance:** this RFC exists because Andrey's vision question
> ("what role do `.gitmodules` play in AssetSpace distribution?") turned out to
> rest on a **falsified mechanism** (§1.3), and his follow-up insight — _"the git
> URL is computable from the AssetSpace folder path, so why store it in
> `.gitmodules`?"_ — is **architecturally valid but lossy** (§4). The interview is
> recorded verbatim in §9.

---

## 0. v2 changelog — prerequisites DONE + git-free grounding (2026-06-27)

v1 was written while `/Users/kitelev/vault-2025` was still a **live git superproject**
(10 gitlinks) and explicitly held: _"Phase 1 (git-free) doesn't touch them; Phase 2
would need a one-time de-submodule migration"_ (§10.4). Two prerequisite migrations
have since landed, which **change the grounding and simplify the phasing**:

| Prerequisite | Status | Evidence |
| --- | --- | --- |
| **P1 — vault-2025 (last legacy git-vault) decommissioned** | ✅ **DONE** (2026-06-27) | losslessly reconstituted into the canonical git-free `vault-my`/`vault-tbank`, then `mv`'d to graveyard `/Users/kitelev/vault-graveyard-1782569496/vault-2025-root` (reversible; git HEAD `5104935f1` intact). No longer at the live path. |
| **P2 — vault-exodev migrated to git-free** | ✅ **DONE** | `vault-exodev` is a tarball-mount vault (no `.git` in root nor in any `assetspaces/exoas-*`; verified 2026-06-27). |

**Net effect — all three canonical vaults are now git-free:**

| Vault (`/Users/kitelev/vaults/`) | `.git`? | `.gitmodules` text file | git submodule gitlinks |
| --- | --- | --- | --- |
| `vault-my` | none (tarball mount) | 7 stanzas | **0** |
| `vault-tbank` | none | 13 stanzas | **0** |
| `vault-exodev` | none | 15 stanzas | **0** |

So **every device vault's `.gitmodules` is now exactly the "pure text URL-registry with no git mechanism behind it"** that v1 §3.3 found on 7-of-17 vault-2025 stanzas — now it is **100% of stanzas on 100% of vaults**. The file is still written (REST mount path via `vault.adapter`) and physically present, on vaults that have no git at all — the precise "git-named file on a non-git vault" awkwardness Andrey raised (§5 goal #1). This is the strongest possible motivation for the RFC, and it is now **universal**, not a vault-2025-only edge.

**Two consequences for the plan:**

1. **The v1 blocker is cleared.** v1 implicitly required Phase 1 to wait until no live git-vault depended on real submodule gitlinks. With vault-2025 retired and every canonical vault git-free, **Phase 1 is now the universal device-side target** — there is no live git-superproject vault that would break.
2. **Phase 2 is now N/A for canonical vaults.** v1 §6 Phase 2 ("de-submodule the desktop git vaults: vault-2025/vault-exodev, 10 gitlinks each") **no longer has a subject** — those git-superproject vaults no longer exist in active use. The only remaining holders of real `.gitmodules`+gitlinks are the **exocortex dev repo** (`packages/exoas-*` — a build/CI concern, not device distribution) and the **graveyard** (out of active use). Phase 2's reproducibility trade-off (§6, §10.2) is therefore moot for the distribution stack.

The recommended path collapses to **Phase 0 → Phase 1**. Everything from §1 onward is the original v1 analysis; counts/claims that v1 grounded against the now-retired vault-2025 are annotated inline.

---

## 1. Context & problem

### 1.1 The vision (verbatim, 2026-06-27)

> «Какую роль играют .gitmodules в инфраструктуре механизма распространения
> ассетспейсов? Мой вижн в том, что .gitmodules есть только в самих гит-репо,
> чтобы корректно проходил CI (проверка broken wikilinks, когда есть ссылки на
> ассеты в онтологиях, которые не в этом ассетспейсе), но локально (на айфон и
> макбук) они не скачиваются, так как вся синхронизация идёт через ExoSync.»

This is a **hypothesis to verify**, not a spec. Investigation falsified its core
mechanism and surfaced a different (valid) simplification.

### 1.2 What `.gitmodules` actually is — the verified map

**Who WRITES `.gitmodules`** — always the **vault superproject on the device**,
never an AssetSpace repo:

| Writer | How |
| --- | --- |
| CLI `bootstrap` / `assetspace-add` / `assetspace-remove` → `BootstrapAssetSpaceService.ensureGitmodulesEntry` | git-free text stanza |
| CLI `CliApplyProfileService` (on materialise) | `mount.ensureGitmodulesEntry` |
| Plugin `RestAssetSpaceMount.mount()` (iPhone + post-#3567 desktop REST path) | `appendGitmodulesEntry` via `vault.adapter` — **no git binary, no gitlink** |
| Plugin `GitSubmoduleOps` (legacy desktop-git path) | real `git submodule add` |
| Core `AssetSpaceMount.ts` | shared text transforms (`appendGitmodulesEntry` / `stripGitmodulesEntry` / `escapeGitmodulesRegex`) |

The emitted stanza is the canonical single-space form:
`[submodule "<path>"]\n\tpath = <path>\n\turl = <url>\n`.

**Who READS `.gitmodules`** — only device-side **rediscovery** flows:

| Reader | Live? | Reads |
| --- | --- | --- |
| `BootstrapAssetSpaceCommands.fetchTrackedAssetSpaces()` (state `clone-needs-fetch`) | ✅ | path **+ url** → re-materialise each AssetSpace from its recorded URL |
| `Unmount assetspace` → `readGitmodulesEntries()` | ✅ | path + url — the "what's mounted" registry the picker lists |
| `ProfileApplyManager` / `CliApplyProfileService` apply-profile | ✅ | path — toDestroy/toMaterialise diff; entries **preserved** post-destroy as switch-back registry |
| **ExoSync** (`packages/core/src/services/sync/`) | — | **does NOT read `.gitmodules`** (0 references; remote URL comes from frontmatter descriptor `exo__AssetSpace_source ?? _git`) |
| **AssetSpace CI** broken-wikilinks/SHACL | — | **does NOT read `.gitmodules`** (AssetSpace repos have none) |

### 1.3 Vision vs reality — the mechanism is falsified

| Vision claim | Verified reality |
| --- | --- |
| 1. `.gitmodules` live in the AssetSpace repos themselves, for CI | ❌ **FALSE.** The `exoas-*` repos have **no** `.gitmodules` (`gh api`, 2026-06-27). `.gitmodules` lives only in the **vault** superproject. |
| 2. CI broken-wikilinks resolves cross-ontology refs via submodule-mount (`.gitmodules`) | ❌ **FALSE.** CI resolves cross-ontology refs via the **central registry `exo__AssetSpace_dependsOn` DAG** (§2), not submodules. |
| 3. On devices `.gitmodules` are not downloaded; sync is via ExoSync | ⚠️ **NUANCED.** `.gitmodules` is **not downloaded as AssetSpace content** and ExoSync indeed ignores it ✅ — **but the file is written locally and physically present on every device vault** as a URL-registry. _(v1 grounded this on "vault-2025 + vault-exodev each have 17 stanzas"; **v2:** vault-2025 is retired, and the three live git-free vaults carry 7/13/15 stanzas each — see §0.)_ |

So the vision is a **phantom mechanism**: the mental model of _where_ `.gitmodules`
live and _what_ they do for CI is inverted from reality. But the **spirit** of the
vision — "devices use no git-submodule machinery; distribution is via ExoSync /
descriptors" — is already largely true, and §4 shows the remaining device-side
`.gitmodules` _can_ be removed.

### 1.4 How the AssetSpace broken-wikilinks CI actually works (for the record)

Each `exoas-*` repo's `.github/workflows/ci.yml` is thin and calls a reusable
workflow `kitelev/exoas-ci/.github/workflows/assetspace-ci.yml@main` with
`resolve_deps: true`. The reusable workflow:

1. **resolve-deps** — `git clone kitelev/exoas-registry` (the central registry of
   `exo__AssetSpace` descriptors + `dependsOn` DAG), then
   `exocortex resolve-deps --registry <registry> --self <repo> --format urls`
   prints the transitive `dependsOn` closure's clone URLs.
2. **merge** — `rsync` the calling repo + every resolved dependency into **one
   merged vault** under one root (one link-index, one graph). _(The earlier
   `--also <dir>` approach produced false `sh:class` violations from the
   symbolic-vs-filename IRI mismatch across vault boundaries — issue #3523 — so
   deps are merged into one graph instead.)_
3. **validate** — `validate schema --shapes-mode --vault <merged>` (SHACL-lite,
   **blocking**): genuine `sh:Violation` fails CI (exit 1); unresolvable
   cross-vault refs are `sh:Warning` (open-world, do not fail). Plus
   `audit ontology-imports` (advisory, never blocks).

There is **no dedicated "broken wikilinks" CLI command**. "Broken wikilinks" =
SHACL needing to resolve `[[uid]]` structural references (`exo__Instance_class`,
`exo__Asset_isDefinedBy`, `exo__Class_superClass`, `exo__Property_domain`/`_range`)
to a target asset; merging the dependency ontologies (registry-driven) is what
lets cross-ontology refs resolve. **`.gitmodules` plays no part in this.** _(The
hard dangling-`[[uid]]` enforcement Andrey may be thinking of is the local
PreToolUse hook `validate-wikilinks.sh` at edit-time on the machine — not CI.)_

---

## 2. The two registries are NOT duplicates (different roles)

| | `exoas-registry` (central, GitHub) | `.gitmodules` (per-vault, device-local) |
| --- | --- | --- |
| **Holds** | `exo__AssetSpace` descriptors + `dependsOn` DAG | `path → url` stanzas |
| **Consumed by** | CI `resolve-deps` (cross-ontology validation); CLI profile resolver (effective set) | device rediscovery: clone-needs-fetch re-fetch, unmount listing, apply-profile switch-back |
| **Scope** | the whole ecosystem | one device's one vault |

This RFC is about the **second** one only.

---

## 3. Andrey's insight — derive the URL from the folder path

> «Я так и не понял, зачем нужен .gitmodules, ведь есть класс ассетов
> `exo__AssetSpace`, а URL гит-репо вычисляем по folderPath ассетспейса.»

Two sub-claims, examined against `derivePath` (`packages/core/src/services/AssetSpacePathDeriver.ts`):

### 3.1 Claim "the descriptor already holds the URL" — true, but chicken-and-egg

The `exo__AssetSpace` ABox descriptor carries the URL (`exo__AssetSpace_source ?? _git`),
and ExoSync already uses it. **But the descriptor file lives _inside_ the AssetSpace
folder** (verified: `exoas-exo/exo/*.md`, `exoas-registry/registry/*.md`; 35 descriptors
in vault-2025). When the folder is **empty** (clone-needs-fetch) or **destroyed**
(apply-profile unmount), the descriptor is gone too — so for exactly the rediscovery
flows that need the URL, the descriptor is unavailable. That is why a vault-root
registry (`.gitmodules`) exists.

### 3.2 Claim "the URL is computable from the folder path" — valid but **lossy**

`derivePath` maps **`url → assetspaces/<owner>/<repo>`** and in doing so **discards
host and scheme** — it normalises `https://`, `http://`, `ssh://`, `git://`,
scp-form `git@github.com:owner/repo.git`, embedded credentials, ports and the
`.git` suffix all to the **same** `assetspaces/<owner>/<repo>`. This is **many-to-one**,
and **no inverse `deriveUrl(path)` exists in the codebase** (verified: no
`deriveUrl`/`pathToUrl`/`reconstructUrl`).

Therefore `folderPath → url` is **not uniquely defined**: from
`assetspaces/kitelev/exoas-exo` you recover `kitelev/exoas-exo` but **not** the
host/scheme. Reconstruction requires **assuming `https://github.com/`**.

**Crucially, that assumption already holds for the entire current ecosystem:**
every `.gitmodules` URL across both vaults is `https://github.com` (verified
2026-06-27 — zero non-GitHub URLs). And `derivePath`'s own Maven-style design is
predicated on it: _"GitHub guarantees global uniqueness of `owner/repo`"_ (its
docstring). So the GitHub-https convention is **already de-facto baked in**.

**Conclusion:** Andrey is right — under the invariant **"every AssetSpace URL =
`https://github.com/<owner>/<repo>`"**, the URL becomes derivable from the folder
path, and `.gitmodules` as a **URL-store** becomes redundant. The single thing
lost is support for **non-GitHub / non-https** AssetSpace URLs (GitLab, SSH-only,
self-hosted, private custom-host) — of which **none currently exist**.

### 3.3 Additional finding — `.gitmodules` is already partly decoupled from git

v1 found vault-2025 had **17 `.gitmodules` stanzas but only 10 git submodule gitlinks**
(mode `160000`) — so **7 stanzas were already pure URL-registry with no git-submodule
mechanism behind them** (REST/apply-profile-managed AssetSpaces). `.gitmodules` was
**already** being used as a plain text registry beyond git's submodule machinery —
confirming the "it's a repurposed registry" reading and meaning a chunk of it was
trivially replaceable.

> **v2 update (§0):** this is now the situation on **100% of stanzas, 100% of vaults.**
> The last git-superproject vault (vault-2025, the 10-gitlink case) is retired; all
> three live canonical vaults are git-free, so **every** `.gitmodules` stanza on
> every device is now a pure text URL-registry with **zero** git-submodule mechanism
> behind it. The "trivially replaceable chunk" became the whole thing.

---

## 4. Why the prior D6 triage's "keep it" conclusion is incomplete

The D6 triage (`794a95ae`, PR #3582) examined all readers and concluded
`.gitmodules` is load-bearing because, after a fresh clone, **"there is no other
source of remote URL."** That premise omits **the folder path itself** as a URL
source (via a `deriveUrl` inverse under the GitHub convention). The triage was
correct that `.gitmodules` is _currently_ the only **stored** URL source; it did
not consider that the URL is **derivable** and so need not be stored at all. This
RFC re-opens that conclusion on that basis.

---

## 5. Goals

1. Remove `.gitmodules` as a device-side URL-registry (no git-specific sidecar on
   git-free iPhone vaults — closes the "git-named file on a non-git vault"
   awkwardness Andrey raised).
2. Make an AssetSpace's identity fully a function of `exo__AssetSpace` + the
   folder convention (homoiconicity-aligned: identity in the class + convention,
   not in a git sidecar).
3. **No regression** of the three device flows (clone-needs-fetch re-fetch,
   unmount listing, apply-profile switch-back) — each must keep working from a
   derived URL.
4. **No regression** of CI (already `.gitmodules`-independent) or ExoSync (already
   descriptor-driven).

**Non-goal:** supporting non-GitHub / non-https AssetSpace URLs. Adopting the
convention is an explicit, accepted trade-off (none exist today).

---

## 6. Proposed solution & phasing (sequential, each independently shippable)

The work splits cleanly into a **safe minimal** phase and a **deeper optional**
phase. Andrey decides how far to go.

### Phase 0 — the enabling primitive (small, low-risk, prerequisite for all) — ⏳ **IN PROGRESS this cycle**

Add a pure inverse `deriveUrl(path): string | null` to
`AssetSpacePathDeriver.ts`, mirroring `derivePath`:
`assetspaces/<owner>/<repo>` → `https://github.com/<owner>/<repo>` (validate
segments with the existing `SEGMENT_RE`; return `null` for non-conforming paths so
callers can fall back). Unit-tested round-trip:
`deriveUrl(derivePath(url)) === canonical-github(url)` for all GitHub inputs;
`null` for malformed. req-first SDD (`@req`), revert-verify. **Ships nothing
user-visible** — just the capability the later phases consume.

> **v2 — DRY refinement (grounded `c9f012f9`):** the `path → url` half of Phase 0
> **already exists**, duplicated, inside `toHttpsGitHubUrl(git)`
> (`packages/cli/src/services/CliApplyProfileService.ts:129`): it calls
> `derivePath(git)` then builds `https://github.com/${ownerRepo}` — exactly the
> inverse, minus segment validation (it trusts `derivePath`'s already-validated
> output). So Phase 0 is a **DRY extract**, not a green-field function: lift the
> reconstruction into `deriveUrl(path)` in `packages/core` (adding the `SEGMENT_RE`
> + traversal guards, since `deriveUrl`'s input is an untrusted folder path, not a
> `derivePath` output), then refactor `toHttpsGitHubUrl(git)` to
> `deriveUrl(derivePath(git)) ?? git`. Scope is `packages/core` + `packages/cli`
> only (no `packages/obsidian-plugin` change in Phase 0).

### Phase 1 — git-free (iPhone + post-#3567 REST desktop): stop writing `.gitmodules`

On the REST mount path (`RestAssetSpaceMount`), stop calling `appendGitmodulesEntry`
on mount; refactor the three readers to use `deriveUrl(folderPath)` instead of
`readGitmodulesEntries()`:

- **clone-needs-fetch / re-fetch** — enumerate the expected AssetSpace folders
  (filesystem `assetspaces/*/*` for present-empty dirs; for not-present, the
  `exo__Profile_includes` + registry descriptors), then `deriveUrl(path)` →
  re-materialise.
- **unmount listing** — list `assetspaces/*/*` folders (+ derived URL) instead of
  `.gitmodules` stanzas.
- **apply-profile switch-back** — resolve a destroyed AssetSpace's URL by
  `deriveUrl(its-folderPath)` (folderPath known from the Profile's effective set),
  not from a preserved `.gitmodules` entry.

Result: a git-free vault carries **no `.gitmodules`** at all. This is the targeted
fix for Andrey's stated discomfort and the lowest-risk way to validate the whole
idea in production.

> **v2 (§0):** with all three canonical vaults now git-free, Phase 1 is the
> **universal** device-side target — there is no remaining live git-superproject
> vault to special-case. The v1 "git-free (iPhone + REST desktop)" qualifier now
> covers every device.

### Phase 2 (optional, bigger) — de-submodule the desktop git vaults — ⛔ **N/A in v2 (no subject)**

> **v2 (§0):** this phase no longer has a subject. Its target — the real
> git-superproject vaults vault-2025/vault-exodev (10 gitlinks each) — **no longer
> exists in active use**: vault-2025 is retired (graveyard) and vault-exodev is
> git-free. The only remaining real `.gitmodules`+gitlinks live in the **exocortex
> dev repo** (`packages/exoas-*`, a build/CI concern — not device distribution) and
> the **graveyard** (out of use). The reproducibility trade-off below is therefore
> moot for the distribution stack; Phase 2 is dropped. The original analysis is
> retained for the record.

For real git superprojects (vault-2025/vault-exodev: 10 gitlinks each), `.gitmodules`
is **required by git itself** while gitlinks exist — you cannot just delete it.
Eliminating it means **stop treating AssetSpaces as git submodules** and instead
treat them as **ExoSync-managed, git-ignored materialisations** (like
`node_modules`): the superproject git tracks only authored content; AssetSpaces are
runtime state. Post-#3567 the apply path is already REST even on desktop, so the
submodule mechanism is largely vestigial there too.

**Trade-off to weigh (Andrey's call):** today the superproject's submodule pointers
(mode-160000 SHAs) give a **git-tracked, reproducible snapshot of exactly which
AssetSpace commit was mounted** (and feed the daily auto-backup). De-submoduling
loses that git-native reproducibility — ExoSync watermarks/manifests would become
the sole record of mounted versions. This is the main reason Phase 2 is separable
and may be declined even if Phase 1 ships.

### Recommended path

**Phase 0 → Phase 1**, then **stop**. _(v2: Phase 2 is dropped — §0/§6 — so there
is no longer a "re-evaluate Phase 2" tail; Phase 1 completes the vision.)_ Phase 1
delivers the vision (no `.gitmodules` on **any** device — now universal, since every
canonical vault is git-free) without touching the git-backup story, which lives only
in the dev repo + graveyard now.

**Status of this path (v2):** **Phase 0 is being built this cycle** (req-first SDD —
`deriveUrl` DRY extract, the §6 Phase 0 box); **Phase 1 is the next follow-up**.

---

## 7. Verify-before-assert — load-bearing findings (grounded 2026-06-27)

1. **`exoas-*` repos have no `.gitmodules`; CI is registry-driven** — `gh api`
   on exoas-exo/public/exocmd/registry/profiles: all have `ci.yml`, none has
   `.gitmodules`; `kitelev/exoas-ci/assetspace-ci.yml` uses `resolve-deps` +
   merge, not submodules.
2. **ExoSync has 0 `.gitmodules` references** — `grep` of `packages/core/src/services/sync/`;
   discovery via `spaceSpecCore` frontmatter (`exo__AssetSpace_source ?? _git`).
3. **`derivePath` is many-to-one, no inverse exists** —
   `AssetSpacePathDeriver.ts` drops host+scheme; no `deriveUrl` in the codebase.
4. **All current AssetSpace URLs are `https://github.com`** — both vaults'
   `.gitmodules`, zero exceptions → the GitHub-https invariant holds today.
5. **vault-2025: 17 stanzas, 10 gitlinks** — `.gitmodules` is already partly a
   plain registry decoupled from git submodules. **(v2: superseded by §0 — vault-2025
   is retired; all three live canonical vaults are git-free → 100% of stanzas are now
   pure registry, 0 gitlinks; verified `vault-my`/`vault-tbank`/`vault-exodev`
   2026-06-27.)**
6. **Descriptors live inside the AssetSpace folders** — 35 in vault-2025
   (`exoas-*/<ns>/*.md`) → the chicken-and-egg that motivates a vault-root
   registry, and the reason `deriveUrl` (not "read the descriptor") is the right
   replacement.
7. **D6 triage premise incomplete** — `794a95ae`/PR #3582 closed this as
   not-a-bug on "no other URL source"; folderPath is another (derivable) source.

---

## 8. Definition of Done (this RFC's scope = design only)

- [x] Verified map of who writes/reads `.gitmodules` across the distribution stack.
- [x] Vision falsified/reconciled with evidence (§1.3).
- [x] Andrey's "derive URL from folder path" assessed rigorously (§3) — valid, lossy, feasible under the GitHub invariant.
- [x] D6 triage re-opened with the missing premise (§4).
- [x] Phased implementation plan with trade-offs (§6).
- [x] **Scope decided (the "потом решим" gate is resolved):** prerequisites landed → all canonical vaults git-free (§0) → the orchestrator (Andrey's delegation) elected the RFC's own recommended path **Phase 0 → Phase 1**; **Phase 2 dropped as N/A** (no git-vault subject remains).
- [x] **v2 — grounding corrected:** prerequisites recorded DONE; stanza/gitlink counts re-grounded to git-free reality (§0, §1.3, §3.3, §7).

Implementation proceeds under req-first SDD: **Phase 0 (`deriveUrl` DRY extract) is being built this cycle**; **Phase 1 is the next follow-up**.

---

## 9. Interview record (Andrey, 2026-06-27)

| # | Andrey | Outcome |
| --- | --- | --- |
| Q1 | "Напиши подробно, как сейчас работает проверка broken wikilinks в CI гитхаба?" | Answered: reusable `exoas-ci` workflow, registry `dependsOn` DAG → merge → SHACL; `.gitmodules`-independent (§1.4). |
| Q2 | "То есть можно удалить все .gitmodules?" | Not as-is — load-bearing for 3 device flows; prior D6 triage (§4). |
| Q3 | "То есть .gitmodules сейчас создаётся даже на iphone, верно?" | Yes — `RestAssetSpaceMount.mount()` writes it git-free via `vault.adapter`, even on a non-git vault. |
| Q4 | "Зачем нужен .gitmodules, ведь есть `exo__AssetSpace`, а URL вычисляем по folderPath?" | Valid but lossy — `derivePath` drops host+scheme; recoverable only under the GitHub-https invariant, which holds today (§3). |
| Q5 | "Какой scope?" → **"Сначала RFC + детальный план, потом решим."** | This RFC. |

---

## 10. Open questions / risks (for the decision + any implementation)

1. **Non-GitHub URLs (accepted loss).** The convention forecloses GitLab/SSH/
   self-hosted/private-custom-host AssetSpaces. None exist; if one is ever needed,
   `deriveUrl` would return `null` and that AssetSpace would need an explicit URL
   carrier (re-introducing a per-vault registry for the exception only).
2. **Reproducibility (Phase 2).** Removing submodule gitlinks loses the
   git-tracked "which commit was mounted" snapshot + its role in the daily
   auto-backup. ExoSync watermarks become the sole version record. Weigh before
   Phase 2.
3. **Path-list source for not-materialised AssetSpaces.** Phase 1's re-fetch needs
   a list of "what should be here" when folders are absent — filesystem
   enumeration covers present-empty dirs; `exo__Profile_includes` + registry
   descriptors cover fully-absent ones. Confirm this fully replaces the
   `.gitmodules` path-list before removing the writes.
4. **Migration of existing vaults.** Existing vault-2025/vault-exodev have live
   `.gitmodules` + gitlinks. Phase 1 (git-free) doesn't touch them; Phase 2 would
   need a one-time de-submodule migration (handled as its own change).

---

## Sources

- exocortex `origin/main` `5032e8da` (2026-06-27): `packages/core/src/services/AssetSpacePathDeriver.ts`, `.../services/assetspace/AssetSpaceMount.ts`, `.../services/sync/spaceSpecCore.ts` (+ 0 `.gitmodules` in `sync/`), `packages/obsidian-plugin/src/infrastructure/adapters/{RestAssetSpaceMount,BootstrapAssetSpaceCommands,ProfileApplyManager,GitSubmoduleOps}.ts`, `packages/cli/src/{commands/{bootstrap,assetspace-add,assetspace-remove,resolve-deps,validate-schema,audit-ontology-imports}.ts,services/{BootstrapAssetSpaceService,CliProfileResolver,CliApplyProfileService}.ts}`.
- Live (v1): `/Users/kitelev/vault-2025/.gitmodules` (17 stanzas, 10 gitlinks, all github.com), `/Users/kitelev/vault-exodev/.gitmodules` (17 stanzas).
- Live (v2, 2026-06-27): canonical git-free vaults `/Users/kitelev/vaults/{vault-my,vault-tbank,vault-exodev}` — no `.git`; `.gitmodules` text registries of 7/13/15 stanzas, **0 gitlinks**, all github.com. vault-2025 retired → `/Users/kitelev/vault-graveyard-1782569496/vault-2025-root`. exocortex `origin/main` `c9f012f9` — `toHttpsGitHubUrl` at `packages/cli/src/services/CliApplyProfileService.ts:129` (consumes `derivePath`).
- GitHub (2026-06-27): `kitelev/exoas-{exo,public,exocmd,registry,profiles}` (no `.gitmodules`, `ci.yml` present); `kitelev/exoas-ci/.github/workflows/assetspace-ci.yml`.
- Prior triage: D6 node `794a95ae`, PR #3582 (2026-06-16).
