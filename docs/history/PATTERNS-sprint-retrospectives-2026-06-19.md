# Development Patterns — Sprint & Post-Mortem Retrospectives (frozen archive)

> **Frozen archive — as of 2026-06-19.** Dated sprint retrospectives and a post-mortem extracted
> from `PATTERNS.md` (RFC 0001 §4 Phase 3). Each documented _what was done_ in a specific
> past work batch (issue/step/line tables) rather than a reusable coding technique. They are
> preserved verbatim for historical reference and are **not** maintained; for current,
> reusable patterns see [`../../PATTERNS.md`](../../PATTERNS.md).

---

## Documentation Sprint Pattern

**When to use**: Creating documentation for multiple related features in a single development session

### Pattern Description

Documentation sprints leverage the **warm context** effect to rapidly create high-quality documentation for related subsystems. Unlike feature sprints, documentation sprints have lower risk (no code changes) and can be completed faster.

### Real-World Example (December 29, 2025)

7 documentation issues completed in ~5 hours:

| Issue | Feature       | Steps | Lines Added | PR    |
| ----- | ------------- | ----- | ----------- | ----- |
| #1310 | Graph export  | 47    | +1463       | #1321 |
| #1311 | Edge bundling | 48    | +499        | #1322 |
| #1312 | Accessibility | 52    | +355        | #1323 |
| #1313 | Filter/search | 64    | +1134       | #1324 |
| #1314 | Path finding  | 63    | +727        | #1325 |
| #1315 | Inference     | 8     | +526        | #1326 |
| #1316 | Import fix    | 6     | +3          | #1327 |

**Total**: 288 steps, 4707 lines of documentation in ~5 hours

### Workflow

```
1. Research Phase (per feature: 5-10 min)
   ├── Read implementation source code
   ├── Identify public API surface
   └── Find existing examples in tests

2. Writing Phase (per feature: 20-30 min)
   ├── Create guide in docs/guides/
   ├── Add API docs in docs/api/
   └── Update README.md with links

3. Integration Phase (per feature: 5 min)
   ├── Cross-link to related docs
   └── Verify code examples compile

4. PR Phase (per feature: 5 min)
   ├── Commit with "docs:" prefix
   ├── Create PR with summary
   └── Enable auto-merge (low risk)
```

### Key Success Factors

1. **Related features share context**: Edge bundling, path finding, and community detection all operate on graphs - understanding one helps document others

2. **API patterns are consistent**: If `ExportManager` follows a factory pattern, `FilterManager` likely does too

3. **README updates are mandatory**: Documentation without README links is invisible

4. **Low step count for small fixes**: Issue #1316 (6 steps) fixed import patterns - small issues should be batched

### Step Count Analysis

| Step Range | Count | Type                               |
| ---------- | ----- | ---------------------------------- |
| 1-10       | 2     | Quick fixes, small updates         |
| 40-50      | 2     | Standard guide creation            |
| 60-70      | 3     | Comprehensive guides with examples |

**Median**: 52 steps per documentation issue

### Anti-Patterns

- ❌ Writing docs without reading implementation first
- ❌ Creating docs without updating README.md
- ❌ Documenting unstable/WIP features (document after code stabilizes)
- ❌ Copying code examples without testing them

### Benefits vs Feature Sprints

| Metric          | Feature Sprint             | Documentation Sprint                |
| --------------- | -------------------------- | ----------------------------------- |
| Risk            | Medium-High                | Low                                 |
| CI failures     | Common                     | Rare (lint only)                    |
| Rollback needed | Sometimes                  | Never                               |
| User value      | Delayed (requires release) | Immediate (docs published on merge) |
| Step count      | 100-200 average            | 50-70 average                       |

### When to Apply

Use documentation sprints when:

- Multiple related features lack documentation
- Feature development complete but docs missing
- New subsystem shipped (e.g., Graph View)
- API stabilized and unlikely to change

### Reference

- Issues #1310-#1316: Graph View documentation sprint (December 29, 2025)
- 7 issues, 5 hours, 4707 lines of documentation

