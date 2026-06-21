# RCA: `dyncommand show` vs `dyncommand exec` precondition divergence

**Status:** investigation complete; T4.2 ships the duplicate-UID detector
in `dyncommand validate` (informational warning, R5 mitigation)
**Phase:** RFC `94e520da-c6f7-48af-944c-51298d68da45` § Phase 4
**Task:** T4.1 — RCA через bisect (3 hypothesis testing)
**Author:** ExoAssistant + Andrey Kitelev, 2026-05-02

## Symptom

User report (T2.4 backlog, RFC § Контекст): for the same command UID,
`dyncommand show <uid>` prints one precondition while
`dyncommand exec <uid> --target <path>` evaluates a _different_
precondition (or rejects on a precondition that `show` does not display).

## Method

Hypothesis-driven bisect of the two code paths in
`packages/cli/src/commands/dynamic-command.ts`:

| Step | `dyncommand show` (lines 154–237)  | `dyncommand exec` (lines 239–417)                                  |
| ---- | ---------------------------------- | ------------------------------------------------------------------ |
| 1    | `buildTripleStore(vaultPath)`      | `buildTripleStore(vaultPath)`                                      |
| 2    | `new CommandResolver(tripleStore)` | `new CommandResolver(tripleStore)`                                 |
| 3    | `resolver.loadCommand(uid)`        | `resolver.loadCommand(uid)`                                        |
| 4    | print `command.precondition.*`     | `new PreconditionEvaluator(...).evaluate(command.precondition, …)` |

`buildTripleStore` (line 676) is a pure function of `vaultPath` filesystem
state at the time of invocation. `CommandResolver.loadCommand` (defined in
`packages/core/src/services/CommandResolver.ts:165`) is deterministic
given a fixed triple store. Therefore, **within a single process, steps 1–3
must produce byte-identical `command.precondition` objects.**

Divergence between two CLI invocations can only originate from:

- **(D1) different triple stores** built by step 1 — caused by vault
  mutation between the two invocations, or by `findSubjectByUID` returning
  a different "first" subject when more than one subject carries the same
  UID;
- **(D2) different binaries** running steps 2–3 — caused by `npx` resolving
  to a stale cached version on one invocation but a freshly published one
  on the other;
- **(D3) shared mutable state** flushed mid-execution.

These map onto the three RFC hypotheses:

| Hypothesis                         | Maps to | Verdict                                        |
| ---------------------------------- | ------- | ---------------------------------------------- |
| **H1** Duplicate `exo__Asset_uid`  | D1      | ✅ Plausible — see §H1                         |
| **H2** Stale npx cache             | D2      | ⚠ Plausible but rare — see §H2                 |
| **H3** Parallel triple-store flush | D3      | ❌ Architecturally impossible in CLI — see §H3 |

## §H1 — Duplicate `exo__Asset_uid`

`CommandResolver.findSubjectByUID` (CommandResolver.ts:905):

```ts
if (this.tripleStore.findSubjectsByUUID) {
  const subjects = await this.tripleStore.findSubjectsByUUID(uid);
  if (subjects.length > 0) return subjects[0] as IRI;
}
// fallback: scan all Asset_uid literal triples, return first match
```

`InMemoryTripleStore.findSubjectsByUUIDSync` (InMemoryTripleStore.ts:226)
indexes subjects by UUIDs **embedded in the subject IRI** (i.e. the file
path). The fallback path iterates `tripleStore.match(undefined,
exo:Asset_uid, undefined)` and returns the _first_ matching subject.

**In both paths the choice between duplicate subjects is order-dependent.**

Consequences:

- If the vault contains two files that both encode the same UID — e.g.
  `inbox/<uuid>.md` and `archive/<uuid>.md` (UUID-form filenames), or two
  arbitrarily-named files that share the same `exo__Asset_uid: <uuid>` in
  frontmatter — `findSubjectByUID` returns whichever file
  `convertVault` saw first.
- Within a single process, the ordering is deterministic
  (`fs.readdirSync` traversal order on macOS APFS is alphabetical); show
  and exec see the **same** "first". So _intra-process_ show ≡ exec.
- Across two separate `dyncommand` invocations the ordering remains
  deterministic _only if_ the file system state is identical. If a file
  sharing the duplicate UID is created/deleted/renamed between the two
  invocations, traversal order changes → `findSubjectByUID` returns a
  different subject → preconditions diverge.

**Concrete reproduction recipe** (verified analytically against the code,
PoC fixture in `cli-dyncommand-show-exec-parity.integration.test.ts`):

1. Author command file `cmd-A.md` with `exo__Asset_uid: <UID>` and
   `exocmd__Command_precondition: [[<pre-A>]]`.
