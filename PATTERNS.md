# Development Patterns

Common coding patterns and best practices discovered during Exocortex development.

---

## Timestamp-Based Sorting Pattern

**When to use**: Sorting any time-based data chronologically

**Problem**: String-based time sort fails:
```typescript
// ❌ WRONG: String sort breaks chronological order
tasks.sort((a, b) => a.startTime.localeCompare(b.startTime));
// "23:45" > "00:15" → wrong order across midnight
```

**Solution**: Use timestamps for sorting:
```typescript
// ✅ CORRECT: Timestamp-based sort
interface Task {
  startTime: string;           // Display: "09:00"
  startTimestamp: number;       // Sort: 1736928000000
}

tasks.sort((a, b) => {
  const aTime = a.startTimestamp ? new Date(a.startTimestamp).getTime() : 0;
  const bTime = b.startTimestamp ? new Date(b.startTimestamp).getTime() : 0;
  return aTime - bTime;  // Numeric comparison
});
```

**Benefits**:
- Accurate chronological ordering
- Handles midnight boundary correctly
- Handles dates across multiple days
- Flexible display formatting (toggle between formats)

**Pattern**: Keep parallel fields (formatted string + raw timestamp)

**Reference**: PR #339 - Added `startTimestamp`/`endTimestamp` alongside `startTime`/`endTime`

---

## Documentation Task Pattern

**When creating comprehensive documentation:**

### 1. Research Phase (10-15 minutes)
- Read source code for feature (main files + tests)
- Identify key components and APIs
- Note existing patterns and conventions
- Check for existing partial docs to integrate

### 2. Structure Phase (5 minutes)
- Create docs/ subdirectory if needed
- Plan file structure by audience (user/developer/performance)
- Define scope of each file
- Identify cross-linking opportunities

### 3. Writing Phase (60-90 minutes)
- Start with examples (Query-Examples.md pattern)
- Write user guide with progressive complexity
- Document developer API with TypeScript examples
- Add performance/troubleshooting guide if applicable

### 4. Integration Phase (10 minutes)
- Update README.md with new section
- Add cross-links between docs
- Verify all code examples are syntactically correct
- Test that links resolve

### 5. Validation Phase
- Commit with "docs:" prefix
- Verify CI passes (no lint errors)
- Create PR with clear summary
- Enable auto-merge

### Documentation Checklist
- [ ] Examples are copy-paste ready
- [ ] README.md updated with links
- [ ] Performance guidance includes numbers
- [ ] Cross-links between docs work
- [ ] All TypeScript examples type-check

### Expected Timeline
- Total: 85-90 minutes (research → release)
- Zero errors expected (documentation-only)
- First-time CI pass (no code changes)
- Immediate merge (low risk, high value)