---

## Feature Removal Sprint Pattern

**When to use**: Removing deprecated settings and their associated logic across architecture layers

### Pattern Description

Removing a setting like "Show projects in daily notes" touches 6+ architecture layers. A systematic approach prevents orphaned code and missed cleanup.

### Removal Checklist by Layer

```
Domain Layer
  □ settings/ExocortexSettings.ts - Remove property from interface + DEFAULT_SETTINGS

Presentation Layer
  □ settings/ExocortexSettingTab.ts - Remove toggle UI
  □ renderers/*Renderer.ts - Remove renderer file entirely
  □ components/*Table.tsx - Remove component file entirely
  □ stores/tableSortStore.ts - Remove sort state
  □ renderers/UniversalLayoutRenderer.ts - Remove import, field, instantiation, guard

Application Layer
  □ services/PropertyDependencyResolver.ts - Remove enum value + all mappings
  □ services/IncrementalUpdateHandler.ts - Remove section handling + CSS selector

Infrastructure Layer
  □ CSS files - Remove section classes (if any)

Tests Layer
  □ Unit tests - Remove or update affected test files
  □ Component tests - Delete component spec files
  □ E2E tests - Remove integration specs
```

### Search Commands Before Removal

```bash
# Find all references to the setting
grep -r "showDailyNoteProjects" packages/obsidian-plugin/src/

# Find all references to the renderer/component
grep -r "DailyProjectsRenderer\|DailyProjectsTable" packages/obsidian-plugin/

# Find enum usage
grep -r "DAILY_PROJECTS\|daily-projects" packages/obsidian-plugin/src/
```

### Real-World Example: Daily Projects Removal (#2144)

**Scope**: 147 steps, 2323 lines deleted

| File                            | Change                                   |
| ------------------------------- | ---------------------------------------- |
| `ExocortexSettings.ts`          | Removed `showDailyNoteProjects: boolean` |
| `ExocortexSettingTab.ts`        | Removed toggle (lines 123-136)           |
| `DailyProjectsRenderer.ts`      | **Deleted entire file**                  |
| `DailyProjectsTable.tsx`        | **Deleted entire file**                  |
| `PropertyDependencyResolver.ts` | Removed 5 enum mappings                  |
| `IncrementalUpdateHandler.ts`   | Removed section case                     |
| `SectionStateManager.ts`        | Removed from known sections              |
| `tableSortStore.ts`             | Removed `dailyProjects` state            |
| `UniversalLayoutRenderer.ts`    | Removed import, field, instantiation     |
| Tests (7 files)                 | Updated or deleted                       |

### February 2026 Sprint: 3 Settings Removed

| Issue | Setting Removed              | Steps | Deletions  |
| ----- | ---------------------------- | ----- | ---------- |
| #2144 | Show projects in daily notes | 147   | 2323 lines |
| #2145 | Default ontology asset       | 70    | 608 lines  |
| #2148 | Show labels in file explorer | 60    | 789 lines  |

**Total**: 277 steps, 3720 lines deleted in one day

### Benefits of Batch Removal

- **Warm context**: Same patterns, same file locations
- **Lower error rate**: Each removal follows identical checklist
- **Clean commits**: Each removal is atomic (one setting per PR)
- **Quick reviews**: Deletions are easy to verify

**Reference**: Issues #2144, #2145, #2148 - Feature Removal Sprint (February 2026)

---

## Settings Cleanup Sprint Pattern

**When to use**: Removing multiple unused/obsolete settings from plugin

### Pattern Description

When removing settings, batch related removals in a single sprint session for maximum efficiency. Each setting removal follows an identical checklist, and warm context from previous removals reduces errors.

### February 2026 Sprint Example: 4 Settings Removed

| Issue | Setting Removed             | Steps | Files Changed |
| ----- | --------------------------- | ----- | ------------- |
| #2162 | Default ontology asset      | 31    | 8             |
| #2163 | Status emoji mapping        | 87    | 12            |
| #2146 | Use dynamic property fields | 117   | 15            |
| #2164 | Webhook integration         | 91    | 10            |

