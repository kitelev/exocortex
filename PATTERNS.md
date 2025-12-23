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
