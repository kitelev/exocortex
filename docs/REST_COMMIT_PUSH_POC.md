# REST commit+push (no `git` binary) — research note + PoC

**RFC:** `01a83de8` (AssetSpace + Profile — exo as SDK platform) Phase 0 spike.
**Goal:** prove that commit+push to a GitHub repo works **without the `git`
binary** (pure GitHub REST API), runnable in the iOS Obsidian plugin runtime,
shipped behind an opt-in experimental flag, and verified end-to-end.

## TL;DR

- **Use the Git Data API**, not the Contents API. It is the only way to put
  **multiple files into one atomic commit**, and it is exactly what the plugin's
  `GitHubRestClient.createCommit` already does.
- **Transport is the only platform-specific piece.** The plugin uses Obsidian
  `requestUrl` (iOS-safe); the CLI uses Node `fetch`. Both are valid HTTP
  transports for the identical 4-call sequence.
- **This PR extracts a transport-agnostic REST-commit core** (`restCreateCommit`
  in `packages/exocortex`) and rewires **both** consumers onto it: the plugin
  (`createCommit` delegates) and a new CLI `experimental rest-push` command.
  One implementation, two transports — the production-grade, iOS-portable path.
- **The remaining iOS gap is NOT push** — push is done. The iOS-incompatible
  code is the `git`-binary **mount/unmount** layer (`GitSubmoduleOps`,
  `execFile("git", …)`). That is **RFC Phase 3**, out of scope for this PoC.

## Contents API vs Git Data API

|                                                                                                     | Contents API (`PUT /repos/{o}/{r}/contents/{path}`)     | Git Data API (refs → trees → commits → refs) |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Files per commit                                                                                    | **1** (one PUT = one commit)                            | **N** (one tree = many blobs, one commit)    |
| Atomicity for a multi-file change                                                                   | ✗ (N commits, partial-failure leaves repo half-written) | ✓ (single commit, all-or-nothing)            |
| Round-trips                                                                                         | 1 per file (+ a GET for each existing file's blob SHA)  | 4 total regardless of file count             |
| Commit-message control                                                                              | per-file                                                | one message for the whole change             |
| Matches `AssetSpace.pushAssetSpace` semantics (push all dirty files of an AssetSpace as one commit) | ✗                                                       | ✓                                            |

**Recommendation: Git Data API.** An AssetSpace push is inherently multi-file
("push all dirty files as one commit"), so the Contents API's one-file-per-call
model is both slower (N+ round-trips) and non-atomic (a mid-sequence failure
leaves the branch in a partially-written state). The Git Data API commits the
whole set atomically in a fixed 4 calls.

### The 4-call chain (what `restCreateCommit` does)

```
1. GET   /repos/{o}/{r}/git/refs/heads/{branch}   → base ref SHA
2. POST  /repos/{o}/{r}/git/trees                 → new tree SHA (base_tree + N blobs)
3. POST  /repos/{o}/{r}/git/commits               → new commit SHA (parent = base)
4. PATCH /repos/{o}/{r}/git/refs/heads/{branch}   → fast-forward ref (force:false)
```

Partial-failure contract: if 1–3 succeed but 4 fails (race / non-fast-forward),
the remote holds an **orphan commit** reachable only by the returned SHA; git GC
reaps it after ~30 days. Safe to retry. Not safe for concurrent writers without
locking. (Single-writer assumption holds for the Exocortex AssetSpace use-case.)

## Transport portability

The 4-call chain is HTTP-only — no git binary, no filesystem. The only
platform-specific dependency is _how an HTTP request is issued_:

| Runtime                               | Transport                   | Notes                             |
| ------------------------------------- | --------------------------- | --------------------------------- |
| Obsidian plugin (desktop **and iOS**) | `requestUrl` (Obsidian API) | iOS-safe; no Node, no CORS issues |
| CLI / Node                            | `fetch` (Node 18+ global)   | desktop only; no Obsidian dep     |

So the **iOS-portable design** is: keep the 4-call orchestration + payload
shapes + validation in one place, and **inject the transport**. That is exactly
what this PR ships.

## What this PR delivers (the extraction, not just a recommendation)

- **`packages/exocortex/src/infrastructure/github/restCommit.ts`** —
  `restCreateCommit(transport, { owner, repo, branch, files, message, baseURL?, redact? })`.
  Pure, platform-free. The transport contract: **throw on non-2xx**; the core
  only navigates successful-response JSON shapes.
- **Plugin rewire:** `GitHubRestClient.createCommit` now delegates to the core,
  supplying a `requestUrl`-backed transport + its PAT redactor. All 74 existing
  `GitHubRestClient` tests stay green (the 7 `createCommit` behavioural tests are
  the revert→fail/restore→pass safety net — breaking the core fails the plugin
  tests, proving real delegation).
- **CLI:** `RestPushService` (a `fetch`-backed transport with PAT redaction +
  `gh auth token` resolution) + `exocortex experimental rest-push` command,
  gated behind `EXOCORTEX_EXPERIMENTAL_REST_PUSH=1` or `--experimental`.
- **Tests:** core 4-call sequence + payloads with production-shaped responses
  (mock transport); CLI fetch-adapter (mock fetch: auth header, redaction,
  error surfacing, gh-token); CLI command logic (gate, validation, DI fakes).

## Security

PAT handling mirrors the existing `GitHubRestClient` / `BootstrapAssetSpaceService`:
classic + fine-grained token redaction on every error string, `Authorization`
attached only when a token is present, token never logged. The CLI resolves the
PAT at runtime via `gh auth token` (`--token-from-gh`) and never prints it.

## Usage (experimental, opt-in)

```bash
EXOCORTEX_EXPERIMENTAL_REST_PUSH=1 \
  npx @kitelev/exocortex-cli experimental rest-push \
  --repo kitelev/exoas-restapi-poc \
  --branch main \
  --file poc.md \
  --content "committed via pure REST, no git binary" \
  --message "test: REST commit+push PoC" \
  --token-from-gh
# → prints commit SHA + https://github.com/<owner>/<repo>/commit/<sha>
```

Default OFF: without the env var or `--experimental`, the command refuses to run.
Normal users are unaffected.

## The remaining iOS gap (RFC Phase 3, NOT this PoC)

Write-back (commit+push) is now proven iOS-portable. The piece that still
requires the `git` binary — and therefore does **not** run on iOS — is
**mount/unmount** of AssetSpaces (`GitSubmoduleOps`, `execFile("git", …)`,
desktop-gated). RFC Phase 3 replaces that with REST/tarball:
pull via `fetchTarballBuffer`, write via the vault adapter, `.gitmodules` /
mount-manifest as plain-text edits (as `BootstrapAssetSpaceService` already
does), and push via this same `restCreateCommit` core.
