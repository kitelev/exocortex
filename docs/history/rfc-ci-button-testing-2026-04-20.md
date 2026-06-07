# RFC — CI Test Coverage for Starter-Kit Dynamic Commands

**Status:** Draft · v5 · 2026-04-20
**Revision note:** v5 (2026-04-20, Phase 2 closure) incorporates CR-2 amendment (AC5 catch-rate recalibration к post-Option-C regressions; pre-Option-C bugs structurally untestable per frankenstein-rewind fixture-shape mismatch at 91d9e37 boundary), path-drift corrections (§3.3 self-test filename `.self-test.ts` → `.self.test.ts`; §7.3 contract test canonical placement в `packages/cli/tests/integration/starter-kit/`; §9.1 + §12.4 helper-test canonical path `packages/cli/tests/unit/test-helpers/`), Phase 2 exit coverage-matrix snapshot, and References block. New §16 "Phase 2 Closure Addendum". v4 added §12 PR-readiness gate. v3 reconciled "51 Commands" → "44 Commands" post-Phase-0 + applied Option C migration. v2 responds to review `/Users/kitelev/Developer/review-rfc-ci-tests-2026-04-20.md`. See §14 Revision Log (§15 Rejected Minor Findings reserved, empty in v2-v5).
**Author:** Claude (child session `claude-cli-rfc-ci-button-testing-2026-04-20`)
**Parent pipeline:** Stage 3 — CI-friendly test coverage for working starter-kit buttons
**Inputs:**
- Audit: `/Users/kitelev/Developer/ui-audit-starter-kit-2026-04-20.md`
- UX RFC: `/Users/kitelev/Developer/rfc-ui-improvements-2026-04-20.md`
- Stage 4 review: `/Users/kitelev/Developer/review-rfc-ci-tests-2026-04-20.md`
**Constraints:** No Mac/GUI dependency · GitHub Actions linux-only (Docker OK) · Coexist с существующим CI budget
**Scope:** 41 working dynamic commands из starter-kit (35 "working-as-expected" + 6 "UX-flawed but functional") × CI-compatible regression coverage
**Out-of-scope:** 3 BROKEN criticality commands (post-fix) · Manual QA guides · iOS · Plugin-agnostic test infra · Core plugin non-dyncommand features
**Class constant referenced throughout:** `exocmd__Command` class UUID = `790e5b16-251d-4556-96ac-e5c7f1429b2e` (starter-kit `exocmd/790e5b16-251d-4556-96ac-e5c7f1429b2e.md`). Wikilink form в ассетах: `[[790e5b16-251d-4556-96ac-e5c7f1429b2e]]`.

---

## 1. Summary

Предлагается **dual-layer coverage** для 41 working starter-kit dynamic commands:

- **Primary (широкое покрытие, L2 integration):** **Programmatic CLI harness** — новые jest-тесты, параметризованные по vault-сканированному списку `exocmd/*.md`, запускают `GroundingExecutor` + `PreconditionEvaluator` против real starter-kit fixtures и ассертят frontmatter-state / Result-shape. Runs на `test-unit` job, ~10-15s добавляется к CI.
- **Complement 1 (узкое UI-smoke, L3 E2E):** **Docker E2E subset 5-7 representative commands** — одна на category × edge case (composite grounding, confirm modal, input modal, category rendering, precondition gate). Runs в existing `e2e-shard` matrix.
- **Complement 2 (статический guard):** **YAML contract-test** (ajv/zod-based schema validation + dup-label / orphan-binding checks) — lint-style CI step, <1s, catches duplicate-button / orphan-grounding classes без runtime.

