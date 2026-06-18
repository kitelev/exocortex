# ExoSync — GitHub-backed vault sync

> RFC `4e4dc453` (Phases A1/A2/A3, B, C2) · PRs #3457, #3459, #3460, #3461, #3462

ExoSync synchronizes the **materialized AssetSpace/FileSpace set** of a vault
directly against the spaces' GitHub repositories over the REST API. It needs no
Obsidian Sync subscription and no `git` binary — pull, merge and push all run
through HTTP (`requestUrl` in the plugin), so the same path works on desktop
and iOS. The engine itself
(`packages/exocortex/src/services/sync/SyncEngine.ts`) is platform-free; all
platform specifics (file access, credential storage, SHA-1, transport) are
injected ports composed by the plugin in
`packages/obsidian-plugin/src/infrastructure/adapters/SyncDepsFactory.ts`.

## How to use

1. **Configure a PAT.** Settings → Exocortex → _Profile: GitHub PAT_. The
   token is stored under the key `pat` in
   `.obsidian/plugins/exocortex/data.local.json` (`LocalSecretsStore`) — the
   `.local.` infix keeps it out of Obsidian Sync replication, and it is never
   committed. A fine-grained PAT with a per-repository allowlist scoped to
   your space repos is recommended. The sync engine is rebuilt from the
   currently stored PAT on every invocation, so a newly saved PAT is honoured
   without a reload.
2. _(Optional but recommended)_ **Configure a quarantine repo.** Settings →
   Exocortex → _ExoSync_ → _Quarantine repo URL_
   (`https://github.com/<owner>/<repo>`). Unresolvable conflicts are
   preserved there as both-versions entries. Leaving it empty is safe for
   AssetSpaces (conflicts simply re-derive on every sync); **FileSpaces
   refuse to sync without it** (their remote-wins policy destroys the local
   version, whose only surviving copy is the quarantine entry). The repo must
   contain at least one commit before the first flush.
3. **Run `Exocortex: Sync`** from the command palette (command id
   `exosync-sync`). The command is registered on both platforms,
   unconditionally; without a PAT it shows a "configure PAT" notice instead
   of hiding.

One run syncs every repo of the sync unit, children-before-parents (deeper
mount paths first), best-effort: one failing repo never blocks the rest. A
summary notice reports `pushed / pulled / merged / quarantined` counts;
per-repo warnings and details go to the developer console (`[ExoSync] …`).

### From the CLI (desktop)

The same sync runs from `@kitelev/exocortex-cli`, driving the identical
platform-free `SyncEngine` over `node:fs` ports instead of `vault.adapter`:

```bash
exocortex exosync sync  --vault <path> --token-from-gh   # full pull→merge→push
exocortex exosync pull  --vault <path> --token-from-gh   # apply remote only
exocortex exosync push  --vault <path> --token-from-gh   # send local delta only
# FileSpaces additionally require --quarantine-repo https://github.com/<o>/<r>
```

The token resolves like `exosync-parity` / `experimental rest-push`
(`--token-from-gh` → `--token` → `GITHUB_TOKEN` / `GH_TOKEN`). The CLI writes
the same `exosync-watermarks.local.json` the plugin uses, so the two share one
base. Exit codes: `0` all clean · `1` at least one repo unresolved/errored ·
`2` vacuous (no materialized AssetSpaces found). For a read-only divergence
check without writing, use `exosync-parity`.

> ⚠ The engine's D11 in-flight guard is per-process: do NOT run the CLI sync
> while the plugin is mid-sync on the same vault (watermark write is
> last-writer-wins across processes).

### What gets synced

The sync unit is collected from vault declarations
(`collectSyncRepoSpecs`): every asset whose `exo__Instance_class` references
`exo__AssetSpace` or `exo__FileSpace` (UUID-form wikilink), that has an
`exo__AssetSpace_source` (or legacy `_git`) of the form
`https://github.com/<owner>/<repo>`, and whose derived mount folder
(`assetspaces/<owner>/<repo>`) currently exists on disk. Unmounted spaces are
skipped silently; other source forms are skipped with a warning. The branch
is fixed to `main` (`SYNC_BRANCH`).

Within an AssetSpace only UID-bearing markdown participates: `*.md`, minus
any path containing the `.local.` infix (device-local artifacts) or
`.conflict.` (quarantine copies). This allowlist is applied symmetrically —
local snapshot, remote diff, pull-apply and delete-inference — so excluded
paths can never corrupt or be corrupted. FileSpaces sync **every** file
byte-exact instead (see below).

