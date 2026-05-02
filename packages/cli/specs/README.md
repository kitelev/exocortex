# CLI BDD Suite

Cucumber.js harness for `@kitelev/exocortex-cli`. Foundation only — laid down by T6.1
(RFC `94e520da-c6f7-48af-944c-51298d68da45` § Phase 6).

## Run

```bash
# from monorepo root
npm run bdd:test:cli       # full run
npm run bdd:test:cli:dry   # snippet check only
```

## Layout

- `features/*.feature` — Gherkin scenarios
- `step_definitions/*.steps.ts` — step bindings
- `support/world.ts` — shared `CliBddWorld` state object

## Next: T6.2

Replace the placeholder `echo` helper in `support/world.ts` with a real
`dyncommand exec` runner against fixture vaults, then author 48 starter-kit
grounding scenarios under `features/groundings/`.
