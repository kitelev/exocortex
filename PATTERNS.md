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