## Sync model

Per repo, one cycle is **pull → conflict check → merge → push**, orchestrated
around the pre-existing write primitive `restCreateCommit`
(`packages/exocortex/src/infrastructure/github/restCommit.ts`) — the GitHub
**Git Data API** 4-call chain: `GET git/refs/heads/{branch}` → `POST
git/trees` (multi-file, atomic) → `POST git/commits` → `PATCH
git/refs/heads/{branch}` with `force: false`. Reads use the same API family
(`githubRepoReader.ts`: refs, commits, trees, blobs). Binary files are
uploaded as base64 blobs (`POST git/blobs`) and enter the tree by SHA — plain
git content, no LFS.

- **Watermarks** (`FileWatermarkStore`). The 3-way base is a per-device,
  per-repo snapshot of the remote tree at the last fully-synced commit
  (`lastSyncedSha`, `rootTreeSha`, file list with blob SHAs and asset uids),
  stored in `.obsidian/plugins/exocortex/exosync-watermarks.local.json`. It
  is never trusted blindly: the stored root tree SHA is validated against
  the actual remote commit before any diff; a mismatch (backup restore,
  history rewrite, corrupt store) yields a `full-conflict` result and
  touches nothing.
- **Change detection** (`ChangeDetector`). Local identity is
  `exo__Asset_uid` from frontmatter where present: a renamed asset (same
  uid, new path) classifies as a modify with a `basePath`, not delete+add;
  uid-less files match by path; duplicate uids on disk degrade to path
  identity with a warning.
- **First sync.** Asset mode: the watermark bootstraps only when the local
  tree is _exactly_ identical to the remote head (fresh mount); any
  divergence is a `full-conflict` — nothing is overwritten. File mode builds
  a synthetic base from already-identical blobs and lets every divergence
  resolve through the remote-wins layer.