2. Duplicate it as `archive/cmd-A.md` with the _same_ UID but
   `exocmd__Command_precondition: [[<pre-B>]]`.
3. `dyncommand show <UID>` reports `pre-A`'s SPARQL ASK.
4. Rename or `mv` the active copy without removing the archived copy.
5. `dyncommand exec <UID> --target <T>` now finds `archive/cmd-A.md` first
   and evaluates `pre-B`.

This **does** reproduce the symptom, but only when the vault holds
duplicate UIDs _and_ mutates between invocations. The duplicate-UID
condition itself is anomalous (and warned on by both
`ExoLayoutRepository` and `RelationColumnSetRepository`, see
`packages/obsidian-plugin/src/infrastructure/repositories/`) but
`CommandResolver` neither warns nor rejects.

**Likelihood assessment:** **moderate-high**. UUID-form filenames have
become the default since 2026-04 (RFC #2863), and bulk
imports / archive operations occasionally produce duplicates. Without a
detector, users have no way to notice.

## §H2 — Stale npx cache

`dyncommand show` and `dyncommand exec` are independent shell
invocations. Most users invoke them through `npx @kitelev/exocortex-cli
dyncommand …`. `npx`'s default resolution (`--prefer-offline`) reuses a
cached binary if one is present and "fresh enough" (~24h since last
update check).

A divergence between show and exec from H2 requires:

- show invocation runs against version `vN`,
- a new version `vN+1` is published _and_ user's npx cache invalidated
  between the two,
- exec invocation runs against `vN+1`,
- and `vN+1` changes how `loadCommand`/`PreconditionEvaluator` reads the
  precondition.

This is a **possible** sequence (e.g. `dyncommand show` in the morning,
release lands at noon, `dyncommand exec` in the afternoon — with
explicit `npx --prefer-online` or after npx cache TTL expiry) but
exceedingly rare in practice and not reproducible deterministically. We
record it as a _background_ possibility but cannot manufacture the
divergence without manually corrupting the npx cache.

**Mitigation hint for T4.2 (out of scope for this RCA):** print the CLI
package version + commit SHA in the show/exec output banner so users can
spot the case where two adjacent invocations ran different binaries.

## §H3 — Parallel triple-store flush

The CLI is a one-shot Node process: every `dyncommand` invocation
constructs a brand-new `InMemoryTripleStore` via `buildTripleStore`
(line 676), populates it from disk, performs its work, then exits. There
is **no shared, long-lived triple store between processes** and no
concurrent writer in the same process (each invocation runs serially).

The hypothesis is meaningful for the **plugin** runtime — there a
long-lived `VaultRDFIndexer` is mutated by Obsidian's vault events and
could in principle be re-indexed mid-evaluation — but it does not apply
to the CLI architecture. We mark H3 as **architecturally inapplicable**
to the CLI show/exec divergence.

## Conclusion

- **Primary root cause (CLI):** **H1 — duplicate `exo__Asset_uid`
  combined with vault mutation between show and exec invocations**, via
  the order-dependent return of `findSubjectByUID`.
- **Secondary contributing factor:** **H2 — stale npx cache** can
  produce the symptom in narrow temporal windows; observable but
  difficult to reproduce intentionally.
- **Hypothesis ruled out:** **H3 — parallel flush** does not apply to
  the CLI process model.

Within a single process, show and exec share the _exact same_
`command.precondition`; an integration test (added in this PR) pins
that invariant so any future regression that re-introduces an
intra-process divergence will fail CI.

## Recommendations for T4.2 (fix scope, not implemented here)

1. **Duplicate-UID detector in `dyncommand validate`** — surface the
   structural defect that enables H1. Output: list of
   `(<uid>, <file-A>, <file-B>, …)` tuples with hint "rename one or
   delete the duplicate".
2. **Optional**: emit a warning when `findSubjectByUID` discards
   non-first matches during `dyncommand show`/`exec`, so users see the
   ambiguity even before running `validate`.
3. **Optional**: include CLI version + commit SHA in show/exec banner
   to surface H2 in support transcripts.

The integration test added here serves as the **acceptance baseline**
for T4.3 (`show ≡ exec` invariant assertion) and as the canary for any
future regression that breaks intra-process parity.

## References

- RFC § Phase 4 — `94e520da-c6f7-48af-944c-51298d68da45`
- T2.4 backlog symptom report — RFC § Контекст
- `dynamic-command.ts:154-417` — show/exec implementations
- `CommandResolver.ts:165, 905` — `loadCommand` and `findSubjectByUID`
- `InMemoryTripleStore.ts:215-243` — UUID index lookup semantics
- Sister duplicate-UID warnings: `ExoLayoutRepository.ts:193`,
  `RelationColumnSetRepository.ts:192`