**Ключевой trade-off:** CLI-harness не ловит `ButtonGroupsBuilder` / `LayoutRenderer` visibility bugs (класс багов Finding #1 из audit — criticality group invisible). Поэтому complement обязан держать subset Docker E2E; contract-test закрывает static-analyzable invariants; visibility bugs класса "group X rendered inline" требуют UI layer explicitly.

**Fixture access:** starter-kit подтягивается в CI через **git submodule pinned to starter-kit main** (details §3). Альтернатива — npm publish starter-kit как `@kitelev/exocortex-starter-kit` + resolve from node_modules — предложена как fallback если submodule создаёт coupling friction.

---

## 2. Motivation

UX audit выявил 44 commands (41 working + 3 broken). CLI parity sprint v15.105.7→v15.113.0 закрыл 10 critical bugs #2863-#2872 за 1 день. **Без regression coverage те же bugs вернутся при следующем refactor.**

Текущее покрытие фрагментарно:

- `packages/cli/tests/unit/services/*.test.ts` — **unit**, service-level (archiveAsset, createRelatedTask, cleanProperties, fixMissingLabel, renameToUid, planForEvening, createRelatedProject). Покрывают **реализацию** service-ов, но НЕ grounding-layer dispatch, НЕ starter-kit YAML wiring.
- `packages/cli/tests/unit/commands/dynamic-command.test.ts` — CLI dyncommand invoker, но **mocked** (`jest.unstable_mockModule("exocortex", ...)`) — не exercise real `GroundingExecutor`.
- `packages/obsidian-plugin/tests/unit/presentation/builders/DynamicCommandButtonGroupBuilder.test.ts` — unit rendering builder, isolated from real commands.
- `packages/obsidian-plugin/tests/e2e/specs/dynamic-commands.spec.ts`, `dynamic-command-buttons-render.spec.ts`, `vault-commands-smoke.spec.ts` — **Docker E2E covering ~3 commands total** (remove-start-timestamp + set-status-doing/done), against a **separate** minimal test-vault под `tests/e2e/test-vault/`, **не** starter-kit.

**Gap:** 41 starter-kit commands × real pipeline (YAML → TripleStore → CommandResolver → PreconditionEvaluator → GroundingExecutor → frontmatter) не тестируются end-to-end ни в одной CI job. CLI sprint issues доказали, что каждый из этих stages несёт баги (#2863 list UUID-wikilink, #2864 service_call silent-success, #2869 cleanProperties wire-only).

**Target:** при любом изменении plugin core / CLI / starter-kit one of the following triggers test failure:
- Command Asset without Binding → test fails (contract).
- Grounding `targetProperty` renaming → test fails (integration).
- Composite grounding emits wrong frontmatter shape → test fails (integration).
- Button category disappears from inline UI → test fails (E2E smoke subset).

---

## 3. Fixture access strategy (foundation for all approaches)

**Blocker to resolve before alternatives analysis:** how does CI reach the 41 starter-kit commands?

### 3.1 Options

**A. Git submodule** (`exocortex/packages/starter-kit-fixtures` → points to `exocortex-starter-kit` main)
- Pros: version-controlled pin; `git clone --recursive` is standard GHA pattern; single source of truth
- Cons: contributors need to remember `git submodule update`; cross-repo PR coordination (updates to starter-kit need submodule bump PR)

**B. npm publish `@kitelev/exocortex-starter-kit` as a fixture package**
- Pros: no submodule; versioned via npm; cache-friendly (GHA `npm ci` caches)
- Cons: requires publish pipeline; starter-kit is not strictly "package material" (just .md files + directory tree); extra release mechanics

**C. Copy-at-test-setup script** (CI job clones starter-kit repo directly)
- Pros: zero coupling; independent release cycles
- Cons: no version pin by default (need explicit `--branch <tag>`); added CI step; network-dependent

**D. Duplicate fixtures into `tests/fixtures/starter-kit/`** (snapshot checked into main repo)
- Pros: fully self-contained; no external dependency
- Cons: starter-kit updates require copy-and-commit; drift risk (tests pass on snapshot while real starter-kit differs)

### 3.2 Recommendation

**Primary choice: A (git submodule)** — standard cross-repo pattern, zero-cost verification (`git status` shows stale submodule), explicit version pin. Add `actions/checkout@v6` with `submodules: recursive` to relevant CI jobs.

**Fallback: B (npm package)** if submodule friction blocks contributor onboarding. Defer to impl phase.

**Rejected: C** (flaky; network-dependent) и **D** (drift risk explicitly; audit Finding #3 duplicate-button precedent shows why fixture-drift masks real bugs).

### 3.3 Parametrization is a hard constraint, not a recommendation

Test suites MUST **scan `exocmd/**/*.md` at test time** and parametrize по discovered commands. Rationale:

- UX RFC (Stage 2) uma уже scheduled changes:
  - Phase A: delete duplicate `Remove Start Timestamp` (`9f33ecdd`) → 44→43 commands
  - Phase B: rename criticality→zone → 3 label changes + category rename
  - Phase A: remove 3 confirmMessage, add 2 successMessage

- Hardcoded list в tests → первый же merge UX RFC Phase A breaks suite.

- **Implementation shape** (⚠ v1 draft had a bug — see §14 Revision Log B1; this is the corrected v2):
  ```ts
  // tests/integration/starter-kit/command-catalog.ts
  //
  // CRITICAL: class matching MUST use the class UUID wikilink, NOT a substring
  // match on "exocmd__Command". Command assets store class references как
  // `[[790e5b16-...]]` UUID-wikilinks (see issue #2863 / PR #2873 / memory
  // `feedback_cli_dyncommand_list_uuid_wikilink`). A substring filter returns
  // an empty catalog; jest reports "0 passed" silently — identical failure
  // mode to the bug we're trying to prevent.

  const EXOCMD_COMMAND_CLASS_UUID = "790e5b16-251d-4556-96ac-e5c7f1429b2e";
  const COMMAND_CLASS_WIKILINK = `[[${EXOCMD_COMMAND_CLASS_UUID}]]`;

  export function loadCommandCatalog(): Command[] {
    const files = globSync("../starter-kit-fixtures/exocmd/**/*.md");
    const parsed = files.map((p) => ({ path: p, fm: parseYaml(p) }));

    // Accept either raw UUID wikilink OR resolved class label (defence in
    // depth against future ontology migrations that re-introduce string
    // labels).
    return parsed
      .filter(({ fm }) => {
        const klass = fm.exo__Instance_class;
        const arr = Array.isArray(klass) ? klass : [klass];
        return arr.some(
          (v) =>
            v === COMMAND_CLASS_WIKILINK ||
            v === `[[exocmd__Command]]` ||
            v === "exocmd__Command"
        );
      })
      .map(({ fm, path }) => hydrateCommand(fm, path));
  }

  // tests/integration/starter-kit/test-helpers/command-catalog.self.test.ts
  //
  // v5 path-drift fix: filename is `.self.test.ts` (period-separated) — the
  // `.self-test.ts` form in v2-v4 snippets falls outside jest's testMatch glob
  // (`tests/**/*.test.ts`) and is silently skipped. Actual PR #2887 shipped
  // `command-catalog.self.test.ts`; unifying docs to match. Helpers live under
  // `test-helpers/` subdir per Phase 1 bundle PR #2889.
  //
  // SELF-TEST: if the loader regresses (reintroduces substring filter,
  // wrong path, bad parseYaml), the catalog goes empty — jest reports
  // "0 passed" WITHOUT failing. This explicit guard fails LOUDLY.
  describe("command-catalog loader", () => {
    it("discovers >= 40 Command instances from current starter-kit", () => {
      const cmds = loadCommandCatalog();
      expect(cmds.length).toBeGreaterThanOrEqual(40);
    });
    it("every discovered Command has a resolvable class UUID", () => {
      for (const c of loadCommandCatalog()) {
        expect(c.classUuid).toBe(EXOCMD_COMMAND_CLASS_UUID);
      }
    });
  });

  // tests/integration/starter-kit/grounding-pipeline.test.ts
  describe.each(loadCommandCatalog())("Command $label", (cmd) => {
    it("dispatches grounding without throwing", async () => { ... });
    it("produces expected frontmatter shape for representative fixture", async () => { ... });
  });
  ```

- **Class resolution helper (reverse index)** — parse all ontology files
  under `exocmd/` once at test setup; build `Map<classLabel, classUuid>`
  so future ontology files written with label references (if any legacy
  exist) still resolve. Pattern mirrors v15.105.7 fix for #2863.

- Suite naturally grows/shrinks с starter-kit content. Post-UX-RFC state: suite finds 43 commands (one less, after duplicate-removal P0-1), passes unchanged because discovery is by class-UUID не category-name.

### 3.4 Developer workflow impact (new in v2, resolves review M5)

Submodule-per-worktree interacts with the mandatory worktree workflow (`/Users/kitelev/Developer/exocortex-development/CLAUDE.md` RULE #1). Quantify:

**Current flow (no submodule):**
1. Edit starter-kit worktree → PR → merge starter-kit main.
2. Done. Plugin repo does not consume starter-kit directly.

**Post-submodule flow:**
1. Edit starter-kit worktree → PR → merge starter-kit main.
2. Open plugin worktree → `git submodule update --remote packages/starter-kit-fixtures`.
3. Commit submodule bump → PR → merge plugin.

**Cost delta:** +1 PR + ~2 min submodule bump per starter-kit change. For 5-10 starter-kit PRs/week (current velocity) this is +10-20 min/week developer time + PR-review overhead × 5-10.

**Submodule-per-worktree disk cost:** each `git worktree add` defaults to initializing submodules into `.git/modules/<name>/` — but the bytes are shared (objects are single-copy in git's ODB). Checked out working tree copy: ~500KB × N worktrees. Negligible at current worktree count (≤ 5 typical).

**Multi-agent write contention:** two parallel Claude sessions editing starter-kit simultaneously cause submodule-bump conflicts. Mitigation: orchestrator pattern (memory `reference_orchestrator_pattern_2026_04_20`) already sequences starter-kit edits through one child at a time.

**npm option B — re-elevated consideration:**
- starter-kit repo already has `auto-release.yml` (confirmed by reviewer via filesystem check).
- Adding `files: ["exocmd/**", "ems/**", "ims/**"]` + `npm publish @kitelev/exocortex-starter-kit@X.Y.Z` is ≤30 LOC workflow change.
- Plugin consumes via `devDependencies` — `npm ci` caches correctly in GHA.
- No submodule-per-worktree surface; contributor onboarding reduces to `npm install`.

**Decision rule (revised from §3.2):**
- **Phase 1 pilot:** start with submodule for speed (zero-cost verification via `git status`).
- **Phase 1 end-of-week review:** if submodule overhead surfaces in ≥3 contributor instances OR parallel-agent conflicts occur ≥2 times, **switch to option B npm package before Phase 2**. Not defer to "rollback if contributor complaints >3".
- Decision criterion is explicit + measurable + time-boxed.

**Cross-package refactor ordering (resolves review discussion + §10 Q7):** when plugin's `GroundingExecutor` API changes breaking starter-kit contract:
1. Land starter-kit fixture update first (behind feature flag / tag).
2. Bump plugin's submodule pointer OR npm dep version concurrently with plugin PR.
3. Submodule-pin-to-tag (`git submodule update --init --depth 1 --branch v<X.Y.Z>`) avoids "starter-kit main drift breaks plugin CI" class of races.

---

## 4. Current State

### 4.0 Command count reconciliation (revised in v3 post-Phase-0, resolves review M6 + m2)

Audit reports 44 commands. Raw filesystem shows 133 files under `exocmd/` (verified 2026-04-20: 33 top-level + 39 creation + 12 criticality + 17 maintenance + 23 maintenance-complex + 33 planning + 45 status). Not all are Commands.

**Authoritative count: 44 Commands** (SPARQL `?cmd exo:Instance_class exocmd:Command` against starter-kit at HEAD 2026-04-20). Reconciled by Phase 0 ladder report (`/Users/kitelev/Developer/phase0-extract-target-class-ladder-2026-04-20.md` §"Dataset Size Discrepancy").

**Pre-Phase-0 confusion:** v2 stated "51 Commands" based on `grep -l '\[\[790e5b16-...\]\]' exocmd/**/*.md`. Phase 0 SPARQL count showed 44 actual `exocmd__Command` instances. The 7-file gap (52 grep matches today: 51 in v2 + 1 file added between v2 and Phase 0) is composed of **ontology assets that reference the Command class UUID but are NOT Command instances themselves**. Documented in §4.0a.

**File-count vs Command-count reconciliation (post-Phase-0):**

| Asset kind | Class UUID | Count under `exocmd/**/*.md` |
|---|---|---|
| `exocmd__Command` (instances) | `790e5b16-251d-4556-96ac-e5c7f1429b2e` | **44** (SPARQL authoritative — `?cmd exo:Instance_class exocmd:Command`) |
| Class / property stubs referencing Command UUID | — | **8** (1 Class def + 7 property defs — see §4.0a) |
| Total grep matches `[[790e5b16-...]]` | — | **52** = 44 + 8 |
| `exocmd__Grounding` | (separate UUID) | ~40 |
| `exocmd__Binding` | (separate UUID) | embedded as subdocs / absent as standalone |
| Precondition file | — | varies |

### 4.0a Property-Definition Stubs (Excluded from Command count)

The `grep -l '\[\[790e5b16-...\]\]' exocmd/**/*.md` query returns 52 files (as of 2026-04-20). Of those, **8 are NOT Command instances** — they are ontology assets that reference the Command class UUID via `exo__Property_domain` / `exo__Property_range` / `exo__Class_superClass`. They were miscounted as Commands in pre-Phase-0 RFC drafts.

| # | UID | Asset class | Role | What it declares |
|--:|-----|-------------|------|-------------------|
| 1 | `790e5b16-251d-4556-96ac-e5c7f1429b2e` | `exo__Class` | Command class **definition** | The `exocmd__Command` class itself |
| 2 | `025fafe0-a42b-4b39-b917-ae8c3b2b1f59` | `exo__Property` | Property def | `exocmd__Command_confirmMessage` (description) |
| 3 | `7980274f-da39-4289-97f9-62fef8a541ec` | `exo__Property` | Property def | `exocmd__Command_icon` (Lucide icon name) |
| 4 | `a9403f5d-2193-40c4-82e7-75c049abc5b3` | `exo__ObjectProperty` | Property def | `exocmd__Command_grounding` (range = Grounding) |
| 5 | `ad6e59f6-2294-4d3a-a54a-dfed80a40914` | `exo__Property` | Property def | `exocmd__Command_successMessage` (Notice text) |
| 6 | `ba9a700f-26ea-47de-abe4-e54d6a4b5594` | `exo__ObjectProperty` | Property def | `exocmd__Command_precondition` (range = Precondition) |
| 7 | `dbb50524-fb5e-4585-8ca8-720b5587f435` | `exo__Property` | Property def | `exocmd__Command_category` (literal — creation/maintenance/etc.) |
| 8 | `736a0ab3-afb6-44e3-b760-52dd261b324c` | `exo__ObjectProperty` | Property def | `exocmd__CommandBinding_command` (Binding→Command range) |

**Phase 1 addendum (2026-04-20):** The migration commits below introduce a 9th stub — `exocmd__Command_targetClass` (UID `4fee233c-7d02-4973-8936-b01835b4b829`) — bringing post-migration grep total to 53.

**Filter mechanism for catalog loader:** the loader **MUST** filter by `exo:Instance_class` SPARQL (not by class-UUID grep) to avoid pulling stub assets into the test suite. See §3.3 for catalog-loader contract.

**`maintenance-complex/` directory (23 files):** mostly Grounding + Binding assets for the composite status commands (Set Status Doing, Set Status Done). Not Commands. No `maintenance-complex` category exists in Command frontmatter. §7.4 coverage matrix correctly omits this label.

**Filter mechanism for catalog loader:**

```ts
// tests/integration/starter-kit/command-catalog.ts (continued)
type CommandState = "active" | "broken" | "deprecated";

function classifyCommand(cmd: Command): CommandState {
  if (cmd.exocmd__Command_state) return cmd.exocmd__Command_state; // explicit
  if (KNOWN_BROKEN_UUIDS.has(cmd.uid)) return "broken";             // audit list
  return "active";                                                   // default
}

export function loadActiveCommandCatalog(): Command[] {
  return loadCommandCatalog().filter(c => classifyCommand(c) === "active");
}
```

**Proposed starter-kit frontmatter addition** (separate PR, prerequisite for Phase 2):
- Add `exocmd__Command_state: "active" | "broken" | "deprecated"` property.
- Backfill: 41 → `active`, 3 criticality → `broken`, 7 delta → triaged during Phase 0.
- Phase 1 uses `KNOWN_BROKEN_UUIDS` hardcoded set as stopgap until property lands.

### 4.1 Existing coverage inventory

| Layer | Path | Scope | Commands covered |
|---|---|---|---|
| CLI unit (service) | `packages/cli/tests/unit/services/` | 7 service files: archiveAsset, cleanProperties, createRelatedTask, createRelatedProject, fixMissingLabel, planForEvening, renameToUid | ~7 services, **not** command-level (bypasses YAML wiring) |
| CLI unit (invoker) | `packages/cli/tests/unit/commands/dynamic-command.test.ts` | Mocked dispatch path | **0 real commands** (all services mocked) |
| Plugin unit | `tests/unit/presentation/builders/DynamicCommandButtonGroupBuilder.test.ts` + `DynamicFormModal.test.ts` + `InputSchemaField.test.ts` | Component-level rendering logic | **0 specific commands** (synthetic fixtures) |
| Plugin Docker E2E | `tests/e2e/specs/dynamic-commands.spec.ts` + `dynamic-command-buttons-render.spec.ts` + `vault-commands-smoke.spec.ts` | Minimal test-vault (separate) | **3 commands**: Remove Start Timestamp, Start (set-status-doing), Complete (set-status-done) |
| Plugin CT | `tests/component/*.spec.tsx` (18 spec files) | Legacy button components (ArchiveTask, CreateInstance, MarkTaskDone, MoveToBacklog, PlanOnToday, RepairFolder, StartEffort, VoteOnEffort, CleanEmptyProperties) | **~9 legacy button names**, pre-dyncommand architecture (Issue: these test widgets, not RDF-driven commands) |
| Desktop E2E | `tests/e2e-desktop/specs/plugin-load.smoke.spec.ts` (macOS + Windows, label/nightly) | Plugin load smoke, not buttons | **0 commands** |

### 4.2 Gap analysis (41 working starter-kit commands)

| Category | Total working | Covered by CLI unit (services) | Covered by Docker E2E | Covered by CT | **Uncovered at integration level** |
|---|---|---|---|---|---|
| creation | 11 | createRelatedTask + createRelatedProject (2) | — | — | **9** (Convert to Project, Convert to Task, Create Area/Knowledge/Note/Task/DailyNote, Create Child Task, Link to Parent) |
| maintenance | 10 (post-P0-1 de-dup) | archiveAsset, cleanProperties, fixMissingLabel, renameToUid (4) | Remove Start Timestamp (1) | RepairFolder, CleanEmptyProperties (legacy 2) | **~5** (Copy Label to Aliases, Remove End Timestamp, Rollback Status, Set Result, Repair Folder via RDF path) |
| planning | 9 | planForEvening (1) | — | PlanOnTodayButton, VoteOnEffortButton (legacy 2) | **~6** (Plan on Today via RDF, Remove Scheduled Date, Set Planned Start/End, Set Scheduled Date, Shift Day Forward/Backward, Vote on Effort via RDF) |
| status | 10 | — | Start, Complete (2, via cmd-set-status-doing/done) | StartEffort, MarkTaskDone, MoveToBacklog (legacy 3) | **~7** (Move to Analysis, Move to ToDo, Set Draft Status, Set Status Backlog/Blocked/Cancelled/Review/Waiting) |

**Total uncovered at end-to-end grounding integration level: ~27 of 41 working commands.** Unit-level CLI tests cover services they use, but NOT YAML-to-frontmatter pipeline.

### 4.3 Historical regression baseline (для Success Metrics §9)

10 issues #2863-#2872 closed 2026-04-19/20:

- #2863 CLI dyncommand list — UUID-wikilink class match (caught by **contract-test** + CLI integration)
- #2864 service_call silent success — 10 stub handlers (caught by **CLI integration** — stubs throw explicitly now)
- #2865-2868 createRelatedTask / smoke / precondition — (caught by **CLI integration**)
- #2869 cleanProperties wire-only — host fn unregistered, default permissive (caught by **CLI integration** if ASK-gate is tested)
- #2870-2872 — (similar, various grounding dispatch)

**Proposed: retroactive audit** — checkout each of v15.105.6, v15.105.7, v15.105.8, v15.110.0 and run new suite against each version; expect tests to FAIL on pre-fix commits, PASS on post-fix commits. Quantifies regression-catch rate concretely.

**Audit protocol (v2, resolves review M8 fixture-version drift):**

Without fixture-version alignment the audit is unmeasurable (either today-fixtures-vs-old-plugin drift fails tests non-regressively, or today-fixtures reference Commands that didn't exist pre-fix).

Protocol:

1. **For each target plugin version** (v15.105.6, v15.105.7, v15.105.8, v15.110.0):
   1. Identify contemporaneous starter-kit SHA via git commit dates (within ±24h of plugin tag timestamp).
   2. Check out plugin at tag + starter-kit submodule at that SHA:
      ```bash
      git -C <plugin> checkout v15.105.6
      git -C <plugin>/packages/starter-kit-fixtures checkout <contemporaneous-sha>
      ```
   3. Run `npm run test:starter-kit-integration -- --forceExit` from tagged plugin version.
2. **Collect failures** per run; join failure-diff file paths against the sprint issue's landed fix commit.
3. **Count caught regression** only if pre-fix suite run produces a failure whose diff points at the **exact file the fix landed in** (verified via `git log --oneline -- <path>` cross-reference to issue #).
4. **Report unmeasurable** categories separately:
   - environmental failures (SDK version drift, missing exports, Node version)
   - fixture-drift failures (Command exists today, didn't pre-fix)
   - fixture-factory API evolution (helpers changed signature post-target-version)
5. **KPI:** `caught / (caught + missed - unmeasurable)`. Target ≥80% as §9 asserts, but **publish the unmeasurable denominator alongside** for honesty.

**Execution responsibility:** Phase 2 item (not Phase 1) — pilot suite stabilizes before retroactive audit runs.

---

## 5. Constraints

| Constraint | Binding |
|---|---|
| CI runtime budget | test-unit/test-coverage job = 7min timeout; existing utilisation ~2-4min; budget для new tests ≈ 2-3min |
| e2e-shard budget | 5min per shard × 4 shards; existing utilisation near-full; can't add 41 E2E tests without expanding shards |
| Docker-only E2E | `packages/obsidian-plugin/CLAUDE.md`: "E2E tests run ONLY in Docker" — new E2E MUST reuse Dockerfile.e2e |
| No GUI automation | no osascript / xdotool / computer-control in CI |
| Linux-only на PR | desktop E2E (macOS/Windows) nightly/label-only, non-blocking |
| Coexist с required checks | 8 required CI checks (build, typecheck, test-unit, test-coverage, test-bdd, archgate, e2e-tests, test-component) |
| Node 22 | per all workflow configs |
| Worktree-only dev | changes only via `worktrees/` — consumer of this RFC produces PRs из starter-kit worktree + plugin worktree |

---

## 6. Alternatives Analyzed

For each: **coverage model** · **CI cost** · **maintenance (1=stable … 5=brittle)** · **setup complexity** · **what it misses** · **recommended subset**.

### A. Programmatic via CLI harness *(chosen primary)*

**Coverage model:** L2 integration — exercises real `NoteToRDFConverter` → `CommandResolver.resolveForAsset` → `PreconditionEvaluator.evaluate` → `GroundingExecutor.execute` against starter-kit YAML. Asserts Result.success, Notice message, frontmatter diff (before/after fs read).

**CI cost:** v1 estimated 50-200ms per command × 41 = 5-10s wall. **v2 revised (per review m1):** without benchmark this is speculation. Realistic floor accounting for `os.tmpdir()` create + triplestore init + 3-5 scenarios per command + fs reads = **30-120s wall** for 41-43 commands. Phase 0 pilot benchmark publishes actual per-command cost. Fits test-unit job 7min budget with ≥3× headroom even at upper bound. Zero container start-up; pure Node.

**Maintenance:** 2/5 (stable). Parametrized by starter-kit glob; when commands change, suite discovers them automatically. Service-layer changes (new grounding type) require small test helper extension, not mass test edits.

**Setup complexity:** medium. Need:
- Submodule / npm dep for starter-kit
- Fixture factory: synthetic `ems__Task` / `ems__Project` / `ems__Area` asset для each command's binding
- Test helper for "execute command X on asset Y, return frontmatter diff"
- ~2 new files × ~150 LOC each

**What it MISSES (exhaustive, binding for RFC):**
- `ButtonGroupsBuilder` filter bugs (criticality invisible — Finding #1)
- `LayoutRenderer` category rendering order
- Inline button DOM placement / visibility rules (requires workspace.getActiveFile + metadataCache timing)
- Duplicate-label side-by-side rendering (Finding #3) — CLI sees 2 commands but doesn't render them as DOM siblings
- `confirmMessage` → native `window.confirm` dialog path (CLI uses `--yes` flag to skip)
- Input modal shape (date-picker vs text field vs enum) — modal is React/Obsidian-UI-only
- `successMessage` delivery via `Notice` — CLI logs to stdout, fade-in-4s behavior impossible to test here
- Obsidian `metadataCache` lag bugs (#2693-class issue — "file written but cache stale")
- Post-write re-render of button group (stale preconditions)

**Recommended subset:** **all 41 commands** via parametrized suite, each with 1-3 fixture scenarios (precondition satisfied, precondition unmet, edge cases like composite grounding).

**Why chosen primary:** highest coverage-per-minute ratio; catches grounding / dispatch / YAML-wiring bugs exactly matching CLI parity sprint pattern; deterministic; fast; no container start-up; extends existing CLI test infra.

---

### B. Docker + Obsidian desktop E2E (existing `e2e-shard` path)

**Coverage model:** L3 end-to-end — real Obsidian 1.9.14 headless in Docker (xvfb), real plugin, real DOM events, real frontmatter write.

**CI cost:** 30-60s per command × 41 = **20-40 min**. **Does NOT fit existing 5min × 4-shard budget.** Would require scaling to 10+ shards OR skipping 30+ commands.

**Maintenance:** 4/5 (brittle). Obsidian version updates break launcher; metadataCache lag → flaky (already documented in existing specs). Each test needs ~30 lines of setup boilerplate for timing.

**Setup complexity:** existing infra reusable. Dockerfile.e2e already builds Obsidian container. Adding fixtures to `tests/e2e/test-vault/` works, but 41 commands + fixtures = O(hundreds of fixture files).

**What it MISSES:**
- Nothing at UI level (covers full stack)
- BUT: can't detect service-layer contract violations cheaply; flakiness obscures signal

**Recommended subset:** **5-7 representative commands** — one per category + edge case:
- `Create Child Task` (creation, async service_call, no confirm)
- `Archive Completed` (maintenance, confirm modal + destructive)
- `Set Result` (maintenance, input modal no-confirm)
- `Set Planned Start` (planning, confirm + input — currently buggy per Finding #5; test AFTER UX RFC P1-3 drops confirm)
- `Start` / `Complete` — already covered, keep
- `Set Status Backlog` (status rollback — timestamps retention is a known UX bug post-UX-RFC P1-5 fix)

**Why complement, not primary:** runtime budget hard-blocks 41-command scale. Keep subset; let it catch UI-integration classes CLI can't.

---

### C. Playwright Component Testing

**Coverage model:** L2 UI unit — mount `ActionButtonsGroup` + `DynamicCommandButtonGroupBuilder` с synthetic props; simulate clicks; assert DOM state + emitted callbacks.

**CI cost:** 1-3s per spec × 41 = 45s-2min. Fits `test-component` job (15min budget).

**Maintenance:** 3/5. Component rewrites (e.g. migration to Signal-based state) require test edits. React-render intensive.

**Setup complexity:** existing CT infra (`playwright-ct.config.ts`, 18 existing specs). BUT: dynamic commands are **RDF-driven** not prop-driven — CT would need to inject TripleStore mock per test. Adding RDF fixtures into CT harness = architectural work.

**What it MISSES:**
- Real `PreconditionEvaluator` SPARQL execution (mocked in CT by design)
- Real `GroundingExecutor` dispatch (would need to mock or share with primary harness)
- File system integration (`metadataCache` / `vault.read`)

**Recommended subset:** 3-5 commands covering UI-only concerns that CLI can't:
- Category group visibility (criticality/zone invisible bug — Finding #1)
- Duplicate-label rendering (Finding #3)
- Button sort order within group

**Why secondary (not primary, not complement — v2 soft-revised per review m5):** narrow UI concern niche — **but** the `ButtonGroupsBuilder` visibility bug (audit Finding #1, criticality invisible) is exactly the class of bug CT can detect deterministically without full Obsidian startup (CT harness can mount `ButtonGroupsBuilder` with RDF-driven props once a TripleStore mock layer is added). Primary covers behavior; Docker E2E covers UI integration; CT catches **specific visibility / group-rendering regressions** Docker E2E detects only flakily. Memory `reference_playwright_ct_sync_function_props` documents a known CT limitation (sync function props unobservable) — recognize this class gap, plan around it. Recommend adding **2-3 targeted specs** for known-bug-classes: criticality/zone group-render invariant, duplicate-button rendering, collapsed-category toggle state. Treat CT as a **cheap dedicated probe** for `ButtonGroupsBuilder` regression, not a broad coverage layer.

---

### D. Screenshot / visual regression (Percy / Chromatic / Playwright snapshots)

**Coverage model:** visual diff of rendered button groups vs baseline.

**CI cost:** 5-10s per snapshot × 41 = 3-7 min. Fits `test-component` (already runs visual tests via `playwright-ct.config.ts --grep visual`).

**Maintenance:** 5/5 (very brittle). Font rendering, anti-aliasing, OS-specific pixel differences → constant baseline churn. Cross-platform snapshot is a known pain point (existing CI has `--update-snapshots` fallback for Linux-missing snaps).

**Setup complexity:** existing Playwright snapshot infra. But dynamic-commands use Obsidian theme CSS → snapshots are theme-bound.

**What it MISSES:**
- **Behavior entirely.** Visual-only; passing snapshot + broken grounding = green CI.
- Frontmatter state changes.

**Recommended subset:** **rejected for button testing**. Visual regression is orthogonal to the bug classes audit found. Consider keeping existing `*.visual.spec.tsx` for legacy components; do not extend to dyncommand.

---

### E. Dual-layer (A + B + F) *(shape of proposed solution)*

See §7 Proposed Solution — this is the recommendation, not a separate alternative.

---

### F. YAML contract test *(added per advisor — 7th candidate)*

**Coverage model:** static analyzer — reads all `exocmd/**/*.md` frontmatter, validates JSON-Schema (ajv/zod) + cross-reference invariants:
- Every Command has ≥1 Binding
- Every Binding references an existing Command + Grounding
- Every Grounding has a known `serviceId` / `targetProperty` / `type`
- No duplicate Command labels within same `category` (position field does not exist on Command; v2 revised per review m3: invariant is `(category, label)` uniqueness only; ordering-within-category is inferred from sort-key / filesystem order, not a frontmatter field)
- `confirmMessage` only permitted on destructive categories (catches Finding #5 redundant-confirm class post-policy)
- `successMessage` required (P1-4 enforcement)
- Valid `exo__Asset_uid` format (UUID-v4)
- All referenced classes resolvable in ontology

**CI cost:** ~200ms total (file IO + schema validation). Near-free.

**Maintenance:** 1/5 (stable). Schema evolves только when contracts change (explicit).

**Setup complexity:** ~1 new file, ~200 LOC ajv schema + invariant-checker. Can reuse `WikilinkValidator` from CLI package (already exists).

**What it MISSES:**
- Runtime dispatch logic (catches shape bugs, not execution bugs)
- Obsidian metadataCache / filesystem-specific behavior

**Recommended subset:** **all 41+ files** + any future commands. Runs на every PR touching `starter-kit/` OR plugin YAML schemas.

**Why chosen complement #2:** cheapest signal for a class of bugs (duplicate labels, orphan bindings, schema drift) that audit explicitly found. Complements Primary without overlap.

---

### Trade-off matrix summary

| Approach | Coverage | CI cost | Maint. | Setup | Misses | Scale fit 41? |
|---|---|---|---|---|---|---|
| A. CLI harness | L2 integration | 5-10s | 2/5 | med | UI layer, modals, Notice | ✅ all 41 |
| B. Docker E2E | L3 full | 20-40min | 4/5 | low (reuse) | — | ❌ 5-7 only |
| C. Playwright CT | L2 UI | 45s-2min | 3/5 | med | RDF pipeline | ⚠ 3-5 targeted |
| D. Visual regression | pixel-level | 3-7min | 5/5 | low | behavior | ❌ rejected |
| F. YAML contract | L1 static | <1s | 1/5 | low | runtime | ✅ all 41+ |

---

## 7. Proposed Solution

### 7.1 Primary approach: CLI harness (A)

New test suite under `packages/cli/tests/integration/starter-kit/`:

```
packages/cli/tests/integration/starter-kit/
  command-catalog.ts               # glob exocmd/**/*.md, parse, return Command[]
  command-catalog.self-test.ts     # asserts catalog >= 40 cmds (guards silent-zero-discovery B1)
  extract-target-class.ts          # deterministic ladder — Command → target class
  predict-mutation.ts              # YAML-driven expected-frontmatter predictor
  user-input-factory.ts            # synthesize --input JSON per command inputSchema
  fixture-factory.ts               # build synthetic ems__Task / ems__Project / ems__Area per resolved target
  execute-command.ts               # real GroundingExecutor pipeline wrapper
  grounding-pipeline.test.ts       # parametrized suite — each Command × scenarios
```

### 7.1a Fixture factory strategy ladder (new in v2, resolves review M2)

`extractTargetClassFromCommand(cmd)` follows a **strict resolution ladder**. Each step either returns a class or falls through to the next. Phase 0 mandatory prototype: run against all **44 Commands** (SPARQL-authoritative count, see §4.0) + classify which bucket each falls into.

**Strategy ladder:**

1. **Explicit `exocmd__Command_targetClass`** — if Command frontmatter declares target class (proposed for v2 starter-kit migration, analogous to `exocmd__Command_state`).
2. **Precondition SPARQL inspection** — if `exocmd__Command_precondition` references a Precondition asset whose SPARQL contains `?this rdf:type <class>` OR a triple pattern `?this <namespace>__<Class>_<property>`, extract class IRI.
3. **Grounding `targetProperty` heuristic** — if all Groundings for this Command share a common `targetProperty` (e.g. `ems__Task_zone`), infer target class from the property's RDFS:domain (e.g. `ems__Task`).
4. **Grounding `targetValue` class-flip** — for class-flip commands like "Convert to Task", `targetValue: "[[ems__Task]]"` indicates the DESTINATION class; source class stays `ems__Effort` or broader. Fixture is pre-flip instance (`ems__Project`).
5. **Fallback `ems__Task`** — broadest applicable class; flag test as "fallback-target" so coverage matrix can downgrade it from "P-mutation ✅" to "P-dispatch ✅".

**Phase 0 deliverable (prerequisite for Phase 1 PR merge):**

Publish a `Phase-0-prototype-report.md` containing:
- Per-Command table: `label | uid | chosen strategy (1-5) | target class | confidence`
- Aggregate: `Strategy 1: N, Strategy 2: N, ..., Strategy 5 (fallback): N`
- **Gate:** if Strategy 5 ratio > 30% of **44 Commands**, harness coverage-claim is too optimistic — re-scope required before Phase 1 PR. *(Phase 0 result: 40.9% → FAIL → Option C migration applied → Phase 1 result: 22.7% → PASS. See `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md`.)*

**Rationale:** the "audit-driven" mental model that binding metadata is explicit is false (verified by reviewer via `grep -l '"exocmd__Binding"' exocmd/*.md` = 0). The fixture factory is really a **precondition satisfier** — it must generate assets that satisfy the Command's precondition SPARQL, and classes are inferred from that constraint.

**Test pattern (representative, v2):**

```ts
import { describe, it, expect, beforeEach } from "@jest/globals";
import { loadActiveCommandCatalog } from "./command-catalog";
import { buildFixtureFor } from "./fixture-factory";
import { buildUserInputFor } from "./user-input-factory";
import { predictMutationForGrounding } from "./predict-mutation";
import { executeCommand } from "./execute-command";

describe.each(loadActiveCommandCatalog())(
  "Starter-kit command: $label [$uid]",
  (cmd) => {
    let fixture: VaultFixture;
    let userInput: Record<string, unknown> | undefined;

    beforeEach(() => {
      fixture = buildFixtureFor(cmd);        // resolves target class via §7.1a ladder
      userInput = buildUserInputFor(cmd);    // v15.106.0+ `--input` JSON or undefined
    });

    it("dispatches grounding without throwing", async () => {
      const result = await executeCommand(cmd, fixture.assetPath, { input: userInput });
      expect(result.success).toBe(true);
    });

    it("produces expected successMessage on structured result", async () => {
      if (!cmd.successMessage) return; // skipped when absent
      const result = await executeCommand(cmd, fixture.assetPath, { input: userInput });
      expect(result.message).toBe(cmd.successMessage); // CLI Result.message, not Obsidian Notice
    });

    it("respects precondition — skipped when unmet", async () => {
      if (!cmd.precondition) return;
      const unmetFixture = buildFixtureFor(cmd, { precondition: "unmet" });
      const result = await executeCommand(cmd, unmetFixture.assetPath, { input: userInput });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("PRECONDITION_UNMET");
    });

    it("mutates frontmatter correctly", async () => {
      if (isFallbackTarget(cmd)) return; // §7.1a Strategy 5 — dispatch-only, skip mutation assertion
      const before = await readFrontmatter(fixture.assetPath);
      await executeCommand(cmd, fixture.assetPath, { input: userInput });
      const after = await readFrontmatter(fixture.assetPath);
      const expected = predictMutationForGrounding(cmd, userInput); // deterministic, YAML-driven
      expect(diff(before, after)).toMatchObject(expected);
    });
  }
);
```

**`buildUserInputFor(cmd)` contract (resolves review M3):**

`packages/cli/tests/integration/starter-kit/user-input-factory.ts` reads `exocmd__Command_inputSchema` (or Grounding-referenced `exocmd__Grounding_inputSchema`) and synthesizes CLI `--input '{"field":value}'` payloads. Supported field types (per memory `reference_inputschema_field_mapping`): `text`, `date`, `enum`, `multiline`, `assetRef`.

- `text` / `multiline` → `"test-input-<uid>"`
- `date` → `"2026-04-20"` (deterministic date constant)
- `enum` → first option value from schema
- `assetRef` → `[[<known-seed-uuid>]]` (fixture factory pre-creates seed)

If Command has no inputSchema → `userInput = undefined` → `--input` flag omitted.

CLI consumption (v15.106.0+, PR #2875, memory `reference_dyncommand_exec_input_flag`): `npx exocortex-cli command <cmd-uid> <asset-path> --input '{"value":"test"}'` propagates the JSON to `executeServiceCall`'s `userInput` parameter before dispatching.

**`predictMutationForGrounding(cmd, userInput)` contract (resolves review M4):**

Predictor reads Grounding YAML + substitutes `$input` / `$value` / `$nowLocal` placeholders deterministically:

| Grounding shape | Expected mutation |
|---|---|
| `type: property_set` + `targetProperty: X` + `targetValue: Y` | `{ [X]: Y }` (Literal) OR `{ [X]: "[[Y]]" }` (wikilink — verified via `exocortex-cli SELECT ?p ?o` dump per memory `feedback_pre_fix_triple_dump_mandatory`) |
| `type: service_call` + `serviceId: updateProperty` + `targetProperty: X` + `targetValue: $input` | `{ [X]: userInput.value }` |
| `type: composite` (Set Status Doing) | `{ ems__Effort_status: "[[ems__EffortStatusDoing]]", ems__Effort_startTimestamp: "$nowLocal" }` — timestamp matched by regex |
| `type: create_instance` | new file created, not frontmatter diff on fixture — separate assertion `expect(fs.existsSync(expectedChildPath)).toBe(true)` |

**Phase 0 prototype (mandatory before Phase 1 PR, resolves review M4):**

Implement predictor against **two representative composites**:
- `Set Status Doing` (`ems__Effort_status` + `ems__Effort_startTimestamp`) — happy-path composite
- `Convert to Task` (class-flip: `exo__Instance_class` rewrite to `[[ems__Task]]`) — `targetValue` Literal-vs-IRI edge case

**Gate:** if predictor needs >5 per-command special-case branches to green the two prototypes, the "auto-discovers" claim is false. Re-scope: either restrict Primary mutation-assertion to simple `property_set` + `updateProperty` groundings (drop composite mutation coverage), or invest in a richer predictor architecture. Publish decision in `Phase-0-prototype-report.md`.

### 7.2 Complement 1: Docker E2E smoke subset (B)

Extend `packages/obsidian-plugin/tests/e2e/specs/` с one new spec:

```
packages/obsidian-plugin/tests/e2e/specs/starter-kit-smoke.spec.ts
```

Pre-populates test-vault `03 Knowledge/commands/` with **7 starter-kit commands** (copied from starter-kit submodule at CI setup) + 3 representative target assets (`ems__Task` Backlog, `ems__Task` Done, `ems__Project` Doing). Asserts:

- Each category header renders
- Inline buttons appear with correct label per category
- Click → grounding executes → file-on-disk mutates (same pattern as `vault-commands-smoke.spec.ts`)
- Confirm modal appears for `Archive Completed` (destructive)
- Input modal appears для `Set Result`

**Exactly 7 commands**, selected for coverage gap:
1. **Create Child Task** (creation, async)
2. **Archive Completed** (maintenance, confirm+destructive)
3. **Set Result** (maintenance, input modal without confirm)
4. **Set Planned Start** (planning, input modal — ensures UX RFC P1-3 fix holds)
5. **Plan on Today** (planning, direct, fast-path)
6. **Set Status Doing** (status, composite grounding)
7. **Set Zone to Today** (post-UX-RFC P0-2 rename — covers criticality→zone migration)

### 7.3 Complement 2: YAML contract test (F)

```
packages/cli/tests/integration/starter-kit/exocmd-contract.test.ts
packages/cli/tests/integration/starter-kit/exocmd-contract.baseline.json
```

**v5 path-drift fix:** v2-v4 listed this file under `packages/obsidian-plugin/tests/unit/infrastructure/`. Actual Phase 1 implementation (PR #2888, v15.114.2) placed it under the CLI package's starter-kit integration dir because the helpers use `import.meta.url` + ESM `.js` imports; plugin jest is CJS ts-jest и не смог бы загрузить тот же код без двойного bundle. Contract test is semantically invariant — runs в `test-unit` job regardless of which workspace hosts it. See memory `reference_cli_vs_plugin_esm_boundary`.

Reuses `starter-kit-fixtures` submodule; runs в `test-unit` job. ~200ms total.

**Invariants checked:**
- Schema validation per asset kind (`exocmd__Command`, `exocmd__Grounding`, `exocmd__Binding`, `exocmd__Precondition`)
- Every Command has ≥1 Binding (no orphans)
- No duplicate `(category, label)` tuples (v2: dropped `position` per review m3 — field does not exist on Command assets)
- `confirmMessage` only when `category ∈ {creation/convert, maintenance/destructive}` (policy-guard for UX RFC P1-3)
- All `targetProperty` values resolve to ontology (cross-package reference)
- Every active Command has discoverable class UUID wikilink `[[790e5b16-251d-4556-96ac-e5c7f1429b2e]]` (guards against catalog-loader silent-zero regression — same spirit as §3.3 self-test, static version)

### 7.4 Coverage matrix (v2 — split by UX-RFC state, resolves review M1 + M3 + m2)

Legend:
- **P-dispatch** ✅ = CLI harness dispatches without throw; precondition scenario covered. Includes userInput-requiring commands where CLI `--input` works.
- **P-mutation** ✅ = frontmatter-diff prediction holds (requires Strategy 1-4 target-class resolution per §7.1a; Strategy 5 fallbacks get only P-dispatch).
- **C1** = Docker E2E smoke subset (7 commands — §7.2).
- **C2** = YAML contract test (all Commands).
- **—** = not covered by this RFC's additions.

**Current state (pre-UX-RFC, 44 commands including 3 broken criticality):**

| Category | Label | P-dispatch | P-mutation | C1 | C2 |
|---|---|---|---|---|---|
| creation | Convert to Project | ✅ | ✅ | | ✅ |
| creation | Convert to Task | ✅ | ✅ | | ✅ |
| creation | Create Area | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Child Task | ✅ | ✅ (create_instance) | ✅ | ✅ |
| creation | Create Knowledge | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Note | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Project | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Related Task | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Task | ✅ | ✅ (create_instance) | | ✅ |
| creation | Create Task for DailyNote | ✅ | ✅ (create_instance) | | ✅ |
| creation | Link to Parent | ✅ (userInput assetRef) | ✅ | | ✅ |
| **criticality** (BROKEN pre-P0-2) | Set Criticality High | ⛔ state=broken → excluded | — | | ✅ (contract catches mismatch) |
| **criticality** (BROKEN) | Set Criticality Medium | ⛔ excluded | — | | ✅ |
| **criticality** (BROKEN) | Set Criticality Low | ⛔ excluded | — | | ✅ |
| maintenance | Archive Completed | ✅ | ✅ | ✅ | ✅ |
| maintenance | Clean Properties | ✅ | ✅ | | ✅ |
| maintenance | Copy Label to Aliases | ✅ | ✅ | | ✅ |
| maintenance | Fix Missing Label | ✅ | ✅ | | ✅ |
| maintenance | Remove End Timestamp | ✅ | ✅ | | ✅ |
| maintenance | Remove Start Timestamp (canonical) | ✅ | ✅ | | ✅ |
| maintenance | Remove Start Timestamp (dup — P0-1 deletes) | ⛔ deleted post-P0-1 | — | | ✅ (contract flags dup) |
| maintenance | Rename to UID | ✅ | ✅ | | ✅ |
| maintenance | Repair Folder | ✅ | ✅ | | ✅ |
| maintenance | Rollback Status | ✅ | ✅ | | ✅ |
| maintenance | Set Result | ✅ (userInput text) | ✅ | ✅ | ✅ |
| planning | Plan for Evening | ✅ | ✅ | | ✅ |
| planning | Plan on Today | ✅ | ✅ | ✅ | ✅ |
| planning | Remove Scheduled Date | ✅ | ✅ | | ✅ |
| planning | Set Planned End | ✅ (userInput date) | ✅ | | ✅ |
| planning | Set Planned Start | ✅ (userInput date) | ✅ | ✅ | ✅ |
| planning | Set Scheduled Date | ✅ (userInput date) | ✅ | | ✅ |
| planning | Shift Day Backward | ✅ | ✅ | | ✅ |
| planning | Shift Day Forward | ✅ | ✅ | | ✅ |
| planning | Vote on Effort | ✅ | ✅ | | ✅ |
| status | Move to Analysis | ✅ | ✅ | | ✅ |
| status | Move to ToDo | ✅ | ✅ | | ✅ |
| status | Set Draft Status | ✅ | ✅ | | ✅ |
| status | Set Status Backlog | ✅ | ✅ | | ✅ |
| status | Set Status Blocked | ✅ | ✅ | | ✅ |
| status | Set Status Cancelled | ✅ | ✅ | | ✅ |
| status | Set Status Doing | ✅ | ⚠ composite — gated by Phase 0 predictor prototype | ✅ | ✅ |
| status | Set Status Done | ✅ | ⚠ composite (§7.1 predictor contract) | | ✅ |
| status | Set Status Review | ✅ | ✅ | | ✅ |
| status | Set Status Waiting | ✅ | ✅ | | ✅ |

**Target state (post-UX-RFC Phase 0-2, 43 commands including 3 zone):** identical matrix with:
- `criticality` rows removed (3)
- `zone` rows added (3): Set Zone to Today (⇔ C1 subset #7), Set Zone to This Week, Set Zone to Someday — all P-dispatch ✅, P-mutation ✅ (ems__Task_zone simple property_set)
- duplicate Remove Start Timestamp row removed (1)
- Total: 44 − 3 criticality − 1 dup + 3 zone = **43 active Commands**

**Totals (current):** 41/44 active with P-dispatch · 39/44 with P-mutation (2 composite commands gated by predictor prototype) · 7/44 C1 · 44/44 C2.
**Totals (post-UX-RFC):** 43/43 active P-dispatch · 41/43 P-mutation · 7/43 C1 · 43/43 C2.

### 7.4a Transition plan across UX RFC phases (new in v2, resolves review M1)

Prerequisite decision: does CI Test RFC Phase 1 block on UX RFC Phase 0-2 merge?

**Chosen policy: NO — CI RFC Phase 1 is UX-RFC-agnostic.**

Discovery is by class-UUID (§3.3 corrected catalog loader); category name change `criticality` → `zone` is transparent. Suite naturally:

1. Today: discovers 44 Commands (SPARQL-authoritative, see §4.0), filters to 41 active (criticality marked broken via KNOWN_BROKEN_UUIDS or state property), runs tests.
2. Post-UX-RFC P0-1 merge: 3 criticality Commands replaced by 3 zone Commands; catalog discovers 44 − 3 + 3 = 44 still; state filter keeps 43.
3. Post-UX-RFC P0-1 duplicate removal: 44 → 43; 43 → 42, then if P0-2 zone-rename adds 3 new with active state → 45 → suite grows to 45.

**Gating constraints (explicit):**
- **Contract test (§7.3) must NOT hardcode category name** `criticality` or `zone`. Policy: "no duplicate (category, label)" uses whatever category value exists at test-time.
- **E2E smoke subset #7 "Set Zone to Today"** is gated on UX-RFC P0-2 merge. Prior to merge, E2E tests the pre-rename path (Set Criticality High → current UI-invisible → skipped as known-broken). After merge, activates automatically.
- **Phase 1 PR timing:** merge-able against current starter-kit main; does NOT block on UX RFC.

**Explicit option rejections (for review transparency):**
- ~~(a) CI Test RFC blocks on UX RFC Phase 0-2 merge~~ — rejected, unnecessary coupling.
- ~~(c) pre-rename / post-rename variants gated by feature flag~~ — rejected, adds branching complexity.
- **(b) design-parametrized so rename is transparent** — **chosen** (discovery-by-UUID).

### 7.5 CI workflow changes

**New jobs / steps:**

1. **`ci.yml → test-unit`**: add submodule checkout + run contract test + new integration tests
   ```yaml
   - name: Checkout
     uses: actions/checkout@v6
     with:
       submodules: recursive
   # existing build steps...
   - name: Run CLI integration tests (starter-kit)
     run: npm run test:starter-kit-integration  # new script
   ```

2. **`ci.yml → e2e-shard`**: add one new spec `starter-kit-smoke.spec.ts`; existing sharding unchanged (7 tests distribute across shards).

3. **`ci.yml → test-unit`**: new contract test is a jest file under `tests/unit/`, auto-picked by existing glob.

**Triggers:**
- Primary (CLI integration) → runs on every PR (`test-unit`)
- Complement 1 (E2E smoke subset) → runs on every PR (`e2e-shard`, required check)
- Complement 2 (contract) → runs on every PR (`test-unit`)

No separate nightly / label-gated runs needed.

### 7.6 Fixtures strategy

- **Starter-kit access:** submodule `exocortex/packages/starter-kit-fixtures/` pointing to `exocortex-starter-kit` main.
- **Per-test asset fixtures:** `fixture-factory.ts` generates synthetic `ems__Task` / `ems__Project` / `ems__Area` markdown files in tmp dir (jest `os.tmpdir()`), one per test. Deterministic UUIDs (`'00000000-0000-0000-0000-<label-hash>'`) для reproducibility.
- **Cleanup:** `afterEach` removes tmp dir.
- **Ephemerality:** no shared seed; each test isolated.

### 7.7 Failure reporting

- Jest assertions → standard diff output (frontmatter before/after)
- `execute-command.ts` attaches Result object + plugin log tail to failure message
- E2E failures: existing video/screenshot/trace artifact upload already wired
- Contract test: ajv error path → exact offending file + property path

### 7.8 Parallel vs serial

- **CLI integration:** trivially parallel (each test has isolated tmp vault). Jest workers auto-distribute.
- **E2E smoke:** reuses existing `e2e-shard` matrix (4 shards); 7 new tests distribute 2-2-2-1.
- **Contract:** single-threaded, <1s — no need to parallelize.

---

## 8. Migration Plan

### Phase 0 — Prerequisite prototypes (new in v2, gating Phase 1 — resolves review M2 + M4 + M7 + m1)

**Goal:** eliminate hand-waving in critical helpers before committing to 200-300 test scaffolding.

0a. **Prototype `extractTargetClassFromCommand(cmd)`** against all **44 discovered Commands** (§7.1a ladder, SPARQL count).
    - Deliverable: per-Command strategy classification table.
    - **Gate:** Strategy 5 (fallback) ratio ≤ 30%, else re-scope.
    - **Status:** Phase 0 task `7804d300` Done 2026-04-20 — gate FAIL (40.9%) → Option C migration applied (Phase 1 task `1894db7c`) → re-evaluation PASS (22.7%). See `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md`.

0b. **Prototype `predictMutationForGrounding(cmd, input)`** against 2 representative composites:
    - `Set Status Doing` (happy-path composite)
    - `Convert to Task` (class-flip, Literal-vs-IRI edge case)
    - **Gate:** ≤ 5 per-command special-case branches combined.

0c. **Benchmark** per-command wall-time on GHA `ubuntu-latest` using 5 pilot commands × 3 scenarios.
    - Extrapolate to 41-43 Commands.
    - **Gate:** projected total ≤ 3 min test-unit increment.

0d. **Coverage-delta pilot** on same 5 commands:
    - Compare `packages/cli/` coverage before/after pilot merge.
    - **Gate:** ≤ 1% drop in any of {statements, branches, functions, lines}.

0e. **Publish `Phase-0-prototype-report.md`** with 0a+0b+0c+0d findings to RFC stakeholders.
    - Failure of any Gate blocks Phase 1 until remediation or explicit re-scope.

**Ship as:** 1 investigative PR (experimental branch, may be abandoned if Gates fail) `exp(cli): RFC-CI-Tests Phase 0 prototype report`.

### Phase 1 — Foundation (1 day — after Phase 0 Gates green)

1. Adopt fixture access strategy per §3.4 decision rule (submodule Phase-1 start, npm fallback time-boxed).
2. Add `submodules: recursive` to relevant `actions/checkout@v6` calls in `ci.yml`.
3. Write `command-catalog.ts` (§3.3 corrected, class-UUID-based) + `command-catalog.self-test.ts` guard (≥40 discovered).
4. Write `fixture-factory.ts` + `extract-target-class.ts` + `predict-mutation.ts` + `user-input-factory.ts` — architecture informed by Phase 0 prototypes.
5. Write YAML contract-test (Complement 2) — including class-UUID self-guard invariant.
6. Run 5-command pilot coverage-delta measurement (per §9.1 threshold-neutrality commitment).
7. CI green → merge.

**Ship as:** 1 PR `test(cli): starter-kit command-catalog harness + contract (RFC-CI-Tests Phase 1)`.

### Phase 2 — Expand CLI harness (2 days)

7. Extend parametrized suite to all 41 commands
8. Add precondition-unmet scenarios
9. Add frontmatter-diff assertions
10. Retroactive audit: checkout v15.105.6/7/8 and run suite; document expected FAIL/PASS matrix as regression-catch evidence

**Ship as:** 1 PR `test(cli): parametrize starter-kit command suite to 41 commands (RFC-CI-Tests Phase 2)`.

### Phase 3 — E2E smoke subset (1 day)

11. Write `starter-kit-smoke.spec.ts` с 7 representative commands
12. Add fixtures to test-vault under `03 Knowledge/commands/starter-kit/` (copied from submodule at CI setup OR manually synced)
13. Verify 4-shard balance still fits 5min budget

**Ship as:** 1 PR `test(plugin): starter-kit E2E smoke subset (RFC-CI-Tests Phase 3)`.

### Phase 4 — Enforcement (admin-coordinated, not fixed duration)

14. Add new test scripts as required CI checks в branch protection config **— requires repo-admin permissions** (v2 revised per review m6; "0.5 day" implied solo work, in practice this is a coordination step gated on user/admin approval + potential transitional PR-conflict resolution during roll-out)
15. Update `packages/obsidian-plugin/CLAUDE.md` / `AGENTS.md` with testing convention for new commands
16. **Admin handoff checklist:**
    - Confirm new jobs are green for ≥5 consecutive PR merges before requesting branch-protection update.
    - Document rollback procedure in case of unforeseen blocker during enforcement cutover.

**Ship as:** 1 PR `chore(ci): require RFC-CI-Tests suite (RFC-CI-Tests Phase 4)` — merged through admin-owned branch-protection change (may require admin bypass if existing PRs were opened before enforcement).

### Rollback plan

- If any test becomes flaky (>5% false-positive rate over 20 runs), quarantine to `continue-on-error: true` block
- If E2E smoke subset blows budget: reduce from 7 → 5 commands (drop `Plan on Today`, `Set Zone to Today`)
- If submodule friction is high (contributor complaints >3 instances): migrate to npm-published fixture package (§3.1 option B)

---

## 9. Success Metrics

### Quantitative (v2 — revised per review m1 benchmark, M7 coverage threshold)

- **Coverage:** 41-43/43-44 active commands × primary approach (integration level) — see §7.4 split; 7/43 × E2E smoke; 44/44 × contract (including broken criticality for contract-shape check)
- **Test count added:** ~200-300 (41-43 commands × 3-5 scenarios + 1 E2E spec × 7 tests + 10-15 contract assertions)
- **Wall-time added to CI (v2 — benchmark-gated, was hand-waved "10-15s" in v1):**
  - `test-unit`: **estimated 30-120s** (CLI integration + contract) pending Phase 0 pilot benchmark — 5-command pilot × 3 scenarios measures per-command cost on GHA `ubuntu-latest` + extrapolates to 41-43
  - `e2e-shard`: +30-60s per shard (7 tests ÷ 4 shards)
  - Total PR latency increase: **estimated 1-3 min** (was "<1 min" — revised upward pending benchmark)
  - **Gate:** if pilot benchmark shows per-command cost × 43 exceeds 3 min, re-scope Primary to smaller command subset before Phase 2.
- **False-positive rate target:** <5% over 100 runs (measured via existing flaky-test-tracking infra)

### 9.1 Coverage threshold neutrality (new in v2, resolves review M7)

Current CLI thresholds (from `ci.yml` test-coverage job, lines 302–326): statements 65%, branches 60%, functions 70%, lines 65%.

Adding 200-300 integration tests changes coverage in three ways:
1. Branches re-exercised — raises branch% modestly.
2. New helper code (`command-catalog.ts`, `fixture-factory.ts`, `predict-mutation.ts`, `user-input-factory.ts`, `extract-target-class.ts`) — ≈600-800 LOC with own conditional branches. If un-tested, drops branch% below floor.
3. `--coverage` must include integration tests (opt-in via jest config).

**Commitment (chosen policy: threshold-neutral):**

- All new helpers under `packages/cli/tests/integration/starter-kit/test-helpers/` have their own unit tests under `packages/cli/tests/unit/test-helpers/` — coverage counts them. **v5 path-drift fix:** unit-test dir is `packages/cli/tests/unit/test-helpers/` (not under `services/`) — actual Phase 1 helpers bundle PR #2889 placed unit tests directly under `tests/unit/test-helpers/` because the helpers are test infrastructure, not service code. Canonical form in v5.
- Phase 0 pilot publishes **coverage delta table**: before/after statements, branches, functions, lines on `packages/cli/` module.
- **Gate:** if pilot shows >1% drop in any of {statements, branches, functions, lines}, add helper unit tests or adjust helper code until neutral.
- Do NOT propose threshold bump in Phase 1 — keep it reversible. Threshold bump is a separate future PR after 4 weeks of production data.

**Alternatives rejected:**
- ~~Lower thresholds~~ — review discipline regression.
- ~~Exclude integration tests from coverage~~ — hides helper bugs.
- ~~Separate threshold for integration module~~ — adds config complexity for no gain.

### Regression catch rate (retroactive audit per §4.3)

Checkout sequence, run proposed suite, count regressions caught:

| Plugin version | CLI sprint issue | Expected suite behavior |
|---|---|---|
| v15.105.6 (pre-#2866) | grounding targetValue Literal/IRI shape mismatch | **Primary fails** — frontmatter assertion catches IRI shape |
| v15.105.7 (pre-#2864) | CLI service_call silent success (stubs no-op) | **Primary fails** — all service_call tests expect throw, get no-op |
| v15.105.8 (pre-#2863) | CLI dyncommand list UUID-wikilink | **Contract fails** — catalog load fails on binding with UUID-wikilink target |
| v15.110.0 (pre-#2869) | cleanProperties wire-only | **Primary fails** — precondition-gated test detects missing host-fn |

**Target:** ≥80% of sprint #2863-#2872 issues caught by new suite if checked out pre-fix. Quantifies preventive value.

### Qualitative

- **Developer velocity:** new command addition workflow — add YAML file → contract test auto-discovers → integration test auto-parametrizes → no test-file edits required for most cases
- **Onboarding friction:** submodule command on clone (`git submodule update --init --recursive`) in README
- **Failure actionability:** every failure should point to (a) the YAML file, (b) the expected state, (c) the diff — via structured jest output

---

## 10. Open Questions

1. **Submodule vs npm package for fixtures (§3.1)?** Decision owner: maintainer + contributor-experience consideration. RFC recommends submodule; impl Phase 1 can revisit if pain.
2. **Contract test policy for `confirmMessage`:** what's the canonical list of "destructive categories"? UX RFC P1-3 says "Delete, Convert class, Archive, Rename-to-UID" — encode where? Separate `docs/CONFIRM_POLICY.md` referenced by contract-test?
3. **Binding discovery for parametrization:** does `fixture-factory` need full binding ontology or just asset-class → target-file convention? Simpler if latter; needs investigation.
4. **Starter-kit's own CI:** should starter-kit repo run its own contract-test CI independent of plugin? Proposal: yes, for fast feedback before plugin-side suite runs. Requires separate RFC or addendum.
5. **Composite grounding frontmatter prediction:** **RESOLVED in v2 §7.1 `predictMutationForGrounding` contract + Phase 0 prototype gate.** How to encode "Set Status Doing" expected mutation (status + startTimestamp): YAML grounding file declares triples; predictor reads them and substitutes `$input` / `$value` / `$nowLocal` placeholders deterministically. Phase 0 prototype runs against Set Status Doing + Convert to Task; >5 special-case branches triggers re-scope.
6. **Test-vault submodule pin policy:** float on starter-kit main, or pin to tagged releases? Float = faster feedback, pin = reproducibility. Proposal: pin to latest tag, auto-bump via Renovate-style bot on new tag.
7. **Cross-package refactor coordination:** when plugin's `GroundingExecutor` API changes, который repo merges first — plugin or starter-kit? Matters for submodule bump timing.

---

## 11. Related Work

- **Audit input:** `/Users/kitelev/Developer/ui-audit-starter-kit-2026-04-20.md` (44 commands breakdown)
- **UX RFC (sibling):** `/Users/kitelev/Developer/rfc-ui-improvements-2026-04-20.md` (pre-fix scope of test targets)
- **Historical evidence:** CLI parity sprint memory `project_cli_ui_parity_issues_2026_04_19` (10 issues #2863-#2872 — concrete regression baseline)
- **Infra references:**
  - `reference_e2e_desktop_obsidian_gha.md` (desktop E2E pattern — not primary path here but known alternative)
  - `reference_orchestrator_pattern_2026_04_20.md` (child-session sprint model — how to execute phases)
  - Existing tests: `packages/cli/tests/unit/services/`, `packages/obsidian-plugin/tests/e2e/specs/dynamic-commands.spec.ts`, `tests/e2e/specs/vault-commands-smoke.spec.ts`
- **RFC-009** (dyncommand infra origin) — all 41 commands are instances of this contract
- **Fixture access precedent:** `packages/obsidian-plugin/tests/e2e/test-vault/` demonstrates minimal-vault pattern; starter-kit is larger-scale evolution

---

## 12. PR Readiness Gate

**Status:** new in v4 (2026-04-20); user-approved scope expansion during Phase 0 synthesis task `69871588`.
**Relation to §9.1:** §9.1 states the helper-self-coverage commitment as Phase 0 aspiration + pilot-level gate (pilot-PR ≤ 1 pp drop). §12 escalates that same requirement to a **PR-readiness gate** enforced on every Phase 1 PR that ships helper code. §9.1 remains the policy rationale; §12 is the enforcement rule.

### 12.1 Gate item — helpers have own unit tests

> All helpers under `tests/integration/**/test-helpers/` MUST have own unit tests in `tests/unit/**/test-helpers/`. Phase 0 pilot publishes coverage delta table; >1pp drop = gate FAIL → add helper tests or reduce helper LOC before Phase 1 PR.

### 12.2 Rationale

Phase 0 coverage-delta pilot (task `c91f0395`; report `/Users/kitelev/Developer/phase0-coverage-delta-2026-04-20.md`) confirmed the §9.1 threshold-neutrality claim for **test-only** PRs (delta tautologically 0 / +0.04 pp across the 4 metrics). It also measured the **risk surface for Phase 1**: adding ≈ 600–800 LOC of helpers **without** self-coverage projects statements 71.32% → ~61.5% — **3.5 pp below** the 65% `ci.yml test-coverage` floor. Without an enforcement rule the §9.1 commitment is not self-enforcing; the Phase 1 PR would be the first place the coverage regression is observed, and the PR would have to be split after the fact.

### 12.3 Enforcement shape

- **PR template checklist item** (added alongside existing "pilot commands + expected regressions" items): "☐ Every helper added under `tests/integration/**/test-helpers/` has a matching unit test in `tests/unit/**/test-helpers/`."
- **Coverage delta table** published in PR description (same shape as `/Users/kitelev/Developer/phase0-coverage-delta-2026-04-20.md` §4) computed against base-branch commit. Reviewer verifies no metric drops > 1 pp.
- **Failure mode:** > 1 pp drop in any of {statements, branches, functions, lines} on `packages/cli/` → gate FAIL. Remediation options: (a) add the missing helper unit tests, (b) reduce helper LOC, (c) inline the helper at the call site. Threshold bump is **not** an acceptable remediation — see §9.1 alternatives-rejected.

### 12.4 Path convention drift — RESOLVED in v5

**v5 resolution (2026-04-20):** canonical paths set to actual Phase 1 implementation state:

- **Helpers:** `packages/cli/tests/integration/starter-kit/test-helpers/` (per PR #2889 bundle, v15.114.3).
- **Unit tests for helpers:** `packages/cli/tests/unit/test-helpers/` (per PR #2889; note: NOT under `services/`).

v12 text `tests/integration/**/test-helpers/` + `tests/unit/**/test-helpers/` is accurate as glob-shape. v9.1 v5 text reflects the same concrete paths. Drift retroactively closed; no follow-up RFC minor revision required.

v4 historical note (flagged as open follow-up): user-approved text uses path convention `tests/integration/**/test-helpers/` + `tests/unit/**/test-helpers/`. §9.1 historically described helpers living directly under `packages/cli/tests/integration/starter-kit/` + tests under `packages/cli/tests/unit/services/test-helpers/`. Phase 1 шипнуло canonical paths above; §12.4 drift closed in v5.

---

## 13. Appendix — What this RFC deliberately does NOT propose

- Replacing legacy component tests (`tests/component/*.spec.tsx` for pre-dyncommand buttons like ArchiveTaskButton) — those остаются для legacy-button audit trail
- Testing core plugin features (SPARQL, renderers, layouts) — existing jest + BDD coverage stands
- Mobile / iOS Obsidian coverage — out of scope per prompt
- Screenshot visual regression for dyncommand UI — rejected per §6-D
- Plugin-agnostic test infrastructure — scope is Exocortex-only
- Single-shot test for 44 commands in one file — explicit parametrization via catalog discovery

---

## 14. Revision Log

### v5 — 2026-04-20 (Phase 2 closure — CR-2 + path-drift + coverage matrix)

**Triggered by:** Phase 2 closure task `896e7905-b3aa-4cc2-9f7c-42569e863357` + accumulated drift flags from Phase 1/2 implementation (PRs #2886-#2893). Phase 2 work shipped через 3 merged PRs (#2891 41-suite + #2893 preconditions+diff + retroactive audit report `/Users/kitelev/Developer/phase2-retroactive-audit-2026-04-20.md`); this v5 is the docs-only consolidation PR that records Phase 2 exit state + closes amendments.

**Disposition summary:** 0 blockers · 0 majors · 0 minors · 1 amendment (CR-2) · 3 path-drift fixes · 1 new section (§16 Phase 2 Closure Addendum) · 0 new follow-ups.

| Finding | Severity | Disposition | Section(s) touched |
|---|---|---|---|
| V5-1 — CR-2 amendment: AC5 catch-rate gate recalibrated к post-Option-C regressions; pre-Option-C bugs structurally untestable per frankenstein-rewind fixture-shape mismatch (91d9e37 boundary) | Amendment | INCORPORATED | §16.1 (verbatim CR-2 text) + §9.1 reinterpretation note deferred к §16.1 |
| V5-2 — §3.3 snippet filename `command-catalog.self-test.ts` silently outside jest testMatch glob → actual shipped `.self.test.ts` (period) | Path-drift | FIX | §3.3 code block updated + inline rationale |
| V5-3 — §7.3 contract test path listed `packages/obsidian-plugin/tests/unit/infrastructure/`; actual PR #2888 placement `packages/cli/tests/integration/starter-kit/exocmd-contract.test.ts` (ESM/CJS boundary per memory `reference_cli_vs_plugin_esm_boundary`) | Path-drift | FIX | §7.3 path + rationale |
| V5-4 — §9.1 + §12.4 helper unit-test path `packages/cli/tests/unit/services/test-helpers/`; actual PR #2889 placement `packages/cli/tests/unit/test-helpers/` (no `services/` nesting) | Path-drift | FIX | §9.1 path + §12.4 resolution |
| V5-5 — Phase 2 exit coverage matrix snapshot + references block not present in v4; required for Phase 2 closure recordkeeping | Gap | ADD | New §16.2 + §16.3 |

**Renumbered sections:** none. §16 is net-new append after §15 Rejected Minor Findings; all prior § numbers preserved.

**No semantic changes** to the test strategy, ladder algorithm, gate thresholds, or coverage matrix structure. All edits are path-correctness + CR-2 scope amendment + Phase 2 closure recordkeeping.

### v4 — 2026-04-20 (Phase 0 synthesis + PR-readiness gate)

**Triggered by:** Phase 0 synthesis task `69871588-e240-49a4-bf68-38a82963c431` + user-approved scope expansion to encode the §9.1 helper-self-coverage commitment as a PR-level gate. Motivated by Phase 0 coverage-delta pilot finding (`c91f0395`, report `/Users/kitelev/Developer/phase0-coverage-delta-2026-04-20.md` §6): Phase 1 helpers without self-coverage project −3.5 pp statements, below the 65% CI floor.

**Disposition summary:** 0 blockers · 0 majors · 0 minors · 1 new section (§12 PR Readiness Gate) · 1 open follow-up (path-convention drift, Phase 1 resolution).

| Finding | Severity | Disposition | Section(s) touched |
|---|---|---|---|
| V4-1 — §9.1 helper-self-coverage commitment not self-enforcing; Phase 1 PR projected −3.5 pp statements without a PR-level gate | Gap | FIX | New §12 PR Readiness Gate (user-approved verbatim text at §12.1; escalation-over-§9.1 framing at §12.2-12.3) |
| V4-2 — §12 text path convention (`tests/integration/**/test-helpers/`) differs from §9.1 path language (`packages/cli/tests/integration/starter-kit/` + `packages/cli/tests/unit/services/test-helpers/`) | Drift | FLAG | §12.4 — Phase 1 implementation reconciles (move helpers / clarify §9.1 / treat glob as equivalent). Does not block Phase 0 → Phase 1 transition. |

**Renumbered sections** (v3 → v4): old §12 Appendix → §13 Appendix; old §13 Revision Log → §14 Revision Log; old §14 Rejected Minor Findings → §15 Rejected Minor Findings. Two cross-references updated in the header (§14/§15 references).

**No semantic changes** to the test strategy, ladder algorithm, gate thresholds, coverage matrix, or Phase 0 gate results. All Phase 0 gates PASS per synthesis report `/Users/kitelev/Developer/Phase-0-prototype-report.md`.

### v3 — 2026-04-20 (post-Phase-0 reconcile + Option C migration)

**Triggered by:** Phase 0 ladder report `/Users/kitelev/Developer/phase0-extract-target-class-ladder-2026-04-20.md` (task `7804d300`) + Phase 1 entry task `1894db7c` (Reconcile RFC §4.0 + Option C migration plan).

**Disposition summary:** 0 blockers · 0 majors · 0 minors · 1 reconcile · 1 migration applied.

| Finding | Severity | Disposition | Section(s) touched |
|---|---|---|---|
| R1 — "51 Commands" repeated 9× across §4.0/§7.1a/§7.4.3/§8/§9/§13; SPARQL-authoritative count is 44 | Reconcile | FIX | §4.0 (rewritten + new §4.0a enumerating 8 property/class stubs) + §7.1a §483 + §7.1a §498 + §7.4.3 §702-704 + §8 Phase 0 §770 + §9 §843 + §13 M6 entry |
| R2 — Phase 0 ladder gate FAIL (S5=40.9%) → user-approved Option C migration | Re-scope | APPLIED | Migration commits in starter-kit branch `phase1/option-c-target-class` (commits `91d9e37` + `94a7dc9`); post-migration ladder S5=22.7% PASS — see `/Users/kitelev/Developer/phase1-post-migration-ladder-2026-04-20.md` |

**No semantic changes** to the test strategy, ladder algorithm, gate threshold, or coverage matrix structure. All edits are count-correctness + Phase 0/1 status annotations.

### v2 — 2026-04-20 (post-review)

**Review reference:** `/Users/kitelev/Developer/review-rfc-ci-tests-2026-04-20.md` (verdict: APPROVE-WITH-CHANGES).
**Disposition summary:** 1/1 blocker FIX · 8/8 majors FIX · 6/6 minors FIX · 0 push-backs · 0 deferrals.

| Finding | Severity | Disposition | Section(s) touched |
|---|---|---|---|
| B1 — Catalog-loader `.includes("exocmd__Command")` fails on UUID-wikilink | Blocker | FIX | §3.3 (rewritten snippet with class-UUID filter + `command-catalog.self-test.ts` guard asserting ≥40 discovered) + class-UUID constant in header |
| M1 — Coverage matrix mixes pre/post UX-RFC state | Major | FIX | §7.4 split into current-state (44) vs target-state (43) + new §7.4a "Transition plan across UX RFC phases" selecting design-parametrized (option b) |
| M2 — Fixture factory / binding metadata hand-waved | Major | FIX | new §7.1a "Fixture factory strategy ladder" — 5-strategy ordered resolution + Phase 0 gate (Strategy 5 fallback ≤30%) |
| M3 — userInput CLI `--input` flag not acknowledged | Major | FIX | §7.1 test template adds `buildUserInputFor(cmd)` + `user-input-factory.ts` contract; §7.4 splits P into P-dispatch / P-mutation |
| M4 — Composite grounding prediction deferred | Major | FIX | §7.1 `predictMutationForGrounding(cmd, input)` contract + Phase 0 prototype gate (≤5 special-case branches); §10 Q5 resolved |
| M5 — Submodule vs worktree workflow friction | Major | FIX | new §3.4 "Developer workflow impact" — quantified cost delta, explicit npm-option re-evaluation criteria, cross-package refactor ordering |
| M6 — Scope filter 41 vs 51 vs 103 files unreconciled | Major | FIX | new §4.0 "Command count reconciliation" — class-UUID-filter yields 51 (now 52 in v3); SPARQL `?cmd exo:Instance_class exocmd:Command` yields 44 (authoritative). v3 §4.0a enumerates 8 stubs. |
| M7 — Coverage-threshold interaction unspecified | Major | FIX | new §9.1 "Coverage threshold neutrality" — helpers self-covered + pilot delta gate |
| M8 — Retroactive audit fixture-version drift | Major | FIX | §4.3 adds per-version contemporaneous submodule-SHA protocol + unmeasurable-denominator disclosure |
| m1 — CI cost "10-15s" not benchmarked | Minor | FIX | §6-A revised "30-120s wall" floor; §9 estimate adjusted to 1-3 min; Phase 0 benchmarks |
| m2 — `maintenance-complex` category unacknowledged | Minor | FIX | §4.0 clarifies `maintenance-complex/` is Grounding + Binding assets, not Commands |
| m3 — Duplicate-detection `(category, label, position)` — no position field | Minor | FIX | §6-F + §7.3 invariant revised to `(category, label)` uniqueness |
| m4 — `result.notice` vs CLI stdout contract | Minor | FIX | §7.1 test template renames `result.notice` → `result.message` (structured Result, not Obsidian Notice) |
| m5 — CT dismissal over-softened | Minor | FIX | §6-C soft-revised — CT recognized as dedicated probe for `ButtonGroupsBuilder` visibility class (audit Finding #1) |
| m6 — Phase 4 branch-protection admin coordination | Minor | FIX | §8 Phase 4 revised to "admin-coordinated, not fixed duration" + handoff checklist |

### v1 — 2026-04-20 (Stage 3 initial draft)

Original submission.

---

## 15. Rejected Minor Findings

**None.** All 6 minors (m1-m6) addressed in v2 per §14 table.

This section is reserved for future deferrals. Format:
> **m<N>:** <reason deferred> — revisit in v<future> when <trigger condition>.

---

---

## 16. Phase 2 Closure Addendum (v5, 2026-04-20)

### 16.1 Change Control Log — CR-2 amendment (verbatim)

> **CR-2 — AC5 recalibration для task 11b23509 (2026-04-20)**
>
> **Context:** Retroactive audit (task `11b23509`) ran 4 plugin tags (v15.105.6/7/8, v15.110.0) против current integration suite at HEAD. Empirical KPI=0% (0 caught / 10 missed / 0 unmeasurable-bug-KPI).
>
> **Root cause:** Option-C migration (starter-kit commit `91d9e37`, 2026-04-20) reshaped all Command fixtures — current suite's 41-command catalog is structurally incompatible with pre-migration fixture state. Retroactive "frankenstein" rewind (plugin-production-only, helpers-at-HEAD) still loads modern fixtures → 0 catches possible.
>
> **Amendment:** AC5 catch-rate gate applies **к post-Option-C regressions only**; pre-Option-C bugs structurally untestable per frankenstein-rewind fixture-shape mismatch (91d9e37 boundary). Empirical KPI=0% documented в audit report as honest finding, not gate failure.
>
> **Closure:** AC5 closed via CR-2 scope amendment + follow-up issue [kitelev/exocortex#2892](https://github.com/kitelev/exocortex/issues/2892) (L1/L2/L3 test-harness improvements, P2 enhancement backlog).
>
> **Impact on RFC §9.1 SC gate:** Catch rate Success Criteria reinterpreted as forward-looking — target applies to future regressions after test-harness improvements (issue #2892) ship. Empirical backward-looking rate documented in audit report.

Source: Project 9b4f1f59 Change Control Log (vault).

### 16.2 Coverage matrix snapshot — Phase 2 exit state (2026-04-20)

**Scope filter:** 44 catalog Commands × 3 `KNOWN_BROKEN_UUIDS` filter = **41 active Commands** (SPARQL-authoritative count + v3 §4.0 reconciliation).

**Strategy distribution per §7.1a ladder** (actual post-migration measurement, PR #2891 audit + PR #2893 suite):

| Strategy | Count / 41 | Share | Notes |
|---|---|---|---|
| S1 — Explicit `exocmd__Command_targetClass` | 8 | 19.5% | Option C migration added explicit targetClass на 8 Commands |
| S2 — Precondition SPARQL inspection | 16 | 39.0% | S2 pre-empts S4 class-flip где precondition binds target class |
| S3 — Grounding `targetProperty` heuristic (RDFS domain) | 7 | 17.1% | Convert commands + property_set |
| S4 — Grounding `targetValue` class-flip | 0 | 0.0% | **S4 pre-empted by S2** — see memory `reference_ladder_s4_preempted_by_s2`; class-flip enumerated by predictor shape, not by strategy==S4 |
| S5 — Fallback `ems__Task` (dispatch-only) | 10 | **24.4%** | ≤30% gate PASS; Phase 1 result 22.7% held at Phase 2 within measurement noise |

**Dispatch predictability:** 31 predictable (S1+S2+S3) + 10 dispatch-only-clean (S5) = 41/41. Strategy-based axis (не mutation-based).

**CI wall-time incremental (Phase 2 total):** +50ms test-unit; 99 suites / 1582 tests → +3 suites / +143 tests relative к pre-Phase-2 baseline (98 suites / 1439 tests).

**Coverage delta (Phase 2 test-only PRs):** 0.00pp on all 4 metrics (statements / branches / functions / lines). Denominators byte-identical per `collectCoverageFrom: src/**/*.ts` — `tests/` helpers excluded from coverage denominator. See memory `reference_rfc_ci_tests_phase1_empirical_validation`.

**Terminology note:** "predictable" here = strategy-based (S1+S2+S3+S4). A separate "mutation-assertable" axis (used в Phase 2 suite-implementation notes task 7225a3cb) measures 15 mutation-assertable + 26 dispatch-only-clean of 41 — different axis, not directly comparable. v5 matrix uses strategy-based axis throughout.

### 16.3 References

**Phase 2 shipped PRs:**

- [#2891](https://github.com/kitelev/exocortex/pull/2891) — `test(cli): parametrize starter-kit command suite to 41 commands (RFC-CI-Tests Phase 2)` (v15.114.5, merged 2026-04-20). 41-suite foundation; 15 predictable + 26 dispatch-only-clean; KNOWN_BROKEN stopgap for 3 broken Commands.
- [#2893](https://github.com/kitelev/exocortex/pull/2893) — `test(cli): precondition-unmet + mutation-coverage + class-flip literal-vs-IRI (Phase 2 f68d0553)` (v15.114.6, merged 2026-04-20). 22 preconditions + mutation-diff matrix + class-flip shape invariants.

**Phase 2 audit (report-only):**

- Task `11b23509-1f62-4893-9a10-7f85ed0c3fd6` — retroactive audit v15.105.6/7/8/v15.110.0 against HEAD integration suite. KPI=0% (frankenstein-rewind fixture-shape mismatch); classified as honest finding via CR-2.
- Report: `/Users/kitelev/Developer/phase2-retroactive-audit-2026-04-20.md`.

**Follow-up issue (forward-looking, P2 enhancement backlog):**

- [#2892](https://github.com/kitelev/exocortex/issues/2892) — L1/L2/L3 test-harness improvements: populate `ServiceRegistry` in integration tests (#2892 L1), tighten dispatch-only assertions (#2892 L2), add CLI subprocess harness (#2892 L3). Projected ~100% catch rate on 41-suite once all three land.

**Option C migration (starter-kit):**

- [exocortex-starter-kit#81](https://github.com/kitelev/exocortex-starter-kit/pull/81) — `exocmd__Command_targetClass` explicit property + migration backfill. Commit `91d9e37` — boundary SHA beyond which pre-migration fixtures are structurally incompatible with current integration suite.

**Phase 2 memory anchors:**

- `project_rfc_ci_tests_phase2_parametrized_done` (task 7225a3cb — 41-suite Review)
- `project_rfc_ci_tests_phase2_f68d0553_done` (task f68d0553 — preconditions+diff Review)
- `project_phase2_retroactive_audit_done` (task 11b23509 — audit + CR-2 closure)
- `reference_frankenstein_retroactive_audit` (frankenstein-rewind methodology)
- `feedback_integration_test_populate_registry` (#2892 L1 motivation)

---

**Author:** Claude (child session `claude-cli-rfc-ci-button-testing-2026-04-20`; v4 update by child session `claude-child-69871588`; v5 update by child session `claude-child-896e7905`)
**Status:** Draft v5 — Phase 2 closure (CR-2 + path-drift + coverage matrix consolidated)
**Date:** 2026-04-20