- **Convergence without CAS.** The write primitive has no expected-head
  parameter; a concurrent push surfaces as HTTP 422 on the final `PATCH`
  and the engine re-pulls, re-checks and retries, capped at 3 retries.
  After the cap, the contended files go to **terminal quarantine** and the
  watermark is not advanced (everything re-derives next sync). A residual
  race window (commit landing between the conflict check and the
  primitive's own ref read) is detected post-push and reported as a
  warning — the previous version stays recoverable from git history.
- **Pull-apply safety.** Remote changes land on disk only after the push
  succeeded, through atomic writes (temp file + rename), with a TOCTOU
  guard: a file the user edited mid-sync is skipped and _pinned_ in the
  watermark so the divergence re-derives next sync instead of being
  silently reverted. Unsafe remote paths (`..`, absolute, backslash) are
  refused.
- **Exclusion guards.** One sync/apply operation at a time: a second `Sync`
  invocation reports busy, a sync started during a profile apply (or
  vice-versa) refuses, and a repo that is not fully materialized (folder
  missing/empty, staging dir allocated, apply in flight) is skipped — with
  deletes never inferred from local absence.

## Merge layer (AssetSpaces)

Overlapping local + remote changes on the same uid or path are conflicts.
Convergent cases (identical edit, both-sides delete, identical rename) are
consumed silently. Real conflicts go through `GatedStructuredMerger`:

- **Frontmatter** — per-key 3-way merge. Multi-valued keys (any side an
  array: `aliases`, `exo__Asset_relates`, `exo__Instance_class`, …) merge as
  set-union with base-tombstones: a value removed on one side stays removed,
  values added on either side survive. Scalar keys follow the classic 3-way
  rule; a key changed differently on both sides is a conflict. A merge that
  would strip _all_ `exo__Instance_class` values via crossed tombstones is
  refused.
- **Body** — structured section merge, explicitly not last-write-wins. The
  body splits at ATX headings (code-fence-aware); per-section 3-way; a
  section modified on both sides falls back to paragraph-level `diff3`, then
  line-level `diff3` (git's granularity). Overlapping edits of the same
  region are a conflict.
- **SHACL merge-gate** (`MergeShaclGate`) — validates the merged candidate
  with the existing SHACL-lite validator before it may ship: intrinsic
  violations (minCount/maxCount/datatype) always gate; `sh:class` range
  checks gate only for references resolvable inside the mounted scope
  (open-world: a ref into an unmounted space is not a violation). A gated
  merge quarantines both versions instead of shipping. _Note: the gate
  module ships in the core package, but the plugin's Phase B composition
  does not wire it yet (`SyncDepsFactory` marks it a follow-up) —
  unresolvable merges still quarantine._

Anything the merger cannot resolve — delete-vs-modify, ambiguous multi-remote
overlap, unparseable frontmatter, conflicting scalar edits — is never
guessed: it goes to quarantine.

## FileSpaces (attachments)

An `exo__FileSpace` (class UID `aad8913e-5e9f-4047-879d-93cc46befd52`,
onto-RFC `18808c73`) is a git-backed space of opaque blobs:

- **Indexer skip.** `FileSpaceDiscovery` turns FileSpace declarations into
  folder-exclusion prefixes for the RDF indexer — content inside a FileSpace
  mount is never parsed, never enters the triple store, never SHACL-checked.
  The skip is derived from the `rdf:type` declaration, not hardcoded paths,
  and reacts live to declaration create/edit/delete/rename. The declaration
  asset itself must live _outside_ its mount folder.
- **Sync.** Every file syncs byte-exact (no `.md` restriction; the
  `.local.`/`.conflict.` infix exclusions still apply). No uid identity —
  blobs match by path. Pushes go through base64 blob upload; binary content
  never round-trips through string decode.
- **Conflicts: deterministic remote-wins.** Opaque blobs cannot merge, so
  the remote version lands on disk and the losing **local** version is
  preserved byte-exact in quarantine (a `.conflict.<ext>` payload file next
  to the entry record). Local-delete vs remote-change restores the remote
  with nothing to quarantine. Because the losing bytes exist nowhere else,
  the destructive apply is withheld unless the quarantine flush durably
  persisted — which is why file-mode sync requires the quarantine repo.
- **Size cap.** Files over 30 MiB (default `maxFileBytes`) are excluded
  symmetrically on both sides with a warning, and pinned so that a file
  crossing back under the cap derives as a conflict, never as a blind push.

## Conflict quarantine

`SyncedQuarantineStore` commits conflict entries to the dedicated quarantine
repo through the same write primitive — entries survive reinstall and device
loss and are visible cross-device. Design points:

- Entries are `.json` files under `entries/<repoKey-slug>/<path-slug>-<hash>.json`
  carrying `reason`, `status: open | resolved`, timestamps and the base /
  local / remote contents (binary local versions as a sibling
  `.conflict.<ext>` payload). The RDF walker parses only `.md`, so the
  quarantine never enters the triple store, and `isSyncablePath` refuses
  `.json` so entries never re-enter the sync cycle.
- One stable filename per (repo, path): re-quarantining an unchanged
  conflict pushes **zero** commits; many entries flush as one commit.
- Quarantined paths stay untouched on disk and are pinned in the watermark
  — the conflict re-derives on every sync until resolved. There is no
  dedicated resolver UI yet: you resolve by making the two sides converge
  (edit the local file and/or the remote so they agree); once the conflict
  resolves convergently the pin clears and the entry is automatically
  tombstoned `resolved` (resolution is overwrite-based — the write
  primitive cannot delete files). Terminal-quarantine entries (retry
  exhaustion) are not auto-resolved.
- Entry contents are secret-**redacted** (`[REDACTED:<kind>]`) rather than
  refused — a conflict copy embedding a credential is still preserved,
  minus the secret. Redaction does not apply to binary payloads.

## Security

- **PAT storage** — per-device only: `data.local.json` (plugin), key `pat`;
  never in `data.json`, never in the vault, never committed. The CLI-side
  push path resolves its token from `gh auth token` (OS keychain).
- **Secret scan** (`secretScan.ts`) — every push payload is scanned for
  GitHub classic tokens (`ghp_/gho_/ghu_/ghs_/ghr_…`), fine-grained tokens
  (`github_pat_…`) and private-key blocks. Any finding refuses the _whole_
  push (a partial set could ship an inconsistent asset graph); the report
  names the path and pattern kind, never the secret. In file mode,
  UTF-8-decodable contents still scan; true binary is skipped (secret
  patterns are text-shaped — documented residual).
- **Redaction everywhere** — error details, warnings and notices pass
  through the PAT redactor (`GitHubRestClient.redactTokens`) as
  defence-in-depth.

## Limitations and troubleshooting

- **Local deletes and renames are not pushed.** The write primitive cannot
  express deletions, so local deletions/renames are reported as
  `deferredDeletes` warnings and re-surface on every sync. Remote deletes
  _are_ applied locally.
- **`auth-required`** — HTTP 401, or 403 without rate-limit markers: the
  PAT is expired, revoked or under-scoped; never treated as success. Known
  blind spot: an under-scoped _fine-grained_ PAT gets **404** from GitHub
  on private-repo refs (existence-hiding), which surfaces as a generic
  error, not as `auth-required` — if a private repo "does not exist",
  check the PAT's repository allowlist first.
- **Rate limits** — every transport call is wrapped in exponential backoff
  with jitter (default 3 retries, 1 s base) on HTTP 429 / 403-rate-limit.
  After the retries the repo's cycle fails warn-not-block.
- **`full-conflict`** — first sync over a diverged tree, or a watermark
  whose base commit no longer matches the remote. Nothing is touched;
  align the local tree with the remote (or clear the watermark file) and
  re-sync.
- **`retry-exhausted`** — a concurrent writer kept moving the branch
  through all 422 retries; contended files are in quarantine, the
  watermark did not advance, everything re-derives next sync.
- **Watermark kind-flips** — a repo whose declaration changed between
  AssetSpace and FileSpace refuses (file→asset) or rebuilds its base
  through the file-mode first-sync layer (asset→file).
- **Notes named `*.local.*.md`** never sync (substring exclusion) —
  symmetric on both sides, so nothing corrupts; they are simply not
  synced.

## Source map

| Module (`packages/exocortex/src/`)                             | Role                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `services/sync/SyncEngine.ts`                                  | pull→merge→push orchestrator, retry loop, watermark advance                |
| `services/sync/ChangeDetector.ts`                              | uid/path 3-way change detection vs the watermark base                      |
| `services/sync/StructuredMerger.ts` + `diff3.ts`               | frontmatter + section/paragraph 3-way merge                                |
| `services/sync/GatedStructuredMerger.ts` + `MergeShaclGate.ts` | merge layer composition + SHACL gate                                       |
| `services/sync/SyncedQuarantineStore.ts`                       | durable cross-device conflict store                                        |
| `services/sync/FileWatermarkStore.ts`                          | per-device watermark persistence                                           |
| `services/sync/CredentialStore.ts`                             | PAT port contract + auth-failure detection                                 |
| `services/sync/secretScan.ts` / `transportBackoff.ts`          | push refusal on secrets / rate-limit backoff                               |
| `services/sync/githubRepoReader.ts`                            | Git Data API read helpers                                                  |
| `services/sync/spaceSpecCore.ts`                               | shared sync-unit classification (plugin + CLI, one parser)                 |
| `services/sync/ParityValidator.ts` + `assetSemanticCompare.ts` | Phase E M1/M2 parity harness ([parallel-run doc](../explanation/exosync-parallel-run.md)) |
| `services/FileSpaceDiscovery.ts`                               | FileSpace → indexer-exclusion prefixes                                     |
| `infrastructure/github/restCommit.ts`                          | the 4-call commit+push write primitive                                     |

Plugin wiring: `packages/obsidian-plugin/src/infrastructure/adapters/SyncCommands.ts`
(palette handler) and `SyncDepsFactory.ts` (engine composition over
`vault.adapter`, WebCrypto SHA-1, `requestUrl` transport).

## References

- RFC `4e4dc453` — ExoSync (vault asset)
- onto-RFC `18808c73` — `exo__FileSpace` (Phase 5 = indexer skip)
- PRs: [#3457](https://github.com/kitelev/exocortex/pull/3457) (A1 engine),
  [#3459](https://github.com/kitelev/exocortex/pull/3459) (A2 merge + gate),
  [#3460](https://github.com/kitelev/exocortex/pull/3460) (A3 quarantine /
  credential / watermark stores),
  [#3461](https://github.com/kitelev/exocortex/pull/3461) (Phase B plugin
  command), [#3462](https://github.com/kitelev/exocortex/pull/3462) (C2
  FileSpaces)
- Related docs: [profile.md](../explanation/profile.md) (mount-state apply — the
  materialized set ExoSync syncs),
  [settings-homoiconization.md](../explanation/settings-homoiconization.md) (ExoSync Phase
  D: settings as vault assets),
  [exosync-parallel-run.md](../explanation/exosync-parallel-run.md) (Phase E: parallel-run
  mode + M1/M2 validation harness)
