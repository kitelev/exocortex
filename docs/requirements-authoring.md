# Authoring functional requirements (`req__Requirement`)

> **Status:** P1–P3 mechanism live (RFC 0003) — the traceability checker
> (`exocortex requirements audit`), the **soft** `requirements-trace` CI gate,
> and the **hard-gate capability** (`--gate hard` + `rampReady`) are all built.
> The gate still runs **soft**; it flips hard at M3-closure (see
> [The soft→hard gate](#the-softhard-gate-rfc-0003-37)). This guide documents the
> format and discipline.
> **Source of truth:** [`docs/rfc/0003-requirements-management.md`](./rfc/0003-requirements-management.md).

This is the **how-to** for writing a functional requirement. It is a companion to
RFC 0003, which holds the _why_ and the full design.

## TL;DR

1. A **functional** requirement is a vault asset of class `req__Requirement`, written
   as **Gherkin Given/When/Then**, living in a per-module `exoas-<module>-reqs`
   assetspace (first one: `exoas-exo-reqs`).
2. It **binds to an already-existing real test** by putting a `@req:<uid>` token in
   that test's `it(...)` / `test(...)` title. **No new test runner. No Cucumber.**
3. A binding is **valid only with revert-verify evidence**: the cited test must
   **fail when the production behavior is reverted**. Record the evidence as a
   `Revert-verified:` token.
4. **Architectural / non-functional** requirements do **not** go here — they are
   `.archgate` ADRs (RFC 0003 §3.9).

## Where things live

| Thing                                                     | Where                                         | Namespace       |
| --------------------------------------------------------- | --------------------------------------------- | --------------- |
| `req` TBox (class `req__Requirement`, properties, enums)  | `kitelev/exoas-req`                           | `req`           |
| Functional requirement _instances_ about the `exo` module | `kitelev/exoas-exo-reqs`                      | `exo-reqs`      |
| Other modules' requirement instances                      | `exoas-<module>-reqs` (`dependsOn exoas-req`) | `<module>-reqs` |
| Architectural / NFR requirements                          | `.archgate/` ADRs                             | —               |

Each requirement instance is UID-named, co-located in its assetspace's own folder
(`exo__Asset_isDefinedBy → the assetspace anchor`), and is a cross-assetspace
`rdf:type` of `req__Requirement` (in `exoas-req`).

## The shape of a requirement

````yaml
---
exo__Asset_uid: <uuid>
exo__Asset_isDefinedBy: "[[<assetspace-anchor>]]"   # co-location key
exo__Instance_class:
  - "[[<req__Requirement uid>|req__Requirement]]"
exo__Asset_label: "req(<module>): <one-line behavior>"
req__Requirement_status: "[[<enum>|req__RequirementStatusDraft]]"   # Draft|Approved|Deprecated
req__Requirement_priority: "[[<enum>|req__RequirementPriorityP0]]"  # P0..P3
req__Requirement_bindingClass:
  - "[[<enum>|req__RequirementBindingClassIntegration]]"            # unit|integration|e2e|gui-bdd
req__Requirement_area: "[[<ems__Area>|...]]"        # optional grouping
req__Requirement_author: "[[<person/ExoAssistant>|...]]"
req__Requirement_covers:
  - "<command/feature this is about>"
req__Requirement_verifiedBy:
  - "<test file>::<describe > it title>"             # the real test(s) (also derived from @req tags)
req__Requirement_implementedBy:
  - "<command / PR# / code ref>"
---

# req(<module>): <one-line behavior>

## Job Story
When <situation>, I want <motivation>, so <outcome>.

## Statement (Gherkin)
```gherkin
Given <precondition>
When <action>
Then <observable outcome>
```

## Verification
**Revert-verified (<class>):** `@req:<uid>` — reverting `<prod ref>` makes
`<test>` go **RED** (<failure shape>); restored → **GREEN** (<date>, <session>, origin/main `<sha>`).
````

The Gherkin **statement is the body**, not a frontmatter property — humans and AI
agents read it directly. A `## Job Story` header is optional user-value framing.

## Binding a requirement to a test (the `@req:<uid>` convention — P1)

Put the requirement's uid in the **test title** so it travels with the assertion
across refactors (a detachable comment would drift):

```ts
it("@req:449f29ce-cbd5-4ac8-94d4-28aa56a013c2 inherits area from prototype when instance has no own area", async () => {
  // ... real assertions against production code ...
});
```

The `exocortex requirements audit` checker greps test titles for `@req:<uid>`,
derives `req__Requirement_verifiedBy`, and reports **orphans** (req with no
binding), **dangling tags** (tag → missing req), **duplicate bindings** (one uid
claimed by >1 test), the **P0 binding-class floor**, and **coverage**. Run it
locally against the reqs assetspace (or your vault) + the repo test corpus:

```bash
npx @kitelev/exocortex-cli requirements audit \
  --reqs <path-to-exoas-exo-reqs-or-vault> --tests . --output text
# JSON for tooling/CI: --output json   ·   --strict also fails on orphans
# Gate mode: --gate soft (default, warn) | --gate hard (block when not ramp-ready)
```

`@req:<uid>` in the test title is the canonical back-edge; keeping
`req__Requirement_verifiedBy` as `<file>::<title>` in the asset is the
human-readable companion (the checker derives bindings from the tags, not the
property). A `@req:` tag must be a well-formed UUID — archgate **REQ-001**
warns whole-tree on malformed/truncated tags; existence/resolution is the soft
`requirements-trace` CI job's job (it has the vault graph).

## The revert-verify discipline (what makes a binding _valid_)

A green, tagged test only proves **association**, not **exercise** — a tag can point
at a test that never touches the behavior. Exocortex already deleted a Cucumber
harness twice (#3401/#3433/#3545) for exactly this "harness-theater". So a binding
is **valid only with revert-verify evidence**:

1. Identify the production function/line that _implements_ the behavior.
2. In a worktree on `origin/main`, **revert** that behavior (smallest change that
   removes it; keep it compiling — e.g. neutralize the write, not an early-return
   that orphans code).
3. Run the cited test → it must go **RED on an assertion** (not a compile error).
4. **Restore** → it must go **GREEN**.
5. Record the machine-checkable token in the requirement body **and** the PR/commit:

   ```
   Revert-verified: @req:<uid> reverting <prod-ref> → <test> RED (<failure shape>); restored → GREEN
   ```

`verified` is **runtime-derived, never a stored status**: a requirement is _verified_
iff it has ≥1 revert-verified `_verifiedBy` passing in CI. `_status` is the
human-authored lifecycle only (Draft/Approved/Deprecated).

### Worked example (seed `449f29ce`, prototype inheritance)

- **Behavior:** an instance inherits its prototype's properties it does not own.
- **Test:** `packages/exocortex/tests/integration/smoke/prototype-chain.test.ts`
  › `should inherit area from prototype when instance has no own area`.
- **Revert:** in `PrototypeChainMaterializer.materialize`, neutralize the
  inherited-triple `store.add(...)` writes.
- **Result:** test RED (`areaTriples` length `0 ≠ 1`); restored → GREEN.

## Binding-class floor for P0

A **P0** requirement may **not** be bound _solely_ to a `unit` test — at least one
`_verifiedBy` must be `integration`, `e2e`, `gui-bdd`, or `ui-acceptance`
(real-prod-exercising). Set `req__Requirement_bindingClass` for each binding; the
checker enforces the floor. Lower priorities (P1–P3) may be unit-only.

### `ui-acceptance` — manual computer-control verification (no jest tag)

Some behaviors are only meaningfully verifiable through the **live UI**. For these,
set `req__Requirement_bindingClass: ui-acceptance`: the requirement is verified by
recorded **computer-control evidence** (screenshot + date + observed result), **not**
by a `@req:<uid>` jest tag. The checker **does not** expect a jest binding for a
`ui-acceptance` requirement and **does not** flag it as an orphan — it counts it as
_manually verified_ (covered), and `ui-acceptance` satisfies the P0 floor. Record the
evidence in the requirement body in place of the `Revert-verified:` token, e.g.:

```
UI-verified (ui-acceptance): <date> — computer-control on live Obsidian; <action> →
<observed result> (screenshot <ref>).
```

A `ui-acceptance` requirement may **also** carry a `@req` jest tag (mixed); then it
is jest-bound as usual. (Enum UID `9709619c-e16d-4501-89ed-3c2abd6af87d`,
`req__RequirementBindingClassUiAcceptance`, in `exoas-req`.)

> **NO-Docker note.** `e2e` / `gui-bdd` revert-verify needs a Docker/native-amd64 run
> (real Obsidian via Playwright). When authoring from a NO-Docker session, complete
> the `unit`/`integration` revert-verify and mark the `e2e`/`gui-bdd` floor binding
> as **revert-verify deferred** — it is completed when the checker + CI run on
> native-amd64. Such a requirement's derived `verified` is _partial_ until then.

## The soft→hard gate (RFC 0003 §3.7)

The `requirements-trace` CI job has two modes, selected by the checker's
`--gate` flag (and, in CI, the job-level `REQ_GATE` env):

| `--gate`         | exit 1 when…                                                                                                                    | CI effect today                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `soft` (default) | a **hard finding** is present: a dangling `@req` tag, or a P0 binding-class floor violation. P0 coverage gaps are **warnings**. | swallowed by `continue-on-error` — never blocks a merge                 |
| `hard`           | the above **or** the report is **not ramp-ready** (any enumerated P0 requirement unbound).                                      | would block (once `continue-on-error` is dropped + the job is required) |

**Ramp-ready** is the auto-flip criterion (the JSON report's `rampReady` field):
every enumerated **P0** requirement is bound, all P0 binding-class floors are met,
and no tag dangles. The PR comment shows `P0 checklist: X/Y bound · ramp-ready:
✅/❌` so you can see — before flipping — whether `main` is safe to flip. (It is
fail-safe: `rampReady` is `false` when there are **no** P0 requirements, so
`--gate hard` blocks rather than passing vacuously on an empty/failed-to-clone
reqs set.)

### The flip (deterministic, one action, at M3-closure)

The trigger is **Alpha GA = M3-closure** (`ems__Project` milestone `1ec7677e`) —
not a calendar date and not auto-magic. When M3 closes, flip the gate by editing
`.github/workflows/ci.yml`:

1. set `REQ_GATE: hard` on the `requirements-trace` job;
2. delete the `continue-on-error: true` on its **Run traceability audit** step;
3. add `requirements-trace` to branch-protection required status checks.

Confirm `rampReady` is already `true` on `main` before flipping (the PR comment /
`--gate hard` run will tell you). After the flip, **new behavior must be
spec-first**: a behavior PR that leaves a P0 requirement unbound fails the gate.

**Soft-gate expiry.** The gate _must_ flip hard at M3-closure. Staying soft past
M3-closure is allowed only with an explicit, documented user dispensation — the
gate is not permitted to silently remain advisory (this is the discipline
`uj__UserJourney` lacked).

```bash
# preview the hard-gate verdict locally before the flip
npx @kitelev/exocortex-cli requirements audit \
  --reqs <reqs-dir> --tests . --gate hard --output text
# exit 1 if not ramp-ready; the text/JSON report shows the P0 checklist + rampReady
```

## Authorship vs verification (decoupled on purpose)

**AI drafts, a human approves** (`_status: Draft → Approved`, recording
`_approvedBy`/`_approvedAt`). But the same agent must not author the requirement,
the test, _and_ the binding and then self-certify. So human approval covers the
**prose**; revert-verify covers the **bind**. Any later change to an `Approved`
requirement's statement resets it to `Draft` (re-approval-on-change).

## Functional vs architectural (don't duplicate)

| Requirement type                                                           | Home                     | Format                         |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------------ |
| **Functional** (user-facing behaviors, command outcomes)                   | vault `req__Requirement` | Gherkin                        |
| **Architectural + non-functional** (perf, security, structural invariants) | `.archgate` ADRs         | EARS / ADR prose + `.rules.ts` |

An invariant is **not** restated as a `req` asset — it _is_ the ADR. The
requirements-management _system_ is the federation of both.

## Checklist before you commit a requirement

- [ ] One verifiable functional behavior, Gherkin Given/When/Then in the body.
- [ ] `_covers` names the command/feature; `_priority` and `_status` set.
- [ ] `_verifiedBy` cites a **real, existing** test (P1: `@req:<uid>` in its title).
- [ ] `_bindingClass` set; P0 includes ≥1 integration/e2e/gui-bdd.
- [ ] **Revert-verify** done (or `e2e`/`gui-bdd` floor explicitly deferred) with a
      `Revert-verified:` token.
- [ ] UID-canon filename, co-located, SHACL `validate schema --shapes-mode` = 0.
