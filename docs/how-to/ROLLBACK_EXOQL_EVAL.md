# Rollback — exoql:eval flag flip (RFC c78cc5c8 Phase 1a, PR3)

## What this rollback covers

PR3 (T4–T6) flipped the `exoql:eval` feature flag from `false` → `true`,
introduced `IQueryBodyResolver` + `ObsidianQueryBodyResolver`, and
migrated one production precondition (`a75beba2-549e-425d-b8b0-84afb386b28a`)
from inline `exocmd__Precondition_sparqlAsk` to a UID reference via
`exocmd__Precondition_query`.

## Symptoms that should trigger rollback

- Layout rendering crashes whenever a query-referenced precondition is
  encountered (missing resolver, unhandled exception in
  `evaluateWithExoEval`).
- Buttons that were previously visible disappear permanently because
  `evaluateQueryRef` returns `false` (resolver returns `null` — asset
  missing or an ontology asset not synced into the user's vault).
- E2E suite reports systematic 4xx/5xx-equivalent failures on the
  Always-true precondition path.

## Procedure

### Step 1 — Disable the feature flag (sub-minute revert)

`evaluateWithExoEval` honors `DEFAULT_EVAL_CONFIG.enabled`. Flipping the
default back to `false` causes `evaluateQueryRef` to return `false` for
every query-referenced precondition (fail-closed) — the SPARQL_ASK and
host-function paths are unaffected.

Edit `packages/core/src/exoql/eval-config.ts`:

```ts
export const DEFAULT_EVAL_CONFIG: ExoQLEvalConfig = {
  enabled: false, // ← flip back from true
  // ... rest unchanged
};
```

Cut a patch release. No data migration is required because the feature
flag is consulted on every invocation.

### Step 2 — Revert the vault migration (optional)

Only required if step 1 leaves the operator without a working precondition
on the affected binding. Restore the inline body in
`a75beba2-549e-425d-b8b0-84afb386b28a.md`:

```yaml
exocmd__Precondition_sparqlAsk: "ASK { }"
# Remove this line:
# exocmd__Precondition_query: "[[<Always-true-precondition-UID>]]"
```

Bump `exo__Asset_updatedAt` in the same edit (validate-updatedAt hook).

### Step 3 — Optional: drop the resolver wiring

If the IQueryBodyResolver path itself is implicated (rare — the
sub-second cache and the empty-store fail-closed semantics make this
unlikely), revert the constructor change in `ExocortexPlugin.ts`:

```ts
this.preconditionEvaluator = new PreconditionEvaluator(tripleStore);
```

…and delete the three vault-event listeners that invalidate the cache.
The legacy `sparqlAsk` and `hostFunction` paths remain functional
without the resolver.

## Verification after rollback

1. `npm run check:types` clean.
2. `npm run test:unit -- PreconditionEvaluator` — 50/50 pass (baseline
   pre-PR3 set; the 7 query-path tests will fail until step 3 also
   reverts the test additions, which is expected).
3. Manual: open a vault with the migrated asset, confirm the previously
   inline-bound precondition still gates the button correctly.

## Forward-only notes

T7 (CI drift-guard wiring + scoped E2E) is deferred per M1 and is
tracked in a follow-up issue. The rollback steps above are independent
of T7 and do not need updating when T7 lands.