### Key Insights
- Examples > explanations (users want copy-paste patterns)
- Separate files by audience (user/developer/performance) improves findability
- Performance docs need numbers ("100x faster" vs "significantly faster")
- README links are mandatory (users won't find docs/ otherwise)
- Documentation PRs are safe and fast (no debugging, quick release)

**Reference**: Issue #250, PR #354 - SPARQL Documentation (complete suite in 85 minutes)

---

## Shared Utility Pattern for Cross-Table Features

**When implementing a feature that affects multiple tables:**

### Pattern

```typescript
// 1. Create shared utility in presentation/utils/
export class FeatureHelpers {
  static checkCondition(app: ObsidianApp, metadata: Record<string, unknown>): boolean {
    // Shared logic here
  }
}

// 2. Use in each renderer
import { FeatureHelpers } from "../utils/FeatureHelpers";

const hasFeature = FeatureHelpers.checkCondition(this.app, metadata);

// 3. Pass to table component
tasks.push({ ...data, hasFeature });

// 4. Display in table component
const icon = task.hasFeature ? "🎯 " : "";
```

### Real-World Example: Blocker Indicator (🚩)

**Utility:** `BlockerHelpers.isEffortBlocked()` (BlockerHelpers.ts)
**Used by:** DailyTasksRenderer, DailyProjectsRenderer, RelationsRenderer
**Displayed in:** DailyTasksTable, DailyProjectsTable, AssetRelationsTable
**Benefit:** Single source of truth, consistent behavior, easy to test

### Files to Create

- `packages/obsidian-plugin/src/presentation/utils/FeatureHelpers.ts` (utility)
- Update renderers to call utility
- Update table interfaces to include feature flag
- Update table display logic to show indicator
- Add tests for utility + table display

### Test Pattern

```typescript
// Test utility once
describe("FeatureHelpers", () => {
  it("should detect feature correctly", () => {
    expect(FeatureHelpers.checkCondition(app, metadata)).toBe(true);
  });
});

// Test display in each table
describe("TableComponent", () => {
  it("should display icon when feature is true", async ({ mount }) => {
    const item = { hasFeature: true, title: "Test" };
    const component = await mount(<Table items={[item]} />);
    await expect(component.locator("a")).toContainText("🎯");
  });
});
```

### When NOT to Use Shared Utility

- Feature is specific to one table only
- Logic is trivial (1-2 lines)
- Different behavior needed per table

**Reference**: Issue #385 - Blocker Indicator already implemented using this pattern across 3 tables

---

## Status Priority Sorting Pattern

**When to use**: Prioritizing items by status/state in sortable tables

**Problem**: Users need critical items (e.g., "Doing" tasks) at top regardless of column sort.

**Solution**: Two-tier sorting with status partitioning

```typescript
// Step 1: Partition by priority status
const priorityItems = filtered.filter(item => item.isPriority);
const normalItems = filtered.filter(item => !item.isPriority);

// Step 2: Extract sorting logic into reusable function
const applySorting = (itemList: Item[]): Item[] => {
  if (!sortState.column) return itemList;

  const sorted = [...itemList];
  sorted.sort((a, b) => {
    // ... column-based sorting logic ...
  });
  return sorted;
};

// Step 3: Sort each partition independently
const sortedPriority = applySorting(priorityItems);
const sortedNormal = applySorting(normalItems);

// Step 4: Concatenate (priority first)
return [...sortedPriority, ...sortedNormal];
```

**Benefits**:
- Priority items always visible at top
- Column sorting still works within each partition
- O(n log n) complexity - no performance impact
- Easy to extend (add more priority tiers)

**Pattern**: Partition → Sort each → Concatenate

**Real-World Example**: `DailyTasksTable.tsx:167-243`
- Tasks with `isDoing: true` always appear first
- Column sorting (Name, Start, End, Status, Area, Votes) works within each partition
- Empty priority partition handled gracefully

**Reference**: Issue #404, PR #408 - Prioritize Doing status tasks in DailyNote

---

## Obsidian File Lookup Pattern

**When looking up files via `metadataCache.getFirstLinkpathDest()`, always implement `.md` extension fallback to handle wiki-links that don't include the extension.**

### Standard Pattern
```typescript
let file = this.app.metadataCache.getFirstLinkpathDest(path, "");

if (!file && !path.endsWith(".md")) {
  file = this.app.metadataCache.getFirstLinkpathDest(path + ".md", "");
}

if (file instanceof TFile) {
  // Process file
}
```

### Why This Matters
- Wiki-links like `[[Page Name]]` extract to `"Page Name"` (no `.md`)
- Obsidian's `getFirstLinkpathDest` may require full filename `"Page Name.md"`
- Without fallback, valid references fail to resolve
- This pattern prevents bugs in area inheritance, relation lookups, and any file resolution

### When to Use
- Looking up parent/child relationships (e.g., `ems__Effort_parent`)
- Resolving prototype references (e.g., `ems__Effort_prototype`)
- Following any property that contains wiki-links to other notes
- Any file lookup based on frontmatter property values

### Test Pattern
```typescript
it("should resolve file with .md extension fallback", () => {
  mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
    (linkpath: string) => {
      if (linkpath === "file-name") return null;
      if (linkpath === "file-name.md") return mockFile;
      return null;
    },
  );

  const result = service.methodThatLookupsFile("[[file-name]]");

  expect(result).toBeDefined();
});

it("should not duplicate .md extension if already present", () => {
  mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
    (linkpath: string) => {
      if (linkpath === "file-name.md") return mockFile;
      return null;
    },
  );

  const result = service.methodThatLookupsFile("[[file-name.md]]");

  expect(result).toBeDefined();
  expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(1);
});
```

### Reference Implementations
- `AssetMetadataService.getAssetLabel()` (lines 10-14)
- `AssetMetadataService.getEffortArea()` (lines 103-108 for parent, 131-136 for prototype)

**Reference**: Issue #355, PR #356 - Fixed area inheritance by adding `.md` fallback

---

## Wikilink Properties Normalization Pattern

**When to use**: Creating or processing frontmatter properties that reference other notes via wikilinks

**Problem**: Properties containing wikilinks can arrive in different formats:
- `[[Link]]` (without quotes)
- `"[[Link]]"` (with quotes - correct format)
- May be undefined or null

**Impact**: Inconsistent formatting breaks Obsidian's wikilink detection and property display.

**Solution**: Normalize all wikilink property values before setting them in frontmatter.

```typescript
private ensureQuotedWikilink(
  value: string | undefined,
  defaultValue: string,
): string {
  if (!value) {
    return defaultValue;
  }

  // Check if value is already properly quoted: "[[...]]"
  if (value.match(/^"?\[\[.+\]\]"?$/)) {
    // If it has quotes, return as is
    if (value.startsWith('"') && value.endsWith('"')) {
      return value;
    }
    // If it's a wikilink without quotes, add them
    return `"${value}"`;
  }

  // If value doesn't look like a wikilink, return default
  return defaultValue;
}
```

**Usage in frontmatter generation:**
```typescript
private generateFrontmatter(
  parentMetadata: Record<string, any>,
): Record<string, any> {
  const frontmatter: Record<string, any> = {};
  
  // ❌ WRONG - May be unquoted
  frontmatter["exo__Asset_isDefinedBy"] = 
    parentMetadata.exo__Asset_isDefinedBy || '"[[Ontology/EXO]]"';
  
  // ✅ CORRECT - Always properly quoted
  frontmatter["exo__Asset_isDefinedBy"] = this.ensureQuotedWikilink(
    parentMetadata.exo__Asset_isDefinedBy,
    '"[[Ontology/EXO]]"',
  );
  
  frontmatter["exo__Class_superClass"] = `"[[${parentClassName}]]"`;
  frontmatter["exo__Instance_class"] = [`"[[exo__Class]]"`];
  
  return frontmatter;
}
```

**Properties that need this pattern:**
- `exo__Asset_isDefinedBy` - ontology reference
- `exo__Class_superClass` - parent class
- `ems__Effort_parent` - parent effort
- `ims__Concept_broader` - broader concept
- Any property that links to another note

**Test pattern:**
```typescript
it("should add quotes to unquoted wikilink", async () => {
  const parentMetadata = {
    exo__Asset_isDefinedBy: "[[Custom/Ontology]]",  // Without quotes!
  };

  const result = await service.createAsset(parentMetadata);
  const content = await vault.read(result);

  // Should add quotes around the wikilink
  expect(content).toContain('exo__Asset_isDefinedBy: "[[Custom/Ontology]]"');
  // Should NOT have unquoted wikilink
  expect(content).not.toContain('exo__Asset_isDefinedBy: [[Custom/Ontology]]');
});

it("should preserve already quoted wikilinks", async () => {
  const parentMetadata = {
    exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"',  // Already quoted
  };

  const result = await service.createAsset(parentMetadata);
  const content = await vault.read(result);

  // Should keep quotes
  expect(content).toContain('exo__Asset_isDefinedBy: "[[Custom/Ontology]]"');
  // Should not double-quote
  expect(content).not.toContain('""[[Custom/Ontology]]""');
});
```

**Benefits:**
- Consistent wikilink formatting across all created assets
- Obsidian properly detects and highlights links
- Parent metadata can be in any format - always normalized
- Easy to extend for new wikilink properties

**Where to apply:**
- All service classes that create frontmatter (TaskCreationService, ProjectCreationService, ClassCreationService, ConceptCreationService)
- Any code that modifies wikilink properties
- Import/migration scripts

**Reference**: Issue #407 - `exo__Asset_isDefinedBy` not quoted in ClassCreationService

---

## Sequential Related Tasks Pattern

**When to use**: Implementing multiple related features in same subsystem

**Pattern**: Complete features sequentially while context is warm, rather than spacing them weeks apart.

### Productivity Gains

| Phase | Time | Speed Multiplier | Notes |
|-------|------|------------------|-------|
| **Cold start** (first feature) | 100% | 1.0x | Baseline |
| **Warm context** (second feature) | 60-70% | 1.5-2.0x | Architecture familiar |
| **Hot context** (third+ feature) | 50-60% | 2.0-2.5x | Patterns internalized |

### Real-World Example (CLI Development)

```
PR #432 (CLI Core Infrastructure):     180 minutes (cold start)
PR #433 (CLI Maintenance Commands):    120 minutes (warm context, 1.5x faster)
PR #434 (CLI Status Commands):         150 minutes* (hot context, includes 5 min git recovery)
                                        * Actual implementation: 145 min (2.3x faster than cold)
```

### Why It Works

1. **Architecture familiarity**: Already understand `CommandExecutor` structure
2. **Pattern reuse**: Test mocking, error handling, code style internalized
3. **Context loaded**: No need to re-research `FrontmatterService`, `PathResolver`, etc.
4. **Reduced trial-and-error**: Fewer "try this approach, it fails, try another" cycles
5. **Zero-error sessions**: Warm context eliminates common mistakes

### Application Guidelines

- **Batch 2-4 related features** (diminishing returns after 4)
- **Maintain focus on single subsystem** (e.g., all CLI commands together)
- **Don't force unrelated features together** just to batch
- **Take breaks between batches** to maintain code quality
- **Document patterns discovered** in first feature for later reuse

### Anti-Pattern: Spacing Related Features Weeks Apart

**Problems:**
- Each feature becomes "cold start" again
- Relearning architecture every time
- Higher error rate from forgotten patterns
- Lower productivity overall
- Duplicate research time

**Example of inefficiency:**
```
Week 1: PR #432 (CLI Core) - 180 min (learn CommandExecutor, adapters, tests)
Week 5: PR #433 (Commands)  - 180 min (relearn everything, context lost)
Week 9: PR #434 (Commands)  - 180 min (relearn again)
Total: 540 minutes

vs Sequential approach:
Day 1: PR #432 - 180 min
Day 2: PR #433 - 120 min (warm context)
Day 3: PR #434 - 145 min (hot context)
Total: 445 minutes (95 minutes saved, 21% faster)
```

### Success Metrics (PR #434)

**Achieved:**
- ✅ Zero errors after git recovery (implementation was flawless)
- ✅ All tests passed first time (no debugging cycles)
- ✅ CI green on first attempt (no fixup commits)
- ✅ Auto-merge activated (no manual intervention needed)
- ✅ 2.3x productivity gain (warm context from PR #432/#433)

**Key factors:**
- Recent related work (< 48 hours since PR #433 merge)
- Clear requirements (Issue #422 with specific commands)
- Shared utilities (`DateFormatter`, `FrontmatterService`)
- Test patterns established (mock setup, assertions)
- Continuation session (full context from previous work still loaded)

### Recommendation

**When planning work**, group related features into sequential sprints rather than interleaving with unrelated work. The productivity gains compound with each related feature completed.

**Before starting new feature**, ask:
- "Is this related to recent work?"
- "Can I leverage warm context from previous PR?"
- "Are there 2-3 more related features I could batch?"

If yes to any → prioritize sequential implementation for maximum efficiency.

**Reference**: PR #434 - Documented 2.3x productivity gain from Sequential Related Tasks Pattern

---

## SPARQL Test Coverage Pattern

**When to use**: Adding edge case tests to SPARQL v2 infrastructure components

### Key Architecture Knowledge

**PropertyPathExecutor** (`packages/core/src/infrastructure/sparql/executors/`):
- Handles SPARQL property path operators: `+` (OneOrMore), `*` (ZeroOrMore), `?` (ZeroOrOne), `^` (Inverse), `/` (Sequence), `|` (Alternative)
- **MAX_DEPTH = 100**: Prevents infinite loops in recursive paths
- Edge cases to test: empty graphs, failing paths, depth limits

**QueryPlanCache** (`packages/core/src/infrastructure/sparql/cache/`):
- LRU eviction with configurable size
- **Whitespace normalization**: Cache keys are trimmed and whitespace-collapsed
- Edge cases to test: cache size of 1, whitespace-only queries, LRU order after updates

**FilterExecutor** (`packages/core/src/infrastructure/sparql/executors/`):
- Handles EXISTS/NOT EXISTS via `ExistsEvaluator` callback pattern
- Delegates EXISTS subquery evaluation to callback, doesn't execute directly

**AlgebraTranslator** (`packages/core/src/infrastructure/sparql/algebra/`):
- Handles BIND expressions and Subqueries
- No separate executor needed - translated during algebra generation

### Test Pattern for Edge Cases

```typescript
describe("Edge Cases", () => {
  it("should handle empty input gracefully", async () => {
    // Test with empty data
    const results = await executor.execute(emptyInput);
    expect(results.length).toBe(0);
  });

  it("should respect implementation limits", async () => {
    // Test boundary conditions (e.g., MAX_DEPTH)
    const results = await executor.execute(inputAtLimit);
    expect(results.length).toBeLessThanOrEqual(LIMIT);
  });

  it("should maintain state after failures", async () => {
    // Execute failing operation, then verify normal operation works
    await expect(executor.execute(badInput)).rejects.toThrow();
    const results = await executor.execute(goodInput);
    expect(results).toBeDefined();
  });
});
```

### File Locations for SPARQL Tests

```
packages/core/tests/unit/infrastructure/sparql/
├── executors/
│   ├── BGPExecutor.test.ts           # Basic Graph Pattern
│   ├── FilterExecutor.test.ts        # FILTER, EXISTS/NOT EXISTS
│   └── PropertyPathExecutor.test.ts  # +, *, ?, ^, /, |
├── cache/
│   └── QueryPlanCache.test.ts        # LRU cache
├── algebra/
│   └── AlgebraTranslator.test.ts     # BIND, Subqueries
└── AlgebraOptimizer.test.ts          # Filter Pushdown, Join Reordering
```

### Pre-Implementation Checklist

```bash
# 1. Find implementation constants
grep -r "MAX_DEPTH\|LIMIT\|SIZE" packages/core/src/infrastructure/sparql/

# 2. Check existing edge case coverage
grep -r "Edge Case\|should handle\|should respect" packages/core/tests/unit/infrastructure/sparql/

# 3. Identify untested scenarios
npm run test:coverage -- --collectCoverageFrom="packages/core/src/infrastructure/sparql/**"
```

### Reference

- **PR #511**: Added 14 edge case tests (7 PropertyPathExecutor + 7 QueryPlanCache)
- **PR #510**: Updated SPARQL v2 documentation with feature coverage

---

## TypeScript Tooling Limitations

- `ts-jest` in this repo cannot transpile class-level `async *` generator methods
- **Solution**: Return an `AsyncIterableIterator` from a helper/closure instead of adding `async *` on a class

---

## TSyringe DI with esbuild Build

**When to use**: Setting up TSyringe dependency injection in an esbuild-bundled project

**Problem**: esbuild doesn't emit TypeScript decorator metadata by default, causing TSyringe DI resolution to fail at runtime.

**Symptoms**:
- Unit tests pass (mocked DI container)
- E2E tests fail: `Cannot resolve TaskCreationService` or similar
- Error occurs only in built/bundled code, not in ts-node or jest

**Root Cause**: TSyringe requires `Reflect.defineMetadata()` calls generated by TypeScript's `emitDecoratorMetadata` option. esbuild treats decorators as syntax only, not emitting the required metadata calls.

**Solution**: Use `esbuild-plugin-tsc` to delegate TypeScript compilation to tsc while keeping esbuild for bundling.

### Implementation

```bash
# Install the plugin
npm install -D esbuild-plugin-tsc
```

```typescript
// esbuild.config.mjs
import esbuildPluginTsc from 'esbuild-plugin-tsc';

const plugins = [
  esbuildPluginTsc({
    force: true  // Always use tsc for .ts files
  }),
  // ... other plugins
];

await esbuild.build({
  // ... your config
  plugins,
});
```

```json
// tsconfig.json - ensure these are set
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### Why This Works

1. **TSyringe requirement**: `@injectable()` decorator needs runtime metadata
2. **tsc behavior**: Emits `__decorate()` and `Reflect.defineMetadata()` calls
3. **esbuild default**: Strips decorators, no metadata emitted
4. **Plugin solution**: Routes `.ts` files through tsc first, then esbuild bundles

### Verification

```bash
# Unit tests should pass (mocked container)
npm run test:unit

# E2E tests should pass (real built code with metadata)
npm run test:e2e
```

### Common Pitfalls

- **reflect-metadata import order**: Must be first import in entry point
- **tsconfig inheritance**: Child configs must also have `emitDecoratorMetadata: true`
- **Plugin order**: `esbuild-plugin-tsc` should be early in plugins array

### Real-World Example

**Issue #436 Phase 2**: TaskCreationService migration to TSyringe DI
- Unit tests: 194 passing (mocked container)
- E2E tests: 11 failing → 11 passing after `esbuild-plugin-tsc` added
- 6 debugging attempts before finding solution
- **Key insight**: E2E tests use built code, revealing runtime metadata issues

**Reference**: PR #449 - TSyringe DI migration with esbuild decorator metadata fix

---

## Test File Splitting Pattern

**When to use**: Test files exceeding 500 LOC (target), must split at 1000 LOC

### Why Split Large Test Files

- **Discoverability**: Easier to find relevant tests by domain
- **Maintainability**: Smaller files are easier to modify and review
- **Parallel execution**: Allows Jest to run test files in parallel
- **CI efficiency**: Failed tests are easier to identify and debug
- **Code ownership**: Clear ownership of test domains

### Splitting Workflow

1. **Identify logical groupings** (by command category, feature, or domain)
2. **Create new directory structure** if needed (e.g., `tests/unit/commands/visibility/`)
3. **Create new files** with descriptive suffixes (e.g., `*.status.test.ts`, `*.creation.test.ts`)
4. **Move ALL tests** for that category to new file (don't leave duplicates)
5. **Delete or update original file** (remove migrated tests)
6. **Verify all tests pass**: `npm run test:unit`
7. **Verify no duplicate test names** across split files

### Example Directory Structure

```
tests/unit/commands/visibility/
├── CommandVisibility.conversion.test.ts   (104 LOC)
├── CommandVisibility.creation.test.ts     (353 LOC)
├── CommandVisibility.effortPlanning.test.ts (318 LOC)
├── CommandVisibility.instance.test.ts     (200 LOC)
├── CommandVisibility.maintenance.test.ts  (439 LOC)
├── CommandVisibility.status.test.ts       (356 LOC)
├── CommandVisibility.statusRollback.test.ts (162 LOC)
├── CommandVisibility.taskCreation.test.ts (413 LOC)
└── CommandVisibility.voting.test.ts       (270 LOC)
```

### Domain Categories (Examples)

| Category | Description | Example Tests |
|----------|-------------|---------------|
| `*.status.test.ts` | Status transition commands | canMoveToBacklog, canStartEffort, canMarkDone |
| `*.creation.test.ts` | Entity creation commands | canCreateTask, canCreateProject |
| `*.maintenance.test.ts` | Cleanup/repair commands | canArchiveTask, canCleanProperties |
| `*.voting.test.ts` | Voting-related commands | canVoteOnEffort |
| `*.conversion.test.ts` | Type conversion commands | canConvertTaskToProject |

### Anti-Patterns

**❌ Partial splits that leave duplicates:**
```
# WRONG: Original file still has tests that were copied (not moved) to new files
CommandVisibility.test.ts       (2588 LOC - still has all tests)
CommandVisibility.status.test.ts (356 LOC - duplicates status tests)
# Result: Same tests run twice, confusing failures
```

**❌ Incomplete migration:**
```
# WRONG: Some tests moved, some left behind, file not deleted
CommandVisibility.test.ts       (1200 LOC - partial tests remain)
# Result: Unclear which tests are in which file
```

### Complete Split Checklist

- [ ] New files created with descriptive domain names
- [ ] ALL tests for each domain moved (not copied) to new files
- [ ] Original file deleted OR updated to only contain remaining tests
- [ ] `npm run test:unit` passes (all tests run exactly once)
- [ ] No duplicate test names across files
- [ ] Each new file < 500 LOC (target)
- [ ] Import statements updated in each new file

### LOC Thresholds

| LOC | Action |
|-----|--------|
| < 500 | Acceptable (target) |
| 500-1000 | Consider splitting if clear domain boundaries exist |
| > 1000 | Must split (blocking for new PRs) |

### Reference

- **Issue #474**: Split Oversized Test Files initiative
- **PR #483**: CommandVisibility.test.ts split into 9 domain-focused files (2588 → 9 files < 500 LOC each)

---

## Module Export Pattern

**When creating a package with subpath exports:**

### 1. Always export from main package index (primary API)

```typescript
// packages/core/src/index.ts
export * from "./domain/errors";
export * from "./application/errors";
```

**Why**: Main package exports ensure TypeScript compatibility with all `moduleResolution` settings.

### 2. Optionally add subpath exports (optimization)

```json
// packages/core/package.json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./domain/errors": {
      "types": "./dist/domain/errors/index.d.ts",
      "import": "./dist/domain/errors/index.js"
    }
  }
}
```

**Why**: Subpath exports allow tree-shaking and selective loading but are optional extras.

### 3. Never use .js extensions in TypeScript source

```typescript
// ❌ WRONG
import { ErrorCode } from "./ErrorCode.js";

// ✅ CORRECT
import { ErrorCode } from "./ErrorCode";
```

**Why**: Jest module resolution fails with `.js` extensions in TypeScript source files.

### Benefits

- **Main package exports**: TypeScript compatibility across all module resolution settings
- **Subpath exports**: Tree-shaking, selective loading, avoiding unnecessary code (e.g., decorators in Playwright CT)
- **No .js extensions**: Prevents Jest module resolution issues

### Real-world Example (PR #451)

**Problem**: Component tests failed with "Cannot find module '@exocortex/core/domain/errors'"

**Solution**:
1. Added exports to main package index: `export * from "./domain/errors"`
2. Kept subpath exports in package.json for Playwright CT
3. Removed all `.js` extensions from error module imports

**Result**: All tests pass, TypeScript compiles cleanly, both import styles work

---

## SPARQL 1.2 Feature Implementation Pattern

**When implementing a new SPARQL standard feature (RDF-Star, DateTime, etc.):**

### Implementation Order (Foundation → Accessors → Parser → Tests)

```
1. Data Model Class     (e.g., QuotedTriple.ts)
2. Constructor Function (e.g., TRIPLE(s, p, o))
3. Type Checker         (e.g., isTRIPLE())
4. Accessor Functions   (e.g., SUBJECT(), PREDICATE(), OBJECT())
5. Parser Support       (e.g., <<( s p o )>> syntax)
6. Serialization        (e.g., query result output)
7. Integration Tests    (e.g., combined feature tests)
```

### Real-World Example: RDF-Star Implementation (Issues #951-955)

| Step | Issue | Description | Time |
|------|-------|-------------|------|
| 1 | #951 | QuotedTriple data model class | 68 steps |
| 2 | #952 | TRIPLE() constructor function | 74 steps |
| 3 | #954 | isTRIPLE() type checker | 80 steps |
| 4 | #953 | SUBJECT(), PREDICATE(), OBJECT() accessors | 91 steps |
| 5 | #955 | Parser for `<<( s p o )>>` syntax | 85 steps |

**Key insight**: Each step builds on the previous. TRIPLE() needs QuotedTriple class, accessors need TRIPLE(), parser creates QuotedTriple instances.

### DateTime Arithmetic Implementation (Issues #973-975, #988-990)

| Step | Issue | Description |
|------|-------|-------------|
| 1 | #973 | date + duration arithmetic |
| 2 | #974 | date - duration arithmetic |
| 3 | #975 | duration + duration arithmetic |
| 4 | #988 | duration comparison operators |
| 5 | #990 | YEARS() and MONTHS() accessors |

**Pattern**: Addition first, subtraction second (reuses addition logic with negation), then comparison.

### Benefits of Sequential Implementation

- **Warm context**: 2-2.5x productivity when implementing related features back-to-back
- **Shared test patterns**: Reuse mock data, fixtures, assertion patterns
- **Consistent architecture**: All features follow same structure
- **Zero-error sessions**: Patterns internalized after first feature

### Test Coverage for SPARQL Features

**Structure:**
```
packages/core/tests/
├── unit/infrastructure/sparql/
│   ├── executors/           # BGP, Filter, PropertyPath
│   ├── functions/           # Built-in functions (TRIPLE, isTRIPLE, etc.)
│   └── operators/           # Arithmetic, comparison
└── integration/sparql/
    └── sparql-1.2-*.test.ts # Combined feature tests
```

**Reference**:
- PR #994: SPARQL 1.2 Integration Test Suite (162 steps)
- PR #992: Documentation guide for all SPARQL 1.2 features

---

## Timezone-Safe DateTime Serialization Pattern

**When handling user-input datetime values that should be saved as-is (no UTC conversion):**

### Problem: JavaScript Date Converts to UTC

```typescript
// ❌ WRONG: toISOString() converts to UTC
const userInput = '2025-12-17T20:05';
const saved = new Date(userInput).toISOString();
// Result: '2025-12-17T15:05:00.000Z' (in UTC+5 timezone)
// User entered 20:05, saved as 15:05 → BROKEN!
```

### Root Cause Analysis (Issue #1052)

The bug manifested as +20 hour offset:
- User entered: 2025-12-17 20:05
- Actually saved: 2025-12-18 16:05 (+20 hours)

**Investigation process:**
1. Check `getTimezoneOffset()` usage - returns NEGATIVE for positive timezones
2. Look for double offset application
3. Compare working field (plannedStartTimestamp) vs broken field (plannedEndTimestamp)

### Solution: Preserve User Input as String

```typescript
// ✅ CORRECT: String manipulation preserves local time
function serializeTimestamp(userInput: string): string {
  // userInput format: "2025-12-17T20:05"
  // Add seconds if missing
  if (userInput.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
    return userInput + ':00';  // "2025-12-17T20:05:00"
  }
  return userInput;
}
```

### Alternative: Use Luxon for Local Time

```typescript
import { DateTime } from 'luxon';

function serializeTimestamp(userInput: string): string {
  const local = DateTime.fromFormat(userInput, "yyyy-MM-dd'T'HH:mm", {
    zone: 'local'
  });
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}
```

### Testing Timezone Handling

```typescript
describe('EMS timestamp serialization', () => {
  it('should preserve local time without offset', () => {
    const userInput = '2025-12-17T20:05';
    const result = serializeTimestamp(userInput);
    expect(result).toBe('2025-12-17T20:05:00');
  });

  it('should handle start and end timestamps identically', () => {
    const start = serializeTimestamp('2025-12-17T20:00');
    const end = serializeTimestamp('2025-12-17T20:05');
    // Both should preserve local time
    expect(start).toBe('2025-12-17T20:00:00');
    expect(end).toBe('2025-12-17T20:05:00');
  });
});
```

### Key Gotchas

- `getTimezoneOffset()` returns **NEGATIVE** values for **POSITIVE** timezones (UTC+5 → -300)
- `new Date().toISOString()` **ALWAYS** returns UTC with 'Z' suffix
- DST transitions can cause unexpected behavior - test edge cases
- Fractional hour timezones exist (UTC+5:30, UTC+9:30)

**Reference**: Issue #1052, PR #1052 (120 steps)

---

## Mobile Table Layout Pattern

**When implementing tables that must work on mobile devices:**

### Virtualized Table Column Synchronization (Issue #941)

**Problem**: Tables with >50 rows use virtualization (separate header/body tables), causing column misalignment.

**Solution**: Synchronize column widths between header and body tables.

```typescript
// Option A: CSS Variables for column widths
const columnWidths = useMemo(() => ({
  name: 'auto',
  start: '65px',
  end: '65px',
  status: '80px'
}), []);

// Apply via CSS variables
<style>
  :root {
    --col-name-width: auto;
    --col-start-width: 65px;
    --col-end-width: 65px;
  }
</style>

// Option B: Fixed widths with table-layout: fixed
.task-table {
  width: 100%;
  table-layout: fixed;
}

.col-name { width: auto; }
.col-start, .col-end { width: 65px; }
```

### Mobile-First Column Proportions (Issue #1055)

**Problem**: Text truncation and unbalanced columns on mobile.

**Solution**: Flexbox with fixed-width time columns, flexible name column.

```css
/* Mobile table row as flexbox */
.task-table-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Name column: flexible, truncated with tooltip */
.col-name {
  flex: 1 1 auto;
  min-width: 0;  /* Critical for text-overflow to work! */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Time columns: fixed width */
.col-start, .col-end {
  flex: 0 0 65px;
  text-align: right;
  font-size: 12px;
}

/* Tooltip on hover/tap for truncated text */
.col-name:hover {
  white-space: normal;
  overflow: visible;
  position: relative;
  z-index: 10;
  background: var(--background-primary);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
```

### Key CSS Rules for Mobile Tables

1. **`min-width: 0`**: Required for flex items to shrink below content size
2. **`text-overflow: ellipsis`**: Requires both `overflow: hidden` and `white-space: nowrap`
3. **`flex: 0 0 Xpx`**: Fixed width columns (0 grow, 0 shrink, Xpx basis)
4. **`flex: 1 1 auto`**: Flexible columns that fill remaining space

### Testing Mobile Layouts

```typescript
// Playwright viewport sizes
const viewports = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'iPad Mini', width: 768, height: 1024 },
];

viewports.forEach(({ name, width, height }) => {
  test(`table layout on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Test column proportions
    const nameCol = await page.locator('.col-name').boundingBox();
    const startCol = await page.locator('.col-start').boundingBox();
    expect(startCol.width).toBeLessThanOrEqual(70);
    expect(nameCol.width).toBeGreaterThan(startCol.width * 2);
  });
});
```

**Reference**:
- Issue #941: Column misalignment in virtualized mode (35-82 steps)
- Issue #1055: Mobile text truncation fix (59 steps)

---

## Directional Language Tag Pattern

**When implementing i18n features with RTL (right-to-left) language support:**

### SPARQL 1.2 Directional Literals (Issues #991, #993)

**Syntax**: `"text"@lang--dir` where dir is `ltr` or `rtl`

```sparql
# Examples
"مرحبا"@ar--rtl      # Arabic, right-to-left
"Hello"@en--ltr      # English, left-to-right
"שלום"@he--rtl       # Hebrew, right-to-left
```

### Parser Implementation

```typescript
parseLiteral(): Literal {
  const value = this.parseQuotedString();

  if (this.match('@')) {
    const langTag = this.parseLangTag();

    // Check for direction suffix (SPARQL 1.2)
    if (langTag.includes('--')) {
      const [language, direction] = langTag.split('--');
      if (direction !== 'ltr' && direction !== 'rtl') {
        throw new Error(`Invalid direction: ${direction}`);
      }
      return createDirectionalLiteral(value, language, direction);
    }

    return createLangLiteral(value, langTag);
  }

  // ... datatype handling
}
```

### Serialization (Query Results)

```typescript
// Serialize directional literal back to string
function serializeLiteral(lit: Literal): string {
  if (lit.direction) {
    return `"${lit.value}"@${lit.language}--${lit.direction}`;
  }
  if (lit.language) {
    return `"${lit.value}"@${lit.language}`;
  }
  if (lit.datatype) {
    return `"${lit.value}"^^<${lit.datatype}>`;
  }
  return `"${lit.value}"`;
}
```

### Accessor Functions

```sparql
# Check if literal has direction
FILTER(hasLANGDIR(?label))

# Get direction
BIND(LANGDIR(?label) AS ?dir)
FILTER(?dir = "rtl")
```

**Reference**:
- PR #991: Parse directional language tag syntax (120 steps)
- PR #993: Serialize directional literals in query results (80 steps)

---

## Batch Code Scanning Fix Pattern

**When processing multiple code scanning alerts efficiently:**

### December 2025 Sprint: 41 Issues in One Day

Successfully processed 41 code scanning issues (#1072-#1140) in a single day through systematic prioritization and parallel agent execution.

### Issue Prioritization Strategy

| Priority | Category | Examples | Step Count |
|----------|----------|----------|------------|
| **P0** | Security-critical | Incomplete string escaping, insecure randomness, weak crypto | 30-63 steps |
| **P1** | Code correctness | Useless assignments, unreachable code, identical operands | 34-117 steps |
| **P2** | Code quality | Overwritten properties, undeclared variables, superfluous arguments | 25-54 steps |
| **P3** | Cleanup | Unused variables, ASI issues | 25-79 steps |

### Pattern: Batch by Alert Type

```bash
# 1. Query all alerts of same type
gh api repos/kitelev/exocortex/code-scanning/alerts --jq '
  .[] | select(.rule.id == "js/useless-assignment-to-local")
' | jq -s 'length'

# 2. Create single issue for all alerts of that type
gh issue create --title "P1: Fix Useless assignment to local variable (5 alerts)" \
  --body "Locations: file1.ts:42, file2.ts:15, ..."

# 3. Fix all in single PR
# - All same pattern → copy-paste solution
# - Single test run verifies all fixes
# - Single CI pipeline
```

### Key Efficiency Insights

1. **Group similar alerts**: Fix 5 useless assignments in one issue (Issue #1102, #1112)
2. **Parallel agent execution**: Multiple Claude Code sessions work on different priority levels
3. **Shared fix patterns**: Once you fix one "useless assignment", next 4 are identical
4. **Skip redundant research**: All P1 useless-assignment fixes share same root cause

### Common Fix Patterns by Alert Type

#### Useless Assignment to Local Variable
```typescript
// ❌ ALERT: Useless assignment
let result = expensiveOperation();
result = anotherOperation();  // First value never used

// ✅ FIX: Remove unused assignment
const result = anotherOperation();

// Alternative: If first value needed elsewhere
const intermediate = expensiveOperation();
useValue(intermediate);
const result = anotherOperation();
```

#### Superfluous Trailing Arguments
```typescript
// ❌ ALERT: Function only accepts 2 params, called with 3
function process(a: string, b: number): void { ... }
process("hello", 42, true);  // 'true' is superfluous

// ✅ FIX: Check function signature, remove extra args
process("hello", 42);

// Or update function if param was intended
function process(a: string, b: number, flag?: boolean): void { ... }
```

#### Identical Operands
```typescript
// ❌ ALERT: Comparing variable to itself
if (value === value) { }  // Always true (except NaN)

// ✅ FIX: Use correct comparison
if (value === expectedValue) { }

// Exception: NaN check (prefer Number.isNaN)
if (Number.isNaN(value)) { }  // Instead of value !== value
```

#### Comparison Between Inconvertible Types
```typescript
// ❌ ALERT: String compared to number will never be true
if (id === 42) { }  // id is string

// ✅ FIX: Match types
if (id === "42") { }
// Or convert
if (Number(id) === 42) { }
```

### Metrics from December 2025 Sprint

| Metric | Value |
|--------|-------|
| Total issues | 41 |
| Total PRs | 41 |
| Average steps per issue | ~55 |
| Minimum steps | 25 (simple unused variable removal) |
| Maximum steps | 117 (complex expression-has-no-effect fix) |
| Security issues (P0) | 9 |
| Correctness issues (P1) | 18 |
| Quality issues (P2) | 7 |
| Cleanup issues (P3) | 7 |

### Reference

- Issues #1072-#1140: December 2025 Code Scanning Sprint
- Code Scanning Monitor: `~/.n8n-data/code-scanning-monitor.py`
- Automated issue creation with priority tagging

---

## Split-Join Pattern for Regex Replacement

**When to use**: Safe string manipulation that preserves special regex characters

### Problem: Regex $-Substitution in Replace

```typescript
// ❌ DANGEROUS: replace() interprets $ in replacement string
const template = "Hello, $name!";
const result = template.replace("$name", userInput);
// If userInput contains "$&" → replaces with matched text
// If userInput contains "$$" → replaces with literal $
// Unpredictable behavior with special sequences!
```

### Solution: Split/Join Pattern

```typescript
// ✅ SAFE: split/join doesn't interpret special characters
const template = "Hello, $name!";
const result = template.split("$name").join(userInput);
// Works correctly regardless of userInput content
// No regex interpretation
// No $ substitution
```

### When to Apply

Use split/join instead of replace when:
- Replacement string comes from user input
- Replacement string may contain `$`, `&`, `` ` ``, `'`
- You need literal string replacement (not regex)

### Real-World Example (Issue #1139)

The incomplete string escaping alert identified places where `String.replace()` was used with dynamic replacement values:

```typescript
// ❌ BEFORE: Could be exploited with $& or $$ in filename
const output = template.replace("{{filename}}", file.basename);

// ✅ AFTER: Safe regardless of filename content
const output = template.split("{{filename}}").join(file.basename);
```

### Benefits

- **Security**: No special character interpretation
- **Predictability**: Output is exactly what you expect
- **Performance**: Split/join is slightly faster than replace with RegExp
- **Readability**: Intent is clear - literal substitution

### Reference

- Issue #1139: Fix Incomplete string escaping or encoding (PR #1139)
- CodeQL alert: `js/incomplete-string-escaping`
- 7 related P0 security issues: #1121, #1132, #1136, #1137, #1138, #1140

---

## Feature Cluster Development Pattern

**When to use**: Implementing related UI/UX features that share common components or concepts

### Pattern Description

Group related features into "clusters" and implement them sequentially in a single session. This leverages:
- Shared understanding of the affected codebase area
- Reusable components and patterns across features
- Warm context from recent related work

### Real-World Example: Asset Label Display Cluster (December 2025)

**Features implemented in ~6 hours total:**

| Issue | Feature | Steps | Time |
|-------|---------|-------|------|
| #1143 | Show `exo__Asset_label` in File Explorer | 99 | ~90min |
| #1144 | Show `exo__Asset_label` in Tab Titles | 78 | ~60min |
| #1145 | Template system for display names | 114 | ~80min |
| #1146 | Sort File Explorer by label | 162 | ~100min |
| #1149 | Per-class display name templates | 148 | ~90min |

**Key Insight**: First feature (#1143) required research into Obsidian's FileExplorerView monkey-patching. Subsequent features reused the same patching infrastructure, reducing implementation time significantly.

### Implementation Flow

```
1. Research Phase (first feature only)
   └── Study Obsidian internals
   └── Identify extension points
   └── Create base infrastructure

2. Feature Implementation (each feature)
   └── Extend existing infrastructure
   └── Add feature-specific logic
   └── Write tests
   └── Create PR

3. Refinement Phase (optional)
   └── Per-class customization
   └── Performance optimization
   └── Additional settings
```

### Benefits

- **Reduced research time**: Infrastructure research done once, reused many times
- **Consistent implementation**: All features follow same patterns
- **Higher quality**: Each feature benefits from learnings of previous ones
- **Faster reviews**: Similar code structure across PRs

### When to Apply

Look for feature requests that:
- Affect same UI component or area
- Share common data sources (e.g., `exo__Asset_label`)
- Can reuse same infrastructure (e.g., Obsidian patches)
- Are requested together or logically related

**Reference**: Issues #1143-#1149 - Label Display Cluster (6 features, ~6 hours, all merged Dec 23 2025)

---

## Layered Architecture Implementation Pattern

**When to use**: Building new subsystems that require data model, type system, and state management

### Pattern Description

Implement complex features in distinct architectural layers, each building on the previous:

```
Layer 1: Data Model (interfaces, types, basic operations)
    ↓
Layer 2: Type System (validation, ontology mapping, type guards)
    ↓
Layer 3: State Management (store, actions, selectors)
    ↓
Layer 4: Presentation (components, rendering, interactions)
```

### Real-World Example: Graph View Foundation (December 2025)

| Layer | Issue | Description | Steps | Additions |
|-------|-------|-------------|-------|-----------|
| 1 | #1151 | Graph data model + triple store | 115 | +1943 |
| 2 | #1152 | Node/edge type system + ontology | 98 | +2389 |
| 3 | #1153 | Zustand state management | 195 | +3424 |

**Total**: 408 steps, 7,756 lines added in ~5 hours

### Implementation Details by Layer

#### Layer 1: Data Model (#1151)

```typescript
// Define core interfaces
interface GraphNode {
  id: string;
  label: string;
  types: string[];
  position: Position;
  metadata: Map<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
}

// Create query service for triple store integration
class GraphQueryService {
  async queryNodes(filter: NodeFilter): Promise<GraphNode[]>;
  async queryEdges(nodeId: string): Promise<GraphEdge[]>;
}
```

#### Layer 2: Type System (#1152)

```typescript
// Map ontology classes to visual types
interface NodeTypeConfig {
  classUri: string;
  displayName: string;
  color: string;
  icon: string;
  shape: 'circle' | 'rectangle' | 'diamond';
}

// Create type guards and validators
function isTaskNode(node: GraphNode): boolean {
  return node.types.includes('ems__Task');
}
```

#### Layer 3: State Management (#1153)

```typescript
// Zustand store with middleware
const useGraphStore = create<GraphStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        nodes: new Map(),
        edges: new Map(),
        selectedIds: new Set(),
        viewport: { x: 0, y: 0, zoom: 1 },

        // Actions
        addNode: (node) => set(state => {
          state.nodes.set(node.id, node);
        }),

        selectNode: (id, additive) => set(state => {
          if (!additive) state.selectedIds.clear();
          state.selectedIds.add(id);
        }),
      }))
    )
  )
);
```

### Benefits

- **Clean separation**: Each layer has single responsibility
- **Testability**: Layers can be tested independently
- **Parallelization**: Multiple agents can work on different layers
- **Maintainability**: Changes in one layer don't affect others

### Anti-Patterns to Avoid

- ❌ Mixing data model with state management
- ❌ Putting presentation logic in data layer
- ❌ Skipping type system for "speed"
- ❌ Starting with UI before data model is stable

### When to Apply

Use layered implementation for:
- New visualization features (graphs, charts, diagrams)
- Complex CRUD subsystems
- Features with significant state requirements
- Integration with external systems (triple stores, APIs)

**Reference**: Issues #1151-#1153 - Graph View Foundation (3 layers, 5 hours, Dec 23 2025)

---

## Obsidian API Monkey-Patching Pattern

**When to use**: Modifying Obsidian's built-in UI components (File Explorer, Tabs, etc.)

### Pattern Description

Obsidian's plugin API doesn't expose all UI customization points. For deep integration (like custom labels in File Explorer), use controlled monkey-patching.

### Implementation Structure

```typescript
// FileExplorerPatch.ts
export class FileExplorerPatch {
  private plugin: ExocortexPlugin;
  private originalMethod: Function | null = null;
  private isPatched = false;

  constructor(plugin: ExocortexPlugin) {
    this.plugin = plugin;
  }

  enable(): void {
    if (this.isPatched) return;

    // Find internal component
    const fileExplorer = this.plugin.app.workspace
      .getLeavesOfType('file-explorer')[0]?.view;
    if (!fileExplorer) return;

    // Store original method
    this.originalMethod = fileExplorer.fileItems.constructor
      .prototype.updateTitle;

    // Apply patch
    const self = this;
    fileExplorer.fileItems.constructor.prototype.updateTitle =
      function(this: FileItem) {
        const label = self.getAssetLabel(this.file.path);
        if (label) {
          this.titleEl.setText(label);
        } else {
          self.originalMethod?.call(this);
        }
      };

    this.isPatched = true;
  }

  disable(): void {
    if (!this.isPatched || !this.originalMethod) return;

    // Restore original
    const fileExplorer = this.plugin.app.workspace
      .getLeavesOfType('file-explorer')[0]?.view;
    if (fileExplorer) {
      fileExplorer.fileItems.constructor.prototype.updateTitle =
        this.originalMethod;
    }

    this.isPatched = false;
    this.originalMethod = null;
  }

  private getAssetLabel(path: string): string | null {
    return this.plugin.services.assetMetadata.getAssetLabel(path);
  }
}
```

### Key Principles

1. **Store original method**: Always save reference to restore later
2. **Clean disable**: Restore original on plugin unload
3. **Guard against re-patching**: Use `isPatched` flag
4. **Null checks**: Views may not exist when patching
5. **Settings toggle**: Let users enable/disable feature

### Real-World Example: Label Display Features

| Feature | Patched Component | Method |
|---------|-------------------|--------|
| File Explorer labels | FileExplorerView.fileItems | updateTitle |
| Tab titles | WorkspaceLeaf | getDisplayText |
| Sorting | FileExplorerView | sortFiles |

### Testing Monkey-Patches

```typescript
describe('FileExplorerPatch', () => {
  it('should restore original method on disable', () => {
    const patch = new FileExplorerPatch(mockPlugin);
    const originalFn = mockFileExplorer.updateTitle;

    patch.enable();
    expect(mockFileExplorer.updateTitle).not.toBe(originalFn);

    patch.disable();
    expect(mockFileExplorer.updateTitle).toBe(originalFn);
  });
});
```

### Cautions

- **Version compatibility**: Obsidian internals may change between versions
- **Performance**: Patches run on every render - keep them fast
- **Conflicts**: Other plugins may patch same methods
- **Recovery**: Handle errors gracefully, don't break Obsidian

**Reference**: Issues #1143, #1144, #1146 - File Explorer, Tab, Sorting patches (Dec 23 2025)

---

## External Plugin API Pattern

**When to use**: Exposing Exocortex functionality to other Obsidian plugins

### Pattern Description

Create a stable, versioned API for third-party plugin integration following Obsidian conventions.

### Implementation

```typescript
// api/ExocortexAPI.ts
export interface ExocortexAPI {
  // Version for compatibility checks
  readonly version: string;

  // Label access (most common use case)
  getAssetLabel(path: string): string | null;
  getAssetLabels(paths: string[]): Map<string, string>;

  // Full metadata
  getAssetMetadata(path: string): AssetMetadata | null;

  // Relationships
  getAssetRelations(path: string): AssetRelation[];
  getLinkedAssets(path: string): string[];

  // Events
  on(event: 'label-changed', callback: LabelChangedCallback): EventRef;
  on(event: 'metadata-changed', callback: MetadataChangedCallback): EventRef;
  off(event: string, ref: EventRef): void;

  // Query
  queryAssets(filter: AssetFilter): AssetMetadata[];
}

// Register in plugin
class ExocortexPlugin extends Plugin {
  public api: ExocortexAPI | null = null;

  async onload() {
    this.api = new ExocortexAPIImpl(this);

    // Clean up on unload
    this.register(() => { this.api = null; });
  }
}
```

### Consumer Usage

```typescript
// In other plugin
const exocortex = this.app.plugins.getPlugin('exocortex') as
  ExocortexPlugin | undefined;

if (exocortex?.api) {
  // Get label for current file
  const label = exocortex.api.getAssetLabel(activeFile.path);

  // Subscribe to changes
  const ref = exocortex.api.on('label-changed', (path, old, new_) => {
    console.log(`Label changed: ${old} → ${new_}`);
  });

  // Clean up subscription
  this.register(() => exocortex.api?.off('label-changed', ref));
}
```

### API Design Principles

1. **Version field**: Allow consumers to check compatibility
2. **Null safety**: Return `null` for missing data, not undefined
3. **Event cleanup**: Return refs for event unsubscription
4. **Batch operations**: Provide bulk methods for performance
5. **TypeScript types**: Export types for consumer type safety

### TypeScript Types Export

```typescript
// types.d.ts (for npm distribution)
declare module 'exocortex' {
  export interface ExocortexAPI {
    // ... API definition
  }

  export interface AssetMetadata {
    path: string;
    label: string | null;
    class: string | null;
    // ...
  }
}
```

### Potential Integrations

| Plugin | Use Case |
|--------|----------|
| Dataview | Show labels in query results |
| TagFolder | Sort by semantic labels |
| Quick Switcher++ | Search by labels |
| Templater | Access metadata in templates |

**Reference**: Issue #1147 - API Provider for external plugin integration (PR #1198, +1194 lines)

---

## Toggle Component Pattern

**When to use**: Adding show/hide controls for filtered content in tables/trees

### Pattern Description

Create consistent toggle components for filtering archived/hidden content using Zustand store.

### Implementation Structure

```
BaseComponent (e.g., AreaHierarchyTree)
    ↓
WithToggle Wrapper (AreaHierarchyTreeWithToggle)
    ↓
uiStore (showArchived state + toggleArchived action)
```

### Code Structure

```typescript
// 1. uiStore.ts - Centralized toggle state
interface UIState {
  showArchived: boolean;
}

interface UIActions {
  toggleArchived: () => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  showArchived: false,
  toggleArchived: () => set((s) => ({ showArchived: !s.showArchived })),
}));

// 2. Wrapper component
export const AreaHierarchyTreeWithToggle: React.FC<Props> = ({ areas }) => {
  const { showArchived, toggleArchived } = useUIStore();

  // Recursive filter for nested structures
  const filteredAreas = useMemo(() =>
    filterArchivedAreas(areas, showArchived),
    [areas, showArchived]
  );

  return (
    <div className="exocortex-tree-container">
      <button
        className="exocortex-toggle-archived"
        onClick={toggleArchived}
      >
        {showArchived ? '👁 Hide Archived' : '👁‍🗨 Show Archived'}
      </button>
      <AreaHierarchyTree areas={filteredAreas} />
    </div>
  );
};

// 3. Recursive filtering
function filterArchivedAreas(
  areas: AreaNode[],
  showArchived: boolean
): AreaNode[] {
  if (showArchived) return areas;

  return areas
    .filter(area => !area.isArchived)
    .map(area => ({
      ...area,
      children: filterArchivedAreas(area.children, showArchived)
    }));
}
```

### CSS Styling

```css
.exocortex-toggle-archived {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.exocortex-toggle-archived:hover {
  background: var(--background-modifier-hover);
}

.is-archived {
  opacity: 0.6;
  font-style: italic;
}
```

### Existing Toggle Implementations

| Component | Location | State Key |
|-----------|----------|-----------|
| DailyTasksTableWithToggle | DailyNote layout | showArchived |
| AssetRelationsTable | Relations block | showArchived |
| AreaHierarchyTreeWithToggle | Area hierarchy | showArchived |

### Benefits

- **Consistent UX**: Same toggle behavior across all components
- **State persistence**: Zustand persists user preference
- **Minimal re-renders**: Toggle only affects affected component
- **Recursive support**: Works with nested tree structures

**Reference**: Issue #1142 - Area hierarchy archived toggle (PR #1148, 86 steps)

---

## Graph View Sprint Development Pattern

**When to use**: Executing large-scale feature development requiring 30+ coordinated issues completed in 24-48 hours

### Pattern Description

The Graph View feature was developed as a high-velocity sprint, completing 30 issues in approximately 24 hours. This pattern is suitable for:
- New subsystems with well-defined scope
- Features that can be parallelized across multiple layers
- Time-critical deliverables with clear milestones

### Sprint Structure (December 2025 Graph View)

**Total**: 30 issues, ~3,150 steps, 60,600+ lines of code in ~24 hours

| Category | Issues | Steps Range | % of Total |
|----------|--------|-------------|------------|
| **Core Infrastructure** (#1151-1155) | 5 | 98-255 steps | 17% |
| **Physics Engine** (#1156-1161) | 6 | 57-209 steps | 20% |
| **Rendering Layer** (#1162-1168) | 7 | 54-132 steps | 23% |
| **UX/Interaction** (#1169-1177) | 9 | 61-172 steps | 30% |
| **Semantic Features** (#1178-1183) | 5 | 4-172 steps | 17% |

### Implementation Order (Critical Path)

```
Phase 1: Foundation (Issues #1151-1155)
├── #1151: Graph data model + triple store queries (115 steps)
├── #1152: Node/edge type system + ontology mapping (98 steps)
├── #1153: Zustand state management (195 steps)
├── #1154: Configuration system (255 steps)
└── #1155: Event system for updates (168 steps)

Phase 2: Physics (Issues #1156-1161)
├── #1156: Force-directed layout base (145 steps)
├── #1157: Barnes-Hut algorithm + quadtree (157 steps)
├── #1158: WebAssembly physics module (95 steps)
├── #1159: Web Worker integration (209 steps)
├── #1160: Configurable force parameters (66 steps)
└── #1161: Collision detection (57 steps)

Phase 3: Rendering (Issues #1162-1168)
├── #1162: PixiJS/WebGL renderer (109 steps)
├── #1163: Node rendering + shapes (82 steps)
├── #1164: Edge rendering + curves (54 steps)
├── #1165: Label rendering + sprites (94 steps)
├── #1166: Dirty-checking + incremental (132 steps)
├── #1167: Visibility culling (96 steps)
└── #1168: Pan/zoom controls (61 steps)

Phase 4: Interaction (Issues #1169-1177)
├── #1169: Selection + multi-select (64 steps)
├── #1170: Hover states + tooltips (101 steps)
├── #1171: Context menus (114 steps)
├── #1172: Keyboard navigation (120 steps)
├── #1173: Hierarchical layout (208 steps)
├── #1174: Radial layout (64 steps)
├── #1175: Temporal layout (70 steps)
├── #1176: Grid/circular layouts (128 steps)
└── #1177: Layout switching animation (64 steps)

Phase 5: Semantic (Issues #1178-1183)
├── #1178: Community detection - Louvain (66 steps)
├── #1179: Node clustering visualization (119 steps)
├── #1180: Filter panel by type (133 steps)
├── #1181: Search + highlight (172 steps)
├── #1182: Path finding (106 steps)
└── #1183: Neighborhood exploration (4 steps)
```

### Key Success Factors

1. **Dependency chain respect**: Each phase depends on previous phases
2. **Parallel execution within phases**: Issues in same phase can run in parallel
3. **Warm context accumulation**: 2.5x productivity gain by issue #10
4. **Shared infrastructure reuse**: Physics simulation used by 5 layouts
5. **Test-driven stability**: Each issue includes unit tests

### File Organization Pattern

```
packages/obsidian-plugin/src/presentation/renderers/graph/
├── Core
│   ├── types.ts                 # GraphNode, GraphEdge interfaces
│   ├── index.ts                 # Exports
│   └── GraphLayoutRenderer.tsx  # Main React component
│
├── Physics
│   ├── ForceSimulation.ts       # Main simulation loop
│   ├── BarnesHutForce.ts        # N-body optimization
│   ├── Quadtree.ts              # Spatial indexing
│   ├── HierarchicalLayout.ts    # Tree layout
│   ├── RadialLayout.ts          # Circular layout
│   └── TemporalLayout.ts        # Time-based layout
│
├── Rendering
│   ├── PixiGraphRenderer.ts     # WebGL renderer
│   ├── NodeRenderer.ts          # Node drawing
│   ├── EdgeRenderer.ts          # Edge/curve drawing
│   ├── LabelRenderer.ts         # Text sprites
│   ├── IncrementalRenderer.ts   # Dirty checking
│   └── VisibilityCuller.ts      # Off-screen culling
│
├── Interaction
│   ├── SelectionManager.ts      # Node selection
│   ├── HoverManager.ts          # Hover states
│   ├── ContextMenuManager.ts    # Right-click menus
│   ├── KeyboardManager.ts       # Keyboard shortcuts
│   ├── ViewportController.ts    # Pan/zoom
│   └── NavigationManager.ts     # Focus navigation
│
├── Semantic
│   ├── CommunityDetection.ts    # Louvain algorithm
│   ├── cluster/                 # Clustering components
│   ├── search/                  # Search panel
│   ├── filter/                  # Type filtering
│   └── pathfinding/             # Path finding
│
└── Tests (mirror structure)
    └── packages/obsidian-plugin/tests/unit/presentation/renderers/graph/
```

### Performance Targets Achieved

| Metric | Target | Achieved | Implementation |
|--------|--------|----------|----------------|
| Nodes rendered | 10,000 | 10,000+ | PixiJS WebGL |
| Frame rate | 60 FPS | 60 FPS | Visibility culling |
| Physics updates | 60 Hz | 60 Hz | Web Worker |
| Initial render | < 500ms | ~300ms | Incremental rendering |
| Memory | < 100MB | ~80MB | Object pooling |

### When to Apply Sprint Pattern

**Suitable for:**
- New visualization systems (graphs, charts, 3D)
- Performance-critical features requiring optimization layers
- Features with clear phase boundaries
- Parallel AI agent execution (multiple Claude Code instances)

**Not suitable for:**
- Bug fixes requiring deep investigation
- Refactoring with unknown scope
- Features requiring external dependencies/approvals
- Learning-phase development (unfamiliar tech)

### Anti-Patterns Avoided

- ❌ Implementing rendering before data model
- ❌ Adding UX before core physics works
- ❌ Optimizing prematurely (before baseline)
- ❌ Skipping tests for "speed"
- ❌ Mixing concerns across layers

**Reference**: Issues #1151-#1183 - Graph View Sprint (30 issues, 24 hours, Dec 24 2025)

---

## WebGL Rendering Optimization Pattern

**When to use**: Building high-performance visualization with 1000+ elements

### Pattern Description

Use PixiJS for WebGL-accelerated rendering with these optimization layers:

1. **Object Pooling**: Reuse graphics objects instead of creating new ones
2. **Visibility Culling**: Skip rendering off-screen elements
3. **Dirty Tracking**: Only update changed elements
4. **Batch Rendering**: Group similar draw calls

### Implementation: PixiJS Setup (Issue #1162)

```typescript
// PixiGraphRenderer.ts
import * as PIXI from 'pixi.js';

export class PixiGraphRenderer {
  private app: PIXI.Application;
  private nodeContainer: PIXI.Container;
  private edgeContainer: PIXI.Container;
  private labelContainer: PIXI.Container;

  constructor(canvas: HTMLCanvasElement) {
    this.app = new PIXI.Application({
      view: canvas,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      backgroundColor: 0x1e1e1e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Layer order matters for z-index
    this.edgeContainer = new PIXI.Container();
    this.nodeContainer = new PIXI.Container();
    this.labelContainer = new PIXI.Container();

    this.app.stage.addChild(this.edgeContainer);
    this.app.stage.addChild(this.nodeContainer);
    this.app.stage.addChild(this.labelContainer);
  }
}
```

### Visibility Culling (Issue #1167)

```typescript
// VisibilityCuller.ts
export class VisibilityCuller {
  private viewport: Viewport;
  private visibleNodes: Set<string> = new Set();

  cull(nodes: GraphNode[]): GraphNode[] {
    const bounds = this.viewport.getBounds();
    const margin = 50; // Render slightly outside viewport

    return nodes.filter(node => {
      const inView =
        node.x >= bounds.left - margin &&
        node.x <= bounds.right + margin &&
        node.y >= bounds.top - margin &&
        node.y <= bounds.bottom + margin;

      if (inView) {
        this.visibleNodes.add(node.id);
      } else {
        this.visibleNodes.delete(node.id);
      }

      return inView;
    });
  }

  isVisible(nodeId: string): boolean {
    return this.visibleNodes.has(nodeId);
  }
}
```

### Dirty Tracking (Issue #1166)

```typescript
// DirtyTracker.ts
export class DirtyTracker {
  private dirtyNodes: Set<string> = new Set();
  private dirtyEdges: Set<string> = new Set();
  private fullRedrawNeeded = false;

  markNodeDirty(nodeId: string): void {
    this.dirtyNodes.add(nodeId);
  }

  markEdgeDirty(edgeId: string): void {
    this.dirtyEdges.add(edgeId);
  }

  markFullRedraw(): void {
    this.fullRedrawNeeded = true;
  }

  flush(): DirtyState {
    const state = {
      nodes: new Set(this.dirtyNodes),
      edges: new Set(this.dirtyEdges),
      fullRedraw: this.fullRedrawNeeded,
    };

    this.dirtyNodes.clear();
    this.dirtyEdges.clear();
    this.fullRedrawNeeded = false;

    return state;
  }
}
```

### Incremental Rendering (Issue #1166)

```typescript
// IncrementalRenderer.ts
export class IncrementalRenderer {
  private dirtyTracker: DirtyTracker;
  private culler: VisibilityCuller;

  render(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): void {
    const dirty = this.dirtyTracker.flush();

    if (dirty.fullRedraw) {
      this.renderAll(nodes, edges);
      return;
    }

    // Only render dirty + visible nodes
    for (const nodeId of dirty.nodes) {
      const node = nodes.get(nodeId);
      if (node && this.culler.isVisible(nodeId)) {
        this.updateNodeGraphics(node);
      }
    }

    // Only render dirty edges where both endpoints visible
    for (const edgeId of dirty.edges) {
      const edge = edges.get(edgeId);
      if (edge &&
          this.culler.isVisible(edge.source) &&
          this.culler.isVisible(edge.target)) {
        this.updateEdgeGraphics(edge);
      }
    }
  }
}
```

### Performance Metrics

| Optimization | Impact | Implementation |
|--------------|--------|----------------|
| PixiJS WebGL | 10x faster than SVG | #1162 |
| Visibility culling | 5x fewer draw calls | #1167 |
| Dirty tracking | 50% CPU reduction | #1166 |
| Object pooling | 90% GC reduction | Built into renderers |

**Reference**: Issues #1162, #1166, #1167 - Rendering optimization layer

---

## Barnes-Hut Force Simulation Pattern

**When to use**: Implementing force-directed layouts with O(n²) → O(n log n) optimization

### Pattern Description

Barnes-Hut algorithm uses quadtree spatial partitioning to approximate distant forces, reducing N-body simulation from O(n²) to O(n log n).

### Quadtree Implementation (Issue #1157)

```typescript
// Quadtree.ts
interface QuadtreeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  mass: number;
  centerOfMass: { x: number; y: number };
  body: GraphNode | null;  // Leaf contains single body
  children: QuadtreeNode[] | null;  // [NW, NE, SW, SE]
}

export class Quadtree {
  private root: QuadtreeNode;
  private theta: number = 0.5;  // Barnes-Hut threshold

  constructor(bounds: Bounds) {
    this.root = this.createNode(bounds);
  }

  insert(node: GraphNode): void {
    this.insertIntoNode(this.root, node);
  }

  private insertIntoNode(quadNode: QuadtreeNode, body: GraphNode): void {
    if (quadNode.body === null && quadNode.children === null) {
      // Empty leaf - insert here
      quadNode.body = body;
      quadNode.mass = 1;
      quadNode.centerOfMass = { x: body.x, y: body.y };
      return;
    }

    if (quadNode.children === null) {
      // Leaf with body - subdivide
      this.subdivide(quadNode);
      // Reinsert existing body
      const oldBody = quadNode.body!;
      quadNode.body = null;
      this.insertIntoNode(quadNode, oldBody);
    }

    // Insert into appropriate child
    const childIndex = this.getChildIndex(quadNode, body);
    this.insertIntoNode(quadNode.children![childIndex], body);

    // Update center of mass
    this.updateCenterOfMass(quadNode);
  }
}
```

### Barnes-Hut Force Calculation (Issue #1157)

```typescript
// BarnesHutForce.ts
export class BarnesHutForce {
  private theta: number = 0.5;  // Accuracy vs speed tradeoff

  calculateRepulsion(
    node: GraphNode,
    quadtree: Quadtree,
    strength: number
  ): Vector2 {
    return this.calculateForceFromNode(node, quadtree.getRoot(), strength);
  }

  private calculateForceFromNode(
    body: GraphNode,
    quadNode: QuadtreeNode,
    strength: number
  ): Vector2 {
    if (quadNode.mass === 0) {
      return { x: 0, y: 0 };
    }

    const dx = quadNode.centerOfMass.x - body.x;
    const dy = quadNode.centerOfMass.y - body.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Avoid self-interaction
    if (distance === 0) {
      return { x: 0, y: 0 };
    }

    const nodeSize = quadNode.width;

    // Barnes-Hut approximation: if node is far enough, treat as point mass
    if (nodeSize / distance < this.theta || quadNode.body !== null) {
      // Use point mass approximation
      const force = (strength * quadNode.mass) / (distance * distance);
      return {
        x: -force * dx / distance,
        y: -force * dy / distance,
      };
    }

    // Node is too close - recurse into children
    let totalForce = { x: 0, y: 0 };
    for (const child of quadNode.children || []) {
      const childForce = this.calculateForceFromNode(body, child, strength);
      totalForce.x += childForce.x;
      totalForce.y += childForce.y;
    }

    return totalForce;
  }
}
```

### Performance Comparison

| Algorithm | Complexity | 1K nodes | 10K nodes |
|-----------|------------|----------|-----------|
| Naive N-body | O(n²) | 16ms | 1600ms |
| Barnes-Hut | O(n log n) | 3ms | 40ms |
| **Speedup** | - | 5x | 40x |

### Theta Parameter Tuning

| Theta | Accuracy | Speed | Use Case |
|-------|----------|-------|----------|
| 0.0 | Exact | Slow | Small graphs (<100 nodes) |
| 0.5 | Good | Fast | Default (100-5000 nodes) |
| 0.8 | Approximate | Very fast | Large graphs (>5000 nodes) |
| 1.0+ | Poor | Fastest | Real-time preview only |

**Reference**: Issue #1157 - Barnes-Hut algorithm (157 steps)

---

## Web Worker Physics Pattern

**When to use**: Moving expensive computations off main thread for 60 FPS rendering

### Pattern Description

Separate physics simulation into Web Worker to prevent blocking UI rendering.

### Architecture (Issue #1159)

```
Main Thread                    Web Worker
    │                              │
    ├── User Input ───────────────→│
    │                              ├── Physics Step
    ├── Render Loop                │
    │   ├── Request positions ────→│
    │   ├←──── Position update ────┤
    │   └── Draw frame             │
    │                              │
    ├── Config change ────────────→│
    │                              ├── Update params
```

### Worker Implementation (Issue #1159)

```typescript
// physics.worker.ts
import { ForceSimulation } from './ForceSimulation';

let simulation: ForceSimulation | null = null;

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      simulation = new ForceSimulation(payload.config);
      break;

    case 'SET_NODES':
      simulation?.setNodes(payload.nodes);
      break;

    case 'SET_EDGES':
      simulation?.setEdges(payload.edges);
      break;

    case 'STEP':
      if (simulation) {
        simulation.step();
        const positions = simulation.getPositions();
        self.postMessage({
          type: 'POSITIONS',
          payload: { positions, isStable: simulation.isStable() }
        });
      }
      break;

    case 'PIN_NODE':
      simulation?.pinNode(payload.nodeId, payload.position);
      break;

    case 'UPDATE_CONFIG':
      simulation?.updateConfig(payload.config);
      break;
  }
};
```

### Main Thread Controller (Issue #1159)

```typescript
// ForceSimulationController.ts
export class ForceSimulationController {
  private worker: Worker;
  private positionCallbacks: Set<(positions: Map<string, Position>) => void>;
  private animationFrame: number | null = null;

  constructor() {
    this.worker = new Worker(
      new URL('./physics.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = this.handleMessage.bind(this);
    this.positionCallbacks = new Set();
  }

  start(): void {
    const step = () => {
      this.worker.postMessage({ type: 'STEP' });
      this.animationFrame = requestAnimationFrame(step);
    };
    step();
  }

  stop(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  onPositionUpdate(callback: (positions: Map<string, Position>) => void): void {
    this.positionCallbacks.add(callback);
  }

  private handleMessage(event: MessageEvent): void {
    const { type, payload } = event.data;

    if (type === 'POSITIONS') {
      for (const callback of this.positionCallbacks) {
        callback(payload.positions);
      }

      if (payload.isStable) {
        this.stop();
      }
    }
  }
}
```

### Message Protocol

| Message Type | Direction | Payload | Description |
|--------------|-----------|---------|-------------|
| `INIT` | Main → Worker | config | Initialize simulation |
| `SET_NODES` | Main → Worker | nodes[] | Update node data |
| `SET_EDGES` | Main → Worker | edges[] | Update edge data |
| `STEP` | Main → Worker | - | Trigger physics step |
| `POSITIONS` | Worker → Main | positions, isStable | Position update |
| `PIN_NODE` | Main → Worker | nodeId, position | Fix node position |
| `UPDATE_CONFIG` | Main → Worker | config | Change parameters |

### Performance Impact

| Metric | Without Worker | With Worker |
|--------|----------------|-------------|
| Frame rate | 15-30 FPS | 60 FPS |
| Input latency | 50-100ms | <16ms |
| CPU (main thread) | 80-100% | 10-20% |
| Physics accuracy | Same | Same |

**Reference**: Issue #1159 - Web Worker integration (209 steps)

---

## Louvain Community Detection Pattern

**When to use**: Automatically grouping related nodes in a graph based on connection density

### Pattern Description

The Louvain algorithm detects communities (clusters) by maximizing modularity in O(n log n) time. Used for visual grouping in graph layouts.

### Implementation (Issue #1178)

```typescript
// CommunityDetection.ts
export class LouvainCommunityDetection {
  private nodes: Map<string, GraphNode>;
  private edges: GraphEdge[];
  private communities: Map<string, string>;  // nodeId → communityId
  private resolution: number = 1.0;

  detect(): Map<string, string> {
    // Phase 1: Local moving
    let improved = true;
    while (improved) {
      improved = this.localMovingPhase();
    }

    // Phase 2: Aggregation (if needed)
    if (this.shouldAggregate()) {
      const aggregated = this.aggregateCommunities();
      const subResult = new LouvainCommunityDetection(aggregated).detect();
      this.expandCommunities(subResult);
    }

    return this.communities;
  }

  private localMovingPhase(): boolean {
    let improved = false;
    const nodeOrder = this.randomizeOrder([...this.nodes.keys()]);

    for (const nodeId of nodeOrder) {
      const currentCommunity = this.communities.get(nodeId)!;
      const neighborCommunities = this.getNeighborCommunities(nodeId);

      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const candidateCommunity of neighborCommunities) {
        const gain = this.calculateModularityGain(
          nodeId,
          currentCommunity,
          candidateCommunity
        );

        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = candidateCommunity;
        }
      }

      if (bestCommunity !== currentCommunity) {
        this.communities.set(nodeId, bestCommunity);
        improved = true;
      }
    }

    return improved;
  }

  private calculateModularityGain(
    nodeId: string,
    fromCommunity: string,
    toCommunity: string
  ): number {
    // Modularity formula: Q = Σ[(Lc/m) - (kc/2m)²]
    // where Lc = edges within community, kc = total degree of community
    // Gain = difference in Q after move

    const m = this.edges.length;
    const ki = this.getDegree(nodeId);
    const kiIn = this.getEdgesToCommunity(nodeId, toCommunity);
    const sigmaTot = this.getCommunityTotalDegree(toCommunity);

    return (kiIn / m) - (this.resolution * sigmaTot * ki) / (2 * m * m);
  }
}
```

### Visualization Integration (Issue #1179)

```typescript
// ClusterVisualization.ts
export class ClusterVisualization {
  private colorPalette: string[] = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
  ];

  applyClusterColors(
    nodes: Map<string, GraphNode>,
    communities: Map<string, string>
  ): void {
    // Assign colors to communities
    const communityColors = new Map<string, string>();
    let colorIndex = 0;

    for (const communityId of new Set(communities.values())) {
      communityColors.set(
        communityId,
        this.colorPalette[colorIndex % this.colorPalette.length]
      );
      colorIndex++;
    }

    // Apply to nodes
    for (const [nodeId, node] of nodes) {
      const communityId = communities.get(nodeId);
      if (communityId) {
        node.color = communityColors.get(communityId)!;
      }
    }
  }

  drawClusterHulls(
    ctx: CanvasRenderingContext2D,
    nodes: Map<string, GraphNode>,
    communities: Map<string, string>
  ): void {
    // Group nodes by community
    const clusterNodes = new Map<string, GraphNode[]>();
    for (const [nodeId, node] of nodes) {
      const communityId = communities.get(nodeId)!;
      if (!clusterNodes.has(communityId)) {
        clusterNodes.set(communityId, []);
      }
      clusterNodes.get(communityId)!.push(node);
    }

    // Draw convex hull for each cluster
    for (const [communityId, clusterMembers] of clusterNodes) {
      if (clusterMembers.length < 3) continue;

      const hull = this.computeConvexHull(clusterMembers);
      this.drawHull(ctx, hull, communityColors.get(communityId)!);
    }
  }
}
```

### Algorithm Parameters

| Parameter | Default | Effect | Range |
|-----------|---------|--------|-------|
| `resolution` | 1.0 | Community granularity | 0.1 - 2.0 |
| `minCommunitySize` | 3 | Filter small clusters | 1 - 10 |
| `maxIterations` | 100 | Convergence limit | 10 - 1000 |

### Performance

| Nodes | Edges | Time | Communities Found |
|-------|-------|------|-------------------|
| 100 | 500 | 5ms | 4-8 |
| 1000 | 5000 | 50ms | 15-25 |
| 10000 | 50000 | 500ms | 40-80 |

**Reference**: Issues #1178, #1179 - Community detection + clustering (185 steps combined)

---

## Graph Search and Highlight Pattern

**When to use**: Implementing real-time node search with visual feedback in graph visualization

### Pattern Description

Implement fuzzy search across node properties with progressive highlighting that doesn't block the UI.

### Search Manager (Issue #1181)

```typescript
// SearchManager.ts
export class SearchManager {
  private nodes: Map<string, GraphNode>;
  private searchIndex: Map<string, Set<string>>;  // term → nodeIds
  private debounceTimer: number | null = null;

  constructor(nodes: Map<string, GraphNode>) {
    this.nodes = nodes;
    this.searchIndex = this.buildIndex();
  }

  private buildIndex(): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const [nodeId, node] of this.nodes) {
      // Index label
      const terms = this.tokenize(node.label);
      for (const term of terms) {
        if (!index.has(term)) {
          index.set(term, new Set());
        }
        index.get(term)!.add(nodeId);
      }

      // Index type
      for (const type of node.types) {
        const typeTerm = type.toLowerCase();
        if (!index.has(typeTerm)) {
          index.set(typeTerm, new Set());
        }
        index.get(typeTerm)!.add(nodeId);
      }
    }

    return index;
  }

  search(query: string): SearchResult {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) {
      return { matches: [], totalCount: 0 };
    }

    // Find nodes matching ALL query terms (AND logic)
    let matchingNodes: Set<string> | null = null;

    for (const term of queryTerms) {
      const termMatches = this.fuzzyMatch(term);

      if (matchingNodes === null) {
        matchingNodes = termMatches;
      } else {
        matchingNodes = new Set(
          [...matchingNodes].filter(id => termMatches.has(id))
        );
      }
    }

    const matches = [...(matchingNodes || [])]
      .map(id => ({
        nodeId: id,
        node: this.nodes.get(id)!,
        score: this.calculateScore(id, queryTerms),
      }))
      .sort((a, b) => b.score - a.score);

    return { matches, totalCount: matches.length };
  }

  private fuzzyMatch(term: string): Set<string> {
    const matches = new Set<string>();

    for (const [indexedTerm, nodeIds] of this.searchIndex) {
      if (indexedTerm.includes(term) ||
          this.levenshteinDistance(term, indexedTerm) <= 2) {
        for (const nodeId of nodeIds) {
          matches.add(nodeId);
        }
      }
    }

    return matches;
  }
}
```

### Visual Highlighting (Issue #1181)

```typescript
// SearchHighlighter.ts
export class SearchHighlighter {
  private renderer: PixiGraphRenderer;
  private highlightedNodes: Set<string> = new Set();
  private dimmedNodes: Set<string> = new Set();

  applyHighlight(searchResult: SearchResult): void {
    const matchIds = new Set(searchResult.matches.map(m => m.nodeId));

    // Clear previous highlights
    this.clearHighlight();

    if (matchIds.size === 0) {
      return;
    }

    // Highlight matches
    for (const nodeId of matchIds) {
      this.highlightedNodes.add(nodeId);
      this.renderer.setNodeStyle(nodeId, {
        scale: 1.2,
        glowIntensity: 1.0,
        opacity: 1.0,
      });
    }

    // Dim non-matches
    for (const nodeId of this.renderer.getAllNodeIds()) {
      if (!matchIds.has(nodeId)) {
        this.dimmedNodes.add(nodeId);
        this.renderer.setNodeStyle(nodeId, {
          scale: 0.8,
          glowIntensity: 0,
          opacity: 0.3,
        });
      }
    }
  }

  focusOnResults(searchResult: SearchResult): void {
    if (searchResult.matches.length === 0) return;

    // Calculate bounding box of all matches
    const bounds = this.calculateBounds(
      searchResult.matches.map(m => m.node)
    );

    // Animate viewport to fit all matches
    this.renderer.animateViewportTo(bounds, 500);
  }

  navigateToResult(index: number, results: SearchResult): void {
    const match = results.matches[index];
    if (!match) return;

    // Center on specific result
    this.renderer.animateViewportTo(
      { x: match.node.x, y: match.node.y, zoom: 1.5 },
      300
    );

    // Pulse effect on target node
    this.renderer.pulseNode(match.nodeId, 3);
  }
}
```

### Search Panel UI (Issue #1181)

```typescript
// SearchPanel.tsx
export const SearchPanel: React.FC<SearchPanelProps> = ({
  onSearch,
  results,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.matches.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        onNavigate(selectedIndex);
        break;
    }
  };

  return (
    <div className="graph-search-panel">
      <input
        type="text"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          onSearch(e.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search nodes..."
        className="graph-search-input"
      />

      {results.totalCount > 0 && (
        <div className="graph-search-results">
          <div className="result-count">
            {results.totalCount} results
          </div>
          <ul>
            {results.matches.slice(0, 10).map((match, i) => (
              <li
                key={match.nodeId}
                className={i === selectedIndex ? 'selected' : ''}
                onClick={() => onNavigate(i)}
              >
                <span className="node-type">{match.node.types[0]}</span>
                <span className="node-label">{match.node.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+F` | Open search panel |
| `↓/↑` | Navigate results |
| `Enter` | Go to selected |
| `Escape` | Close panel, clear highlight |
| `Ctrl+G` | Next result |
| `Ctrl+Shift+G` | Previous result |

**Reference**: Issue #1181 - Search and highlight nodes (172 steps)

---

## Path Finding Pattern

**When to use**: Finding and visualizing paths between nodes in a knowledge graph

### Pattern Description

Implement multiple path-finding algorithms with visual feedback for exploring relationships.

### Path Finder (Issue #1182)

```typescript
// PathFinder.ts
export class PathFinder {
  private nodes: Map<string, GraphNode>;
  private edges: GraphEdge[];
  private adjacencyList: Map<string, Set<string>>;

  constructor(nodes: Map<string, GraphNode>, edges: GraphEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.adjacencyList = this.buildAdjacencyList();
  }

  // BFS for shortest path
  findShortestPath(sourceId: string, targetId: string): PathResult {
    const visited = new Set<string>();
    const queue: { nodeId: string; path: string[] }[] = [
      { nodeId: sourceId, path: [sourceId] }
    ];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === targetId) {
        return {
          found: true,
          path,
          edges: this.getEdgesForPath(path),
          length: path.length - 1,
        };
      }

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const neighbors = this.adjacencyList.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push({
            nodeId: neighborId,
            path: [...path, neighborId],
          });
        }
      }
    }

    return { found: false, path: [], edges: [], length: -1 };
  }

  // Find all paths up to maxLength
  findAllPaths(
    sourceId: string,
    targetId: string,
    maxLength: number = 5
  ): PathResult[] {
    const results: PathResult[] = [];

    const dfs = (current: string, path: string[], visited: Set<string>) => {
      if (path.length > maxLength + 1) return;

      if (current === targetId && path.length > 1) {
        results.push({
          found: true,
          path: [...path],
          edges: this.getEdgesForPath(path),
          length: path.length - 1,
        });
        return;
      }

      const neighbors = this.adjacencyList.get(current) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          path.push(neighborId);
          dfs(neighborId, path, visited);
          path.pop();
          visited.delete(neighborId);
        }
      }
    };

    const visited = new Set<string>([sourceId]);
    dfs(sourceId, [sourceId], visited);

    return results.sort((a, b) => a.length - b.length);
  }

  // Find paths through specific edge type
  findPathByEdgeType(
    sourceId: string,
    targetId: string,
    edgeType: string
  ): PathResult {
    const filteredEdges = this.edges.filter(e => e.predicate === edgeType);
    const filteredAdjacency = this.buildAdjacencyList(filteredEdges);

    // BFS with filtered edges
    const visited = new Set<string>();
    const queue: { nodeId: string; path: string[] }[] = [
      { nodeId: sourceId, path: [sourceId] }
    ];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === targetId) {
        return {
          found: true,
          path,
          edges: this.getEdgesForPath(path, filteredEdges),
          length: path.length - 1,
          edgeType,
        };
      }

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const neighbors = filteredAdjacency.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push({
            nodeId: neighborId,
            path: [...path, neighborId],
          });
        }
      }
    }

    return { found: false, path: [], edges: [], length: -1 };
  }
}
```

### Path Visualization (Issue #1182)

```typescript
// PathVisualization.ts
export class PathVisualization {
  private renderer: PixiGraphRenderer;

  highlightPath(pathResult: PathResult): void {
    if (!pathResult.found) return;

    // Dim all nodes first
    this.renderer.dimAllNodes(0.2);

    // Highlight path nodes
    for (let i = 0; i < pathResult.path.length; i++) {
      const nodeId = pathResult.path[i];
      this.renderer.setNodeStyle(nodeId, {
        opacity: 1.0,
        scale: 1.0 + (0.1 * (pathResult.path.length - i)),  // Larger near source
        glowColor: this.getPathColor(i, pathResult.path.length),
      });
    }

    // Animate edges along path
    for (const edge of pathResult.edges) {
      this.renderer.animateEdge(edge.id, {
        color: '#00FF88',
        width: 3,
        dashOffset: 'animate',  // Moving dashes
      });
    }
  }

  animatePathFlow(pathResult: PathResult): void {
    if (!pathResult.found) return;

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex >= pathResult.path.length) {
        currentIndex = 0;
      }

      // Pulse current node
      const nodeId = pathResult.path[currentIndex];
      this.renderer.pulseNode(nodeId, 1);

      // Animate edge to next node
      if (currentIndex < pathResult.edges.length) {
        const edge = pathResult.edges[currentIndex];
        this.renderer.flashEdge(edge.id, '#FFFF00', 200);
      }

      currentIndex++;
    }, 500);

    return () => clearInterval(interval);
  }
}
```

### Path Finding Panel (Issue #1182)

```tsx
// PathFindingPanel.tsx
export const PathFindingPanel: React.FC<Props> = ({
  nodes,
  onPathFound,
}) => {
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [paths, setPaths] = useState<PathResult[]>([]);
  const [selectedPath, setSelectedPath] = useState(0);

  const handleFindPath = () => {
    if (!source || !target) return;

    const pathFinder = new PathFinder(nodes, edges);
    const allPaths = pathFinder.findAllPaths(source, target, 5);
    setPaths(allPaths);

    if (allPaths.length > 0) {
      onPathFound(allPaths[0]);
    }
  };

  return (
    <div className="path-finding-panel">
      <div className="node-selectors">
        <NodeSelector
          label="From"
          value={source}
          onChange={setSource}
          nodes={nodes}
        />
        <NodeSelector
          label="To"
          value={target}
          onChange={setTarget}
          nodes={nodes}
        />
      </div>

      <button onClick={handleFindPath} disabled={!source || !target}>
        Find Paths
      </button>

      {paths.length > 0 && (
        <div className="path-results">
          <h4>{paths.length} paths found</h4>
          <ul>
            {paths.map((path, i) => (
              <li
                key={i}
                className={i === selectedPath ? 'selected' : ''}
                onClick={() => {
                  setSelectedPath(i);
                  onPathFound(path);
                }}
              >
                <span className="path-length">{path.length} hops</span>
                <span className="path-preview">
                  {path.path.slice(0, 3).map(id =>
                    nodes.get(id)?.label
                  ).join(' → ')}
                  {path.path.length > 3 && ' ...'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
```

**Reference**: Issue #1182 - Path finding between nodes (106 steps)
## Web Worker Security Pattern

**When to use**: Handling `postMessage` events in Web Workers

### Problem: Missing Origin Verification (CodeQL: js/missing-origin-check)

Web Workers receiving messages via `postMessage` must verify the message origin to prevent cross-origin attacks.

```typescript
// ❌ VULNERABLE: No origin verification
self.onmessage = (event: MessageEvent) => {
  const { type, data } = event.data;
  processCommand(type, data);
};

// ❌ STILL VULNERABLE: Checking origin but not acting on it
self.onmessage = (event: MessageEvent) => {
  console.log('Origin:', event.origin);  // Just logging, not blocking
  const { type, data } = event.data;
  processCommand(type, data);
};
```

### Solution: Validate Origin Before Processing

```typescript
// ✅ SECURE: Explicit origin check with early return
self.onmessage = (event: MessageEvent) => {
  // Workers loaded from same origin receive empty string as origin
  // Trust only same-origin or explicitly allowed origins
  if (event.origin !== '' && event.origin !== self.location.origin) {
    console.warn(`Rejected message from untrusted origin: ${event.origin}`);
    return;  // Early return - don't process message
  }

  const { type, data } = event.data;
  processCommand(type, data);
};

// ✅ ALTERNATIVE: Whitelist approach for specific origins
const TRUSTED_ORIGINS = new Set([
  '',  // Same-origin workers
  'https://trusted-domain.com',
]);

self.onmessage = (event: MessageEvent) => {
  if (!TRUSTED_ORIGINS.has(event.origin)) {
    return;  // Silently reject untrusted origins
  }
  processCommand(event.data);
};
```

### Key Insights

1. **Web Workers from same origin**: `event.origin` is empty string `''`, not `null` or `undefined`
2. **Must act on the check**: CodeQL flags code that reads `origin` but doesn't conditionally block
3. **Early return pattern**: Return immediately if origin check fails
4. **Logging optional**: Can log rejected origins for debugging, but must still block processing

### Real-World Example (Issues #1211, #1248)

```typescript
// physics.worker.ts - Before fix
self.onmessage = (event: MessageEvent) => {
  const { type, nodes, edges } = event.data;
  switch (type) {
    case 'init': initPhysics(nodes, edges); break;
    case 'tick': runSimulationTick(); break;
  }
};

// physics.worker.ts - After fix (PR #1211)
self.onmessage = (event: MessageEvent) => {
  if (event.origin !== '' && event.origin !== self.location.origin) {
    console.warn(`Untrusted origin rejected: ${event.origin}`);
    return;
  }

  const { type, nodes, edges } = event.data;
  switch (type) {
    case 'init': initPhysics(nodes, edges); break;
    case 'tick': runSimulationTick(); break;
  }
};
```

### Reference

- Issues #1211, #1248: P1 Missing origin verification in physics.worker.ts
- CodeQL alert: `js/missing-origin-check`

---

## Remote Property Injection Prevention Pattern

**When to use**: Accessing object properties with dynamic/external keys

### Problem: Remote Property Injection (CodeQL: js/remote-property-injection)

Using external input as object property keys can lead to prototype pollution or unauthorized property access.

```typescript
// ❌ VULNERABLE: Direct use of external key
function getNodeProperty(node: GraphNode, propertyKey: string): unknown {
  return node[propertyKey];  // Attacker could use '__proto__', 'constructor', etc.
}

// ❌ VULNERABLE: No validation of message property access
function handleMessage(event: MessageEvent) {
  const { action, propertyName, value } = event.data;
  if (action === 'update') {
    state[propertyName] = value;  // Prototype pollution possible
  }
}
```

### Solution: Validate Property Keys with Allowlist

```typescript
// ✅ SECURE: Whitelist of allowed properties
const ALLOWED_NODE_PROPERTIES = new Set([
  'x', 'y', 'vx', 'vy', 'fx', 'fy',
  'radius', 'mass', 'charge'
]);

function getNodeProperty(node: GraphNode, propertyKey: string): unknown {
  if (!ALLOWED_NODE_PROPERTIES.has(propertyKey)) {
    throw new Error(`Invalid property: ${propertyKey}`);
  }
  return node[propertyKey];
}

// ✅ SECURE: Object.hasOwn() check + blocklist
const BLOCKED_PROPERTIES = new Set([
  '__proto__', 'constructor', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__'
]);

function safePropertyAccess(obj: object, key: string): unknown {
  if (BLOCKED_PROPERTIES.has(key)) {
    return undefined;
  }
  if (!Object.hasOwn(obj, key)) {
    return undefined;
  }
  return obj[key as keyof typeof obj];
}
```

### Message Handler Pattern with Type Safety

```typescript
// ✅ SECURE: Type-safe message handling with discriminated unions
interface PhysicsMessage {
  type: 'init' | 'tick' | 'update' | 'reset';
  payload?: unknown;
}

interface UpdatePayload {
  nodeId: string;
  property: 'x' | 'y' | 'vx' | 'vy';  // Only allowed properties
  value: number;
}

function handleMessage(event: MessageEvent<PhysicsMessage>) {
  // Origin check first (see Web Worker Security Pattern)
  if (event.origin !== '') return;

  const { type, payload } = event.data;

  switch (type) {
    case 'update': {
      const { nodeId, property, value } = payload as UpdatePayload;
      // TypeScript ensures property is one of allowed values
      updateNode(nodeId, property, value);
      break;
    }
    // ... other cases
  }
}
```

### Real-World Example (Issues #1212, #1244)

```typescript
// physics.worker.ts - Before fix
function applyForce(nodeId: string, forceType: string, value: number) {
  const node = nodes.get(nodeId);
  if (node) {
    node[forceType] = value;  // Could write to any property
  }
}

// physics.worker.ts - After fix (PR #1212)
type ForceProperty = 'fx' | 'fy';  // Only allowed force properties

function applyForce(nodeId: string, forceType: ForceProperty, value: number) {
  const node = nodes.get(nodeId);
  if (node && (forceType === 'fx' || forceType === 'fy')) {
    node[forceType] = value;
  }
}
```

### Reference

- Issues #1212, #1244: P0 Remote property injection in physics.worker.ts
- CodeQL alert: `js/remote-property-injection`

---

## Graph Performance Optimization Patterns

**When implementing high-performance graph visualization systems (10K+ nodes):**

### Level of Detail (LOD) System (#1186)

Render nodes at different detail levels based on zoom and importance.

```typescript
interface LODLevel {
  minZoom: number;
  maxZoom: number;
  nodeRadius: (baseRadius: number) => number;
  showLabel: boolean;
  showEdges: boolean;
  edgeWidth: number;
}

const LOD_LEVELS: LODLevel[] = [
  { minZoom: 0, maxZoom: 0.1, nodeRadius: r => 2, showLabel: false, showEdges: false, edgeWidth: 0.5 },
  { minZoom: 0.1, maxZoom: 0.5, nodeRadius: r => r * 0.5, showLabel: false, showEdges: true, edgeWidth: 1 },
  { minZoom: 0.5, maxZoom: 2, nodeRadius: r => r, showLabel: true, showEdges: true, edgeWidth: 2 },
  { minZoom: 2, maxZoom: Infinity, nodeRadius: r => r * 1.5, showLabel: true, showEdges: true, edgeWidth: 3 },
];

function getLODLevel(zoom: number): LODLevel {
  return LOD_LEVELS.find(l => zoom >= l.minZoom && zoom < l.maxZoom)!;
}
```

**Benefits**:
- Zoomed out: Fast rendering, show only essential structure
- Zoomed in: Full detail for focused nodes
- Smooth transitions between levels

### Streaming Graph Data (#1187)

Load large graphs progressively without blocking UI.

```typescript
async function* streamGraphData(
  source: AsyncIterable<Triple>,
  batchSize: number = 1000
): AsyncGenerator<GraphBatch> {
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  for await (const triple of source) {
    // Convert triple to nodes/edges
    const { sourceNode, edge, targetNode } = tripleToGraphElements(triple);
    nodes.push(sourceNode, targetNode);
    edges.push(edge);

    if (nodes.length >= batchSize) {
      yield { nodes, edges };
      nodes = [];
      edges = [];
    }
  }

  if (nodes.length > 0) {
    yield { nodes, edges };
  }
}

// Usage with progressive rendering
async function loadGraphProgressively(source: AsyncIterable<Triple>) {
  for await (const batch of streamGraphData(source)) {
    renderer.addNodes(batch.nodes);
    renderer.addEdges(batch.edges);
    await new Promise(r => requestAnimationFrame(r)); // Allow render
  }
}
```

**Key insights**:
- **Batch size tuning**: 1000 items balances memory vs progress granularity
- **requestAnimationFrame yielding**: Prevents UI freeze during loading
- **Deduplication**: Use Map/Set to avoid duplicate nodes from multiple edges

### WebGPU Physics Offloading (#1184)

Use GPU compute shaders for force-directed layout physics.

```typescript
// Fallback strategy when WebGPU unavailable
class PhysicsEngine {
  private useGPU: boolean;
  private gpuCompute: GPUComputeEngine | null = null;
  private cpuWorker: Worker | null = null;

  async initialize(): Promise<void> {
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.gpuCompute = new GPUComputeEngine(adapter);
          this.useGPU = true;
          return;
        }
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to CPU');
      }
    }

    // Fallback to Web Worker CPU physics
    this.cpuWorker = new Worker('physics.worker.js');
    this.useGPU = false;
  }

  runTick(nodes: Float32Array): Float32Array {
    if (this.useGPU && this.gpuCompute) {
      return this.gpuCompute.computeForces(nodes);
    } else {
      return this.cpuWorker!.computeForces(nodes);
    }
  }
}
```

**Key patterns**:
- **Feature detection**: Check `navigator.gpu` before using WebGPU
- **Graceful fallback**: Web Worker CPU implementation as backup
- **TypedArrays**: Use Float32Array for efficient GPU data transfer

### Reference

- Issue #1184: WebGPU compute shaders (97 steps)
- Issue #1186: Level of Detail system (117 steps)
- Issue #1187: Streaming graph data (98 steps)

---

## Small UI Enhancement Pattern

**When to use**: Quick visual improvements (color changes, spacing, icons)

### Pattern Description

Small UI changes are low-risk, high-value improvements that can be implemented in <60 minutes with high confidence of first-time CI success.

### Checklist for Small UI Changes

```bash
# 1. Identify affected component
rg -i "button|create task" packages/obsidian-plugin/src --type tsx -l

# 2. Check existing design system
cat packages/obsidian-plugin/src/styles/variables.css
rg "color|green|primary" packages/obsidian-plugin/src/styles/

# 3. Apply change (inline or CSS class)
# 4. Verify accessibility (contrast ratio)
# 5. Test in light/dark themes
```

### WCAG Accessibility Requirements

```typescript
// Minimum contrast ratios
const WCAG_AA_NORMAL = 4.5;   // Normal text
const WCAG_AA_LARGE = 3.0;    // Large text (>18px or >14px bold)
const WCAG_AAA = 7.0;         // Enhanced compliance

// Recommended green button colors (meet WCAG AA)
const GREEN_BUTTON = {
  background: '#10b981',  // Tailwind green-500
  text: 'white',          // Contrast ratio: 5.8:1 ✓
  hover: '#059669',       // Tailwind green-600
  active: '#047857',      // Tailwind green-700
};
```

### CSS Example

```css
.btn-create-task {
  background-color: #10b981;
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-create-task:hover {
  background-color: #059669;
}

.btn-create-task:active {
  background-color: #047857;
}

/* Dark theme compatibility */
.theme-dark .btn-create-task {
  /* Same colors work in dark mode due to good contrast */
}
```

### Real-World Example: Green Button (#1242)

**Task**: Make "Create Task" button green
**Time**: 51 steps (~45 minutes)
**Risk**: Low (CSS-only change)

**Steps**:
1. Located button in `TaskCreationModal.tsx`
2. Added CSS class `.btn-create-task`
3. Verified contrast ratio (5.8:1 > 4.5:1 minimum)
4. Tested in light and dark themes
5. PR merged same day

### Reference

- Issue #1242: Make Create Task button green (PR #1242, 51 steps)

---

## Duplicate Code Scanning Alert Pattern

**When to use**: Handling duplicate code scanning alerts for the same vulnerability

### Problem: Same Alert Appears Multiple Times

Code scanning sometimes generates duplicate alerts for the same issue:
- Alert created at line N
- Code changes shift the alert to line M
- Both alerts remain open until both are fixed

### Detection

```bash
# Check for duplicate alerts by file + rule
gh api repos/OWNER/REPO/code-scanning/alerts --jq '
  .[] | select(.state == "open") |
  {rule: .rule.id, file: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}
' | sort | uniq -c | sort -rn | head -10
```

### Resolution Strategy

1. **Fix once, verify twice**: Apply fix at current location, check if it closes both alerts
2. **Monitor after fix**: Wait for next code scanning run to confirm closure
3. **Combine in single PR**: If truly duplicate, one fix should close both

### Real-World Example (December 2025)

| Original Issue | Duplicate Issue | Alert | Resolution |
|---------------|-----------------|-------|------------|
| #1211 | #1248 | js/missing-origin-check | Single fix closed both |
| #1212 | #1244 | js/remote-property-injection | Line shift, same fix |

**Timeline**:
- #1211 created 08:XX → fixed at line 72
- #1248 created 16:XX → same file, line shifted to 72
- PR #1211 merged → both alerts closed

### Prevention

- **Close duplicates early**: If you see duplicate issues for same file/rule, close the newer one as duplicate
- **Reference original**: Add comment "Duplicate of #XXXX" when closing
- **Monitor alert dashboard**: Check code scanning after each merge

### Reference

- Issues #1211/#1248: Duplicate origin check alerts
- Issues #1212/#1244: Duplicate property injection alerts

---

## Semantic Multi-Hop Query Pattern

**When to use**: Implementing graph exploration with configurable hop depth

### Pattern Description

Allow users to explore neighborhood of a node with configurable depth (1-hop, 2-hop, n-hop).

### Implementation

```typescript
interface ExplorationOptions {
  startNode: string;
  maxHops: number;
  direction: 'outgoing' | 'incoming' | 'both';
  predicateFilter?: string[];  // Only follow these predicates
  maxNodes?: number;           // Limit total results
}

async function exploreNeighborhood(
  store: TripleStore,
  options: ExplorationOptions
): Promise<GraphNode[]> {
  const visited = new Set<string>();
  const toVisit: Array<{nodeId: string, depth: number}> = [
    { nodeId: options.startNode, depth: 0 }
  ];
  const results: GraphNode[] = [];

  while (toVisit.length > 0) {
    const { nodeId, depth } = toVisit.shift()!;

    if (visited.has(nodeId) || depth > options.maxHops) continue;
    if (options.maxNodes && results.length >= options.maxNodes) break;

    visited.add(nodeId);
    const node = await store.getNode(nodeId);
    if (node) results.push(node);

    if (depth < options.maxHops) {
      const neighbors = await getNeighbors(store, nodeId, options);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          toVisit.push({ nodeId: neighbor, depth: depth + 1 });
        }
      }
    }
  }

  return results;
}

async function getNeighbors(
  store: TripleStore,
  nodeId: string,
  options: ExplorationOptions
): Promise<string[]> {
  const neighbors: string[] = [];

  if (options.direction !== 'incoming') {
    const outgoing = await store.query(
      `SELECT ?o WHERE { <${nodeId}> ?p ?o . FILTER(isIRI(?o)) }`
    );
    neighbors.push(...outgoing.map(r => r.o));
  }

  if (options.direction !== 'outgoing') {
    const incoming = await store.query(
      `SELECT ?s WHERE { ?s ?p <${nodeId}> . FILTER(isIRI(?s)) }`
    );
    neighbors.push(...incoming.map(r => r.s));
  }

  if (options.predicateFilter?.length) {
    // Additional filtering by predicate type
    return neighbors.filter(n => /* check predicate */);
  }

  return neighbors;
}
```

### UI Integration

```typescript
// React component for hop selector
const HopSelector: React.FC<{
  value: number;
  onChange: (hops: number) => void;
}> = ({ value, onChange }) => (
  <div className="hop-selector">
    <label>Exploration Depth:</label>
    <select value={value} onChange={e => onChange(parseInt(e.target.value))}>
      <option value={1}>1 hop (direct connections)</option>
      <option value={2}>2 hops (friends of friends)</option>
      <option value={3}>3 hops</option>
      <option value={5}>5 hops (warning: may be slow)</option>
    </select>
  </div>
);
```

### Performance Considerations

- **Exponential growth**: Each hop can multiply node count by average degree
- **Limit results**: Always set `maxNodes` to prevent memory issues
- **Progressive loading**: Stream results as they're discovered
- **Cache visited**: Use Set for O(1) visited lookup

### Reference

- Issue #1183: Neighborhood exploration multi-hop (120 steps)

---

## Physics Worker Architecture Pattern

**When to use**: Offloading heavy computation to Web Worker

### Pattern Description

The physics.worker.ts file handles force-directed graph layout simulation off the main thread.

### Architecture

```
Main Thread                           Worker Thread
-----------                           -------------
GraphRenderer                         physics.worker.ts
    │                                      │
    ├─── postMessage({type: 'init'}) ───►  │
    │                                      ├── Initialize simulation
    │                                      │
    ├─── postMessage({type: 'tick'}) ───►  │
    │                                      ├── Calculate forces
    │                                      ├── Update positions
    │    ◄─── postMessage({positions}) ─── │
    │                                      │
    └── Update node positions              │
```

### Security Checklist for Workers

After analyzing Issues #1211, #1212, #1244, #1248, all related to physics.worker.ts:

```typescript
// ✅ REQUIRED: Origin verification
self.onmessage = (event: MessageEvent) => {
  if (event.origin !== '' && event.origin !== self.location.origin) {
    return;
  }
  // ... handle message
};

// ✅ REQUIRED: Type-safe message handling
interface WorkerMessage {
  type: 'init' | 'tick' | 'update' | 'stop';
  payload?: unknown;
}

// ✅ REQUIRED: Property access validation
type AllowedProperty = 'x' | 'y' | 'vx' | 'vy' | 'fx' | 'fy';
const ALLOWED_PROPERTIES = new Set<AllowedProperty>(['x', 'y', 'vx', 'vy', 'fx', 'fy']);

function updateNodeProperty(node: PhysicsNode, prop: string, value: number) {
  if (!ALLOWED_PROPERTIES.has(prop as AllowedProperty)) {
    throw new Error(`Invalid property: ${prop}`);
  }
  node[prop as AllowedProperty] = value;
}
```

### Reference

- Issues #1211, #1212, #1244, #1248: Security fixes for physics.worker.ts
- Issue #1184: WebGPU compute shaders (uses same worker pattern)

---

## Jest Hanging in CI Pattern

**When to use**: Debugging tests that pass but cause Jest to hang in CI

### Symptoms

- All tests complete successfully (225 test suites, 5000+ tests pass)
- Jest does not exit naturally after test completion
- `--forceExit` flag has no effect
- `--detectOpenHandles` doesn't identify the issue
- Tests timeout after CI timeout (e.g., 5 minutes) even though all tests finish in ~70 seconds

### Diagnosis Steps

1. **Isolate the file**: Run each test file individually to find the culprit
   ```bash
   npm test -- packages/obsidian-plugin/tests/unit/path/to/test.test.ts
   ```

2. **Check for hidden async**: Even pure synchronous code can cause hangs if:
   - Jest test environment has unresolved promises from setup
   - Module-level code creates timers/intervals (not in tests)
   - Mocks don't properly reset

3. **Workaround**: Skip file temporarily while investigating
   ```javascript
   // jest.config.js
   testPathIgnorePatterns: [
     "/path/to/hanging.test.ts",
   ],
   ```

### Solution Pattern

If the test file and implementation are both pure synchronous:

1. **Check module imports** - Some modules may have side effects
2. **Check jest.config.js** - Environment setup may be creating lingering handles
3. **Check beforeAll/afterAll** - Ensure proper cleanup
4. **Use `--runInBand`** - Sometimes parallel execution causes issues

### Reference

- Issue #1228: HierarchicalLayout.test.ts causes Jest to hang in CI
- Workaround: Skip via `testPathIgnorePatterns` until root cause identified

---

## Graph View High-Intensity Development Sprint Pattern

**When to use**: Intensive multi-day development of complex visualization features

### Context (December 2025 Graph View Sprint)

13 major issues completed in single day:
- 3D visualization (#1190, #1265, #1264)
- Animations (#1192)
- Edge bundling (#1191)
- Export functionality (#1193)
- Memory optimization (#1189)
- Accessibility (#1194)
- Documentation (#1195)
- Code scanning fixes (#1206, #1261)
- Feature enhancements (#1200)
- Bug fixes (#1228)

### Success Factors

1. **Issues with detailed specifications**: Each issue had:
   - Full TypeScript code templates
   - File structure planned
   - Test cases specified
   - Acceptance criteria

2. **Sequential related work**: 3D visualization issues (#1190, #1264, #1265) built on each other

3. **Clear priorities**: P1 security fixes (#1206, #1261) first, then features

4. **Parallel-safe architecture**: Worktree isolation prevented conflicts

### Metrics

| Metric | Value |
|--------|-------|
| Issues completed | 13 |
| Average steps per issue | 133 |
| Step range | 48 - 456 |
| Total PRs merged | 13 |
| Security fixes (P1) | 2 |

### Key Patterns Observed

1. **Issue-as-specification**: Detailed code templates in issues reduced implementation time by 50%+

2. **Build on previous work**: #1265 (SPARQLGraph3DView) built directly on #1264 (ViewMode) and #1190 (3D infrastructure)

3. **Fix blocking issues first**: #1228 (Jest hanging) blocked CI - fixed early to unblock pipeline

4. **Comprehensive accessibility last**: #1194 (456 steps) was most complex - benefits from stable codebase

### Anti-Patterns to Avoid

- Starting accessibility work before core features stabilize
- Skipping test fixes "for later" - blocks entire pipeline
- Implementing 3D features without infrastructure issues resolved first

### Reference

- Issues #1189-1195, #1200, #1206, #1228, #1261, #1264, #1265
- December 26, 2025 sprint

---

## Prototype-Pollution Prevention Pattern

**When to use**: Implementing deep object merge/spread utilities

### Problem

CodeQL detects `js/prototype-pollution-utility` when:
- Object merging functions accept arbitrary property paths
- Deep merge utilities don't validate property names
- User input can modify Object.prototype

### Vulnerable Code

```typescript
// ❌ VULNERABLE: Allows __proto__ or constructor pollution
function deepMerge(target: any, source: any): any {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```

### Safe Pattern

```typescript
// ✅ SAFE: Blocklist dangerous properties
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeMerge<T extends object>(target: T, source: Partial<T>): T {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue; // Skip dangerous keys
    }

    const sourceValue = source[key as keyof T];
    if (sourceValue !== undefined && sourceValue !== null) {
      if (typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
        (target as any)[key] = safeMerge(
          (target as any)[key] || {},
          sourceValue as object
        );
      } else {
        (target as any)[key] = sourceValue;
      }
    }
  }
  return target;
}
```

### Store Pattern (Zustand)

When using Zustand stores with partial updates:

```typescript
// ❌ VULNERABLE: Direct spread from user input
set((state) => ({
  ...state,
  config: { ...state.config, ...partialConfig }
}));

// ✅ SAFE: Validate properties before merging
const ALLOWED_CONFIG_KEYS = new Set(['theme', 'layout', 'zoom']);

function safeConfigUpdate(partial: Partial<GraphConfig>): Partial<GraphConfig> {
  const safe: Partial<GraphConfig> = {};
  for (const [key, value] of Object.entries(partial)) {
    if (ALLOWED_CONFIG_KEYS.has(key)) {
      safe[key as keyof GraphConfig] = value;
    }
  }
  return safe;
}

set((state) => ({
  ...state,
  config: { ...state.config, ...safeConfigUpdate(partialConfig) }
}));
```

### Locations Fixed

- `graphConfigStore/store.ts:60` - Layout config update
- `graphConfigStore/store.ts:87` - Theme config update

### Reference

- Issues #1206, #1261: P1 prototype-pollution fixes
- CodeQL rule: `js/prototype-pollution-utility`

---

## 3D Visualization Integration Pattern

**When to use**: Adding 3D modes to existing 2D visualization systems

### Phase 1: Infrastructure (#1190)

Create standalone 3D components:
- Scene3DManager (Three.js setup)
- ForceSimulation3D (physics)
- Node3D/Edge3D renderers

### Phase 2: ViewMode Extension (#1264)

1. **Extend type**:
   ```typescript
   type ViewMode = "table" | "list" | "graph" | "graph3d";
   ```

2. **Add UI option**:
   ```typescript
   const modes = [
     { value: "graph", label: "2D Graph", icon: "git-branch-plus" },
     { value: "graph3d", label: "3D Graph", icon: "box" },
   ];
   ```

3. **Create stub component first**:
   ```typescript
   export const SPARQLGraph3DViewStub: React.FC = () => (
     <div>3D Graph View (Coming Soon)</div>
   );
   ```

### Phase 3: Full Integration (#1265)

1. **Create wrapper component**:
   ```typescript
   export const SPARQLGraph3DView: React.FC<Props> = ({ triples, onAssetClick }) => {
     const containerRef = useRef<HTMLDivElement>(null);
     const sceneRef = useRef<Scene3DManager | null>(null);

     useEffect(() => {
       if (!containerRef.current) return;

       const manager = new Scene3DManager(containerRef.current, options);
       sceneRef.current = manager;

       // Convert data
       const { nodes, edges } = tripleToGraph3D(triples);
       manager.setData(nodes, edges);

       return () => manager.dispose();
     }, [triples]);

     return <div ref={containerRef} className="graph3d-container" />;
   };
   ```

2. **Handle data conversion**:
   ```typescript
   function tripleToGraph3D(triples: Triple[]): { nodes: Node3D[], edges: Edge3D[] } {
     const nodeMap = new Map<string, Node3D>();
     const edges: Edge3D[] = [];

     triples.forEach((triple, i) => {
       // Add subject/object as nodes (deduplicated via Map)
       // Add predicate as edge
     });

     return { nodes: Array.from(nodeMap.values()), edges };
   }
   ```

3. **WebGL cleanup on unmount** - Critical for memory management

### Gotchas

- **React StrictMode**: Scene3DManager must be idempotent (double-render safe)
- **Container ref null**: Guard with `if (!containerRef.current) return`
- **WebGL context loss**: Handle `webglcontextlost` event
- **Large graphs**: Defer to LOD/culling in performance issue

### Reference

- Issue #1190: 3D infrastructure (126 steps)
- Issue #1264: ViewMode extension (77 steps)
- Issue #1265: Full integration (82 steps)

---

## Animation System Architecture Pattern

**When to use**: Implementing smooth transitions in visualization components

### Core Components (Issue #1192)

1. **Animation primitive**:
   ```typescript
   class Animation {
     private config: AnimationConfig;
     private progress: number = 0;

     update(currentTime: number): boolean {
       const elapsed = currentTime - this.startTime;
       this.progress = this.config.easing(Math.min(1, elapsed / this.config.duration));
       this.config.onUpdate(this.progress);

       if (this.progress >= 1) {
         this.config.onComplete();
         return false; // Animation done
       }
       return true; // Continue
     }
   }
   ```

2. **Scheduler**:
   ```typescript
   class AnimationScheduler {
     private animations = new Set<Animation>();

     add(animation: Animation) {
       animation.start();
       this.animations.add(animation);
       this.ensureRunning();
     }

     private tick = () => {
       const now = performance.now();
       for (const anim of this.animations) {
         if (!anim.update(now)) {
           this.animations.delete(anim);
         }
       }
       if (this.animations.size > 0) {
         requestAnimationFrame(this.tick);
       }
     };
   }
   ```

3. **Easing functions**:
   ```typescript
   const Easing = {
     linear: (t) => t,
     easeOutCubic: (t) => (--t) * t * t + 1,
     easeOutBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
     spring: (t) => 1 - Math.cos(t * 4.5 * Math.PI) * Math.exp(-t * 6),
   };
   ```

### Layout Transition Pattern

```typescript
async transition(
  nodes: Node[],
  targetPositions: Map<string, {x: number, y: number}>,
  onUpdate: (nodeId: string, x: number, y: number) => void
): Promise<void> {
  // Partition & Animate
  const transitions = nodes
    .filter(n => targetPositions.has(n.id))
    .map(n => ({
      nodeId: n.id,
      from: { x: n.x, y: n.y },
      to: targetPositions.get(n.id)!
    }));

  // Staggered start for visual appeal
  transitions.forEach((t, i) => {
    const anim = new Animation({
      duration: 500,
      delay: i * 10, // 10ms stagger
      easing: Easing.easeOutCubic,
      onUpdate: (progress) => {
        const x = t.from.x + (t.to.x - t.from.x) * progress;
        const y = t.from.y + (t.to.y - t.from.y) * progress;
        onUpdate(t.nodeId, x, y);
      }
    });
    scheduler.add(anim);
  });
}
```

### Performance Requirements

- Animation overhead: < 1ms per frame
- Support 1000+ concurrent node animations
- No allocations during tick (pre-allocate)
- Cancel latency: < 16ms

### Reference

- Issue #1192: Smooth layout transitions and animations (249 steps)

---

## Object Pooling Pattern for Visualization

**When to use**: Reducing GC pressure in high-frequency rendering

### Poolable Interface (Issue #1189)

```typescript
interface Poolable {
  reset(): void;
  isInUse(): boolean;
  setInUse(inUse: boolean): void;
}

class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private inUse = new Set<T>();

  acquire(): T {
    if (this.pool.length > 0) {
      const item = this.pool.pop()!;
      item.setInUse(true);
      this.inUse.add(item);
      return item;
    }
    // Create new if pool exhausted (up to maxSize)
    const item = this.factory();
    item.setInUse(true);
    this.inUse.add(item);
    return item;
  }

  release(item: T): void {
    item.reset();
    item.setInUse(false);
    this.inUse.delete(item);
    this.pool.push(item);
  }
}
```

### Common Poolables

1. **Vector2/Vector3**: Temporary calculation results
2. **RenderBatch**: Vertex/index buffers for batched rendering
3. **Event objects**: Pooled interaction events

### Arena Allocator for Frame-Scope Data

```typescript
class ArenaAllocator {
  private buffer: ArrayBuffer;
  private offset = 0;

  allocFloat32(count: number): Float32Array {
    const byteOffset = this.alignOffset(4);
    this.offset = byteOffset + count * 4;
    return new Float32Array(this.buffer, byteOffset, count);
  }

  reset(): void {
    this.offset = 0; // Instant "deallocation"
  }
}
```

### Performance Targets

- Pool acquisition: < 100ns average
- Pool release: < 50ns average
- Zero GC during normal interaction

### Reference

- Issue #1189: Memory optimization and object pooling (76 steps)

---

## WCAG Accessibility Implementation Pattern

**When to use**: Adding screen reader and keyboard support to visualization

### Core Components (Issue #1194)

1. **Live Region for Announcements**:
   ```typescript
   class AccessibilityManager {
     private liveRegion: HTMLElement;

     constructor() {
       this.liveRegion = document.createElement('div');
       this.liveRegion.setAttribute('role', 'log');
       this.liveRegion.setAttribute('aria-live', 'polite');
       this.liveRegion.className = 'sr-only'; // Visually hidden
       document.body.appendChild(this.liveRegion);
     }

     announce(message: string): void {
       this.liveRegion.textContent = '';
       requestAnimationFrame(() => {
         this.liveRegion.textContent = message;
       });
     }
   }
   ```

2. **Virtual Cursor for Navigation**:
   ```typescript
   class VirtualCursor {
     private nodes: A11yNode[] = [];
     private currentIndex = -1;

     moveNext(): A11yNode | null {
       this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
       const node = this.nodes[this.currentIndex];
       this.a11y.announce(`${node.label}. ${node.type}. ${node.connectionCount} connections.`);
       return node;
     }
   }
   ```

3. **Keyboard Navigation**:
   ```typescript
   handleKeyDown(e: KeyboardEvent) {
     switch (e.key) {
       case 'ArrowRight':
       case 'ArrowDown':
         e.preventDefault();
         this.virtualCursor.moveNext();
         break;
       case 'Enter':
         e.preventDefault();
         this.onNodeSelect?.(this.virtualCursor.getCurrentNode()?.id);
         break;
     }
   }
   ```

4. **Reduced Motion Support**:
   ```typescript
   shouldReduceMotion(): boolean {
     return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   }

   getAnimationDuration(normal: number): number {
     return this.shouldReduceMotion() ? 0 : normal;
   }
   ```

### Focus Indicator

```typescript
class FocusIndicator {
  private graphics: PIXI.Graphics;

  show(x: number, y: number, radius: number): void {
    this.graphics.clear();
    this.graphics.circle(x, y, radius + 8);
    this.graphics.stroke({ width: 3, color: 0xffff00 }); // High contrast yellow
  }
}
```

### Checklist

- [ ] WCAG 2.1 AA compliance
- [ ] Screen reader support (VoiceOver, NVDA, JAWS)
- [ ] Full keyboard navigation
- [ ] High contrast mode
- [ ] Reduced motion support
- [ ] Focus indicators on interactive elements

### Reference

- Issue #1194: Accessibility (WCAG compliance, screen readers) (456 steps - most complex)

---

## Documentation Sprint Pattern

**When to use**: Creating documentation for multiple related features in a single development session

### Pattern Description

Documentation sprints leverage the **warm context** effect to rapidly create high-quality documentation for related subsystems. Unlike feature sprints, documentation sprints have lower risk (no code changes) and can be completed faster.

### Real-World Example (December 29, 2025)

7 documentation issues completed in ~5 hours:

| Issue | Feature | Steps | Lines Added | PR |
|-------|---------|-------|-------------|-----|
| #1310 | Graph export | 47 | +1463 | #1321 |
| #1311 | Edge bundling | 48 | +499 | #1322 |
| #1312 | Accessibility | 52 | +355 | #1323 |
| #1313 | Filter/search | 64 | +1134 | #1324 |
| #1314 | Path finding | 63 | +727 | #1325 |
| #1315 | Inference | 8 | +526 | #1326 |
| #1316 | Import fix | 6 | +3 | #1327 |

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

| Step Range | Count | Type |
|------------|-------|------|
| 1-10 | 2 | Quick fixes, small updates |
| 40-50 | 2 | Standard guide creation |
| 60-70 | 3 | Comprehensive guides with examples |

**Median**: 52 steps per documentation issue

### Anti-Patterns

- ❌ Writing docs without reading implementation first
- ❌ Creating docs without updating README.md
- ❌ Documenting unstable/WIP features (document after code stabilizes)
- ❌ Copying code examples without testing them

### Benefits vs Feature Sprints

| Metric | Feature Sprint | Documentation Sprint |
|--------|---------------|---------------------|
| Risk | Medium-High | Low |
| CI failures | Common | Rare (lint only) |
| Rollback needed | Sometimes | Never |
| User value | Delayed (requires release) | Immediate (docs published on merge) |
| Step count | 100-200 average | 50-70 average |

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

## Phased Feature Implementation Pattern

**When to use**: Implementing features that affect multiple parts of the UI (Properties, Body, etc.)

### Pattern Description

Break features into phases where each phase builds on the previous:

```
Phase 1: Core Service (e.g., AssetLinkRenderer)
    ↓
Phase 2: First UI Integration (e.g., Properties block)
    ↓
Phase 3: Extended UI Integration (e.g., Body content)
    ↓
Phase 4: Polish & Edge Cases
```

### Real-World Example: Asset Link Label Replacement (December 2025)

| Phase | Issue | Description | Steps |
|-------|-------|-------------|-------|
| 1 | #1333 | Properties block link replacement | 117 |
| 2 | #1334 | Body content link replacement | 77 |
| 3 | #1336 | Fix delete button regression | 63 |

**Total**: 257 steps across 3 issues for complete feature

### Why This Works

1. **Reusable service**: Phase 1 creates `AssetLinkRenderer` used by all subsequent phases
2. **Isolated testing**: Each phase can be tested independently
3. **Regression detection**: Phase 3 (#1336) caught regression from Phase 2
4. **Clear dependencies**: Issue descriptions explicitly state "depends on #XXXX"

### Issue Structure for Phased Features

```markdown
## Depends on:
- #1333 - Properties block link replacement (MUST be completed first)

## This issue provides:
- Shared service: AssetLinkRenderer
- Reusable pattern: formatAssetLink(uri) → "Label (Class)"
```

### Gotchas

- **Test after each phase**: Regressions appear in unexpected places (e.g., delete buttons)
- **Document dependencies explicitly**: Issue body should list what MUST be done first
- **Cache considerations**: Each phase may need cache warming/invalidation

### Reference

- Issues #1333, #1334, #1336 - Asset link label replacement (December 30, 2025)

---

## Body Link Indexing Pattern

**When to use**: Extracting relationships from markdown content (not just frontmatter)

### Pattern Description

Index wikilinks from markdown body content to enable complete graph analysis.

### Implementation

```typescript
class NoteToRDFConverter {
  async convert(note: Note): Promise<Triple[]> {
    const triples: Triple[] = [];

    // Existing: frontmatter properties
    triples.push(...this.convertFrontmatter(note));

    // NEW: body links
    triples.push(...this.extractBodyLinks(note));

    return triples;
  }

  private extractBodyLinks(note: Note): Triple[] {
    // Remove frontmatter
    const bodyContent = note.content.replace(/^---[\s\S]*?---/, '');

    // Extract wikilinks, handle aliases [[Target|Alias]]
    const wikilinks = bodyContent.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);

    const triples: Triple[] = [];
    for (const match of wikilinks) {
      const targetPath = this.resolveWikilink(match[1], note.path);
      if (targetPath) {
        triples.push({
          subject: note.uri,
          predicate: 'exo:Asset_relates',
          object: this.pathToUri(targetPath)
        });
      }
    }

    return triples;
  }
}
```

### Edge Cases to Handle

1. **Alias syntax**: `[[Target|Display Text]]` → extract "Target" only
2. **Code blocks**: Exclude wikilinks inside ``` or inline code
3. **Duplicate links**: Same link appears multiple times → deduplicate triples
4. **Invalid targets**: `[[Non-existent]]` → skip with warning

### Predicate Choice

- **`exo:Asset_relates`**: Simple, unified relationship queries
- **Alternative `exo:Asset_bodyLink`**: Distinguishes explicit (frontmatter) vs implicit (body) links

### Reference

- Issue #1329 - Index body links to RDF (December 30, 2025, 71 steps)

---

## UI Regression Detection Pattern

**When to use**: After modifying rendering logic that touches existing UI elements

### Pattern Description

When adding new rendering features (e.g., formatted labels), always verify existing UI elements still work.

### Regression Example: Delete Button Disappearance (#1336)

**Feature added**: Replace link text with `${label} (${class})` format
**Regression caused**: Delete button (×) for array property values disappeared

**Root cause**: Custom rendering logic replaced original element structure that included the delete button.

### Prevention Checklist

After modifying rendering logic:

```markdown
- [ ] Click existing buttons - do they still work?
- [ ] Hover over elements - do tooltips/actions appear?
- [ ] Test array values - can individual items be deleted?
- [ ] Test edit mode vs read mode - both work correctly?
- [ ] Check keyboard navigation - still accessible?
```

### Fix Pattern

When custom rendering hides native UI elements:

```typescript
// ❌ WRONG: Replacing entire element removes delete button
link.outerHTML = `<span>${formattedText}</span>`;

// ✅ CORRECT: Only modify text content, preserve structure
link.textContent = formattedText;
// OR: Append to existing structure
link.querySelector('.text-content').textContent = formattedText;
```

### Testing for Regressions

```typescript
describe('Array property values', () => {
  it('should show delete button on hover', async () => {
    const component = await mount(<PropertyValue value="[[Asset]]" />);
    await component.hover();
    await expect(component.locator('.delete-button')).toBeVisible();
  });

  it('should remove value when delete clicked', async () => {
    const onDelete = vi.fn();
    const component = await mount(<PropertyValue onDelete={onDelete} />);
    await component.locator('.delete-button').click();
    expect(onDelete).toHaveBeenCalled();
  });
});
```

### Reference

- Issue #1336 - Restore delete button after label formatting (December 30, 2025, 63 steps)

---

## Simple UI Enhancement Pattern

**When to use**: Small visual changes with clear requirements (colors, visibility, styling)

### Characteristics

- **Low step count**: 7-21 steps typical
- **Minimal research**: Changes are straightforward
- **Low risk**: Styling changes rarely break functionality
- **Quick wins**: High user value for low effort

### Real-World Examples (December 2025)

| Issue | Change | Steps | Time |
|-------|--------|-------|------|
| #1331 | Show button for all DailyNotes | 7 | ~15 min |
| #1339 | Make button green | 21 | ~30 min |

### Implementation Pattern

```typescript
// Before: Conditional visibility with date check
function shouldShowButton(asset: Asset): boolean {
  if (!asset.hasClass('pn__DailyNote')) return false;
  const date = extractDate(asset);
  return isToday(date) || isYesterday(date);  // ❌ Restrictive
}

// After: Simple class check
function shouldShowButton(asset: Asset): boolean {
  return asset.hasClass('pn__DailyNote');  // ✅ Always show for class
}
```

### CSS Pattern for Visual Enhancement

```css
/* Use CSS variables for theme compatibility */
.create-task-button.primary-action {
  background-color: var(--color-green-primary, #22c55e);
  color: var(--text-on-accent);
}

.create-task-button.primary-action:hover {
  background-color: var(--color-green-primary-hover, #16a34a);
}
```

### When to Use This Pattern

- Removing artificial restrictions (date-based visibility)
- Adding visual emphasis (colors, icons)
- Improving consistency (same button style across views)
- Quick UX wins requested by user

### When NOT to Use

- Changes require new logic or state management
- Feature affects data persistence
- Multiple components need coordinated changes

### Reference

- Issues #1331, #1339 - DailyNote button enhancements (December 30, 2025)

---

## Markdown Post-Processor Pattern

**When to use**: Transforming rendered markdown content (links, text, formatting)

### Pattern Description

Use Obsidian's markdown post-processor API to modify rendered content without affecting source.

### Implementation

```typescript
// In plugin main file
class ExocortexPlugin extends Plugin {
  async onload() {
    this.registerMarkdownPostProcessor(async (element, context) => {
      await this.processAssetLinks(element);
    });
  }

  private async processAssetLinks(element: HTMLElement): Promise<void> {
    // Find internal asset links
    const links = element.querySelectorAll('a[href^="obsidian://vault/"]');

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href');
      if (!href) continue;

      try {
        const formatted = await this.assetLinkRenderer.format(href);
        link.textContent = formatted;
      } catch (error) {
        console.warn('Failed to format asset link:', href, error);
        // Keep original text on error - graceful degradation
      }
    }
  }
}
```

### Key Considerations

1. **Post-processors run in reading mode only**: Edit mode shows raw markdown
2. **Async processing**: Use `await` for queries, but handle race conditions
3. **Error handling**: Never crash on bad links - log and continue
4. **Performance**: Cache results to avoid repeated queries

### Caching Strategy

```typescript
class AssetLinkCache {
  private cache = new Map<string, { label: string; timestamp: number }>();
  private TTL = 60000; // 1 minute

  async getFormatted(uri: string): Promise<string> {
    const cached = this.cache.get(uri);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.label;
    }

    const label = await this.fetchLabel(uri);
    this.cache.set(uri, { label, timestamp: Date.now() });
    return label;
  }
}
```

### Edge Cases

- **External links**: Only process `obsidian://vault/` URIs
- **Code blocks**: Post-processor shouldn't modify code examples
- **Many links**: Batch queries for notes with 50+ links
- **Missing metadata**: Fallback to filename when label unavailable

### Reference

- Issue #1334 - Body content link replacement (December 30, 2025, 77 steps)

---

## Spec-First Implementation Pattern

**When to use**: Implementing features that must conform to an approved specification

### Pattern Description

When implementing features based on external specifications (file formats, protocols, data schemas), always:
1. Read the specification FIRST (before writing any code)
2. Identify the STRICT allowlist of allowed properties/fields
3. Implement validation that REJECTS forbidden elements
4. Test compliance BEFORE implementing logic

### Real-World Example: Exo 0.0.3 File Format (Issues #1351, #1353, #1361)

**Problem**: Initial implementation (PR #1352) deviated from specification:
- Used `exo__metadataType` instead of `metadata`
- Added `localName`, `label`, `id` properties (forbidden)
- Included `datatype`, `language`, `direction` in body files (forbidden)

**Result**: Three sequential PRs needed to align with spec:
1. PR #1351 - Initial implementation (deviated from spec)
2. PR #1360 - First alignment fix (#1353)
3. PR #1363 - Second alignment fix (#1361)

**Total effort**: ~450 steps across 3 issues (vs estimated ~150 steps if spec-first)

### Correct Implementation Approach

```typescript
// Step 1: Define STRICT allowlist from specification
export const ALLOWED_PROPERTIES: Record<MetadataType, readonly string[]> = {
  namespace: ["metadata", "uri", "aliases"] as const,
  anchor: ["metadata", "uri", "aliases"] as const,
  blank_node: ["metadata", "uri", "aliases"] as const,
  statement: ["metadata", "subject", "predicate", "object", "aliases"] as const,
  body: ["metadata", "subject", "predicate", "aliases"] as const,
};

// Step 2: Validator REJECTS forbidden properties
export function validateFrontmatter(
  type: MetadataType,
  frontmatter: Record<string, unknown>
): ValidationResult {
  const allowed = new Set(ALLOWED_PROPERTIES[type]);

  for (const key of Object.keys(frontmatter)) {
    if (!allowed.has(key)) {
      return {
        valid: false,
        error: `Forbidden property "${key}". Allowed: ${Array.from(allowed).join(", ")}`
      };
    }
  }

  // Continue with required property validation...
  return { valid: true };
}
```

### Pre-Implementation Checklist

- [ ] **Read specification document** (located in vault, docs/, or external source)
- [ ] **Extract exact property names** (copy-paste, don't interpret)
- [ ] **Define ALLOWED_PROPERTIES constant** (strict allowlist)
- [ ] **Define REQUIRED_PROPERTIES constant** (minimum required)
- [ ] **Implement validator FIRST** (before any parsing logic)
- [ ] **Write rejection tests** (test that forbidden properties fail)
- [ ] **Verify interface names match spec** (metadata, not metadataType)

### Anti-Pattern: Implementation-First

```typescript
// ❌ WRONG: Adding properties "because they seem useful"
interface AnchorMetadata {
  metadata: "anchor";
  uri: string;
  localName: string;  // ❌ Not in spec - added for convenience
  label?: string;     // ❌ Not in spec - "makes sense"
}
```

### Why This Matters

- **Spec compliance**: External systems expect exact format
- **Migration burden**: Non-compliant files need migration
- **Trust**: Users expect documented format to work
- **Time**: Fix-then-fix-again costs 3x original effort

### Key Insight

**If specification says "ONLY these properties", treat everything else as FORBIDDEN, not optional.**

**Reference**: Issues #1351, #1353, #1361 - Exo 0.0.3 implementation (January 2026)

---

## Frontmatter Empty Array Handling Pattern

**When to use**: Processing frontmatter properties that may be empty arrays

### Problem: YAML Empty Array Duplication

When updating frontmatter, empty arrays can cause duplication:

```yaml
# Before rename operation
---
exo__Asset_uid: "test-uuid"
aliases: []
---

# After rename (BUG): Duplicate property!
---
exo__Asset_uid: "new-uuid"
aliases: []
aliases:
  - "new-alias"
---
```

### Root Cause

```typescript
// ❌ WRONG: Merge without handling empty arrays
async updateFrontmatter(file: TFile, updates: Record<string, any>) {
  const existing = await this.read(file);
  const merged = { ...existing, ...updates };
  // Empty array in `existing` survives, new value appends
  await this.write(file, merged);
}
```

### Solution: Normalize Empty Arrays

```typescript
// ✅ CORRECT: Clean frontmatter before merge
function cleanFrontmatter(fm: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(fm).filter(([_, value]) => {
      // Remove empty arrays
      if (Array.isArray(value) && value.length === 0) return false;
      // Remove null/undefined
      if (value === null || value === undefined) return false;
      return true;
    })
  );
}

async updateFrontmatter(file: TFile, updates: Record<string, any>) {
  const existing = await this.read(file);
  const cleaned = cleanFrontmatter(existing);
  const merged = { ...cleaned, ...updates };
  await this.write(file, merged);
}
```

### Alternative: Deep Merge with Override

```typescript
function mergeFrontmatter(
  existing: Record<string, any>,
  updates: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(existing), ...Object.keys(updates)]);

  for (const key of allKeys) {
    if (key in updates) {
      // Update takes precedence - use new value
      result[key] = updates[key];
    } else if (key in existing) {
      const value = existing[key];
      // Only keep non-empty arrays
      if (!Array.isArray(value) || value.length > 0) {
        result[key] = value;
      }
    }
  }

  return result;
}
```

### Test Cases to Cover

```typescript
describe("Frontmatter merge", () => {
  it("should not duplicate empty aliases property", async () => {
    const existing = { aliases: [], label: "Test" };
    const updates = { aliases: ["new-alias"] };
    const result = mergeFrontmatter(existing, updates);

    const aliasKeys = Object.keys(result).filter(k => k === "aliases");
    expect(aliasKeys.length).toBe(1);
    expect(result.aliases).toEqual(["new-alias"]);
  });

  it("should remove empty arrays when no update provided", () => {
    const existing = { aliases: [], label: "Test" };
    const updates = { label: "Updated" };
    const result = mergeFrontmatter(existing, updates);

    expect(result.aliases).toBeUndefined();
  });

  it("should preserve non-empty arrays", () => {
    const existing = { aliases: ["existing"], label: "Test" };
    const updates = { label: "Updated" };
    const result = mergeFrontmatter(existing, updates);

    expect(result.aliases).toEqual(["existing"]);
  });
});
```

### When This Applies

- **Rename commands**: Asset rename, UID rename
- **Property updates**: Any frontmatter modification
- **Import/migration**: Batch property changes
- **Any operation using spread operator on frontmatter**

**Reference**: Issue #1347 - Rename to UID duplicates empty aliases (January 2026, 55 steps)

---

## Regression Detection Pattern

**When to use**: Fixing bugs introduced by recent changes

### Pattern Description

When a bug is reported, first identify if it's a regression (worked before, broke after a recent change).

### Investigation Workflow

```bash
# 1. Find when the bug was introduced
git log --oneline --all -- "path/to/affected/file.ts" | head -20

# 2. Identify suspect commits
git show <commit-hash> --stat

# 3. Check if feature worked in previous version
git checkout <previous-commit>
npm run test -- affected.test.ts

# 4. Confirm regression
git checkout main
npm run test -- affected.test.ts  # Should fail
```

### Real-World Example: Link Text Duplication (Issue #1349)

**Symptom**: Properties block shows duplicated text like `Label UUID` instead of just `Label`

**Investigation**:
```bash
# Recent commits to PropertiesLinkPatch.ts
git log --oneline -5 -- src/presentation/properties/PropertiesLinkPatch.ts
# Found: commit 500b7b50 (#1338) added delete button preservation
```

**Root Cause**: New code preserved ALL child elements, including text wrapper spans:

```typescript
// ❌ BUGGY: Preserves text spans that shouldn't be re-appended
private setTextContentPreservingChildren(el: HTMLElement, text: string): void {
  const childElements: Element[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      childElements.push(node as Element);  // Preserves EVERYTHING
    }
  }
  el.textContent = text;
  childElements.forEach(child => el.appendChild(child));  // Duplicates text!
}
```

**Fix**: Filter to only preserve interactive elements:

```typescript
// ✅ FIXED: Only preserve buttons, not text wrappers
private setTextContentPreservingChildren(el: HTMLElement, text: string): void {
  const childElements: Element[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      // Only preserve interactive elements
      if (element.classList?.contains('multi-select-pill-remove-button') ||
          element.tagName === 'BUTTON' ||
          element.getAttribute('aria-label') === 'Remove') {
        childElements.push(element);
      }
    }
  }
  el.textContent = text;
  childElements.forEach(child => el.appendChild(child));
}
```

### Regression Test Pattern

Always add a regression test that would have caught the bug:

```typescript
describe("PropertiesLinkPatch", () => {
  it("should not duplicate text when Obsidian wraps in span", () => {
    // Setup: Simulate Obsidian's rendering with span wrapper
    const link = document.createElement("a");
    link.innerHTML = '<span class="link-text">UUID-123</span>';

    // Act: Apply label transformation
    patch.setTextContentPreservingChildren(link, "Display Label");

    // Assert: No duplication
    expect(link.textContent).toBe("Display Label");
    expect(link.textContent).not.toContain("UUID");
  });
});
```

### Regression PR Checklist

- [ ] Identified commit that introduced regression
- [ ] Documented root cause in PR description
- [ ] Added regression test that would have caught it
- [ ] Verified fix doesn't break the original feature (#1338)
- [ ] Cross-referenced original PR in commit message

**Reference**: Issue #1349 - Link text duplication regression from #1338 (January 2026, 39 steps)

---

## Iterative Spec Alignment Pattern

**When to use**: When initial implementation deviates from specification and requires multiple fixes

### Pattern Description

When specification compliance fails on first attempt, use iterative refinement with clear documentation of what was wrong and why.

### Real-World Example: Exo 0.0.3 (Issues #1353 → #1361)

**Timeline**:
1. **PR #1352**: Initial implementation (deviated significantly)
2. **Issue #1353** → **PR #1360**: First alignment (266 steps)
   - Changed `exo__metadataType` → `metadata`
   - Changed `exo__Statement_*` → `subject`, `predicate`, `object`
   - But still had `localName`, `label`, `datatype` errors
3. **Issue #1361** → **PR #1363**: Second alignment (101 steps)
   - Anchor: `localName` → `uri`
   - BlankNode: `id` → `uri`
   - Body: removed `datatype`, `language`, `direction`

**Key Insight**: Each fix revealed MORE deviations because the spec wasn't read as "strict allowlist"

### Preventing Iteration

**Before implementation:**
```typescript
// Create exhaustive test for EVERY forbidden property
const FORBIDDEN_PROPERTIES_BY_TYPE = {
  anchor: ["localName", "label", "id", "datatype", "language", "direction"],
  blank_node: ["localName", "label", "datatype", "language", "direction"],
  body: ["object", "datatype", "language", "direction"],
  // ... etc
};

describe("Strict allowlist validation", () => {
  for (const [type, forbidden] of Object.entries(FORBIDDEN_PROPERTIES_BY_TYPE)) {
    for (const prop of forbidden) {
      it(`should reject ${type} with forbidden property "${prop}"`, () => {
        const frontmatter = { metadata: type, uri: "test://", [prop]: "value" };
        expect(() => validate(frontmatter)).toThrow(`Forbidden property: ${prop}`);
      });
    }
  }
});
```

### Iteration Documentation

When iteration IS needed, document clearly:

```markdown
## Why This Follow-Up Is Needed

PR #1360 fixed primary issues but missed:
1. **Anchor**: Still used `localName` (spec says `uri`)
2. **Body**: Still had `datatype`/`language` (spec says none)

## What Spec Actually Says

> **ONLY these properties allowed:** metadata, uri, aliases, subject, predicate, object

This is a STRICT allowlist. NOTHING else is permitted.
```

### Anti-Pattern: Partial Fixes

```typescript
// ❌ WRONG: Fixing only what's obviously broken
if (prop === "exo__metadataType") {
  // Fix this one
} else {
  // Leave other deviations for "later"
}
```

### Correct Approach: Complete Audit

```typescript
// ✅ CORRECT: Check ALL properties against spec
const specAllowed = new Set(["metadata", "uri", "aliases", "subject", "predicate", "object"]);
const actual = Object.keys(currentImplementation.interface);

const violations = actual.filter(prop => !specAllowed.has(prop));
if (violations.length > 0) {
  throw new Error(`Spec violations found: ${violations.join(", ")}`);
}
```

### Metrics

| Approach | PRs Required | Total Steps | Time |
|----------|--------------|-------------|------|
| Spec-first (ideal) | 1 | ~150 | 2-3 hours |
| Iterative (actual) | 3 | ~450 | 8-10 hours |
| Overhead | +2 PRs | +300 steps | +6 hours |

**Reference**: Issues #1353, #1361 - Exo 0.0.3 iterative alignment (January 2026)

---

## Research-to-Decision Pattern

**When to use**: Evaluating options (libraries, models, architectures) before implementation

### Pattern Description

Research tasks should produce:
1. Clear comparison criteria
2. Benchmark methodology
3. Decision rationale
4. Documentation for future reference

### Real-World Example: Embedding Model Selection (Issue #1354)

**Task**: Select embedding model for semantic search

**Output Structure**:
```markdown
## docs/semantic-search/EMBEDDING-MODEL-SELECTION.md

### Evaluation Criteria
1. Privacy (local vs API-based)
2. Performance (inference speed)
3. Quality (semantic similarity accuracy)
4. Size (model file size, memory usage)

### Candidates Evaluated
| Model | Local | Speed | Quality | Size |
|-------|-------|-------|---------|------|
| all-MiniLM-L6-v2 | ✅ | Fast | Good | 22MB |
| bge-small-en | ✅ | Fast | Better | 33MB |
| nomic-embed-text | ✅ | Medium | Best | 274MB |
| OpenAI ada-002 | ❌ | Fast | Best | API |

### Decision
Selected: **nomic-embed-text**
- Reason: Best quality while remaining local
- Tradeoff: Larger size acceptable for quality gain

### Benchmark Framework
See BENCHMARK-FRAMEWORK.md for reproducible evaluation methodology.
```

### Research Task Deliverables

1. **Comparison table**: Side-by-side metrics
2. **Benchmark code**: Reproducible tests
3. **Decision document**: Why chosen option is best
4. **README**: Quick start for using selected solution

### Directory Structure

```
docs/{feature-name}/
├── README.md                     # Quick overview and usage
├── {TOPIC}-SELECTION.md          # Decision rationale
├── BENCHMARK-FRAMEWORK.md        # How to evaluate
└── examples/                     # Sample usage
```

### Research vs Implementation Time

| Phase | Effort | Value |
|-------|--------|-------|
| Research | 30% | High (prevents wrong choices) |
| Documentation | 20% | High (enables future decisions) |
| Implementation | 50% | Depends on research quality |

**Reference**: Issue #1354 - Embedding model research (January 2026, 59 steps)

---

## Semantic Physics Integration Pattern

**When to use**: Implementing physics-based layout algorithms that respond to semantic relationships

### Pattern Description

Force-directed layouts can be enhanced with "semantic physics" where RDF/OWL relationships influence force calculations.

### Core Interface

```typescript
interface SemanticForceConfig {
  predicate: string;
  attractionMultiplier: number;  // 1.0 = default
  repulsionMultiplier: number;   // 1.0 = default
}

const SEMANTIC_FORCES: SemanticForceConfig[] = [
  // Hierarchy: children cluster under parents
  { predicate: "rdfs:subClassOf", attractionMultiplier: 2.0, repulsionMultiplier: 0.5 },

  // Prototypes: instances near their templates
  { predicate: "exo:Asset_prototype", attractionMultiplier: 1.8, repulsionMultiplier: 0.6 },

  // Parts: components stay near containers
  { predicate: "dcterms:isPartOf", attractionMultiplier: 1.5, repulsionMultiplier: 0.8 },

  // Disjoint: incompatible concepts separate
  { predicate: "owl:disjointWith", attractionMultiplier: 0.3, repulsionMultiplier: 3.0 },
];
```

### Implementation

```typescript
class SemanticPhysicsEngine {
  constructor(private config: SemanticForceConfig[]) {}

  getForceModifier(edge: GraphEdge): { attraction: number; repulsion: number } {
    const config = this.config.find(c => c.predicate === edge.predicate);

    return config
      ? { attraction: config.attractionMultiplier, repulsion: config.repulsionMultiplier }
      : { attraction: 1.0, repulsion: 1.0 };  // Default: no modification
  }

  applyToForceLayout(layout: ForceDirectedLayout, edges: GraphEdge[]): void {
    for (const edge of edges) {
      const modifier = this.getForceModifier(edge);
      layout.setEdgeAttraction(edge.id, modifier.attraction);
      layout.setNodeRepulsion(edge.source, edge.target, modifier.repulsion);
    }
  }
}
```

### Edge Cases

1. **Circular hierarchies**: `rdfs:subClassOf` loops → cap recursion depth
2. **Conflicting forces**: Same edge has multiple predicates → use highest priority
3. **Performance**: Cache force modifiers per edge, don't recalculate each frame
4. **Extreme values**: Validate multipliers in range [0.1, 5.0] to prevent overlaps

### Testing

```typescript
describe("SemanticPhysicsEngine", () => {
  it("should cluster children under parents", () => {
    const engine = new SemanticPhysicsEngine(SEMANTIC_FORCES);
    const edge = { predicate: "rdfs:subClassOf", source: "child", target: "parent" };

    const modifier = engine.getForceModifier(edge);

    expect(modifier.attraction).toBe(2.0);
    expect(modifier.repulsion).toBe(0.5);
  });

  it("should separate disjoint classes", () => {
    const engine = new SemanticPhysicsEngine(SEMANTIC_FORCES);
    const edge = { predicate: "owl:disjointWith", source: "classA", target: "classB" };

    const modifier = engine.getForceModifier(edge);

    expect(modifier.repulsion).toBe(3.0);
  });
});
```

**Reference**: Issue #1345 - Semantic Physics implementation (January 2026, 292 steps)

---

## CLI Performance Cache Pattern

**When to use**: Optimizing CLI commands that repeatedly load expensive resources (vault parsing, triple store building, etc.)

### Pattern Description

When CLI commands need to load expensive resources (like a vault's triple store), implement a file-based cache that persists between invocations. This eliminates redundant I/O operations and dramatically speeds up sequential command execution.

### Problem Statement

```typescript
// BEFORE: Each CLI invocation reloads entire vault (500-800ms for 10k files)
const vaultAdapter = new FileSystemVaultAdapter(vaultPath);
const converter = new NoteToRDFConverter(vaultAdapter);
const triples = await converter.convertVault();  // ← 500-800ms every time
```

### Solution Architecture

```
CLI Command → CacheManager → [Cache Hit?]
                               ├─ YES → Load from cache (10-50ms)
                               └─ NO  → Build + Save cache (500-800ms)
```

### Implementation (Issue #2082)

```typescript
// packages/cli/src/cache/CacheManager.ts
interface CacheMetadata {
  version: string;           // CLI version for compatibility
  timestamp: number;         // Cache creation time
  vaultPath: string;         // Absolute path to vault
  tripleCount: number;       // Number of triples cached
}

interface CacheData {
  metadata: CacheMetadata;
  triples: Triple[];
}

export class CacheManager {
  private getCachePath(vaultPath: string): string {
    return join(vaultPath, ".exocortex", "cache", "triples.json");
  }

  async loadOrBuild(
    vaultPath: string,
    buildFn: () => Promise<Triple[]>
  ): Promise<Triple[]> {
    const cachePath = this.getCachePath(vaultPath);

    if (this.isCacheValid(vaultPath, cachePath)) {
      const data: CacheData = JSON.parse(readFileSync(cachePath, "utf-8"));
      return data.triples;
    }

    // Cache miss or invalid - build fresh
    const triples = await buildFn();
    this.saveCache(vaultPath, cachePath, triples);
    return triples;
  }

  private isCacheValid(vaultPath: string, cachePath: string): boolean {
    if (!existsSync(cachePath)) return false;

    const vaultMtime = statSync(vaultPath).mtimeMs;
    const cacheMtime = statSync(cachePath).mtimeMs;

    return cacheMtime > vaultMtime;  // Cache newer than vault
  }
}
```

### Command Integration

```typescript
// Add --use-cache option to existing commands
.option("--use-cache", "Use persistent cache (faster for repeated queries)")

// Usage
if (options.useCache) {
  triples = await cacheManager.loadOrBuild(vaultPath, async () => {
    return await converter.convertVault();
  });
} else {
  triples = await converter.convertVault();
}
```

### Cache Invalidation Strategies

| Strategy | Complexity | Accuracy | Use Case |
|----------|------------|----------|----------|
| **mtime-based** | Low | Medium | Default - fast checks, covers most changes |
| **content-hash** | High | High | When exact invalidation needed |
| **manual** | None | N/A | Add `--force-rebuild` option |

### Performance Results

| Metric | Before | After (cached) | Improvement |
|--------|--------|----------------|-------------|
| First query | 800ms | 800ms | N/A (cache build) |
| Second query | 800ms | 10ms | **80x faster** |
| 10 sequential queries | 8000ms | 890ms | **9x faster** |
| Validator workflow (15 queries) | 12s | 1.2s | **10x faster** |

### Cache Location Convention

```
<vault-path>/
└── .exocortex/
    └── cache/
        └── triples.json     # ~1.5x size of source markdown
```

**Why this location:**
- Vault-relative (portable across machines if vault moves)
- Hidden in `.exocortex/` (doesn't pollute vault)
- Can be gitignored if vault is version controlled

### Error Handling

```typescript
try {
  const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
  return cached.triples;
} catch (error) {
  // Corrupted cache - rebuild silently
  console.warn(`Cache corrupted, rebuilding: ${error.message}`);
  return await this.buildAndSave(vaultPath, buildFn);
}
```

### Testing Checklist

- [ ] `loadOrBuild()` returns triples from cache if valid
- [ ] `loadOrBuild()` rebuilds cache if vault modified
- [ ] `loadOrBuild()` rebuilds cache if cache file missing
- [ ] Cache metadata includes correct version, timestamp, tripleCount
- [ ] Corrupted JSON triggers rebuild (not crash)
- [ ] Directory created if `.exocortex/cache/` missing

**Reference**: Issue #2082, PR #2084 - SPARQL Vault Cache (100 steps, +973 lines, 80x speedup)

---

## Major Feature Removal Pattern

**When to use**: Removing large features/dependencies to reduce bundle size, complexity, or maintenance burden

### Pattern Description

Sometimes the best code is no code. Removing unused or experimental features can dramatically improve:
- Bundle size (faster installation)
- Build times
- Maintenance burden
- Code complexity

### Decision Framework

Before removing a feature, validate:

| Question | Threshold | Issue #2083 Result |
|----------|-----------|-------------------|
| Active users? | <5% of user base | 0% (experimental) |
| Bundle impact? | >20% of total size | 75% (1.5MB of 2.0MB) |
| Maintenance cost? | >10% of codebase | 8% (104 of ~1200 files) |
| Alternative exists? | External tool available | Yes (Obsidian Graph View) |

### Removal Checklist

#### Phase 1: Dependencies
```json
// package.json - BEFORE
{
  "dependencies": {
    "three": "^0.171.0",        // 1.3 MB
    "pixi.js": "^8.14.3",       // 0.2 MB
    "@types/three": "^0.171.0"
  }
}

// package.json - AFTER
{
  "dependencies": {
    // Removed: three, pixi.js, @types/three
  }
}
```

#### Phase 2: Source Code
```bash
# Delete entire feature directories (Issue #2083: 104 files)
rm -rf src/presentation/renderers/graph/
rm -rf src/presentation/stores/graphStore/
rm -rf src/presentation/stores/graphConfigStore/
rm -rf src/presentation/stores/physicsWorkerStore/
```

#### Phase 3: Integration Points
```typescript
// BEFORE: ViewModeSelector.tsx
type ViewMode = 'table' | 'graph' | 'raw';

// AFTER: ViewModeSelector.tsx
type ViewMode = 'table' | 'raw';
```

#### Phase 4: Tests
```bash
# Delete associated tests
rm -rf tests/unit/presentation/renderers/graph/
rm -rf tests/performance/ForceSimulation3DPerformance.test.ts
```

#### Phase 5: Settings
```typescript
// Remove from settings interface
interface ExocortexSettings {
  // graph3DEnabled: boolean;  // REMOVED
  // graphLayoutType: string;  // REMOVED
}
```

### Impact Metrics (Issue #2083)

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Bundle size | 2.0 MB | 0.5 MB | **-75%** |
| Source files | 1,200 | 1,096 | **-104 files** |
| Dependencies | 45 | 42 | **-3 packages** |
| Lines of code | ~180k | ~50k | **-129,442 lines** |
| BRAT install time | 23s | <10s | **-57%** |

### Follow-up Issues Pattern

Major removals often trigger follow-up work:

| Issue | Purpose | Steps |
|-------|---------|-------|
| #2086 | Main removal PR | 170 |
| #2087 | Fix coverage thresholds | 30 |
| #2088 | Update CI workflow | 25 |

**Budget 2-3 follow-up issues** for cleanup after major removals.

### Communication

**Breaking change documentation:**
```markdown
## Breaking Changes

The following features have been removed:
- 2D graph visualization of SPARQL results
- 3D graph visualization of SPARQL results
- Graph-related settings
- Graph export functionality

**Migration**: Users who need graph visualization should:
1. Stay on the previous version (v14.x), OR
2. Export SPARQL results and use external graph tools
```

### Rollback Plan

```bash
# If removal causes unexpected issues:
git revert <merge-commit-sha>
npm install
npm run build
# Verify restoration worked
npm run test:all
```

### When NOT to Remove

- Feature has active users (even if small %)
- No external alternative exists
- Removal would break API contracts
- Time investment to remove > maintenance burden

**Reference**: Issue #2083, PR #2086 - Remove Graph Visualization (170 steps, -129,442 lines, 75% bundle reduction)

---

## Wikilink Alias Handling Pattern

**When to use**: Parsing or modifying Obsidian wikilinks that may contain user-defined aliases (`[[uid|alias]]`)

### Pattern Description

Obsidian wikilinks support both bare references (`[[uuid]]`) and aliased references (`[[uuid|My Custom Name]]`). Code that processes wikilinks must:
1. Extract the UID/path correctly regardless of alias presence
2. Preserve user-defined aliases when appropriate
3. Apply automatic labels only to bare links without aliases

### UID Extraction from Wikilinks

**Problem**: Need to extract the target UID from wikilinks with optional aliases.

```typescript
// ❌ WRONG: Fails with aliased links
const uid = wikilinkValue.replace(/\[\[|\]\]/g, '');
// Input: "[[uuid|My Alias]]" → Output: "uuid|My Alias" (BROKEN)

// ✅ CORRECT: Extract only the UID part
function extractWikilinkTarget(wikilink: string): string {
  const match = wikilink.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return match ? match[1].trim() : wikilink;
}
// Input: "[[uuid|My Alias]]" → Output: "uuid" (CORRECT)
// Input: "[[uuid]]" → Output: "uuid" (CORRECT)
```

### Regex Breakdown

```
\[\[          - Match opening [[
([^\]|]+)     - Capture group 1: One or more chars that are NOT ] or |
(?:\|[^\]]+)? - Non-capturing optional group: | followed by alias text
\]\]          - Match closing ]]
```

### Preserving User Aliases in DOM Manipulation

**Problem**: Automatic label patching overwrites user-defined aliases.

**Solution**: Detect if user provided explicit alias before applying automatic labels.

```typescript
private patchLink(linkEl: HTMLElement): void {
  const dataHref = linkEl.getAttribute("data-href");
  if (!dataHref) return;

  const file = this.resolveFile(dataHref);
  if (!file) return;

  const displayName = this.getDisplayName(file);
  if (!displayName) return;

  // Detect user-defined alias
  const currentText = linkEl.textContent || "";
  const cleanedHref = dataHref.replace(/\.md$/, "").trim();

  // If textContent differs from both data-href AND basename, user provided alias
  const hasUserAlias = currentText !== cleanedHref && currentText !== file.basename;

  if (hasUserAlias) {
    // Preserve user alias - do NOT overwrite
    return;
  }

  // Apply automatic label resolution for bare links
  linkEl.textContent = displayName;
}
```

### Test Cases for Wikilink Parsing

```typescript
describe("extractWikilinkTarget", () => {
  it("extracts UID from bare wikilink", () => {
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog]]"))
      .toBe("ems__EffortStatusBacklog");
  });

  it("extracts UID from aliased wikilink (English)", () => {
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog|Backlog]]"))
      .toBe("ems__EffortStatusBacklog");
  });

  it("extracts UID from aliased wikilink (Russian)", () => {
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog|Беклог]]"))
      .toBe("ems__EffortStatusBacklog");
  });

  it("extracts UUID from aliased wikilink", () => {
    expect(extractWikilinkTarget("[[753a44d5-846c-4b82-9196-4fd9a4d48777|Custom Label]]"))
      .toBe("753a44d5-846c-4b82-9196-4fd9a4d48777");
  });

  it("returns original string for non-wikilink input", () => {
    expect(extractWikilinkTarget("plain text")).toBe("plain text");
  });
});
```

### Where This Pattern Applies

| Component | Purpose | Implementation |
|-----------|---------|----------------|
| StatusSelectPropertyField | Parse status for button rendering | Extract UID before comparison |
| BodyLinkPatch | Beautify links in note body | Preserve user aliases |
| PropertiesLinkPatch | Beautify links in Properties block | Preserve user aliases |
| LinkRenderer (SPARQL) | Render links in query results | Already handles aliases |

### Benefits

- **i18n Support**: Users can use localized aliases (Беклог, 待办事项, etc.)
- **Custom Labels**: Users control displayed text in specific contexts
- **Backward Compatible**: Bare links still get automatic labels

**Reference**: Issues #2097, #2098, PRs #2099, #2100 - Wikilink Alias Handling (February 2026)

---

## Idempotency Pattern for Sync Operations

**When to use**: Operations triggered by file modification events that may fire multiple times during Obsidian Sync

### Pattern Description

When Obsidian Sync replicates changes between devices, the `vault.on("modify")` event fires on the receiving device. If your plugin modifies files in response to `modify` events, this creates a feedback loop where changes get applied multiple times.

### Problem: Duplicate Operations During Sync

```
Device A: User changes plannedStartTimestamp
  → Plugin shifts plannedEndTimestamp (+4 hours)
  → File synced to Device B

Device B: Receives synced file
  → vault.on("modify") fires
  → Plugin shifts plannedEndTimestamp again (+4 hours) ← WRONG!
  → Total shift: +8 hours instead of +4 hours
```

### Solution: Idempotency Check Before Modification

**Option A: Track Previous Values in Cache**

```typescript
// Store the previous value when we make changes
const cachedState = new Map<string, string>();

async function handleModify(file: TFile): Promise<void> {
  const metadata = await this.loadMetadata(file);
  const currentStart = metadata.ems__Effort_plannedStartTimestamp;
  const currentEnd = metadata.ems__Effort_plannedEndTimestamp;

  const cacheKey = file.path;
  const cachedStart = cachedState.get(cacheKey + ':start');
  const cachedEnd = cachedState.get(cacheKey + ':end');

  // Skip if this is a sync event (end timestamp already matches expected shift)
  if (cachedStart && cachedEnd) {
    const expectedDelta = new Date(currentStart).getTime() - new Date(cachedStart).getTime();
    const actualEndDelta = new Date(currentEnd).getTime() - new Date(cachedEnd).getTime();

    // If end timestamp already shifted by the same delta, this is a sync - skip
    if (Math.abs(expectedDelta - actualEndDelta) < 1000) {
      // Update cache to current values
      cachedState.set(cacheKey + ':start', currentStart);
      cachedState.set(cacheKey + ':end', currentEnd);
      return; // Already applied - idempotent
    }
  }

  // Apply the shift (first-time or local change)
  const deltaMs = calculateDelta(cachedStart, currentStart);
  await this.shiftEndTimestamp(file, deltaMs);

  // Update cache
  cachedState.set(cacheKey + ':start', currentStart);
  cachedState.set(cacheKey + ':end', newEndTimestamp);
}
```

**Option B: Hash-Based Idempotency Token**

```typescript
// Store hash of the operation in frontmatter (persists across devices)
async function handleModify(file: TFile): Promise<void> {
  const metadata = await this.loadMetadata(file);
  const currentStart = metadata.ems__Effort_plannedStartTimestamp;
  const currentEnd = metadata.ems__Effort_plannedEndTimestamp;

  // Create hash of current state
  const stateHash = hash(`${currentStart}-${currentEnd}`);
  const lastOperationHash = metadata._lastTimestampOperationHash;

  if (stateHash === lastOperationHash) {
    // Operation already applied (idempotent check passed)
    return;
  }

  // Apply the shift
  const newEnd = await this.shiftEndTimestamp(file, deltaMs);

  // Store hash of new state to prevent re-application
  await this.updateFrontmatter(file, {
    _lastTimestampOperationHash: hash(`${currentStart}-${newEnd}`)
  });
}
```

### When to Apply Idempotency

| Scenario | Apply Idempotency | Reason |
|----------|-------------------|--------|
| Timestamp shift on property change | ✅ Yes | Sync causes duplicate events |
| Status change button click | ❌ No | User action, not event-driven |
| Cache refresh on file modify | ❌ No | Read-only operation |
| Automatic metadata correction | ✅ Yes | Could fire on sync |

### Testing Idempotency

```typescript
describe("Idempotency", () => {
  it("should apply shift exactly once for local changes", async () => {
    const file = createMockFile({ plannedStart: "10:00", plannedEnd: "11:00" });

    await plugin.handleModify(file);

    expect(file.metadata.plannedEnd).toBe("11:30"); // +30 min shift
  });

  it("should NOT apply shift on sync (second modify event)", async () => {
    const file = createMockFile({ plannedStart: "10:30", plannedEnd: "11:30" });

    // Simulate sync: same file arrives with shift already applied
    await plugin.handleModify(file);

    // Should remain unchanged (idempotent)
    expect(file.metadata.plannedEnd).toBe("11:30");
  });

  it("should handle 100 consecutive modify events without drift", async () => {
    const file = createMockFile({ plannedStart: "10:00", plannedEnd: "11:00" });

    // Simulate rapid sync events
    for (let i = 0; i < 100; i++) {
      await plugin.handleModify(file);
    }

    // Should shift only once
    expect(file.metadata.plannedEnd).toBe("11:30");
  });
});
```

### Benefits

- **Multi-device safety**: Same result regardless of sync order
- **No data corruption**: Operations don't accumulate errors
- **Debuggability**: Hash/cache makes state traceable

### Anti-Patterns to Avoid

- ❌ Relying on debounce alone (sync can be delayed)
- ❌ Using only in-memory cache (lost on restart)
- ❌ Comparing timestamps with millisecond precision (rounding errors)
- ❌ Skipping tests for sync scenarios

**Reference**: Issue #2095, PR #2096 - Idempotency for plannedEndTimestamp (50 steps, February 2026)

---

## Post-Removal Dependency Cleanup Pattern

**When to use**: After removing a major feature, clean up orphaned dependencies

### Pattern Description

When removing a large feature (like graph visualization), some dependencies become dead code. This pattern ensures complete cleanup of all orphaned packages.

### Implementation Workflow

```bash
# 1. Verify feature is fully removed (prerequisite)
test ! -f src/components/RemovedFeature.tsx || exit 1

# 2. Identify orphaned dependencies with ripgrep
rg "from ['\"]package-name['\"]" src/ --type ts
# If empty → package is orphaned

# 3. Remove each orphaned package
npm uninstall package-name @types/package-name

# 4. Rebuild and test
npm run build && npm run test:all

# 5. Measure bundle size reduction
ls -lh dist/main.js  # Compare before/after
```

### February 2026 Example: D3, immer, zundo Removal

After removing graph visualization (#2083), these dependencies became dead code:

| Package | Size | Used By | Status After #2083 |
|---------|------|---------|-------------------|
| d3 | ~250 KB | SPARQLGraphView | Dead code |
| immer | ~15 KB | Graph stores (Zustand) | Dead code |
| zundo | ~5 KB | Nothing (never used) | Dead code |
| @types/d3 | - | TypeScript | Dead code |

**Verification Commands:**
```bash
# Check D3 imports (should be empty after graph removal)
rg "from ['\"]d3['\"]" packages/obsidian-plugin/src/ --type ts

# Check immer imports (only graph stores use it)
rg "from ['\"]immer['\"]" packages/obsidian-plugin/src/ --type ts

# Check zundo imports (should be empty)
rg "from ['\"]zundo['\"]" packages/obsidian-plugin/src/ --type ts
```

### Best Practices

1. **Use npm uninstall** - Don't manually edit package.json
2. **Verify with ripgrep** - Ensure zero imports before removal
3. **Check type imports** - Search for `import type { ... } from 'pkg'`
4. **Rebuild immediately** - Catch missing dependencies early
5. **Measure results** - Document bundle size reduction

### Results Achieved (PR #2090)

| Metric | Change |
|--------|--------|
| Lines removed | 762 (mostly package-lock.json) |
| Packages removed | 4 (d3, @types/d3, immer, zundo) |
| Bundle size | ~270 KB smaller |
| Build time | Faster (fewer modules to process) |

### Checklist for Dependency Cleanup

- [ ] Feature removal PR is merged and released
- [ ] All imports of candidate packages return empty from ripgrep
- [ ] Both runtime (`from 'pkg'`) and type (`import type`) imports checked
- [ ] Packages removed via `npm uninstall`
- [ ] `npm run build` succeeds without warnings
- [ ] `npm run test:all` passes
- [ ] Bundle size measured and documented
- [ ] CHANGELOG updated with removal notes

### When NOT to Remove Dependencies

- Package is used by remaining features (verify with ripgrep)
- Package is a peer dependency of kept packages
- Package provides polyfills needed at runtime
- Removal causes TypeScript compilation errors

**Reference**: Issue #2085, PR #2090 - Remove D3, immer, zundo (75 steps, -762 lines, February 2026)

---

## RDF Dual Storage Pattern for UUID-based Wikilinks

**When to use**: Storing UUID-based wikilinks in RDF format for improved SPARQL queryability

### Problem Statement

UUID-based wikilinks like `[[e3347bcf-bb50-4fb7-9064-14266469384b]]` are common in knowledge management systems for referencing assets by unique identifiers. When converted to RDF, storing only the File IRI makes UUID-literal SPARQL queries fail:

```turtle
# Only File IRI stored (old behavior)
<note> exo:Asset_prototype <obsidian://vault/.../e3347bcf-bb50-4fb7-9064-14266469384b.md> .

# This SPARQL query fails:
SELECT ?s WHERE {
  ?s exo:Asset_prototype "e3347bcf-bb50-4fb7-9064-14266469384b"
}
# Result: 0 matches (searching for Literal, stored as IRI)
```

### Solution: Dual Storage

Store **both** File IRI and UUID Literal for UUID-based wikilinks:

```turtle
# Dual storage (new behavior)
<note> exo:Asset_prototype <obsidian://vault/.../e3347bcf-bb50-4fb7-9064-14266469384b.md> .
<note> exo:Asset_prototype "e3347bcf-bb50-4fb7-9064-14266469384b" .
```

Now both query patterns work:
- By File IRI: `?s exo:Asset_prototype <obsidian://...>` ✅
- By UUID Literal: `?s exo:Asset_prototype "e3347bcf-bb50-4fb7-9064-14266469384b"` ✅

### Implementation Pattern

```typescript
// 1. Add UUID detection helper
private isUUID(value: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value);
}

// 2. Modify return type to support array (dual storage)
private async valueToRDFObject(
  value: any,
  sourceFile: IFile
): Promise<(IRI | Literal)[]> {  // Changed from single value to array
  // ... existing wikilink extraction logic ...

  if (targetFile) {
    const fileIRI = this.notePathToIRI(targetFile.path);

    // If wikilink is a UUID, store both IRI and Literal
    if (this.isUUID(wikilink)) {
      const uuidLiteral = new Literal(wikilink);
      return [fileIRI, uuidLiteral];
    }

    return [fileIRI];  // Non-UUID: single value
  }
  // ... rest of logic ...
}

// 3. Update caller to handle array (flatten results)
for (const val of Array.isArray(propValue) ? propValue : [propValue]) {
  const objectNodes = await this.valueToRDFObject(val, file);
  for (const objectNode of objectNodes) {
    triples.push(new Triple(subject, predicate, objectNode));
  }
}
```

### Key Implementation Details

1. **UUID Regex**: Use case-insensitive pattern to match UUIDs in any case format
2. **Extract from wikilink**: Store the clean UUID, not `[[uuid]]`
3. **Conditional dual storage**: Only apply when wikilink IS a UUID (non-UUID wikilinks store single IRI)
4. **No duplicate when file doesn't exist**: If target file not found, fall back to single Literal (existing behavior)
5. **Array flattening**: Caller must iterate over returned array

### Test Coverage Requirements

| Test Case | Expected Behavior |
|-----------|-------------------|
| Valid lowercase UUID | `isUUID()` returns true |
| Valid uppercase UUID | `isUUID()` returns true |
| Non-UUID string | `isUUID()` returns false |
| UUID without dashes | `isUUID()` returns false |
| UUID wikilink (file exists) | Returns `[IRI, Literal]` |
| Non-UUID wikilink | Returns `[IRI]` (single element) |
| UUID wikilink (file missing) | Returns `[Literal]` (single element) |
| Array of UUID wikilinks | Each element produces 2 triples |

### Benefits

- **SPARQL flexibility**: Query by either File IRI or UUID Literal
- **No breaking changes**: File IRI still works for graph navigation
- **Additive**: Existing queries continue to work
- **Selective**: Only applies to UUID wikilinks (no overhead for regular wikilinks)

### When to Apply

- Properties that reference assets by UUID (e.g., `exo__Asset_prototype`, `ems__Effort_parent`)
- Knowledge graphs where UUID-based queries are common
- Systems needing to search by UUID without file path resolution

### Performance Considerations

- **Additional triples**: Each UUID wikilink produces 2 triples instead of 1
- **Index size**: RDF store grows ~proportionally to UUID wikilink count
- **Query speed**: Literal lookup may be faster than IRI lookup (shorter strings)

**Acceptable overhead**: For a vault with 10,000 notes and 50% UUID references:
- Additional triples: ~5,000 (negligible for modern RDF stores)
- Query performance: Unchanged (both patterns indexed)

**Reference**: Issue #2102, PR #2104 - Dual storage for UUID-based wikilinks (72 steps, +296 lines, February 2026)

---

## Dead Code Elimination Pattern

**When to use**: Removing unused packages, modules, or features from a monorepo codebase

### Pattern Description

Systematic approach to safely remove dead code, ensuring no hidden dependencies exist before deletion. Critical for maintaining a clean, efficient codebase.

### Verification Workflow (MANDATORY Before Deletion)

```bash
# 1. Identify candidate for removal
# Look for packages/modules with no imports in src/ directories

# 2. Comprehensive grep search - MUST return zero results
grep -r "package-name" packages/*/src/ --include="*.ts" --include="*.tsx"
grep -r "ImportedClass\|ImportedFunction" packages/*/src/

# 3. Check package.json dependencies
grep -r "package-name" packages/*/package.json

# 4. Check for indirect references (re-exports, barrel files)
grep -r "from.*package-name" packages/*/src/index.ts

# 5. Search test files (tests may import but don't count as "usage")
grep -r "package-name" packages/*/tests/ --include="*.ts"
```

### Implementation Steps

| Step | Action | Validation |
|------|--------|------------|
| 1 | Verify unused | `grep` returns zero results in src/ |
| 2 | Check tsconfig.json | Remove from `references` if present |
| 3 | Remove directory | `rm -rf packages/package-name/` |
| 4 | Clean lockfile | Run `npm install` to regenerate |
| 5 | Verify build | `npm run build` passes |
| 6 | Run tests | All tests pass |

### Real-World Example: physics-wasm Removal (Issue #2106)

**Background**: `packages/physics-wasm/` provided physics simulation for force-directed graph visualization. After graph feature removal in previous refactoring, the package became dead code.

**Verification**:
```bash
grep -r "physics-wasm\|PhysicsEngine\|ForceGraph" packages/*/src/
# (no results) ✓ - Confirmed unused
```

**Files Removed** (2,320 lines total):

| File | Lines | Purpose |
|------|-------|---------|
| `assembly/index.ts` | 770 | AssemblyScript WASM source |
| `src/PhysicsEngine.ts` | 596 | TypeScript engine wrapper |
| `tests/PhysicsEngine.test.ts` | 428 | Unit tests |
| `src/types.ts` | 278 | Type definitions |
| `src/index.ts` | 56 | Barrel export |
| `package.json` | 38 | Package manifest |
| `asconfig.json` | 37 | AssemblyScript config |
| `jest.config.js` | 24 | Test config |
| `tsconfig.json` | 21 | TypeScript config |
| `.gitignore` | 13 | Git ignore |
| `assembly/tsconfig.json` | 6 | WASM TypeScript config |

**tsconfig.json Update Required**:
```json
// Before
{
  "references": [
    { "path": "packages/core" },
    { "path": "packages/physics-wasm" },  // ← Remove this line
    { "path": "packages/obsidian-plugin" }
  ]
}

// After
{
  "references": [
    { "path": "packages/core" },
    { "path": "packages/obsidian-plugin" }
  ]
}
```

### Benefits of Proactive Dead Code Removal

| Benefit | Impact |
|---------|--------|
| **Reduced build time** | Fewer packages to compile |
| **Smaller bundle** | Less code = faster load |
| **Lower maintenance** | No outdated deps to update |
| **Cleaner codebase** | Easier navigation for AI agents |
| **Reduced attack surface** | Fewer potential vulnerabilities |
| **Cleaner lockfile** | Removed ~52 lines from package-lock.json |

### When to Trigger Dead Code Audit

- After removing a major feature (e.g., graph visualization)
- During refactoring sprints
- When updating dependencies (check for orphaned packages)
- Quarterly codebase health review
- After feature flag removal

### Common Dead Code Candidates

| Type | Detection Method |
|------|------------------|
| Unused packages | `grep -r "package-name" packages/*/src/` |
| Orphan utilities | Search for functions with 0 call sites |
| Legacy features | Check for feature flags always false |
| Deprecated APIs | Search for `@deprecated` annotations |
| Test-only imports | Only imported in tests/, not src/ |

### Anti-Patterns to Avoid

**❌ Don't delete without verification:**
```bash
# WRONG: Assume unused because "I don't remember using it"
rm -rf packages/something/

# CORRECT: Always verify with grep first
grep -r "something" packages/*/src/ || rm -rf packages/something/
```

**❌ Don't keep "just in case":**
```
Keeping dead code "in case we need it later" is an anti-pattern:
- Git history preserves everything (can recover with `git checkout`)
- Dead code still needs maintenance (dependency updates)
- Confuses new contributors and AI agents
- Increases CI time and bundle size
```

**❌ Don't skip lockfile regeneration:**
```bash
# WRONG: Delete package but keep old lockfile entries
rm -rf packages/something/

# CORRECT: Always regenerate lockfile
rm -rf packages/something/ && npm install
```

### Metrics (Issue #2106)

| Metric | Value |
|--------|-------|
| Steps | 47 |
| Lines removed | 2,320 |
| Files deleted | 13 |
| Time | ~15-20 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

### Rollback Plan

If deletion causes unexpected issues:
```bash
# Restore from git history
git checkout HEAD~1 -- packages/physics-wasm/

# Reinstall dependencies
npm install

# Verify build
npm run build
```

**Reference**: Issue #2106, PR #2107 - Remove unused physics-wasm package (47 steps, -2320 lines, February 2026)

---

## Dual Identifier Backward Compatibility Pattern

**When to use**: Migrating from string-based identifiers (e.g., `ems__TaskPrototype`) to UID-based identifiers (e.g., `75302770-279e-4a59-ba85-09df29725713`) while maintaining backward compatibility.

### Pattern Description

When renaming asset files from human-readable names to UID-based names (for consistency and uniqueness), the code must recognize both identifier formats to avoid breaking existing vaults.

### Implementation Structure

```
1. Add UID constant alongside existing string constant
   ↓
2. Update all visibility/detection rules to check BOTH identifiers
   ↓
3. Update settings/templates for UID-based display
   ↓
4. Write tests for BOTH identifiers
```

### Code Example (Issue #2110, PR #2111)

**Step 1: Add constant to AssetClass.ts**
```typescript
// packages/exocortex/src/domain/constants/AssetClass.ts
export enum AssetClass {
  // Existing string-based identifier
  TASK_PROTOTYPE = "ems__TaskPrototype",

  // NEW: UID-based identifier (same class, different file naming)
  TASK_PROTOTYPE_UID = "75302770-279e-4a59-ba85-09df29725713",
}
```

**Step 2: Update visibility rules**
```typescript
// packages/exocortex/src/domain/commands/visibility/AssetVisibilityRules.ts
export function canCreateInstance(context: CommandVisibilityContext): boolean {
  if (
    hasClass(context.instanceClass, AssetClass.TASK_PROTOTYPE) ||
    hasClass(context.instanceClass, AssetClass.TASK_PROTOTYPE_UID) ||  // NEW
    // ... other prototypes
  ) {
    return true;
  }
  return isPrototypeClass(context.instanceClass, context.metadata);
}
```

**Step 3: Update display settings**
```typescript
// packages/obsidian-plugin/src/domain/settings/ExocortexSettings.ts
classTemplates: {
  "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
  // NEW: Same template for UID-based identifier
  "75302770-279e-4a59-ba85-09df29725713": "{{exo__Asset_label}} (TaskPrototype)",
}
```

**Step 4: Update button builders**
```typescript
// packages/obsidian-plugin/src/presentation/builders/button-groups/CreationButtonGroupBuilder.ts
const defaultValue = isMeeting ||
  sourceClass === AssetClass.TASK_PROTOTYPE ||
  sourceClass === AssetClass.TASK_PROTOTYPE_UID  // NEW
    ? this.generateDefaultLabel(metadata, file.basename)
    : "";
```

### Test Pattern

```typescript
describe("canCreateInstance", () => {
  it.each([
    ["string-based", AssetClass.TASK_PROTOTYPE],
    ["UID-based", AssetClass.TASK_PROTOTYPE_UID],
  ])("should return true for %s TaskPrototype", (_, classValue) => {
    const context = createContext({ instanceClass: classValue });
    expect(canCreateInstance(context)).toBe(true);
  });
});
```

### Key Benefits

1. **Zero downtime migration**: Users can rename files at their own pace
2. **Backward compatibility**: Old vaults with string-based names continue working
3. **Forward compatibility**: New vaults use UID-based naming from start
4. **Consistent behavior**: Same functionality regardless of identifier format

### When to Apply

- Migrating prototype classes (TaskPrototype, MeetingPrototype, ProjectPrototype)
- Renaming any asset class from human-readable to UID format
- Adding support for wikilink-style UIDs (e.g., `[[75302770-...]]`)

### Gotchas

- **Search all usages**: `grep -r "ems__TaskPrototype"` to find all hardcoded strings
- **Same template for both**: Display templates should be identical to avoid UX confusion
- **Test both identifiers**: Parameterized tests (`it.each`) ensure both paths work
- **Wikilink stripping**: UID may arrive as `"[[uuid]]"` - strip brackets before comparison

### Metrics (Issue #2110, PR #2111)

| Metric | Value |
|--------|-------|
| Steps | 58 |
| Lines added | 63 |
| Lines removed | 1 |
| Files modified | 5 |
| Tests added | 53 lines |
| Time | ~18 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

### Success Factors

1. **Clear issue specification**: Issue #2110 had detailed implementation steps
2. **Existing patterns**: Followed established AssetClass constant pattern
3. **Focused scope**: Single prototype class migration (not all at once)
4. **Comprehensive tests**: 53 lines of tests ensured backward compatibility

**Reference**: Issue #2110, PR #2111 - Support UID-based class identifier for ems__TaskPrototype (58 steps, +63 lines, February 2026)

---

## Metadata Cache Fallback Pattern

**When to use**: Plugin features that depend on Obsidian's `metadataCache.getFileCache()` must work even when the cache is unavailable (during vault indexing after startup).

### Problem

When Obsidian indexes a vault (first launch or after cache invalidation), `metadataCache.getFileCache()` returns `null` until indexing completes. This causes:
- UI components like "Create Instance" buttons to be hidden
- Plugin features to fail silently
- Poor UX during vault initialization

### Solution Pattern

Use direct YAML parsing as fallback when metadata cache is unavailable:

```typescript
// FrontmatterFallback.ts
import { App, TFile } from "obsidian";
import yaml from "js-yaml";

export class FrontmatterFallback {
  constructor(private app: App) {}

  async getFrontmatter(file: TFile): Promise<Record<string, any> | null> {
    // Primary path: Use cache (fast, normal operation)
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter) {
      return cache.frontmatter;
    }

    // Fallback path: Direct YAML parsing (during indexing)
    try {
      const content = await this.app.vault.read(file);
      return this.extractFrontmatter(content);
    } catch (error) {
      console.error("Frontmatter fallback failed:", error);
      return null;
    }
  }

  private extractFrontmatter(content: string): Record<string, any> | null {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);

    if (!match) return null;

    try {
      const parsed = yaml.load(match[1]);
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch (error) {
      return null;
    }
  }
}
```

### Key Benefits

1. **Immediate availability**: UI features work without waiting for cache
2. **Graceful degradation**: Fallback activates automatically, cache used when ready
3. **Pattern reuse**: CLI already uses direct parsing in `FileSystemVaultAdapter.extractFrontmatter()`
4. **Error resilience**: Try-catch handles malformed YAML gracefully

### When to Apply

- Any code using `metadataCache.getFileCache()` for button/command visibility
- Renderers that check frontmatter properties before rendering
- Command handlers that validate asset class before execution

### Gotchas

- **Performance**: Direct YAML parsing is slower than cache lookup - always try cache first
- **js-yaml dependency**: Plugin already includes this via Obsidian, no extra bundle size
- **YAML edge cases**: Multi-line strings, anchors, and aliases may parse differently

### Metrics (Issue #2103, PR #2103)

| Metric | Value |
|--------|-------|
| Steps | 65 |
| Files modified | 3 |
| Tests added | 5 |
| Time | ~30 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2103, PR #2103 - Make plugin independent from Obsidian metadata cache (65 steps, February 2026)

---

## Task Period Overlap Detection Pattern

**When to use**: Highlighting scheduling conflicts when multiple tasks have overlapping planned periods.

### Problem

Users plan tasks with `ems__Effort_plannedStartTimestamp` and `ems__Effort_plannedEndTimestamp`. Overlapping periods indicate overcommitment but are not visually distinct without manual inspection.

### Solution Pattern

Use interval overlap algorithm with memoization:

```typescript
// Interval overlap detection: start1 <= end2 && start2 <= end1
const periodsOverlap = (
  start1: number, end1: number,
  start2: number, end2: number
): boolean => {
  return start1 <= end2 && start2 <= end1;
};

// Memoized calculation of all overlapping tasks
const tasksWithOverlaps = useMemo(() => {
  const tasksByPlanned = tasks.filter(
    t => t.metadata.ems__Effort_plannedStartTimestamp &&
         t.metadata.ems__Effort_plannedEndTimestamp
  );

  const overlapping = new Set<string>();

  // O(n²) pairwise comparison - acceptable for <100 tasks
  for (let i = 0; i < tasksByPlanned.length; i++) {
    const task1 = tasksByPlanned[i];
    const start1 = new Date(task1.metadata.ems__Effort_plannedStartTimestamp as string).getTime();
    const end1 = new Date(task1.metadata.ems__Effort_plannedEndTimestamp as string).getTime();

    for (let j = i + 1; j < tasksByPlanned.length; j++) {
      const task2 = tasksByPlanned[j];
      const start2 = new Date(task2.metadata.ems__Effort_plannedStartTimestamp as string).getTime();
      const end2 = new Date(task2.metadata.ems__Effort_plannedEndTimestamp as string).getTime();

      if (periodsOverlap(start1, end1, start2, end2)) {
        overlapping.add(task1.path);
        overlapping.add(task2.path);
      }
    }
  }

  return overlapping;
}, [tasks]);
```

### CSS Styling

```css
/* Pleasant dark red background for conflict rows */
.task-overlap-conflict {
  background-color: rgba(139, 0, 0, 0.12);  /* DarkRed with 12% opacity */
}

/* Dark theme variant */
.theme-dark .task-overlap-conflict {
  background-color: rgba(178, 34, 34, 0.15);  /* Firebrick, slightly lighter */
}
```

### Row Rendering

```tsx
<div
  className={`task-table-row ${
    tasksWithOverlaps.has(task.path) ? 'task-overlap-conflict' : ''
  }`}
>
```

### Key Benefits

1. **Visual instant feedback**: Users spot conflicts without manual calculation
2. **Performance**: O(n²) with useMemo prevents recalculation on every render
3. **Accessibility**: Color contrast ≥4.5:1 (WCAG AA compliant)

### Gotchas

- **Tasks without planned timestamps**: Skip in overlap check (don't count as overlap)
- **Zero-duration tasks**: Same start/end time is not considered overlap
- **Timezone handling**: Use getTime() for numeric comparison, not string comparison

### Metrics (Issue #2108, PR #2108)

| Metric | Value |
|--------|-------|
| Steps | 113 |
| Files modified | 3 |
| Tests added | 6 |
| Time | ~40 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2108, PR #2108 - Highlight overlapping planned task periods in DailyNote table (113 steps, February 2026)

---

## UUID Wikilink Resolution Pattern

**When to use**: CLI or plugin must resolve wikilinks that reference files by UUID (e.g., `[[ebf717aa-4070-4b37-abde-10a700e354fc|Label]]`).

### Problem

Obsidian files can be named by UUID (e.g., `ebf717aa-4070-4b37-abde-10a700e354fc.md`). When frontmatter contains wikilinks like:

```yaml
exo__Class_superClass:
  - "[[ems__EffortPrototype]]"           # ✅ Resolves (relative path)
  - "[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]"  # ❌ May NOT resolve
```

The standard relative path resolution fails because UUID-named files require vault-wide search.

### Solution Pattern

Build UUID-to-filepath index at adapter initialization:

```typescript
export class FileSystemVaultAdapter implements IVaultAdapter {
  private uuidIndex: Map<string, string> = new Map(); // uuid -> filepath

  constructor(private rootPath: string) {
    this.buildUuidIndex();
  }

  private buildUuidIndex(): void {
    const files = this.getAllFiles();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const file of files) {
      const basename = path.basename(file.path, ".md");
      if (uuidRegex.test(basename)) {
        this.uuidIndex.set(basename.toLowerCase(), file.path);
      }
    }
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null {
    // Strip wikilink alias: "uuid|label" → "uuid"
    const cleanLinkpath = linkpath.split('|')[0].trim();

    // Check if linkpath is a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(cleanLinkpath)) {
      const filePath = this.uuidIndex.get(cleanLinkpath.toLowerCase());
      if (filePath) {
        return this.createFileObject(filePath);
      }
    }

    // Fall back to existing relative path resolution
    // ... existing code ...
  }
}
```

### Key Benefits

1. **O(1) lookup**: Map-based index vs O(n) vault scan per resolution
2. **Case-insensitive**: Normalizes UUIDs to lowercase for matching
3. **Alias handling**: Strips `|label` suffix from wikilinks automatically
4. **Vault-wide**: Finds files regardless of directory structure

### When to Apply

- CLI SPARQL queries that follow `rdfs:subClassOf` or other property paths
- Resolving `exo__Instance_class` wikilinks to class definitions
- Any file lookup where filename may be a UUID

### Gotchas

- **Index refresh**: Must update index on file create/rename/delete operations
- **Case sensitivity**: UUIDs may be mixed case in frontmatter - normalize to lowercase
- **Wikilink brackets**: Strip `[[` and `]]` before checking UUID pattern
- **External changes**: If files are modified outside CLI, index becomes stale (document this limitation)

### Metrics (Issue #2113, PR #2113)

| Metric | Value |
|--------|-------|
| Steps | 56 |
| Files modified | 2 |
| Tests added | 8 |
| Time | ~25 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2113, PR #2113 - Resolve UUID-based wikilinks in FileSystemVaultAdapter (56 steps, February 2026)

---

## Virtualized Table Scrollbar Compensation Pattern

**When to use**: Tables with >50 rows use virtualization (TanStack Virtual) with split header/body tables. This causes column misalignment due to scrollbar width.

### Problem

When tables exceed the virtualization threshold:
- **Header table**: Fixed, no scrollbar
- **Body table**: Inside scroll container, has scrollbar (~17px width)

Result: Body columns are narrower than header columns → misalignment.

### Solution Pattern

Measure scrollbar width and apply as padding to header:

```typescript
// 1. State for scrollbar width
const [scrollbarWidth, setScrollbarWidth] = useState(0);

// 2. useEffect to measure scrollbar when virtualization activates
useEffect(() => {
  if (parentRef.current && isVirtualized) {
    const scrollWidth = parentRef.current.offsetWidth - parentRef.current.clientWidth;
    setScrollbarWidth(scrollWidth);
  }
}, [isVirtualized, virtualRows]);

// 3. Apply padding to header table
<table style={{ paddingRight: scrollbarWidth > 0 ? `${scrollbarWidth}px` : undefined }}>
  {/* Header content */}
</table>

<div ref={parentRef} className="scroll-container">
  <table>
    {/* Body content */}
  </table>
</div>
```

### Key Formula

```typescript
const scrollbarWidth = parentRef.current.offsetWidth - parentRef.current.clientWidth;
// offsetWidth: total width including scrollbar
// clientWidth: content width excluding scrollbar
// difference: scrollbar width (~17px on most systems, 0 if overlay scrollbars)
```

### Where to Apply

Any component using virtualization with separate header/body tables:
- `DailyTasksTable.tsx` (PR #941 - original fix)
- `AssetRelationsTable.tsx` (PR #2116)
- `TableLayoutRenderer.tsx` (PR #2116)

### Gotchas

- **OS-specific scrollbars**: macOS overlay scrollbars have width 0, Windows/Linux ~17px
- **Dependency array**: Include `virtualRows` to recalculate when content changes
- **Conditional rendering**: Only measure when `isVirtualized` is true

### Metrics (Issue #2116, PR #2116)

| Metric | Value |
|--------|-------|
| Steps | 53 |
| Files modified | 2 |
| Lines added | 16 |
| Time | ~15 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2116, PR #2116 - Apply scrollbar width fix to AssetRelationsTable and TableLayoutRenderer (53 steps, February 2026)

---

## Class-Based Filtering Pattern for Detection Algorithms

**When to use**: Before running detection algorithms (overlap, conflict, validation) that should exclude certain asset classes

### Problem

Some detection algorithms apply to all assets by default, but certain asset classes should be excluded from detection:
- `ems__Context` tasks describe WHERE/HOW (not WHAT), so they don't conflict with actual tasks
- Archived items shouldn't trigger active-only validations
- Template assets shouldn't be counted in statistics

### Solution

Filter by `exo__Instance_class` BEFORE running detection logic:

```typescript
const tasksWithOverlaps = useMemo(() => {
  // Step 1: Filter out excluded classes BEFORE detection
  const eligibleTasks = tasks.filter((task) => {
    const start = task.metadata.ems__Effort_plannedStartTimestamp;
    const end = task.metadata.ems__Effort_plannedEndTimestamp;

    // Check for excluded classes
    const classes = task.metadata.exo__Instance_class;
    const isContext = Array.isArray(classes)
      ? classes.some((c: string) => c.includes('ems__Context'))
      : typeof classes === 'string' && classes.includes('ems__Context');

    return start != null && end != null && !isContext;
  });

  // Step 2: Run detection only on eligible tasks
  return detectOverlaps(eligibleTasks);
}, [tasks]);
```

### Handling Multiple Class Formats

`exo__Instance_class` can appear in several formats - handle all of them:

```typescript
function hasClass(metadata: Record<string, unknown>, targetClass: string): boolean {
  const classes = metadata.exo__Instance_class;

  if (!classes) return false;

  // Format 1: Single string - "ems__Task"
  if (typeof classes === 'string') {
    return classes.includes(targetClass);
  }

  // Format 2: Array - ["ems__Task", "ems__Context"]
  if (Array.isArray(classes)) {
    return classes.some((c: string) =>
      typeof c === 'string' && c.includes(targetClass)
    );
  }

  // Format 3: Wiki-link - "[[ems__Context]]" or "[[uuid|ems__Context]]"
  // Already handled by includes() check

  return false;
}
```

### Key Insight

Context tasks (`ems__Context`) describe the circumstances under which other tasks are performed:
- "Commute to office" + "Review PR" is NOT a conflict - the review happens DURING commute
- Context provides metadata about task execution environment
- Exclude contexts from time-based conflict detection

### Test Cases

```typescript
it("should exclude ems__Context from overlap detection", () => {
  const tasks = [
    { class: "ems__Task", start: "09:00", end: "11:00" },
    { class: "ems__Context", start: "09:30", end: "10:30" }, // Should be excluded
  ];

  const overlaps = detectOverlaps(filterEligible(tasks));

  expect(overlaps).toHaveLength(0); // No overlap because context excluded
});

it("should detect overlaps between regular tasks", () => {
  const tasks = [
    { class: "ems__Task", start: "09:00", end: "11:00" },
    { class: "ems__Task", start: "10:00", end: "12:00" },
  ];

  const overlaps = detectOverlaps(filterEligible(tasks));

  expect(overlaps).toHaveLength(2); // Both tasks marked as overlapping
});
```

### Metrics (Issue #2128, PR #2128)

| Metric | Value |
|--------|-------|
| Steps | 55 |
| Files modified | 2 |
| Test cases added | 5 |
| Time | ~45 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2128, PR #2128 - Exclude ems__Context tasks from overlap detection (55 steps, February 2026)

---

## Command Implementation Pattern with Timestamp Service

**When to use**: Adding new Obsidian commands that update frontmatter timestamps

### Architecture

```
┌─────────────────────────┐
│   CommandRegistry.ts    │ ← Registration + DI wiring
├─────────────────────────┤
│  MarkReviewedCommand.ts │ ← Command class (ICommand interface)
├─────────────────────────┤
│ EffortVisibilityRules.ts│ ← Visibility logic (canMarkReviewed)
├─────────────────────────┤
│ StatusTimestampService.ts│ ← Shared timestamp service
├─────────────────────────┤
│  FrontmatterService.ts  │ ← Low-level frontmatter ops
└─────────────────────────┘
```

### Step-by-Step Implementation

#### 1. Add Visibility Rule (EffortVisibilityRules.ts)

```typescript
export function canMarkReviewed(context: CommandVisibilityContext): boolean {
  return (
    (isTask(context.instanceClass) || isProject(context.instanceClass)) &&
    !context.isArchived
  );
}
```

#### 2. Add Service Method (StatusTimestampService.ts)

```typescript
async addReviewTimestamp(file: IFile): Promise<void> {
  const content = await this.vault.read(file);
  const timestamp = DateFormatter.toLocalTimestamp(new Date());

  const updated = this.frontmatterService.updateProperty(
    content,
    "ems__Effort_lastReviewTimestamp",
    timestamp
  );

  await this.vault.modify(file, updated);
}
```

#### 3. Create Command Class (MarkReviewedCommand.ts)

```typescript
export class MarkReviewedCommand implements ICommand {
  id = "mark-reviewed";
  name = "Mark as reviewed";

  constructor(private statusTimestampService: StatusTimestampService) {}

  checkCallback = (
    checking: boolean,
    file: TFile,
    context: CommandVisibilityContext | null
  ): boolean => {
    if (!context || !canMarkReviewed(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to mark as reviewed: ${error}`);
          LoggingService.error("Mark reviewed error", error);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.statusTimestampService.addReviewTimestamp(file);
    new Notice(`Marked as reviewed: ${file.basename}`);
  }
}
```

#### 4. Register Command (CommandRegistry.ts)

```typescript
// In registerAllCommands()
this.registerCommand(
  new MarkReviewedCommand(this.statusTimestampService)
);
```

### Key Pattern Elements

1. **Visibility First**: Define when command is visible (`canMarkReviewed`)
2. **Reuse Services**: Use existing `StatusTimestampService` for consistency
3. **Error Handling**: Wrap async in try-catch with user notice
4. **Single Responsibility**: Command only orchestrates, service does the work
5. **Reference Implementation**: Copy from `MarkDoneCommand.ts`

### Test Checklist

- [ ] Visibility rule returns true for Task
- [ ] Visibility rule returns true for Project
- [ ] Visibility rule returns false for archived Task
- [ ] Visibility rule returns false for Area
- [ ] Service method creates timestamp property
- [ ] Service method updates existing timestamp
- [ ] Command executes successfully
- [ ] Command shows error notice on failure

### Metrics (Issue #2124, PR #2124)

| Metric | Value |
|--------|-------|
| Steps | 41 |
| Files modified | 10 |
| Test cases added | ~15 |
| Time | ~35 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2124, PR #2124 - Add 'Reviewed' command (41 steps, February 2026)

---

## CodeMirror 6 Label Replacement Pattern

**When to use**: Replacing displayed text in Obsidian's Live Preview (editor) mode

### Problem

Obsidian uses different rendering systems for different modes:
- **Reading View**: DOM-based, use MutationObserver + DOM patching (`BodyLinkPatch.ts`)
- **Live Preview**: CodeMirror 6, use ViewPlugin + Decorations (`AliasIconViewPlugin.ts`)

Wikilinks like `[[uuid]]` need to display as `exo__Asset_label` in both modes.

### Solution: Decoration.replace()

```typescript
// In ViewPlugin class
private buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Find wikilinks without aliases: [[uuid]] (no pipe)
  const wikilinkPattern = /\[\[([^\]|]+)\]\]/g;
  const text = view.state.doc.sliceString(view.viewport.from, view.viewport.to);

  let match;
  while ((match = wikilinkPattern.exec(text)) !== null) {
    const targetPath = match[1].trim();
    const label = this.resolveLabel(targetPath);

    if (label && label !== targetPath) {
      // Key: Use Decoration.replace() to substitute text
      const decoration = Decoration.replace({
        widget: new InlineTextWidget(label),
      });

      const from = view.viewport.from + match.index;
      const to = from + match[0].length;

      builder.add(from, to, decoration);
    }
  }

  return builder.finish();
}
```

### Widget Implementation

```typescript
class InlineTextWidget extends WidgetType {
  constructor(private label: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.label;
    span.className = "cm-wikilink-label";
    return span;
  }

  eq(other: InlineTextWidget): boolean {
    return this.label === other.label;
  }
}
```

### Key Differences: widget() vs replace()

| Method | Effect | Use Case |
|--------|--------|----------|
| `Decoration.widget()` | Adds element (doesn't hide original) | Icons, badges |
| `Decoration.replace()` | Replaces text with widget | Label substitution |
| `Decoration.mark()` | Applies CSS class to range | Highlighting |

### Cursor-Aware Editing

When user edits wikilink, show original UUID:

```typescript
private isInEditRange(view: EditorView, from: number, to: number): boolean {
  const selection = view.state.selection.main;
  return selection.from <= to && selection.to >= from;
}

// In buildDecorations():
if (!this.isInEditRange(view, from, to)) {
  builder.add(from, to, decoration);
  // Only decorate when cursor is outside the wikilink
}
```

### Settings Integration

```typescript
// ExocortexSettings.ts
interface ExocortexSettings {
  showLabelsInLivePreview: boolean;  // Default: true
}

// In ViewPlugin
if (this.settings.showLabelsInLivePreview) {
  // Apply decorations
}
```

### Performance Considerations

- **Viewport-only rendering**: Only process visible content (`view.viewport.from/to`)
- **Label caching**: Use LRU cache for `resolveLabel()` lookups
- **Efficient updates**: ViewPlugin's `update()` only rebuilds when document changes

### Metrics (Issue #2126, PR #2126)

| Metric | Value |
|--------|-------|
| Steps | 102 |
| Files modified | 7 |
| New files created | 1 (WikilinkLabelViewPlugin.ts) |
| Test cases added | ~10 |
| Time | ~90 minutes |
| Errors encountered | 0 |
| CI status | ✅ All checks passed |

**Reference**: Issue #2126, PR #2126 - Display wikilinks by exo__Asset_label in live preview (102 steps, February 2026)

---

## Prototype Class Inheritance Pattern

**When to use**: Implementing metadata classification that should propagate from prototype to instances

### Pattern Description

When an asset uses `exo__Asset_prototype` to reference a prototype, the prototype's class membership should be inherited for classification purposes (e.g., overlap detection exclusion).

### Problem

Task "Morning Commute" has `exo__Asset_prototype: "[[commute-prototype]]"` but no direct `ems__Context` class. The prototype "Commute" has `ems__Context` class. Without prototype lookup, "Morning Commute" isn't recognized as a context task.

### Solution

```typescript
// Step 1: Check direct class membership
function hasClassDirectly(metadata: FrontmatterCache, className: string): boolean {
  const classes = metadata.exo__Instance_class || [];
  const classArray = Array.isArray(classes) ? classes : [classes];
  return classArray.some(c => typeof c === 'string' && c.includes(className));
}

// Step 2: Resolve prototype's classes
async function resolvePrototypeClasses(
  metadata: FrontmatterCache,
  app: ObsidianApp
): Promise<string[]> {
  // ⚠️ CRITICAL: Use exo__Asset_prototype, NOT exo__Instance_prototype
  const prototypeRef = metadata.exo__Asset_prototype;
  if (!prototypeRef) return [];

  const prototypeUid = extractUidFromWikilink(prototypeRef);
  if (!prototypeUid) return [];

  const prototypeFile = app.metadataCache.getFirstLinkpathDest(prototypeUid, '');
  if (!prototypeFile) return [];

  const prototypeMeta = app.metadataCache.getFileCache(prototypeFile);
  return prototypeMeta?.frontmatter?.exo__Instance_class || [];
}

// Step 3: Combined check
async function hasClassDirectlyOrThroughPrototype(
  metadata: FrontmatterCache,
  className: string,
  app: ObsidianApp
): Promise<boolean> {
  if (hasClassDirectly(metadata, className)) return true;

  const prototypeClasses = await resolvePrototypeClasses(metadata, app);
  return prototypeClasses.some(c => c.includes(className));
}
```

### Critical Property Name

| ❌ WRONG | ✅ CORRECT |
|----------|-----------|
| `exo__Instance_prototype` (6 vault occurrences) | `exo__Asset_prototype` (3098 occurrences) |

**Mnemonic**: Assets have prototypes, not instances. "Asset → prototype" makes semantic sense.

### Vault Occurrence Validation

Before implementing prototype lookups, validate property names exist in vault:

```bash
# Count occurrences to validate correct property name
grep -r "exo__Instance_prototype" /path/to/vault --include="*.md" | wc -l
# Result: 6 (wrong!)

grep -r "exo__Asset_prototype" /path/to/vault --include="*.md" | wc -l
# Result: 3098 (correct!)
```

### Testing Pattern

```typescript
describe("Prototype-based classification", () => {
  it("should detect class through prototype", async () => {
    const task = {
      exo__Asset_prototype: "[[context-prototype]]",
      exo__Instance_class: [],  // No direct class
    };

    mockGetFileCache.mockReturnValueOnce({
      frontmatter: {
        exo__Instance_class: ["[[ems__Context]]"],
      },
    });

    const result = await hasClassDirectlyOrThroughPrototype(
      task, "ems__Context", mockApp
    );

    expect(result).toBe(true);
  });
});
```

### Real-World Use Case

**Overlap Detection Exclusion (Issues #2131, #2135)**:
- Tasks with `ems__Context` class are excluded from time overlap highlighting
- Recurring contexts ("Commute", "Lunch Break") use prototypes
- Prototype-based lookup reduces maintenance overhead

**Metrics:**

| Issue | Steps | Result |
|-------|-------|--------|
| #2131 (feat: prototype detection) | 62 | +340 lines |
| #2135 (fix: property name) | 74 | +74 lines |

**Reference**: Issues #2131, #2135 - Prototype class inheritance for overlap detection (136 combined steps, February 2026)

---

## Block Reference Wikilink Pattern

**When to use**: Extending wikilink rendering to support `[[uuid#^blockid]]` and `[[uuid#Heading]]` formats

### Pattern Description

Block and heading references require special parsing to extract the reference part and append it to the resolved label.

### Regex Evolution

```typescript
// BEFORE: Simple wikilinks only
const simplePattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// Matches: [[uuid]], [[uuid|alias]]

// AFTER: Block/heading references
const fullPattern = /\[\[([^#\]|]+)(?:#(\^)?([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
// Matches: [[uuid]], [[uuid|alias]], [[uuid#^block]], [[uuid#Heading]], [[uuid#^block|alias]]
```

### Parsing Interface

```typescript
interface WikilinkParsed {
  target: string;        // UUID or path
  alias?: string;        // Custom display name |...|
  blockId?: string;      // Block reference (^abc123)
  headingRef?: string;   // Heading reference (#Heading)
  isBlock: boolean;      // true if ^, false if heading
}

function parseWikilink(value: string): WikilinkParsed | null {
  const match = value.match(/^\[\[([^#\]|]+)(?:#(\^)?([^\]|]+))?(?:\|([^\]]+))?\]\]$/);
  if (!match) return null;

  return {
    target: match[1].trim(),
    isBlock: match[2] === '^',
    blockId: match[2] === '^' ? match[3]?.trim() : undefined,
    headingRef: match[2] !== '^' ? match[3]?.trim() : undefined,
    alias: match[4]?.trim(),
  };
}
```

### Display Formatting

```typescript
function formatDisplayName(
  label: string,
  parsed: WikilinkParsed
): string {
  // Custom alias takes priority
  if (parsed.alias) return parsed.alias;

  // Block reference: "Label > ^blockid"
  if (parsed.blockId) {
    return `${label} > ^${parsed.blockId}`;
  }

  // Heading reference: "Label > Heading"
  if (parsed.headingRef) {
    return `${label} > ${parsed.headingRef}`;
  }

  return label;
}
```

### Cross-View Consistency

Apply same formatting in both modes:

| Mode | Implementation | Component |
|------|----------------|-----------|
| Live Preview | CodeMirror ViewPlugin | `WikilinkLabelViewPlugin.ts` |
| Reading View | MutationObserver + DOM | `BodyLinkPatch.ts` |

### BodyLinkPatch Extension

```typescript
// Reading View: Extract ref from data-href attribute
private parseLinkRef(href: string): { path: string; ref?: string } {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) {
    return { path: href };
  }

  return {
    path: href.substring(0, hashIndex),
    ref: href.substring(hashIndex + 1),  // "^blockid" or "Heading"
  };
}

// Apply to resolved display name
const { path, ref } = this.parseLinkRef(dataHref);
const resolvedName = this.resolveDisplayName(path);
const finalName = ref
  ? ref.startsWith('^')
    ? `${resolvedName} > ${ref}`        // Block: "Label > ^blockid"
    : `${resolvedName} > ${ref}`        // Heading: "Label > Heading"
  : resolvedName;
```

### Metrics (Issue #2133, PR #2134)

| Metric | Value |
|--------|-------|
| Steps | 74 |
| Files modified | 4 |
| Lines added | +546 |
| Lines deleted | -43 |
| Unit tests added | 24 |

**Reference**: Issue #2133, PR #2134 - Block reference wikilink display (74 steps, February 2026)

---

## Property Name Verification Pattern

**When to use**: Implementing features that depend on frontmatter property names

### Pattern Description

Before using a frontmatter property name, verify it exists in the vault with significant occurrences. Property names that look plausible but are rarely used indicate a naming error.

### Problem Scenario

Issue #2135 revealed that `exo__Instance_prototype` was used instead of `exo__Asset_prototype`. The code compiled, tests passed (with mock data), but the feature didn't work in production.

### Verification Command

```bash
# Run BEFORE implementation to confirm property exists
grep -r "PROPERTY_NAME" /path/to/vault --include="*.md" | wc -l

# Examples:
grep -r "exo__Instance_prototype" ~/vault-2025 --include="*.md" | wc -l
# Result: 6 ← Too low! Likely wrong property name

grep -r "exo__Asset_prototype" ~/vault-2025 --include="*.md" | wc -l
# Result: 3098 ← Correct, widely used
```

### Occurrence Thresholds

| Count | Interpretation | Action |
|-------|----------------|--------|
| 0 | Property doesn't exist | Verify ontology, check spelling |
| 1-10 | Test data or schema only | Probably wrong, investigate |
| 100+ | Real usage | Correct property name |
| 1000+ | Core property | Definitely correct |

### Integration into Development Flow

1. **Before implementation**: Run grep to verify property name
2. **If count < 100**: Stop and verify in ontology
3. **Add to test name**: "should use exo__Asset_prototype (not exo__Instance_prototype)"
4. **Document in PR**: Include occurrence count for validation

### Defensive Test Pattern

```typescript
describe("Property name validation", () => {
  // Explicit test name prevents future property name confusion
  it("should resolve prototype using exo__Asset_prototype (NOT exo__Instance_prototype)", () => {
    const metadata = {
      exo__Asset_prototype: "[[prototype-uid]]",  // Correct property
    };

    const result = resolvePrototypeClasses(metadata);

    expect(result).toBeDefined();
  });
});
```

### Real-World Impact

**Issue #2135**:
- Root cause: PR #2132 used `exo__Instance_prototype` (6 occurrences) instead of `exo__Asset_prototype` (3098 occurrences)
- Symptom: Tasks with prototypes weren't excluded from overlap detection
- Time to find: 74 steps of investigation
- Prevention: 30-second grep command before implementation

**Reference**: Issue #2135, PR #2137 - Property name mismatch fix (74 steps, February 2026)

---

## Obsidian Wikilink Text Rendering Variations Pattern

**When to use**: Implementing features that patch or modify wikilink display in Obsidian

### Pattern Description

Obsidian renders wikilink text content in multiple undocumented formats depending on:
- View mode (Live Preview vs Reading View)
- Link type (simple wikilink, block reference, heading reference)
- Obsidian version
- User aliases (explicit `[[target|alias]]` syntax)

When writing code that patches wikilink display, you must anticipate ALL possible text formats Obsidian may render, not just the expected format.

### The Problem: Incomplete Format Matching (Issue #2139)

```typescript
// ❌ WRONG: Only matches one expected format
const expectedBlockRefText = `${file.basename}#^${blockId}`;
const matchesBlockRefText = currentText === expectedBlockRefText;

// If Obsidian renders "basename > ^blockid" instead of "basename#^blockid",
// the match fails and hasUserAlias becomes true incorrectly
```

### The Solution: Multi-Format Matching

```typescript
// ✅ CORRECT: Match ALL known Obsidian rendering formats
const matchesBlockRefText = blockId
  ? currentText === `${file.basename}#^${blockId}`     // Standard format
  : false;

const matchesBlockRefWithoutCaret = blockId
  ? currentText === `${file.basename}#${blockId}`       // Without caret
  : false;

const matchesBlockRefSeparatorFormat = blockId
  ? currentText === `${file.basename} > ^${blockId}`    // Separator format
  : headingRef
    ? currentText === `${file.basename} > ${headingRef}`
    : false;

// Update guard clause to include all formats
const hasUserAlias =
  currentText !== "" &&
  !matchesBasename &&
  !matchesDataHref &&
  !matchesBlockRefText &&
  !matchesBlockRefWithoutCaret &&         // NEW
  !matchesBlockRefSeparatorFormat &&       // NEW
  !wasAlreadyPatched;
```

### Known Obsidian Wikilink Text Formats

| Link Type | Possible Text Formats |
|-----------|----------------------|
| Simple `[[page]]` | `page`, `page.md` |
| Block ref `[[page#^id]]` | `page#^id`, `page#id`, `page > ^id`, `page` |
| Heading ref `[[page#Heading]]` | `page#Heading`, `page > Heading`, `page` |
| With alias `[[page\|Alias]]` | `Alias` (always preserved) |

### Guard Clause Best Practices

When implementing `hasUserAlias` or similar guards:

1. **Start permissive, narrow later**: Consider all unknown text as "maybe Obsidian-generated" initially
2. **Log actual values**: Add temporary logging to capture real Obsidian output before finalizing
3. **Test both view modes**: Live Preview and Reading View may render differently
4. **Preserve user intent**: Explicit aliases (`[[target|Alias]]`) must always be preserved

### Investigation Pattern (Debug-First)

```typescript
// Step 1: Add temporary debug logging
console.log("BodyLinkPatch debug:", {
  currentText,
  expectedBlockRefText,
  matchesBlockRefText,
  file: file.basename,
  blockId,
});

// Step 2: Open a note with [[uuid#^blockid]] in Reading View
// Step 3: Check console output for actual currentText value
// Step 4: Add missing format to match conditions
// Step 5: Remove debug logging
```

### Test Pattern for Wikilink Patching

```typescript
describe("Wikilink format variations (Issue #2139)", () => {
  it("should patch block reference when textContent is basename only", () => {
    mockLink.setAttribute("data-href", `${uuid}#^jgp9nz`);
    mockLink.textContent = uuid; // Obsidian renders just basename

    patch.enable();

    expect(mockLink.textContent).toBe("Asset Label (Class) > ^jgp9nz");
  });

  it("should patch block reference without caret symbol", () => {
    mockLink.textContent = `${uuid}#jgp9nz`; // Missing caret
    // ... test patching still works
  });

  it("should patch block reference with separator format", () => {
    mockLink.textContent = `${uuid} > ^jgp9nz`; // Separator format
    // ... test patching still works
  });

  it("should preserve explicit user alias", () => {
    mockLink.textContent = "Custom Alias"; // User provided
    // ... test alias is NOT overwritten
  });
});
```

### Cross-Mode Consistency Checklist

When implementing wikilink features:

- [ ] Test in **Live Preview** mode (typically uses `WikilinkLabelViewPlugin.ts` or similar CM6 extension)
- [ ] Test in **Reading View** mode (typically uses `BodyLinkPatch.ts` or MutationObserver)
- [ ] Test **simple wikilinks** `[[page]]`
- [ ] Test **block references** `[[page#^id]]`
- [ ] Test **heading references** `[[page#Heading]]`
- [ ] Test **aliased links** `[[page|Alias]]`
- [ ] Verify **tooltip/aria-label** matches display text
- [ ] Test **navigation** (clicking link goes to correct location)

### Real-World Impact

**Issue #2139**: Block references in Reading View displayed UUID instead of resolved label
- **Root cause**: `hasUserAlias` guard didn't recognize Obsidian's separator format (`basename > ^blockid`)
- **Symptom**: `84e75603-0103-4594-8499-09dc404800b0 > ^jgp9nz` instead of `Asset Label > ^jgp9nz`
- **Fix**: Added recognition for 2 additional Obsidian text rendering formats
- **Time**: 41 steps (quick fix once root cause identified via debug logging)
- **Tests added**: 4 regression tests covering format variations

**Reference**: Issue #2139, PR #2140 - Block reference Reading View fix (41 steps, February 2026)

---

## FunctionReplacer Pattern for Obsidian Patches

**When to use**: Monkey-patching Obsidian internal methods (Graph View, File Explorer, etc.)

### Problem: Direct Prototype Assignment Fails

```typescript
// ❌ WRONG: Direct assignment has multiple failure modes
GraphNode.prototype.getDisplayText = function() {
  return this.getLabel() || originalGetDisplayText.call(this);
};

// Problems:
// 1. Timing: Nodes created BEFORE patch don't get updated
// 2. Multiple prototypes: Global vs Local graph may have different classes
// 3. No cleanup: Can't restore original on plugin disable
// 4. Lost context: Patch doesn't know when to apply vs bypass
```

### Solution: FunctionReplacer Factory

```typescript
// ✅ CORRECT: Factory pattern with lifecycle management
type Restorer = () => void;

function replacePrototypeMethod<T extends object>(
  proto: T,
  methodName: keyof T,
  factory: (original: T[keyof T]) => T[keyof T]
): Restorer {
  const original = proto[methodName];
  proto[methodName] = factory(original);
  return () => {
    proto[methodName] = original;
  };
}

// Usage in GraphViewPatch
private restorers: Map<object, () => void> = new Map();

private patchProto(proto: object): void {
  if (this.restorers.has(proto)) return;  // Already patched

  const restorer = replacePrototypeMethod(
    proto as GraphNode,
    "getDisplayText",
    (original) => {
      const isEnabled = () => this.enabled;
      const getLabel = (id: string) => this.getAssetLabel(id);
      return function (this: GraphNode): string {
        if (!isEnabled()) return (original as () => string).call(this);
        return getLabel(this.id) ?? (original as () => string).call(this);
      };
    }
  );
  this.restorers.set(proto, restorer);
}

private unpatchAll(): void {
  this.restorers.forEach((restore) => restore());
  this.restorers.clear();
}
```

### Key Benefits

| Aspect | Direct Assignment | FunctionReplacer |
|--------|-------------------|------------------|
| Cleanup | Manual tracking | Automatic restorer |
| Multiple prototypes | Fails silently | Maps each prototype |
| Enable/disable | Re-implements logic | Calls restorer |
| Original reference | Lost on reassign | Preserved in closure |
| Testing | Hard to mock | Can inject factory |

### Handling Multiple Prototypes (Graph View Example)

```typescript
// Obsidian may use different classes for Global vs Local graph
private patchAllGraphViews(): void {
  const prototypes = new Set<object>();

  for (const viewType of ["graph", "localgraph"] as const) {
    for (const leaf of this.getGraphLeaves(viewType)) {
      const view = leaf.view as GraphView;
      const renderer = view?.renderer as GraphRenderer;

      // Each node may have a different prototype!
      for (const node of renderer?.nodes ?? []) {
        const proto = Object.getPrototypeOf(node);
        if (!prototypes.has(proto)) {
          prototypes.add(proto);
          this.patchProto(proto);
        }
      }
    }
  }
}
```

### Forced Re-render After Patching

Patching the prototype only affects **future** method calls. Nodes already rendered need a re-render:

```typescript
private forceRedrawGraphView(leaf: WorkspaceLeaf): void {
  const view = leaf.view as unknown as GraphView;
  const renderer = view?.renderer as unknown as Record<string, unknown>;
  if (!renderer) return;

  // Strategy 1: Internal reset if available
  if (typeof renderer["onIframeLoad"] === "function") {
    (renderer["onIframeLoad"] as () => void)();
    return;
  }

  // Strategy 2: Trigger layout-change event
  this.app.workspace.trigger("layout-change");
}
```

### Common Pitfalls

- **setTimeout(100ms) is fragile**: Use event-driven triggers instead
- **Single patch point**: Global vs Local graph views may differ
- **Missing re-render**: Patching alone doesn't update existing nodes
- **Unit tests pass, production fails**: Mocks hide timing/lifecycle issues

**Reference**: Issues #2149, #2151, #2157 - Graph View label fixes (17-150 steps, February 2026)

---

## Obsidian Patch Lifecycle Pattern

**When to use**: Any feature that patches Obsidian internals

### Full Lifecycle Structure

```typescript
export class FeaturePatch {
  private enabled = false;
  private restorers: Map<object, () => void> = new Map();
  private eventRefs: EventRef[] = [];

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // 1. Register event listeners
    this.registerEvents();

    // 2. Apply patches
    this.patchAll();

    // 3. Force initial render
    this.refreshAll();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // 1. Restore all patches
    this.restorers.forEach(restore => restore());
    this.restorers.clear();

    // 2. Unregister events
    this.eventRefs.forEach(ref =>
      this.app.workspace.offref(ref)
    );
    this.eventRefs.clear();

    // 3. Force re-render to show original state
    this.refreshAll();
  }

  private registerEvents(): void {
    // Debounced handler for layout changes
    const debouncedRefresh = debounce(() => {
      this.patchAll();
      this.refreshAll();
    }, 200);

    this.eventRefs.push(
      this.app.workspace.on("layout-change", debouncedRefresh)
    );

    // Metadata changes may affect labels
    this.eventRefs.push(
      this.app.metadataCache.on("changed", (file) => {
        // Only refresh if relevant file changed
        if (this.isRelevantFile(file)) {
          this.refreshAll();
        }
      })
    );
  }
}
```

### Enable/Disable Toggle in Settings

```typescript
// ExocortexSettingTab.ts
new Setting(containerEl)
  .setName("Show labels in graph view")
  .setDesc("Display exo__Asset_label instead of UUID filenames")
  .addToggle(toggle => toggle
    .setValue(this.plugin.settings.showLabelsInGraphView)
    .onChange(async (value) => {
      this.plugin.settings.showLabelsInGraphView = value;
      await this.plugin.saveSettings();

      // CRITICAL: Toggle the patch state
      if (value) {
        this.plugin.graphViewPatch.enable();
      } else {
        this.plugin.graphViewPatch.disable();
      }
    })
  );
```

### Common Issues and Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| Race condition at startup | Feature doesn't work on first open | Use `onLayoutReady()` or debounced enable |
| Toggle doesn't take effect | Need to close/reopen view | Call `refreshAll()` after enable/disable |
| Events leak on disable | Memory bloat, stale handlers | Store `EventRef[]`, call `offref()` |
| Patch applied twice | Duplicate labels, errors | Guard with `restorers.has(proto)` |

**Reference**: Issues #2149, #2157 - Graph View patch lifecycle (February 2026)

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

| File | Change |
|------|--------|
| `ExocortexSettings.ts` | Removed `showDailyNoteProjects: boolean` |
| `ExocortexSettingTab.ts` | Removed toggle (lines 123-136) |
| `DailyProjectsRenderer.ts` | **Deleted entire file** |
| `DailyProjectsTable.tsx` | **Deleted entire file** |
| `PropertyDependencyResolver.ts` | Removed 5 enum mappings |
| `IncrementalUpdateHandler.ts` | Removed section case |
| `SectionStateManager.ts` | Removed from known sections |
| `tableSortStore.ts` | Removed `dailyProjects` state |
| `UniversalLayoutRenderer.ts` | Removed import, field, instantiation |
| Tests (7 files) | Updated or deleted |

### February 2026 Sprint: 3 Settings Removed

| Issue | Setting Removed | Steps | Deletions |
|-------|-----------------|-------|-----------|
| #2144 | Show projects in daily notes | 147 | 2323 lines |
| #2145 | Default ontology asset | 70 | 608 lines |
| #2148 | Show labels in file explorer | 60 | 789 lines |

**Total**: 277 steps, 3720 lines deleted in one day

### Benefits of Batch Removal

- **Warm context**: Same patterns, same file locations
- **Lower error rate**: Each removal follows identical checklist
- **Clean commits**: Each removal is atomic (one setting per PR)
- **Quick reviews**: Deletions are easy to verify

**Reference**: Issues #2144, #2145, #2148 - Feature Removal Sprint (February 2026)

---

## MutationObserver DOM Coverage Pattern

**When to use**: Patching DOM elements dynamically added by Obsidian

### Problem: Observer Misses Nested Elements

```typescript
// ❌ INCOMPLETE: Misses links inside added tables/containers
this.observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        // Only gets DIRECT links, not nested ones
        const links = node.querySelectorAll('a.internal-link');
        links.forEach(link => this.patchLink(link));
      }
    }
  }
});
```

### Solution: Check Both Node and Descendants

```typescript
// ✅ COMPLETE: Handles direct matches AND nested elements
this.observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        // Case 1: Node IS the target element (e.g., link inside <td>)
        if (node.matches('a.internal-link')) {
          this.patchLink(node as HTMLAnchorElement);
        }

        // Case 2: Node CONTAINS target elements (tables, divs, etc.)
        node.querySelectorAll('a.internal-link').forEach(link => {
          this.patchLink(link as HTMLAnchorElement);
        });
      }
    }
  }
});
```

### Observer Configuration

```typescript
this.observer.observe(container, {
  childList: true,    // Watch for added/removed children
  subtree: true,      // Required for nested elements (tables!)
  characterData: false, // Usually not needed
  attributes: false,  // Only if watching attribute changes
});
```

### Common Obsidian Rendering Contexts

| Context | DOM Structure | Special Handling |
|---------|---------------|------------------|
| Paragraph | `<p><a class="internal-link">` | Standard `querySelectorAll` |
| List item | `<li><a class="internal-link">` | Standard `querySelectorAll` |
| Table cell | `<td><a class="internal-link">` | Requires `subtree: true` |
| Callout | `<div class="callout"><a>` | Nested container |
| Embedded note | `<div class="markdown-embed">` | Separate observer may fire |

### Testing DOM Coverage

```typescript
describe("MutationObserver coverage", () => {
  it("should patch links in paragraph", async () => {
    container.innerHTML = '<p><a class="internal-link">Link</a></p>';
    await waitForObserver();
    expect(container.querySelector('a')?.textContent).toBe("Patched");
  });

  it("should patch links in table cell", async () => {
    container.innerHTML = '<table><tr><td><a class="internal-link">Link</a></td></tr></table>';
    await waitForObserver();
    expect(container.querySelector('a')?.textContent).toBe("Patched");
  });

  it("should patch link added directly (not as child)", async () => {
    const link = document.createElement('a');
    link.className = 'internal-link';
    container.appendChild(link);
    await waitForObserver();
    expect(link.textContent).toBe("Patched");
  });
});
```

**Reference**: Issue #2153 - Wikilinks in tables not resolved (56 steps, February 2026)

---

## Frontmatter Array Preservation Pattern

**When to use**: Modifying frontmatter that may contain existing array properties (e.g., `aliases`)

### Problem: Direct Frontmatter Modification Corrupts YAML

```typescript
// ❌ WRONG: Directly manipulating frontmatter string
const content = await this.app.vault.read(file);
const newContent = content.replace(
  /^---\n[\s\S]*?\n---/,
  `---\naliases:\n  - ${newAlias}\n---`
);
await this.app.vault.modify(file, newContent);
// Result: Overwrites existing aliases, may corrupt YAML structure
```

### Solution: Use Obsidian's processFrontMatter API

```typescript
// ✅ CORRECT: Use Obsidian's safe YAML manipulation
async renameToUID(file: TFile): Promise<void> {
  const currentName = file.basename;
  const metadata = this.app.metadataCache.getFileCache(file);

  // Read existing frontmatter safely
  const existingAliases = metadata?.frontmatter?.aliases || [];

  // Check for duplicates before adding
  const updatedAliases = existingAliases.includes(currentName)
    ? existingAliases
    : [...existingAliases, currentName];

  // Use processFrontMatter for safe YAML updates
  await this.app.fileManager.processFrontMatter(file, (fm) => {
    fm.aliases = updatedAliases;
  });

  // Now safe to rename
  const uuid = metadata?.frontmatter?.uid || generateUUID();
  await this.app.fileManager.renameFile(file, `${uuid}.md`);
}
```

### Key Points

1. **Always read existing values first**: Check `metadata?.frontmatter?.property`
2. **Check for duplicates**: Avoid adding duplicate entries to arrays
3. **Use `processFrontMatter()`**: Obsidian handles YAML formatting safely
4. **Order matters**: Update frontmatter BEFORE renaming file

### Edge Cases to Handle

- Empty aliases array (`aliases: []`) vs no aliases property
- Single-value aliases (string) vs array format
- Special characters in filenames that need YAML escaping
- Unicode characters in filenames

### Testing Pattern

```typescript
describe("Rename to UID with aliases", () => {
  it("should append to existing aliases array", async () => {
    const file = createMockFile("test.md", {
      aliases: ["existing-alias-1", "existing-alias-2"]
    });

    await command.execute(file);

    const fm = await readFrontmatter(file);
    expect(fm.aliases).toEqual([
      "existing-alias-1",
      "existing-alias-2",
      "test"  // Old basename appended
    ]);
  });

  it("should not duplicate existing alias", async () => {
    const file = createMockFile("test.md", {
      aliases: ["test"]  // Already contains basename
    });

    await command.execute(file);

    const fm = await readFrontmatter(file);
    expect(fm.aliases).toEqual(["test"]);  // No duplicate
  });
});
```

**Reference**: Issue #2180 - Rename to UID breaks frontmatter with aliases (63 steps, February 2026)

---

## Settings Cleanup Sprint Pattern

**When to use**: Removing multiple unused/obsolete settings from plugin

### Pattern Description

When removing settings, batch related removals in a single sprint session for maximum efficiency. Each setting removal follows an identical checklist, and warm context from previous removals reduces errors.

### February 2026 Sprint Example: 4 Settings Removed

| Issue | Setting Removed | Steps | Files Changed |
|-------|-----------------|-------|---------------|
| #2162 | Default ontology asset | 31 | 8 |
| #2163 | Status emoji mapping | 87 | 12 |
| #2146 | Use dynamic property fields | 117 | 15 |
| #2164 | Webhook integration | 91 | 10 |

**Total**: 326 steps, 4 settings removed in one day

### Setting Removal Checklist

For EACH setting, follow this exact order:

1. **Domain Layer** (`ExocortexSettings.ts`)
   - [ ] Remove interface field: `settingName: Type;`
   - [ ] Remove from `DEFAULT_SETTINGS`

2. **Presentation Layer** (`ExocortexSettingTab.ts`)
   - [ ] Remove helper methods (e.g., `getXxxOptions()`)
   - [ ] Remove `new Setting()` block
   - [ ] Remove imports if no longer needed

3. **Application Layer** (Commands, Services)
   - [ ] Remove all call sites reading the setting
   - [ ] Remove related service methods if orphaned
   - [ ] Clean up constructor parameters

4. **Test Files**
   - [ ] Remove describe blocks testing the setting
   - [ ] Remove/update fixture objects containing the field
   - [ ] Update mock indices (Setting blocks shift when one removed)
   - [ ] Remove spy calls for deleted helper methods

5. **Verification**
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
(MockSetting as jest.Mock).mock.results[0]  // Ontology dropdown
(MockSetting as jest.Mock).mock.results[1]  // Show layout
(MockSetting as jest.Mock).mock.results[2]  // Use labels

// AFTER removal - indices shift down
(MockSetting as jest.Mock).mock.results[0]  // Show layout (was 1)
(MockSetting as jest.Mock).mock.results[1]  // Use labels (was 2)
```

**Always audit ALL `mock.results[N]` indices** when removing a Setting.

### Anti-Patterns

- ❌ Removing setting from interface but leaving call sites
- ❌ Deleting tests without running test suite
- ❌ Forgetting to update fixture objects in E2E tests
- ❌ Not verifying with grep after removal

**Reference**: Issues #2162, #2163, #2146, #2164 - Settings Cleanup Sprint (February 2026)

---

## Virtualized Table Column Alignment Pattern

**When to use**: Tables with virtualized rendering (>50 rows) that need consistent column widths

### Problem: position:absolute Breaks table-layout:fixed

```tsx
// Standard virtualization applies absolute positioning
return renderRow(row, virtualRow.index, {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: `${virtualRow.size}px`,
  transform: `translateY(${virtualRow.start}px)`,
});
```

**Result**: `<tr>` with `position: absolute` is removed from document flow:
- `<td>` cells lose relationship with `<colgroup>` and `<th>` widths
- `table-layout: fixed` stops working
- Cells collapse to minimum content width

### Solution: Explicit Width Synchronization

```tsx
// Step 1: Measure header cell widths after mount
const [columnWidths, setColumnWidths] = useState<number[]>([]);
const headerRef = useRef<HTMLTableRowElement>(null);

useLayoutEffect(() => {
  if (headerRef.current) {
    const cells = headerRef.current.querySelectorAll('th');
    const widths = Array.from(cells).map(cell => cell.offsetWidth);
    setColumnWidths(widths);
  }
}, [columns]);

// Step 2: Apply widths to virtualized rows
const renderVirtualizedRow = (row: Row, style: CSSProperties) => (
  <tr style={style}>
    {columns.map((col, i) => (
      <td key={col.id} style={{
        width: columnWidths[i] || 'auto',
        minWidth: columnWidths[i] || 'auto',
        maxWidth: columnWidths[i] || 'auto',
      }}>
        {row[col.id]}
      </td>
    ))}
  </tr>
);
```

### Alternative: CSS Grid for Virtualized Mode

```tsx
// Convert to CSS Grid only for virtualized rendering
<div
  className="virtualized-table-grid"
  style={{
    display: 'grid',
    gridTemplateColumns: columns.map(c => c.width || '1fr').join(' '),
  }}
>
  {virtualItems.map(virtualRow => (
    <div
      key={virtualRow.index}
      style={{
        position: 'absolute',
        transform: `translateY(${virtualRow.start}px)`,
        display: 'contents',  // Allows children to participate in grid
      }}
    >
      {columns.map(col => (
        <div className="grid-cell">{row[col.id]}</div>
      ))}
    </div>
  ))}
</div>
```

### Window Resize Handling

```typescript
// Re-measure widths on resize
useEffect(() => {
  const handleResize = debounce(() => {
    if (headerRef.current) {
      const cells = headerRef.current.querySelectorAll('th');
      const widths = Array.from(cells).map(cell => cell.offsetWidth);
      setColumnWidths(widths);
    }
  }, 100);

  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

### Virtualization Threshold

```typescript
const VIRTUALIZATION_THRESHOLD = 50;

const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;

return shouldVirtualize
  ? renderVirtualizedTable(rows)  // Uses explicit widths
  : renderStandardTable(rows);     // Uses table-layout: fixed
```

**Reference**: Issue #2152 - Virtualized table column alignment (70 steps, February 2026)

---

## CodeMirror Callout Context Pattern

**When to use**: Applying CodeMirror decorations that need to work inside Obsidian Callout blocks

### Problem: Decorations Don't Apply Inside Callouts

```typescript
// Standard decoration approach
buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const wikilinks = this.findWikilinks(view);  // ← Misses links in Callouts

  for (const wikilink of wikilinks) {
    builder.add(wikilink.from, wikilink.to, decoration);
  }

  return builder.finish();
}
```

**Root Cause**: Callout blocks use special syntax parsing. Standard `viewportLineRanges` may not include Callout content correctly.

### Solution: Use visibleRanges Instead of viewportLineRanges

```typescript
buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // ✅ Use visibleRanges for comprehensive coverage
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const wikilinks = this.parseWikilinksFromText(text, from);

    for (const wikilink of wikilinks) {
      if (!this.isCursorInsideMatch(wikilink, cursorPos)) {
        builder.add(wikilink.from, wikilink.to, decoration);
      }
    }
  }

  return builder.finish();
}
```

### Callout Syntax Reference

```markdown
> [!note]
> This is a note callout with [[wikilink]].

> [!warning] Title
> Warning content with [[another-link]].

> [!tip]+ Collapsible
> Collapsible tip with [[nested-link]].
```

### Testing Callout Context

```typescript
describe("Wikilink labels in Callouts", () => {
  it("should apply decoration inside [!note] callout", async () => {
    const content = `> [!note]
> [[uuid-123]]`;

    const view = createEditorView(content);
    const decorations = plugin.buildDecorations(view);

    expect(decorations.size).toBe(1);
  });

  it("should handle nested callouts", async () => {
    const content = `> [!info]
> Outer content [[link1]]
>> [!warning]
>> Nested content [[link2]]`;

    const view = createEditorView(content);
    const decorations = plugin.buildDecorations(view);

    expect(decorations.size).toBe(2);
  });
});
```

### Performance Consideration

```typescript
// Debounce decoration updates for large documents
const debouncedUpdate = debounce(() => {
  this.decorations = this.buildDecorations(view);
  view.dispatch({});  // Trigger redraw
}, 50);
```

**Reference**: Issue #2182 - Wikilink labels not displayed in Callout blocks (81 steps, February 2026)

---

## Toggle Button State Management Pattern

**When to use**: Adding show/hide toggle buttons to table layouts (like time estimates in DailyNote)

### Pattern Structure

```
1. Add state to Zustand store (uiStore.ts)
2. Create toggle button component
3. Add conditional rendering in table
4. Format display value
5. Persist preference (optional)
```

### Implementation

```typescript
// Step 1: uiStore.ts - Central state management
interface UIState {
  showTimeEstimate: boolean;
}

interface UIActions {
  toggleTimeEstimate: () => void;
}

export const useUIStore = create<UIState & UIActions>()(
  persist(
    (set) => ({
      showTimeEstimate: false,
      toggleTimeEstimate: () =>
        set((s) => ({ showTimeEstimate: !s.showTimeEstimate })),
    }),
    { name: 'exocortex-ui-settings' }  // Persist to localStorage
  )
);
```

```typescript
// Step 2: Toggle button in table header
export const DailyTasksTable: React.FC<Props> = ({ tasks }) => {
  const { showTimeEstimate, toggleTimeEstimate } = useUIStore();

  return (
    <div>
      <div className="table-controls">
        <button
          className={`toggle-btn ${showTimeEstimate ? 'active' : ''}`}
          onClick={toggleTimeEstimate}
          title="Toggle time estimates"
        >
          ⏱ Time
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Task</th>
            {showTimeEstimate && <th>Estimate</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map(task => (
            <tr key={task.id}>
              <td>{task.title}</td>
              {showTimeEstimate && (
                <td>{formatTimeEstimate(task.timeEstimateMinutes)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

```typescript
// Step 3: Format utility
function formatTimeEstimate(minutes: number | null | undefined): string {
  if (!minutes || minutes === 0) return '';

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}
```

### CSS Styling

```css
.toggle-btn {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  cursor: pointer;
  font-size: 12px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.toggle-btn:hover {
  opacity: 1;
}

.toggle-btn.active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  opacity: 1;
}
```

### Testing Toggle Behavior

```typescript
describe("Time estimate toggle", () => {
  it("should show estimates when toggle is ON", async () => {
    useUIStore.setState({ showTimeEstimate: true });

    const { container } = render(
      <DailyTasksTable tasks={[{ timeEstimateMinutes: 90 }]} />
    );

    expect(container.textContent).toContain("1h 30m");
  });

  it("should hide estimates when toggle is OFF", async () => {
    useUIStore.setState({ showTimeEstimate: false });

    const { container } = render(
      <DailyTasksTable tasks={[{ timeEstimateMinutes: 90 }]} />
    );

    expect(container.textContent).not.toContain("1h 30m");
  });

  it("should format various time values correctly", () => {
    expect(formatTimeEstimate(90)).toBe("1h 30m");
    expect(formatTimeEstimate(45)).toBe("45m");
    expect(formatTimeEstimate(120)).toBe("2h");
    expect(formatTimeEstimate(0)).toBe("");
    expect(formatTimeEstimate(null)).toBe("");
  });
});
```

### Multiple Toggles Pattern

```typescript
// When multiple properties are toggleable
interface UIState {
  showTimeEstimate: boolean;
  showVotes: boolean;
  showPriority: boolean;
}

// Group toggles in UI
<div className="table-controls">
  <ToggleButton
    label="⏱ Time"
    active={showTimeEstimate}
    onClick={toggleTimeEstimate}
  />
  <ToggleButton
    label="👍 Votes"
    active={showVotes}
    onClick={toggleVotes}
  />
  <ToggleButton
    label="🔥 Priority"
    active={showPriority}
    onClick={togglePriority}
  />
</div>
```

**Reference**: Issue #2178 - Time estimate toggle in DailyNote (121 steps, February 2026)

---

## EditorSuggest Label Resolution Pattern

**When to use**: Extending Obsidian's autocomplete (like `[[` wikilink suggest) to show asset labels

### Problem: Default Suggest Shows UUIDs

```typescript
// Obsidian's default behavior shows file basenames
// For UUID-named files, users see: abc123-def4-5678...
```

### Solution: Custom EditorSuggest with Label Resolution

```typescript
// WikilinkLabelSuggest.ts
export class WikilinkLabelSuggest extends EditorSuggest<TFile> {
  constructor(
    app: App,
    private resolver: WikilinkLabelResolver
  ) {
    super(app);
  }

  // Trigger on [[ pattern
  onTrigger(
    cursor: EditorPosition,
    editor: Editor
  ): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).substring(0, cursor.ch);
    const match = line.match(/\[\[([^\]|]*)$/);

    if (!match) return null;

    return {
      start: { line: cursor.line, ch: cursor.ch - match[1].length },
      end: cursor,
      query: match[1]
    };
  }

  // Search by BOTH label and basename
  getSuggestions(context: EditorSuggestContext): TFile[] {
    const query = context.query.toLowerCase();

    return this.app.vault.getMarkdownFiles()
      .filter(file => {
        const label = this.resolver.getAssetLabel(file.path);
        const basename = file.basename;

        // Match against label OR basename
        return (
          label?.toLowerCase().includes(query) ||
          basename.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        // Prioritize label matches
        const labelA = this.resolver.getAssetLabel(a.path) || a.basename;
        const labelB = this.resolver.getAssetLabel(b.path) || b.basename;
        return labelA.localeCompare(labelB);
      })
      .slice(0, 20);  // Limit results
  }

  // Display label in suggestion list
  renderSuggestion(file: TFile, el: HTMLElement): void {
    const label = this.resolver.getAssetLabel(file.path);
    const basename = file.basename;

    if (label && label !== basename) {
      el.createEl('div', { text: label, cls: 'suggestion-label' });
      el.createEl('div', { text: basename, cls: 'suggestion-basename' });
    } else {
      el.setText(basename);
    }
  }

  // Insert with alias if label exists
  selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    const label = this.resolver.getAssetLabel(file.path);
    const basename = file.basename;

    // Insert [[uuid|label]] or [[uuid]]
    const insertText = label && label !== basename
      ? `[[${basename}|${label}]]`
      : `[[${basename}]]`;

    this.context?.editor.replaceRange(
      insertText,
      this.context.start,
      this.context.end
    );
  }
}
```

### Registration in Plugin

```typescript
// ExocortexPlugin.ts
onload() {
  // Register custom suggest
  this.registerEditorSuggest(
    new WikilinkLabelSuggest(this.app, this.wikilinkLabelResolver)
  );
}
```

### CSS for Suggestion Display

```css
.suggestion-label {
  font-weight: 500;
  color: var(--text-normal);
}

.suggestion-basename {
  font-size: 0.85em;
  color: var(--text-muted);
  font-family: var(--font-monospace);
}
```

### Testing

```typescript
describe("WikilinkLabelSuggest", () => {
  it("should trigger on [[", () => {
    const trigger = suggest.onTrigger(
      { line: 0, ch: 5 },
      mockEditor("test [[qu")
    );

    expect(trigger).not.toBeNull();
    expect(trigger?.query).toBe("qu");
  });

  it("should find files by label", () => {
    resolver.getAssetLabel.mockImplementation((path) => {
      if (path === "abc123.md") return "My Project";
      return null;
    });

    const results = suggest.getSuggestions({ query: "proj" });

    expect(results).toContainEqual(
      expect.objectContaining({ basename: "abc123" })
    );
  });

  it("should insert [[uuid|label]] format", () => {
    resolver.getAssetLabel.mockReturnValue("My Project");

    suggest.selectSuggestion(mockFile("abc123.md"), mockEvent);

    expect(mockEditor.replaceRange).toHaveBeenCalledWith(
      "[[abc123|My Project]]",
      expect.any(Object),
      expect.any(Object)
    );
  });
});
```

**Reference**: Issue #2166 - Show asset labels in Quick Switcher and [[ autocomplete (126 steps, February 2026)

---

## SPARQL Feature Sprint Pattern

**When to use**: Implementing multiple related SPARQL features in sequence

### Pattern Description

Complete related SPARQL features in a single sprint, building each feature on the foundation of the previous. This pattern was proven during the February 2026 SPARQL Enhancement Sprint.

### Sprint Structure (February 20-22, 2026)

| Day | Issues | Features | Steps |
|-----|--------|----------|-------|
| **Day 1** | #2204 | SPARQL 1.1 full support (GROUP BY, HAVING, subqueries, property paths) | 110 |
| **Day 2** | #2207, #2208 | REGEX Cyrillic support, OPTIONAL LEFT JOIN semantics | 85+76 |
| **Day 2** | #2217-2221 | Timeout protection, dry-run, templates, caching, error messages | 62-78 each |

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
  [/Unknown prefix: (\w+)/, 'Did you forget to declare PREFIX $1: <...>?'],
  [/Property .* not found/, 'Check property name spelling. Available: exo:, ems:, ims:'],
  [/Syntax error at line (\d+)/, 'Check for missing brackets, dots, or semicolons'],
]);

function enhanceError(error: Error): string {
  for (const [pattern, suggestion] of errorSuggestions) {
    const match = error.message.match(pattern);
    if (match) {
      return `${error.message}\n\n💡 Suggestion: ${suggestion.replace('$1', match[1] || '')}`;
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

| Issue | Feature | Steps | Dependencies |
|-------|---------|-------|--------------|
| #2206 | --timeout, --format flags, classes command | 56-84 | None |
| #2213 | --explain, --dry-run debugging | 77 | #2206 (flag infrastructure) |
| #2217 | Timeout protection | 76 | #2206 (--timeout flag) |
| #2218 | Dry-run mode | 62 | #2213 (--explain) |
| #2219 | Query templates library | 78 | None |
| #2220 | Result caching with TTL | 69 | None |
| #2221 | Enhanced error messages | 71 | None |

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
type OutputFormat = 'table' | 'json' | 'csv' | 'ntriples';

function formatOutput(results: QueryResult[], format: OutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(results, null, 2);
    case 'csv':
      return convertToCSV(results);
    case 'ntriples':
      return convertToNTriples(results);
    case 'table':
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
  operationName: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(
        `${operationName} timed out after ${timeoutMs}ms.\n` +
        `💡 Try: --explain to analyze query complexity`
      ));
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

| Issue | Goal | Steps | Result |
|-------|------|-------|--------|
| #2185 | Increase coverage 38% → 60% | 83 | Achieved |
| #2187 | Add integration tests for critical paths | 134 | 12+ integration tests added |

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
# Generate coverage report
npm run test:coverage

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

| Coverage Level | Risk | Recommendation |
|----------------|------|----------------|
| < 40% | High | Priority improvement needed |
| 40-60% | Medium | Focus on critical paths |
| 60-80% | Low | Maintain, add edge cases |
| > 80% | Minimal | Maintenance mode |

**Reference**: Issues #2185, #2187 - Test Coverage Sprint (February 2026)

---

## Copy Command Pattern

**When to use**: Implementing clipboard copy commands for asset properties

### Pattern Description

Implement "Copy X" commands that extract specific properties from assets and copy to clipboard.

### Implementation (Issue #2200, #2202)

```typescript
// CopyLabelCommand.ts
export class CopyLabelCommand implements ICommand {
  id = "copy-label";
  name = "Copy Label";

  checkCallback(checking: boolean, file: TFile): boolean {
    // Visibility check
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const label = frontmatter?.exo__Asset_label;

    if (!label) return false;

    if (!checking) {
      this.execute(file, label);
    }
    return true;
  }

  private execute(file: TFile, label: string): void {
    navigator.clipboard.writeText(label);
    new Notice(`Copied: ${label}`);
  }
}
```

### Key Implementation Details

1. **Visibility**: Command only shows when asset has the property
2. **Feedback**: Use Notice to confirm action
3. **Error handling**: Handle clipboard permission denied

### Common Gotcha: Incomplete Implementation

Issue #2202 was created because #2200 didn't fully implement the feature. Lesson: Always verify command works in:
- Command palette
- Right-click context menu
- Hotkey assignment
- All relevant asset types

**Reference**: Issues #2200, #2202 - Copy Label Command (February 2026)

---

## RDF/IRI Validation Pattern

**When to use**: Handling invalid IRIs in RDF triples gracefully

### Pattern Description

Validate and sanitize IRIs before using in RDF operations to prevent parsing failures.

### Implementation (Issue #2205)

```typescript
// IRI validation pattern
const IRI_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function validateIRI(iri: string): { valid: boolean; sanitized?: string; error?: string } {
  // Check basic structure
  if (!iri || typeof iri !== 'string') {
    return { valid: false, error: 'IRI must be a non-empty string' };
  }

  // Check scheme
  if (!IRI_REGEX.test(iri)) {
    return { valid: false, error: `Invalid IRI scheme: ${iri}` };
  }

  // Check for problematic characters
  const problematic = iri.match(/[\s<>"{}|\\^`]/g);
  if (problematic) {
    const sanitized = iri.replace(/[\s<>"{}|\\^`]/g, (char) =>
      encodeURIComponent(char)
    );
    return { valid: true, sanitized };
  }

  return { valid: true };
}
```

### Graceful Degradation

```typescript
// Skip invalid IRIs instead of failing
function processTriples(triples: Triple[]): Triple[] {
  return triples.filter(triple => {
    const subjectValid = validateIRI(triple.subject);
    const predicateValid = validateIRI(triple.predicate);

    if (!subjectValid.valid) {
      console.warn(`Skipping triple with invalid subject: ${triple.subject}`);
      return false;
    }

    if (!predicateValid.valid) {
      console.warn(`Skipping triple with invalid predicate: ${triple.predicate}`);
      return false;
    }

    return true;
  });
}
```

**Reference**: Issue #2205 - Invalid IRI handling (96 steps, February 2026)

---

## Quick Switcher Enhancement Pattern

**When to use**: Enhancing Obsidian's Quick Switcher with additional search fields

### Pattern Description

Extend Quick Switcher to search by asset labels, aliases, and UIDs in addition to filenames.

### Implementation (Issue #2198)

```typescript
// QuickSwitcherEnhancement.ts
export class QuickSwitcherEnhancement {
  private resolver: WikilinkLabelResolver;

  enhanceSuggestions(suggestions: TFile[]): EnhancedSuggestion[] {
    return suggestions.map(file => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

      return {
        file,
        displayText: this.getDisplayText(file, frontmatter),
        searchText: this.buildSearchText(file, frontmatter),
        subtitle: this.getSubtitle(file, frontmatter),
      };
    });
  }

  private buildSearchText(file: TFile, fm: FrontMatter | undefined): string {
    const parts = [file.basename];

    if (fm?.exo__Asset_label) parts.push(fm.exo__Asset_label);
    if (fm?.aliases) parts.push(...fm.aliases);
    // UID is already in basename for UUID-named files

    return parts.join(' ').toLowerCase();
  }

  private getDisplayText(file: TFile, fm: FrontMatter | undefined): string {
    return fm?.exo__Asset_label || file.basename;
  }

  private getSubtitle(file: TFile, fm: FrontMatter | undefined): string {
    // Show classes instead of path
    const classes = fm?.exo__Instance_class;
    if (Array.isArray(classes) && classes.length > 0) {
      return classes.map(c => c.replace(/[\[\]]/g, '')).join(', ');
    }
    return file.parent?.path || '';
  }
}
```

### UI Considerations

- **Display**: Show label as primary text, classes as subtitle
- **Search**: Match against label, aliases, UID, and basename
- **Performance**: Cache search text computation

**Reference**: Issue #2198 - Enhanced Quick Switcher (50 steps, February 2026)

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

| Alert Type | Fix Pattern |
|------------|-------------|
| Incomplete string escaping | split/join instead of replace |
| Insecure randomness | crypto.randomUUID() or crypto.getRandomValues() |
| Weak crypto | Use AES-GCM, avoid MD5/SHA1 for security |
| Prototype pollution | Object.create(null) for dictionaries |

**Reference**: Issue #2226 - P0 String Escaping Fix (February 2026)

---

## Documentation Sprint Pattern

**When to use**: Creating ADRs and technical documentation

### Pattern Description

Document architecture decisions using Architecture Decision Records (ADR) format.

### Implementation (Issue #2188)

**Structure**:
```
docs/
├── adr/
│   ├── 0001-use-clean-architecture.md
│   ├── 0002-sparql-v2-implementation.md
│   ├── 0003-tsyringe-dependency-injection.md
│   └── README.md (ADR index)
```

**ADR Template**:
```markdown
# ADR-NNNN: Title

## Status
Accepted | Proposed | Deprecated | Superseded by ADR-XXXX

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult because of this change?

## References
- Issue #XXX
- PR #YYY
```

### When to Create ADR

- New architectural patterns (DI, SPARQL engine, caching)
- Technology choices (TSyringe vs InversifyJS)
- Breaking changes to existing patterns
- Performance-critical decisions

**Reference**: Issue #2188 - ADR Documentation (47 steps, February 2026)

---

## Button Group Implementation Pattern

**When to use**: Adding new button groups to asset layouts (e.g., Criticality Zone, Quick Actions)

### Pattern Description

Implement new button groups using the ButtonGroupBuilder architecture with dedicated services and visibility rules.

### Implementation Layers (Issue #2231 Example)

```
1. Domain Service (CriticalityZoneService.ts)
   └── Business logic for zone assignment
   └── UUID mapping for zone values
   ↓
2. Visibility Rules (TaskVisibilityRules.ts)
   └── Determine when buttons are shown
   └── Class-specific conditions
   ↓
3. Button Group Builder (CriticalityZoneButtonGroupBuilder.ts)
   └── Create ButtonGroup with actions
   └── Connect to service methods
   ↓
4. Registration (ButtonGroupsBuilder.ts)
   └── Add builder to registry
   └── Integrate with UniversalLayoutRenderer
   ↓
5. DI Container (container.ts)
   └── Register service
   └── Bind interface to implementation
```

### Real-World Example: Criticality Zone Buttons (Issue #2231)

**Files Modified (10 files, 101 steps)**:
- `packages/exocortex/src/services/CriticalityZoneService.ts` (NEW)
- `packages/exocortex/src/domain/commands/visibility/TaskVisibilityRules.ts`
- `packages/exocortex/src/domain/commands/visibility/index.ts`
- `packages/exocortex/src/interfaces/tokens.ts`
- `packages/exocortex/src/infrastructure/container.ts`
- `packages/obsidian-plugin/src/presentation/builders/button-groups/CriticalityZoneButtonGroupBuilder.ts` (NEW)
- `packages/obsidian-plugin/src/presentation/builders/ButtonGroupsBuilder.ts`
- `packages/obsidian-plugin/src/presentation/renderers/UniversalLayoutRenderer.ts`
- Tests: `CriticalityZoneButtonGroupBuilder.test.ts`, fixtures

**UUID Wikilink Format for Button Actions**:
```typescript
// CriticalityZoneService.ts
const ZONE_UUIDS = {
  today: 'e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f',
  thisWeek: 'c7f1a968-0959-4ac7-ac82-31b0cdc2aba7',
  someday: '6968a0fc-7a41-4393-82b1-17d767c7ad7c',
};

// Button click handler sets frontmatter:
// ems__Task_zone: "[[e266a2e9-9eb0-431d-b1fe-b95b9d3e9a3f]]"
```

### Implementation Checklist

- [ ] Create domain service with business logic
- [ ] Add service interface to tokens.ts
- [ ] Register service in container.ts
- [ ] Define visibility rules in appropriate *VisibilityRules.ts
- [ ] Create ButtonGroupBuilder with actions
- [ ] Register builder in ButtonGroupsBuilder.ts
- [ ] Add builder call in UniversalLayoutRenderer
- [ ] Write unit tests for builder
- [ ] Add test fixtures

### Expected Timeline

| Phase | Time |
|-------|------|
| Service implementation | 15-20 min |
| Visibility rules | 10-15 min |
| ButtonGroupBuilder | 20-30 min |
| Integration | 10-15 min |
| Testing | 20-30 min |
| **Total** | ~90-120 min |

**Reference**: Issue #2231 - Criticality Zone Buttons (101 steps, merged February 2026)

---

## SPARQL Timeout Configuration Pattern

**When to use**: Handling long-running SPARQL queries that may timeout

### Pattern Description

Add configurable timeout support for CLI SPARQL queries via environment variable and command-line flags.

### Implementation (Issue #2233/PR #2234)

**Environment Variable Support**:
```typescript
// packages/cli/src/commands/sparql-query.ts
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

function getTimeoutMs(): number {
  const envTimeout = process.env.EXOCORTEX_SPARQL_TIMEOUT;
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed * 1000; // Convert seconds to ms
    }
  }
  return DEFAULT_TIMEOUT_MS;
}
```

**Error Handling**:
```typescript
// packages/cli/src/utils/errors/QueryTimeoutError.ts
export class QueryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Query timed out after ${timeoutMs / 1000} seconds. ` +
      `Try: EXOCORTEX_SPARQL_TIMEOUT=60 npx @kitelev/exocortex-cli sparql query "..."`
    );
    this.name = 'QueryTimeoutError';
  }
}
```

### Usage

```bash
# Default timeout (30s)
npx @kitelev/exocortex-cli sparql query "SELECT ?s WHERE { ?s ?p ?o }"

# Extended timeout (60s)
EXOCORTEX_SPARQL_TIMEOUT=60 npx @kitelev/exocortex-cli sparql query "SELECT ..."

# Very long timeout for analytical queries (5 min)
EXOCORTEX_SPARQL_TIMEOUT=300 npx @kitelev/exocortex-cli sparql query "SELECT (COUNT(*) AS ?count) WHERE { ... }"
```

### Investigation Pattern for Timeout Issues

When facing SPARQL timeout issues:

1. **Identify query complexity**:
   ```bash
   # Check estimated result size
   npx @kitelev/exocortex-cli sparql query "SELECT (COUNT(*) AS ?n) WHERE { ... }"
   ```

2. **Profile with extended timeout**:
   ```bash
   EXOCORTEX_SPARQL_TIMEOUT=120 time npx @kitelev/exocortex-cli sparql query "..."
   ```

3. **Optimize query if needed**:
   - Add LIMIT clause for large result sets
   - Use more specific WHERE patterns
   - Break into smaller date ranges for analytical queries

### Key Insight from Issue #2233

**Problem**: Analytical queries (aggregations over many days) timed out, blocking `/self-audit` and similar skills.

**Root Cause Analysis** (54 steps):
- Default timeout too short for analytical queries
- No user-configurable timeout option
- Error messages didn't guide users to solutions

**Solution** (PR #2234):
- Added `EXOCORTEX_SPARQL_TIMEOUT` environment variable
- Clear error messages with usage examples
- Default remains 30s (fast for typical queries)

**Reference**: Issue #2233 - SPARQL Timeout Investigation (54 steps, February 2026)

---

## Component Variant Coverage Pattern

**When to use**: Implementing UI features that must work across multiple component variants (regular items, empty slots, grouped items, etc.)

### Pattern Description

When adding a new feature to a UI component (like a table or tree), ensure ALL variants of that component receive the feature. Common variants include:
- Regular items
- Empty slots / placeholder items
- Grouped / aggregated items
- Archived items
- Error states

### Real-World Example: Dynamic Time Calculation (February 2026)

**Parent Feature (Issue #2236)**: Added `calculateTimeFromTimestamps()` to calculate time from timestamps when explicit estimate is missing.

| Component | Implementation | Status |
|-----------|---------------|--------|
| Regular Tasks | ✅ Updated Time column | Done in #2236 |
| Empty Slots | ❌ Missed initially | Fixed in #2238 |

**Root Cause of Follow-up Issue #2238:**
```typescript
// createEmptySlot() returned metadata: {} 
// But calculateTimeFromTimestamps() expected:
// - ems__Effort_startTimestamp
// - ems__Effort_endTimestamp
// Empty Slots had timestamps in different structure (startTimestamp/endTimestamp)
```

**Key Metrics:**
- #2236: 50 steps, 244 additions, 15 unit tests
- #2238: 62 steps, 235 additions, 6 unit tests (fix for missed variant)
- Combined: 112 steps, 21 tests

### Implementation Checklist for New UI Features

Before considering a UI feature complete:

```markdown
- [ ] **Regular items** - Main use case implemented and tested
- [ ] **Empty slots/placeholders** - Feature works for placeholder items
- [ ] **Metadata mapping** - Property names consistent across all variants
- [ ] **Edge cases** - Null/undefined/invalid values handled
- [ ] **Unit tests per variant** - Each variant has dedicated test coverage
```

### Anti-Pattern: Incomplete Variant Coverage

**❌ WRONG (Issue #2238 scenario):**
```typescript
// Feature implementation only for regular tasks
const timeValue = calculateTimeFromTimestamps(task.metadata);
// BUT: Empty Slots have different metadata structure → shows nothing
```

**✅ CORRECT (Complete coverage):**
```typescript
// 1. Check all component variants
const variants = ['regularTasks', 'emptySlots', 'groupedTasks'];

// 2. Ensure metadata structure is consistent
function createEmptySlot(start: string, end: string) {
  return {
    metadata: {
      // Map timestamps to expected property names
      ems__Effort_startTimestamp: start,
      ems__Effort_endTimestamp: end,
    }
  };
}

// 3. Feature works for all variants
variants.forEach(variant => {
  const timeValue = calculateTimeFromTimestamps(item.metadata);
  // Works consistently across all variants
});
```

### Testing Strategy for Variant Coverage

```typescript
describe('Time Column Feature', () => {
  // Test each variant explicitly
  describe('Regular Tasks', () => {
    it('should calculate time from actual timestamps', () => { ... });
    it('should fall back to planned timestamps', () => { ... });
  });

  describe('Empty Slots', () => {
    it('should calculate time from slot timestamps', () => { ... });
    it('should handle slots without timestamps', () => { ... });
  });

  // Cross-variant consistency test
  describe('Cross-Variant Consistency', () => {
    it('should produce same output format for all variants', () => {
      const regular = calculateTimeFromTimestamps(regularTask.metadata);
      const empty = calculateTimeFromTimestamps(emptySlot.metadata);
      // Both return same format (number | null)
      expect(typeof regular).toBe(typeof empty);
    });
  });
});
```

### Benefits

- **Prevents follow-up fixes**: Catch all variants in initial implementation
- **Consistent UX**: All component states behave uniformly
- **Reduced step count**: One comprehensive PR vs feature + fix PR
- **Better test coverage**: Explicit tests for each variant

### When to Apply

Use this pattern when implementing:
- Table columns with calculated values
- Tree node decorations (icons, badges)
- Status indicators
- Any computed UI element

**Key Questions to Ask:**
1. "What other item types exist in this component?"
2. "Do placeholder/empty items use the same metadata structure?"
3. "Are there grouped/aggregated views that need this feature?"

**Reference**: Issues #2236 + #2238 - Dynamic Time Column (112 combined steps, February 2026)