**Total**: 326 steps, 4 settings removed in one day

### Setting Removal Checklist

For EACH setting, follow this exact order:

1. **Domain Layer** (`ExocortexSettings.ts`)
   - [ ] Remove interface field: `settingName: Type;`
   - [ ] Remove from `DEFAULT_SETTINGS`

2. **Homoiconic Settings Registry** (`VaultSettingsRegistry.ts`, since PR #3463)
   - [ ] Remove the setting's `VaultSettingDescriptor` entry from `packages/obsidian-plugin/src/domain/settings/VaultSettingsRegistry.ts` (allowlist binding data.json field ↔ `exo__SettingKey` TBox individual)
   - [ ] Update the corresponding `exo__SettingKey` individual in the `packages/exoas-exo` submodule TBox if it is being retired — otherwise the registry↔graph parity unit test (`VaultSettingsRegistry.test.ts`) fails

3. **Presentation Layer** (`ExocortexSettingTab.ts`)
   - [ ] Remove helper methods (e.g., `getXxxOptions()`)
   - [ ] Remove `new Setting()` block
   - [ ] Remove imports if no longer needed

4. **Application Layer** (Commands, Services)
   - [ ] Remove all call sites reading the setting
   - [ ] Remove related service methods if orphaned
   - [ ] Clean up constructor parameters

5. **Test Files**
   - [ ] Remove describe blocks testing the setting
   - [ ] Remove/update fixture objects containing the field
   - [ ] Update mock indices (Setting blocks shift when one removed)
   - [ ] Remove spy calls for deleted helper methods

6. **Verification**

   ```bash
   # Must return zero matches
   grep -r "settingName" packages/ --include="*.ts" --include="*.tsx"

   npm run check:types  # Must pass
   npm run test:all     # Must pass 100%
   ```

### Why Batching Works

- **Same file patterns**: All removals touch `ExocortexSettings.ts`, `ExocortexSettingTab.ts`
- **Warm context**: After first removal, file structure is fresh in memory
- **Lower error rate**: Checklist becomes automatic after first execution
- **Quick reviews**: Each PR is small, focused deletion

### Mock Index Shifting Gotcha

**CRITICAL**: When removing a Setting block, all subsequent indices shift:

```typescript
// BEFORE removal - ontology dropdown is index 0
(MockSetting as jest.Mock).mock.results[0](
  // Ontology dropdown
  MockSetting as jest.Mock,
)
  .mock.results[1](
    // Show layout
    MockSetting as jest.Mock,
  )
  .mock.results[2](
    // Use labels

    // AFTER removal - indices shift down
    MockSetting as jest.Mock,
  )
  .mock.results[0](
    // Show layout (was 1)
    MockSetting as jest.Mock,
  ).mock.results[1]; // Use labels (was 2)
```

**Always audit ALL `mock.results[N]` indices** when removing a Setting.

### Anti-Patterns

- ❌ Removing setting from interface but leaving call sites
- ❌ Deleting tests without running test suite
- ❌ Forgetting to update fixture objects in E2E tests
- ❌ Not verifying with grep after removal

**Reference**: Issues #2162, #2163, #2146, #2164 - Settings Cleanup Sprint (February 2026)

---

## SPARQL Feature Sprint Pattern

**When to use**: Implementing multiple related SPARQL features in sequence

### Pattern Description

Complete related SPARQL features in a single sprint, building each feature on the foundation of the previous. This pattern was proven during the February 2026 SPARQL Enhancement Sprint.

### Sprint Structure (February 20-22, 2026)

| Day       | Issues       | Features                                                               | Steps      |
| --------- | ------------ | ---------------------------------------------------------------------- | ---------- |
| **Day 1** | #2204        | SPARQL 1.1 full support (GROUP BY, HAVING, subqueries, property paths) | 110        |
| **Day 2** | #2207, #2208 | REGEX Cyrillic support, OPTIONAL LEFT JOIN semantics                   | 85+76      |
| **Day 2** | #2217-2221   | Timeout protection, dry-run, templates, caching, error messages        | 62-78 each |

**Total**: 8 SPARQL issues, ~600 steps, 2 days

### Implementation Order (Critical Path)

```
1. Core SPARQL Feature (GROUP BY, HAVING, etc.)
   ↓
2. Query Semantics Fixes (OPTIONAL, REGEX)
   ↓
3. DX Improvements (--explain, --dry-run)
   ↓
4. Performance (caching, timeout protection)
   ↓
5. UX Polish (error messages with suggestions, templates)
```

### Key Success Factors

1. **Foundation first**: Issue #2204 (SPARQL 1.1 full support) established patterns for all subsequent features
2. **Semantic fixes early**: #2207 (Cyrillic REGEX) and #2208 (OPTIONAL LEFT JOIN) fixed core query semantics before adding features
3. **DX before UX**: Debugging tools (--explain, --dry-run) before user-facing polish
4. **Warm context**: Each feature built on understanding from previous (average 73 steps vs 110 for first)

### Anti-Patterns Avoided

- ❌ Adding UX features before core semantics work
- ❌ Implementing caching before understanding query patterns
- ❌ Adding timeout protection without --explain to debug timeouts
- ❌ Spacing SPARQL features weeks apart (context loss)

### Real-World Code Pattern: --explain Flag

```typescript
// CLI dry-run mode implementation
if (options.explain) {
  const plan = queryEngine.explain(query);
  console.log("Query Plan:");
  console.log(JSON.stringify(plan, null, 2));
  console.log("\nEstimated cost:", plan.estimatedCost);
  console.log("Indexes used:", plan.indexesUsed.join(", "));
  return; // Don't execute
}
```

### Real-World Code Pattern: Enhanced Error Messages

```typescript
// Error suggestion mapping
const errorSuggestions: Map<RegExp, string> = new Map([
  [/Unknown prefix: (\w+)/, "Did you forget to declare PREFIX $1: <...>?"],
  [
    /Property .* not found/,
    "Check property name spelling. Available: exo:, ems:, ims:",
  ],
  [
    /Syntax error at line (\d+)/,
    "Check for missing brackets, dots, or semicolons",
  ],
]);

function enhanceError(error: Error): string {
  for (const [pattern, suggestion] of errorSuggestions) {
    const match = error.message.match(pattern);
    if (match) {
      return `${error.message}\n\n💡 Suggestion: ${suggestion.replace("$1", match[1] || "")}`;
    }
  }
  return error.message;
}
```

### Benefits

- **Compound learning**: Each SPARQL feature shares query engine internals
- **Consistent API**: All features follow same CLI flag patterns
- **Reduced debugging**: Semantic fixes (#2207, #2208) prevent cascading issues
- **User-centric order**: Users get debugging tools before they need to debug performance

**Reference**: Issues #2204, #2207, #2208, #2217-2221 - SPARQL Enhancement Sprint (February 2026)

---

## CLI UX Enhancement Sprint Pattern

**When to use**: Adding multiple CLI flags, output formats, and developer experience features

### Pattern Description

Batch related CLI enhancements together, implementing in order: flags → formats → debugging → caching → error handling.

### Sprint Structure (February 2026)

| Issue | Feature                                    | Steps | Dependencies                |
| ----- | ------------------------------------------ | ----- | --------------------------- |
| #2206 | --timeout, --format flags, classes command | 56-84 | None                        |
| #2213 | --explain, --dry-run debugging             | 77    | #2206 (flag infrastructure) |
| #2217 | Timeout protection                         | 76    | #2206 (--timeout flag)      |
| #2218 | Dry-run mode                               | 62    | #2213 (--explain)           |
| #2219 | Query templates library                    | 78    | None                        |
| #2220 | Result caching with TTL                    | 69    | None                        |
| #2221 | Enhanced error messages                    | 71    | None                        |

### Implementation Order

```
1. Flag Infrastructure (--timeout, --format)
   ↓
2. Debugging Tools (--explain, --dry-run)
   ↓
3. Protection Features (timeout, validation)
   ↓
4. Performance Features (caching)
   ↓
5. UX Polish (error messages, templates)
```

### Key Code Pattern: Output Format Handling

```typescript
// CLI output format pattern (Issue #2206)
type OutputFormat = "table" | "json" | "csv" | "ntriples";

function formatOutput(results: QueryResult[], format: OutputFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(results, null, 2);
    case "csv":
      return convertToCSV(results);
    case "ntriples":
      return convertToNTriples(results);
    case "table":
    default:
      return formatAsTable(results);
  }
}
```

### Key Code Pattern: Timeout Protection

```typescript
// Timeout wrapper pattern (Issue #2217)
async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `${operationName} timed out after ${timeoutMs}ms.\n` +
            `💡 Try: --explain to analyze query complexity`,
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]);
}
```

### Benefits

- **Incremental complexity**: Simple flags first, complex features later
- **Debug-first**: Users can understand issues before they're blocked
- **Consistent patterns**: All features share flag parsing, output formatting
- **Composable**: --explain + --timeout + --format all work together

**Reference**: Issues #2206, #2213, #2217-2221 - CLI Enhancement Sprint (February 2026)

---

## Test Coverage Sprint Pattern

**When to use**: Systematically increasing test coverage for critical paths

### Pattern Description

Achieve significant coverage increases by targeting critical user paths first, then expanding to edge cases.

### Sprint Structure (February 2026)

| Issue | Goal                                     | Steps | Result                      |
| ----- | ---------------------------------------- | ----- | --------------------------- |
| #2185 | Increase coverage 38% → 60%              | 83    | Achieved                    |
| #2187 | Add integration tests for critical paths | 134   | 12+ integration tests added |

### Implementation Order

```
1. Identify coverage gaps (lcov report)
   ↓
2. Prioritize by user impact (critical paths first)
   ↓
3. Add unit tests for uncovered branches
   ↓
4. Add integration tests for user journeys
   ↓
5. Verify coverage targets met
```

### Critical Path Identification

```bash
# Generate coverage report (script lives in the exocortex workspace, not repo root)
npm run test:coverage -w @kitelev/exocortex-core

# Find least-covered critical files
cat coverage/lcov-report/index.html | grep -A2 "src/domain" | sort

# Prioritize by import count (more imports = more critical)
grep -r "from.*domain" src/ | cut -d: -f2 | sort | uniq -c | sort -rn
```

### Key Pattern: Integration Test Structure

```typescript
// Integration test for critical user path (Issue #2187)
describe("Task Creation Flow (Critical Path)", () => {
  let vault: MockVault;
  let service: TaskCreationService;

  beforeEach(() => {
    vault = createMockVault();
    service = container.resolve(TaskCreationService);
  });

  it("should create task with all required properties", async () => {
    const result = await service.createTask({
      title: "Test Task",
      parent: "[[project-uuid]]",
    });

    expect(result.path).toMatch(/\.md$/);

    const content = await vault.read(result);
    expect(content).toContain("ems__Effort_status:");
    expect(content).toContain("exo__Instance_class:");
  });

  it("should inherit area from parent project", async () => {
    // Test area inheritance critical path
  });

  it("should set timestamps correctly", async () => {
    // Test timestamp handling critical path
  });
});
```

### Coverage Target Guidelines

| Coverage Level | Risk    | Recommendation              |
| -------------- | ------- | --------------------------- |
| < 40%          | High    | Priority improvement needed |
| 40-60%         | Medium  | Focus on critical paths     |
| 60-80%         | Low     | Maintain, add edge cases    |
| > 80%          | Minimal | Maintenance mode            |

**Reference**: Issues #2185, #2187 - Test Coverage Sprint (February 2026)

---

## Security Fix Sprint Pattern

**When to use**: Addressing code scanning security alerts systematically

### Pattern Description

Process P0 (security) alerts with highest priority, implementing consistent fix patterns.

### February 2026 Example: String Escaping (Issue #2226)

**Alert**: Incomplete string escaping or encoding
**Severity**: P0 (Security-critical)
**Steps**: 66

### Fix Pattern: Split-Join for Safe Replacement

```typescript
// ❌ VULNERABLE: replace() interprets $ sequences
const result = template.replace("{{value}}", userInput);

// ✅ SECURE: split/join doesn't interpret special characters
const result = template.split("{{value}}").join(userInput);
```

### Verification Checklist

1. ✅ All instances of vulnerable pattern identified
2. ✅ Each instance converted to safe pattern
3. ✅ Unit tests added for edge cases (input with $, &, `)
4. ✅ Code scanning re-run to verify alert cleared
5. ✅ PR labeled with P0 tag

### Common Security Patterns

| Alert Type                 | Fix Pattern                                     |
| -------------------------- | ----------------------------------------------- |
| Incomplete string escaping | split/join instead of replace                   |
| Insecure randomness        | crypto.randomUUID() or crypto.getRandomValues() |
| Weak crypto                | Use AES-GCM, avoid MD5/SHA1 for security        |
| Prototype pollution        | Object.create(null) for dictionaries            |

**Reference**: Issue #2226 - P0 String Escaping Fix (February 2026)

---

## RFC-013 Post-Mortem Patterns (April 2026)

### Pre-Implementation Audit Pattern

Before implementing any RFC Issue, run a 15-minute codebase audit:

1. Search for the feature name in existing code:

   ```bash
   grep -r "PropertyPath\|propertyPath" packages/core/src/
   grep -r "Subquery\|subquery\|SubSelect" packages/core/src/
   ```

2. Check existing test coverage:

   ```bash
   grep -r "property.path\|transitive" packages/core/tests/
   ```

3. If feature exists: redirect Issue to test coverage + docs instead of reimplementation.

**Real example**: RFC-013 saved ~60% of planned work by discovering property paths and subqueries were already implemented in RFC-011/012.

**Reference**: RFC-013 Post-Mortem (April 2026)

### ESM `__dirname` Replacement

In ESM packages (`"type": "module"`), `__dirname` is not available. Use:

```typescript
import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
```

This applies to: `packages/cli` and any ESM test files.

**Reference**: RFC-013 Post-Mortem — PR #2614 CI failure fix

### Depth Annotation in Recursive Materializers

When extending `PrototypeChainMaterializer` or similar BFS materializers:

- **Always distinguish own vs inherited predicates** at each traversal level
- Use `protoInheritedPredicates` filter to skip materialized triples from deeper ancestors
- Only predicates defined directly on the current prototype get the current BFS depth

**Symptom of bug**: Depth values in `exo:inferred` triples are wrong for inherited predicates.
**Root cause**: BFS traversal annotates all triples at current level, including inherited ones.
**Fix**: Filter `protoInheritedPredicates` before annotation.

**Reference**: RFC-013 Post-Mortem — PR #2607 depth annotation bug

---

### SPARQL Property Discovery Pattern (Two-Source)

**When to use**: Querying the ontology for all declared properties (e.g., schema validation)

**Problem**: Not all `exo__Instance_class` wikilinks produce `rdf:type` triples.
`[[UUID|exo__ObjectProperty]]` (UUID wikilink format) is stored as a **literal string**, not resolved to an IRI. Only `[[exo__DeprecatedProperty]]` (without UUID) creates a proper `rdf:type` triple.

**Solution**: Use UNION to query both sources:

```sparql
SELECT ?s WHERE {
  { ?s a ?type . FILTER(CONTAINS(STR(?type), "Property")) }
  UNION
  { ?s exo:Instance_class ?class . FILTER(CONTAINS(STR(?class), "Property")) }
}
```

Then extract property names from:

1. **Subject URI filename**: `obsidian://vault/.../ems__Effort_status.md` → `ems__Effort_status`
2. **IRI label values**: `exo:Asset_label` when value is a full ontology URI

**Impact**: Single-source query finds ~25 properties. Two-source finds ~170.

**Reference**: Issue #2713 Post-Mortem — PR #2716

---
