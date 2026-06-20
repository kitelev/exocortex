# Authoring functional requirements (`req__Requirement`)

> **Status:** P1 (RFC 0003) — the traceability checker (`exocortex requirements
audit`) and the **soft** `requirements-trace` CI gate are now live. This guide
> documents the format and discipline.
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
`_verifiedBy` must be `integration`, `e2e`, or `gui-bdd` (real-prod-exercising). Set
`req__Requirement_bindingClass` for each binding; the P1 checker enforces the floor.
Lower priorities (P1–P3) may be unit-only.

> **NO-Docker note.** `e2e` / `gui-bdd` revert-verify needs a Docker/native-amd64 run
> (real Obsidian via Playwright). When authoring from a NO-Docker session, complete
> the `unit`/`integration` revert-verify and mark the `e2e`/`gui-bdd` floor binding
> as **revert-verify deferred** — it is completed when the checker + CI run on
> native-amd64. Such a requirement's derived `verified` is _partial_ until then.

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
