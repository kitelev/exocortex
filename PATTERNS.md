# Development Patterns

Common coding patterns and best practices discovered during Exocortex development.

> Dated sprint / post-mortem retrospectives (records of specific past work batches, not
> reusable techniques) have moved to a frozen archive: [docs/history/PATTERNS-sprint-retrospectives-2026-06-19.md](docs/history/PATTERNS-sprint-retrospectives-2026-06-19.md).

## Contents

- [Timestamp-Based Sorting Pattern](#timestamp-based-sorting-pattern)
- [Documentation Task Pattern](#documentation-task-pattern)
- [Shared Utility Pattern for Cross-Table Features](#shared-utility-pattern-for-cross-table-features)
- [Status Priority Sorting Pattern](#status-priority-sorting-pattern)
- [Obsidian File Lookup Pattern](#obsidian-file-lookup-pattern)
- [Wikilink Properties Normalization Pattern](#wikilink-properties-normalization-pattern)
- [Cardinality-Aware Wikilink Serialization Pattern](#cardinality-aware-wikilink-serialization-pattern)
- [Optional Cross-Layer Dependencies Pattern](#optional-cross-layer-dependencies-pattern)
- [Sequential Related Tasks Pattern](#sequential-related-tasks-pattern)
- [SPARQL Test Coverage Pattern](#sparql-test-coverage-pattern)
- [TypeScript Tooling Limitations](#typescript-tooling-limitations)
- [TSyringe DI with esbuild Build](#tsyringe-di-with-esbuild-build)
- [Test File Splitting Pattern](#test-file-splitting-pattern)
- [Module Export Pattern](#module-export-pattern)
- [SPARQL 1.2 Feature Implementation Pattern](#sparql-12-feature-implementation-pattern)
- [Timezone-Safe DateTime Serialization Pattern](#timezone-safe-datetime-serialization-pattern)
- [Mobile Table Layout Pattern](#mobile-table-layout-pattern)
- [Directional Language Tag Pattern](#directional-language-tag-pattern)
- [Batch Code Scanning Fix Pattern](#batch-code-scanning-fix-pattern)
- [Split-Join Pattern for Regex Replacement](#split-join-pattern-for-regex-replacement)
- [Feature Cluster Development Pattern](#feature-cluster-development-pattern)
- [Layered Architecture Implementation Pattern](#layered-architecture-implementation-pattern)
- [Obsidian API Monkey-Patching Pattern](#obsidian-api-monkey-patching-pattern)
- [External Plugin API Pattern](#external-plugin-api-pattern)
- [Toggle Component Pattern](#toggle-component-pattern)
- [Web Worker Security Pattern](#web-worker-security-pattern)
- [Small UI Enhancement Pattern](#small-ui-enhancement-pattern)
- [Duplicate Code Scanning Alert Pattern](#duplicate-code-scanning-alert-pattern)
- [Jest Hanging in CI Pattern](#jest-hanging-in-ci-pattern)
- [Prototype-Pollution Prevention Pattern](#prototype-pollution-prevention-pattern)
- [Phased Feature Implementation Pattern](#phased-feature-implementation-pattern)
- [Body Link Indexing Pattern](#body-link-indexing-pattern)
- [UI Regression Detection Pattern](#ui-regression-detection-pattern)
- [Simple UI Enhancement Pattern](#simple-ui-enhancement-pattern)
- [Markdown Post-Processor Pattern](#markdown-post-processor-pattern)
- [Spec-First Implementation Pattern](#spec-first-implementation-pattern)
- [Frontmatter Empty Array Handling Pattern](#frontmatter-empty-array-handling-pattern)
- [Regression Detection Pattern](#regression-detection-pattern)
- [Iterative Spec Alignment Pattern](#iterative-spec-alignment-pattern)
- [Research-to-Decision Pattern](#research-to-decision-pattern)
- [CLI Performance Cache Pattern](#cli-performance-cache-pattern)
- [Major Feature Removal Pattern](#major-feature-removal-pattern)
- [Wikilink Alias Handling Pattern](#wikilink-alias-handling-pattern)
- [Idempotency Pattern for Sync Operations](#idempotency-pattern-for-sync-operations)
- [Post-Removal Dependency Cleanup Pattern](#post-removal-dependency-cleanup-pattern)
- [RDF Dual Storage Pattern for UUID-based Wikilinks](#rdf-dual-storage-pattern-for-uuid-based-wikilinks)
- [Side-Channel Triple Emission Pattern](#side-channel-triple-emission-pattern)
- [Baseline Test Count Before Bug Fix](#baseline-test-count-before-bug-fix)
- [Dead Code Elimination Pattern](#dead-code-elimination-pattern)
- [Dual Identifier Backward Compatibility Pattern](#dual-identifier-backward-compatibility-pattern)
- [Metadata Cache Fallback Pattern](#metadata-cache-fallback-pattern)
- [Task Period Overlap Detection Pattern](#task-period-overlap-detection-pattern)
- [UUID Wikilink Resolution Pattern](#uuid-wikilink-resolution-pattern)
- [Virtualized Table Scrollbar Compensation Pattern](#virtualized-table-scrollbar-compensation-pattern)
- [Class-Based Filtering Pattern for Detection Algorithms](#class-based-filtering-pattern-for-detection-algorithms)
- [Command Implementation Pattern with Timestamp Service](#command-implementation-pattern-with-timestamp-service)
- [CodeMirror 6 Label Replacement Pattern](#codemirror-6-label-replacement-pattern)
- [Prototype Class Inheritance Pattern](#prototype-class-inheritance-pattern)
- [Block Reference Wikilink Pattern](#block-reference-wikilink-pattern)
- [Property Name Verification Pattern](#property-name-verification-pattern)
- [Obsidian Wikilink Text Rendering Variations Pattern](#obsidian-wikilink-text-rendering-variations-pattern)
- [FunctionReplacer Pattern for Obsidian Patches](#functionreplacer-pattern-for-obsidian-patches)
- [Obsidian Patch Lifecycle Pattern](#obsidian-patch-lifecycle-pattern)
- [MutationObserver DOM Coverage Pattern](#mutationobserver-dom-coverage-pattern)
- [Frontmatter Array Preservation Pattern](#frontmatter-array-preservation-pattern)
- [Virtualized Table Column Alignment Pattern](#virtualized-table-column-alignment-pattern)
- [CodeMirror Callout Context Pattern](#codemirror-callout-context-pattern)
- [Toggle Button State Management Pattern](#toggle-button-state-management-pattern)
- [Copy Command Pattern](#copy-command-pattern)
- [RDF/IRI Validation Pattern](#rdfiri-validation-pattern)
- [Button Group Implementation Pattern](#button-group-implementation-pattern)
- [SPARQL Timeout Configuration Pattern](#sparql-timeout-configuration-pattern)
- [Component Variant Coverage Pattern](#component-variant-coverage-pattern)
- [Archive/Unarchive CLI Pattern](#archiveunarchive-cli-pattern)
- [PrintNameRule Pattern](#printnamerule-pattern)
- [Cross-Vault SPARQL Pattern](#cross-vault-sparql-pattern)
- [First-Launch Modal Pattern (E2E-safe)](#first-launch-modal-pattern-e2e-safe)
- [BFS subClass Closure via metadataCache](#bfs-subclass-closure-via-metadatacache)
- [Collision Guard Pattern for Cache Deduplication](#collision-guard-pattern-for-cache-deduplication)
- [Archived — sprint & post-mortem retrospectives](#archived--sprint--post-mortem-retrospectives)

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
  startTime: string; // Display: "09:00"
  startTimestamp: number; // Sort: 1736928000000
}

tasks.sort((a, b) => {
  const aTime = a.startTimestamp ? new Date(a.startTimestamp).getTime() : 0;
  const bTime = b.startTimestamp ? new Date(b.startTimestamp).getTime() : 0;
  return aTime - bTime; // Numeric comparison
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
  static checkCondition(
    app: ObsidianApp,
    metadata: Record<string, unknown>,
  ): boolean {
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
**Used by:** DailyTasksRenderer, RelationsRenderer
**Displayed in:** DailyTasksTable, AssetRelationsTable
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
const priorityItems = filtered.filter((item) => item.isPriority);
const normalItems = filtered.filter((item) => !item.isPriority);

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
- Resolving prototype references (e.g., `exo__Asset_prototype`)
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

**Solution**: Normalize all wikilink property values before setting them in frontmatter. (The helper below is illustrative — there is no `ensureQuotedWikilink` in the codebase today; the live quoting logic sits inside `GenericAssetCreationService.formatPropertyValueWithCardinality`, see the next pattern.)

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
    exo__Asset_isDefinedBy: "[[Custom/Ontology]]", // Without quotes!
  };

  const result = await service.createAsset(parentMetadata);
  const content = await vault.read(result);

  // Should add quotes around the wikilink
  expect(content).toContain('exo__Asset_isDefinedBy: "[[Custom/Ontology]]"');
  // Should NOT have unquoted wikilink
  expect(content).not.toContain("exo__Asset_isDefinedBy: [[Custom/Ontology]]");
});

it("should preserve already quoted wikilinks", async () => {
  const parentMetadata = {
    exo__Asset_isDefinedBy: '"[[Custom/Ontology]]"', // Already quoted
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

- All service classes that create frontmatter (`GenericAssetCreationService`, `ClassCreationService`, `ConceptCreationService` — the former `TaskCreationService`/`ProjectCreationService` were replaced by `GenericAssetCreationService`)
- Any code that modifies wikilink properties
- Import/migration scripts

**Reference**: Issue #407 - `exo__Asset_isDefinedBy` not quoted in ClassCreationService

---

## Cardinality-Aware Wikilink Serialization Pattern

**When to use**: Writing services that emit frontmatter for vault assets and need to honour single-valued vs multi-valued property semantics declared in the SHACL-lite ontology.

**Problem**: Wrapping every wikilink value in a YAML array regardless of cardinality produces noise — `ems__Effort_status: - "[[…]]"` reads worse than the canonical `ems__Effort_status: "[[…]]"`, and it diverges from hand-authored content. Hardcoding a per-property allow-list is brittle and duplicates the ontology source of truth.

**Solution**: Load `ShapeRegistry` from the vault and route the cardinality check through it.

```typescript
import {
  Namespace,
  ShapeLoader,
  type ShapeRegistry,
} from "@kitelev/exocortex-core";

// 1. Load the registry once per CLI/service invocation
let shapeRegistry: ShapeRegistry | undefined;
try {
  shapeRegistry = await ShapeLoader.loadFromVaultFS(vaultPath);
} catch {
  // Fail-soft: legacy array-wrap behaviour is the safe default
  shapeRegistry = undefined;
}

// 2. Inside the serializer: scalar vs array based on declared cardinality
function formatPropertyValue(
  key: string,
  value: string,
  registry?: ShapeRegistry,
): string | string[] {
  if (!value.includes("[[")) return value; // plain scalar
  const quoted = value.startsWith('"') ? value : `"${value}"`;

  const parsed = Namespace.fromPropertyKey(key);
  const iri = parsed ? parsed.namespace.term(parsed.localName).value : null;
  const shape = iri ? registry?.get(iri) : undefined;

  return shape?.cardinality === "Single" ? quoted : [quoted];
}
```

### Properties that must be present on the property asset

```yaml
# assetspaces/ems/<property-uid>.md  (UUID-canon: filename = exo__Asset_uid)
exo__Asset_label: ems__Effort_status
exo__Instance_class:
  - "[[9a1cf31c-9d41-4ef3-9023-584a8d087d16]]" # exo__ObjectProperty (strip-canon UID wikilink)
exo__Property_domain: "[[ems__Effort]]"
exo__Property_range: "[[ems__EffortStatus]]"
exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"
```

`ShapeLoader.processFile` accepts a filename-basename fallback when `exo__Asset_label` is missing, so legacy ontology files keep working without migration. See `docs/reference/PROPERTY_SCHEMA.md` → "Property Cardinality Declarations".

### Backward-compat invariants (do not violate)

- Properties **without** an `exo__Property_cardinality` declaration must keep the legacy array-wrap behaviour.
- Properties declared `PropertyCardinalityMultiple` must also keep the array-wrap behaviour.
- Only `PropertyCardinalitySingle` flips to scalar.

These invariants protect existing callers and avoid mass vault rewrites when new code lands.

**Reference Implementations**:

- `GenericAssetCreationService.formatPropertyValueWithCardinality()` (`packages/core/src/services/GenericAssetCreationService.ts`, ~line 605) — cardinality lookup against optional `ShapeRegistry`; ported from the former CLI `AssetCreationService`.
- `ShapeLoader.processFile()` — filename-basename fallback for property assets that omit `exo__Asset_label`.

**Reference**: Issue #3099 — `cli create` ignored cardinality declarations and emitted YAML arrays unconditionally.

---

## Optional Cross-Layer Dependencies Pattern

**When to use**: A core service needs to trigger a surface-specific side-effect (open file, show notification, refresh layout) but the side-effect doesn't belong in the core's responsibility.

**Pattern**: Don't bake the side-effect into the core. Define a small interface (`IFileOpener`, `IRefreshAfter…`), accept it as an _optional_ constructor argument, and `await it?.(args)` at the call site. Tests and CLI surfaces omit the dep; the platform layer wires its implementation.

```ts
// Core service — no opener dependency baked in
class CommandExecutionFlow {
  constructor(
    private deps: CoreDeps,
    private opener?: IFileOpener, // optional
  ) {}

  async execute(cmd: Command): Promise<ExecutionResult> {
    const result = await this.run(cmd);
    if (result.openPath) {
      await this.opener?.(result.openPath); // no-op if absent
    }
    return result;
  }
}

// Obsidian wiring layer — provides the platform-specific opener
const opener: IFileOpener = async (path) => {
  const af = app.vault.getAbstractFileByPath(path);
  if (af instanceof TFile) {
    await app.workspace.getLeaf("tab").openFile(af);
  }
};
new CommandExecutionFlow(deps, opener);

// CLI / tests — no opener arg, side-effect simply doesn't fire
new CommandExecutionFlow(deps);
```

**Key properties**:

- Core test fixtures stay unchanged (they pass 3 args)
- Headless CLI path stays unchanged (no opener)
- One-line surface added on the Obsidian wiring side
- Side-effect is platform-conditional without conditionals scattered through the core

**Reference**: PR #3189 — `GroundingExecutor` returns `ExecutionResult.openPath`; `CommandExecutionFlow` consumes via optional `IFileOpener`; `ObsidianFileOpener` opens the file in a new tab (B5 fix for #3184).

---

## Sequential Related Tasks Pattern

**When to use**: Implementing multiple related features in same subsystem

**Pattern**: Complete features sequentially while context is warm, rather than spacing them weeks apart.

### Productivity Gains

| Phase                             | Time   | Speed Multiplier | Notes                 |
| --------------------------------- | ------ | ---------------- | --------------------- |
| **Cold start** (first feature)    | 100%   | 1.0x             | Baseline              |
| **Warm context** (second feature) | 60-70% | 1.5-2.0x         | Architecture familiar |
| **Hot context** (third+ feature)  | 50-60% | 2.0-2.5x         | Patterns internalized |

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

# 3. Identify untested scenarios (script lives in the exocortex workspace, not repo root)
npm run test:coverage -w @kitelev/exocortex-core -- --collectCoverageFrom="src/infrastructure/sparql/**"
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
import esbuildPluginTsc from "esbuild-plugin-tsc";

const plugins = [
  esbuildPluginTsc({
    force: true, // Always use tsc for .ts files
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

| Category                | Description                | Example Tests                                 |
| ----------------------- | -------------------------- | --------------------------------------------- |
| `*.status.test.ts`      | Status transition commands | canMoveToBacklog, canStartEffort, canMarkDone |
| `*.creation.test.ts`    | Entity creation commands   | canCreateTask, canCreateProject               |
| `*.maintenance.test.ts` | Cleanup/repair commands    | canArchiveTask, canCleanProperties            |
| `*.voting.test.ts`      | Voting-related commands    | canVoteOnEffort                               |
| `*.conversion.test.ts`  | Type conversion commands   | canConvertTaskToProject                       |

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

| LOC      | Action                                              |
| -------- | --------------------------------------------------- |
| < 500    | Acceptable (target)                                 |
| 500-1000 | Consider splitting if clear domain boundaries exist |
| > 1000   | Must split (blocking for new PRs)                   |

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

**Problem**: Component tests failed with "Cannot find module '@kitelev/exocortex-core/domain/errors'"

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

| Step | Issue | Description                                | Time     |
| ---- | ----- | ------------------------------------------ | -------- |
| 1    | #951  | QuotedTriple data model class              | 68 steps |
| 2    | #952  | TRIPLE() constructor function              | 74 steps |
| 3    | #954  | isTRIPLE() type checker                    | 80 steps |
| 4    | #953  | SUBJECT(), PREDICATE(), OBJECT() accessors | 91 steps |
| 5    | #955  | Parser for `<<( s p o )>>` syntax          | 85 steps |

**Key insight**: Each step builds on the previous. TRIPLE() needs QuotedTriple class, accessors need TRIPLE(), parser creates QuotedTriple instances.

### DateTime Arithmetic Implementation (Issues #973-975, #988-990)

| Step | Issue | Description                    |
| ---- | ----- | ------------------------------ |
| 1    | #973  | date + duration arithmetic     |
| 2    | #974  | date - duration arithmetic     |
| 3    | #975  | duration + duration arithmetic |
| 4    | #988  | duration comparison operators  |
| 5    | #990  | YEARS() and MONTHS() accessors |

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
const userInput = "2025-12-17T20:05";
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
    return userInput + ":00"; // "2025-12-17T20:05:00"
  }
  return userInput;
}
```

### Alternative: Use Luxon for Local Time

```typescript
import { DateTime } from "luxon";

function serializeTimestamp(userInput: string): string {
  const local = DateTime.fromFormat(userInput, "yyyy-MM-dd'T'HH:mm", {
    zone: "local",
  });
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}
```

### Testing Timezone Handling

```typescript
describe("EMS timestamp serialization", () => {
  it("should preserve local time without offset", () => {
    const userInput = "2025-12-17T20:05";
    const result = serializeTimestamp(userInput);
    expect(result).toBe("2025-12-17T20:05:00");
  });

  it("should handle start and end timestamps identically", () => {
    const start = serializeTimestamp("2025-12-17T20:00");
    const end = serializeTimestamp("2025-12-17T20:05");
    // Both should preserve local time
    expect(start).toBe("2025-12-17T20:00:00");
    expect(end).toBe("2025-12-17T20:05:00");
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
  min-width: 0; /* Critical for text-overflow to work! */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Time columns: fixed width */
.col-start,
.col-end {
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
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
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 12", width: 390, height: 844 },
  { name: "iPad Mini", width: 768, height: 1024 },
];

viewports.forEach(({ name, width, height }) => {
  test(`table layout on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Test column proportions
    const nameCol = await page.locator(".col-name").boundingBox();
    const startCol = await page.locator(".col-start").boundingBox();
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

| Priority | Category          | Examples                                                            | Step Count   |
| -------- | ----------------- | ------------------------------------------------------------------- | ------------ |
| **P0**   | Security-critical | Incomplete string escaping, insecure randomness, weak crypto        | 30-63 steps  |
| **P1**   | Code correctness  | Useless assignments, unreachable code, identical operands           | 34-117 steps |
| **P2**   | Code quality      | Overwritten properties, undeclared variables, superfluous arguments | 25-54 steps  |
| **P3**   | Cleanup           | Unused variables, ASI issues                                        | 25-79 steps  |

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
result = anotherOperation(); // First value never used

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
if (value === value) {
} // Always true (except NaN)

// ✅ FIX: Use correct comparison
if (value === expectedValue) {
}

// Exception: NaN check (prefer Number.isNaN)
if (Number.isNaN(value)) {
} // Instead of value !== value
```

#### Comparison Between Inconvertible Types

```typescript
// ❌ ALERT: String compared to number will never be true
if (id === 42) {
} // id is string

// ✅ FIX: Match types
if (id === "42") {
}
// Or convert
if (Number(id) === 42) {
}
```

### Metrics from December 2025 Sprint

| Metric                  | Value                                      |
| ----------------------- | ------------------------------------------ |
| Total issues            | 41                                         |
| Total PRs               | 41                                         |
| Average steps per issue | ~55                                        |
| Minimum steps           | 25 (simple unused variable removal)        |
| Maximum steps           | 117 (complex expression-has-no-effect fix) |
| Security issues (P0)    | 9                                          |
| Correctness issues (P1) | 18                                         |
| Quality issues (P2)     | 7                                          |
| Cleanup issues (P3)     | 7                                          |

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

| Issue | Feature                                  | Steps | Time    |
| ----- | ---------------------------------------- | ----- | ------- |
| #1143 | Show `exo__Asset_label` in File Explorer | 99    | ~90min  |
| #1144 | Show `exo__Asset_label` in Tab Titles    | 78    | ~60min  |
| #1145 | Template system for display names        | 114   | ~80min  |
| #1146 | Sort File Explorer by label              | 162   | ~100min |
| #1149 | Per-class display name templates         | 148   | ~90min  |

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

| Layer | Issue | Description                      | Steps | Additions |
| ----- | ----- | -------------------------------- | ----- | --------- |
| 1     | #1151 | Graph data model + triple store  | 115   | +1943     |
| 2     | #1152 | Node/edge type system + ontology | 98    | +2389     |
| 3     | #1153 | Zustand state management         | 195   | +3424     |

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
  shape: "circle" | "rectangle" | "diamond";
}

// Create type guards and validators
function isTaskNode(node: GraphNode): boolean {
  return node.types.includes("ems__Task");
}
```

#### Layer 3: State Management (#1153)

> The original graph stores (`useGraphStore`, `graphConfigStore`) were removed with the graph-visualization feature (#2083), and the `immer` middleware is no longer a dependency. The **live** Zustand stores following this layer pattern are `useTableSortStore` and `useUIStore` (`packages/obsidian-plugin/src/presentation/stores/`):

```typescript
// tableSortStore.ts (live code, abridged) — plain zustand + devtools + persist
export const useTableSortStore = create<TableSortStore>()(
  devtools(
    persist(
      (set) => ({
        ...DEFAULT_TABLE_SORT_STATE,

        setSort: (table, column, order) =>
          set(
            () => ({ [table]: { column, order } }),
            false,
            `setSort:${table}`,
          ),

        toggleSort: (table, column) =>
          set(
            (state) => {
              const currentSort = state[table];
              const newOrder =
                currentSort.column === column && currentSort.order === "asc"
                  ? "desc"
                  : "asc";
              return { [table]: { column, order: newOrder } };
            },
            false,
            `toggleSort:${table}:${column}`,
          ),
      }),
      { name: "exocortex-table-sort-v1" },
    ),
  ),
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
// FileExplorerLabelPatch.ts (packages/obsidian-plugin/src/presentation/fileexplorer/)
export class FileExplorerLabelPatch {
  private plugin: ExocortexPlugin;
  private originalMethod: Function | null = null;
  private isPatched = false;

  constructor(plugin: ExocortexPlugin) {
    this.plugin = plugin;
  }

  enable(): void {
    if (this.isPatched) return;

    // Find internal component
    const fileExplorer =
      this.plugin.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
    if (!fileExplorer) return;

    // Store original method
    this.originalMethod =
      fileExplorer.fileItems.constructor.prototype.updateTitle;

    // Apply patch
    const self = this;
    fileExplorer.fileItems.constructor.prototype.updateTitle = function (
      this: FileItem,
    ) {
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
    const fileExplorer =
      this.plugin.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
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

| Feature              | Patched Component          | Method         |
| -------------------- | -------------------------- | -------------- |
| File Explorer labels | FileExplorerView.fileItems | updateTitle    |
| Tab titles           | WorkspaceLeaf              | getDisplayText |
| Sorting              | FileExplorerView           | sortFiles      |

### Testing Monkey-Patches

```typescript
describe("FileExplorerLabelPatch", () => {
  it("should restore original method on disable", () => {
    const patch = new FileExplorerLabelPatch(mockPlugin);
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
  on(event: "label-changed", callback: LabelChangedCallback): EventRef;
  on(event: "metadata-changed", callback: MetadataChangedCallback): EventRef;
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
    this.register(() => {
      this.api = null;
    });
  }
}
```

### Consumer Usage

```typescript
// In other plugin
const exocortex = this.app.plugins.getPlugin("exocortex") as
  | ExocortexPlugin
  | undefined;

if (exocortex?.api) {
  // Get label for current file
  const label = exocortex.api.getAssetLabel(activeFile.path);

  // Subscribe to changes
  const ref = exocortex.api.on("label-changed", (path, old, new_) => {
    console.log(`Label changed: ${old} → ${new_}`);
  });

  // Clean up subscription
  this.register(() => exocortex.api?.off("label-changed", ref));
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
declare module "exocortex" {
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

| Plugin           | Use Case                     |
| ---------------- | ---------------------------- |
| Dataview         | Show labels in query results |
| TagFolder        | Sort by semantic labels      |
| Quick Switcher++ | Search by labels             |
| Templater        | Access metadata in templates |

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

| Component                   | Location         | State Key    |
| --------------------------- | ---------------- | ------------ |
| DailyTasksTableWithToggle   | DailyNote layout | showArchived |
| AssetRelationsTable         | Relations block  | showArchived |
| AreaHierarchyTreeWithToggle | Area hierarchy   | showArchived |

### Benefits

- **Consistent UX**: Same toggle behavior across all components
- **State persistence**: Zustand persists user preference
- **Minimal re-renders**: Toggle only affects affected component
- **Recursive support**: Works with nested tree structures

**Reference**: Issue #1142 - Area hierarchy archived toggle (PR #1148, 86 steps)

---

## Web Worker Security Pattern

**When to use**: Handling `postMessage` events and dynamic property keys in any future Worker / message-handler code

> **Historical note**: the original examples lived in `physics.worker.ts` (graph-visualization physics worker, removed with #2083). No Web Workers exist in `packages/*/src` today — the rules below are kept as compact generic guidance for CodeQL alerts `js/missing-origin-check` and `js/remote-property-injection`.

```typescript
// 1. Origin check (js/missing-origin-check): verify AND act on it — early return.
//    Same-origin workers receive '' (empty string) as origin.
self.onmessage = (event: MessageEvent) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  processCommand(event.data);
};

// 2. Dynamic property keys (js/remote-property-injection): allowlist, never raw.
const ALLOWED = new Set(["x", "y", "vx", "vy"]);
function setNodeProperty(node: object, key: string, value: number): void {
  if (!ALLOWED.has(key)) throw new Error(`Invalid property: ${key}`);
  (node as Record<string, number>)[key] = value;
}
```

Key insights: CodeQL flags code that _reads_ `event.origin` but doesn't conditionally block; prefer discriminated-union message types so TypeScript enforces the allowed property set at compile time. See also «Prototype-Pollution Prevention Pattern» in this document.

**Reference**: Issues #1211/#1248 (origin check), #1212/#1244 (property injection) — historical fixes in the removed `physics.worker.ts`

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
const WCAG_AA_NORMAL = 4.5; // Normal text
const WCAG_AA_LARGE = 3.0; // Large text (>18px or >14px bold)
const WCAG_AAA = 7.0; // Enhanced compliance

// Recommended green button colors (meet WCAG AA)
const GREEN_BUTTON = {
  background: "#10b981", // Tailwind green-500
  text: "white", // Contrast ratio: 5.8:1 ✓
  hover: "#059669", // Tailwind green-600
  active: "#047857", // Tailwind green-700
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

| Original Issue | Duplicate Issue | Alert                        | Resolution             |
| -------------- | --------------- | ---------------------------- | ---------------------- |
| #1211          | #1248           | js/missing-origin-check      | Single fix closed both |
| #1212          | #1244           | js/remote-property-injection | Line shift, same fix   |

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

## Jest Hanging in CI Pattern

**When to use**: Debugging tests that pass but cause Jest to hang in CI

### Symptoms

- All tests complete successfully (11,400+ tests across all packages)
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
    if (typeof source[key] === "object") {
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
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeMerge<T extends object>(target: T, source: Partial<T>): T {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue; // Skip dangerous keys
    }

    const sourceValue = source[key as keyof T];
    if (sourceValue !== undefined && sourceValue !== null) {
      if (typeof sourceValue === "object" && !Array.isArray(sourceValue)) {
        (target as any)[key] = safeMerge(
          (target as any)[key] || {},
          sourceValue as object,
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
  config: { ...state.config, ...partialConfig },
}));

// ✅ SAFE: Validate properties before merging
const ALLOWED_CONFIG_KEYS = new Set(["theme", "layout", "zoom"]);

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
  config: { ...state.config, ...safeConfigUpdate(partialConfig) },
}));
```

### Locations Fixed (historical)

- `graphConfigStore/store.ts` — layout/theme config updates (store removed together with the graph visualization feature, #2083). Surviving Zustand stores to apply this pattern to: `tableSortStore`, `uiStore` (`packages/obsidian-plugin/src/`).

### Reference

- Issues #1206, #1261: P1 prototype-pollution fixes
- CodeQL rule: `js/prototype-pollution-utility`

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

| Phase | Issue | Description                       | Steps |
| ----- | ----- | --------------------------------- | ----- |
| 1     | #1333 | Properties block link replacement | 117   |
| 2     | #1334 | Body content link replacement     | 77    |
| 3     | #1336 | Fix delete button regression      | 63    |

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

### Implementation (actual: `NoteToRDFConverter.convertBodyWikilinks`)

Body links are emitted by `NoteToRDFConverter.convertBodyWikilinks(file, subject)` (`packages/core/src/services/NoteToRDFConverter.ts`, ~line 1541), called from the main conversion path:

```typescript
// NoteToRDFConverter.convertBodyWikilinks (abridged)
async convertBodyWikilinks(file: IFile, subject: IRI): Promise<Triple[]> {
  const triples: Triple[] = [];
  const content = await this.vault.read(file);
  const bodyContent = this.extractBodyContent(content); // strips frontmatter
  const wikilinks = this.extractBodyWikilinks(bodyContent); // dedupe + alias handling

  const bodyLinkPredicate = Namespace.EXO.term("Asset_bodyLink");

  for (const linkTarget of wikilinks) {
    const targetFile = this.vault.getFirstLinkpathDest(linkTarget, file.path);
    if (targetFile) {
      // Resolves to a file → file IRI object
      triples.push(new Triple(subject, bodyLinkPredicate, this.notePathToIRI(targetFile.path)));
    } else if (this.isClassReference(linkTarget)) {
      // ems__/exo__ class reference → symbolic class IRI (literal fallback)
      // ...
    } else {
      // Unresolved → stored as Literal for discoverability
      triples.push(new Triple(subject, bodyLinkPredicate, new Literal(linkTarget)));
    }
  }
  return triples;
}
```

### Edge Cases to Handle

1. **Alias syntax**: `[[Target|Display Text]]` → extract "Target" only
2. **Code blocks**: Exclude wikilinks inside ``` or inline code
3. **Duplicate links**: Same link appears multiple times → deduplicate triples
4. **Unresolved targets**: `[[Non-existent]]` → stored as **Literal** object (discoverability), not skipped

### Predicate Choice

- **`exo:Asset_bodyLink`** is the **canonical predicate** for body links — it distinguishes implicit (body) links from explicit frontmatter relations
- `exo:Asset_relates` is NOT used for body links (it is a frontmatter-declared relation); querying for "all relations" must UNION both predicates

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
link.querySelector(".text-content").textContent = formattedText;
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

| Issue | Change                         | Steps | Time    |
| ----- | ------------------------------ | ----- | ------- |
| #1331 | Show button for all DailyNotes | 7     | ~15 min |
| #1339 | Make button green              | 21    | ~30 min |

### Implementation Pattern

```typescript
// Before: Conditional visibility with date check
function shouldShowButton(asset: Asset): boolean {
  if (!asset.hasClass("pn__DailyNote")) return false;
  const date = extractDate(asset);
  return isToday(date) || isYesterday(date); // ❌ Restrictive
}

// After: Simple class check
function shouldShowButton(asset: Asset): boolean {
  return asset.hasClass("pn__DailyNote"); // ✅ Always show for class
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

> **Current state (2026-06)**: the plugin does **NOT** register a generic markdown post-processor. The only registered processors are the `sparql` / `exoql` / `exo-layout` **codeblock** processors (`registerMarkdownCodeBlockProcessor` in `ExocortexPlugin.ts`). Body-link label replacement is implemented via the MutationObserver-based `BodyLinkPatch` (`packages/obsidian-plugin/src/presentation/body/BodyLinkPatch.ts`) — see «MutationObserver DOM Coverage Pattern» in this document. The code below is a generic Obsidian API illustration, not current plugin code.

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
      const href = link.getAttribute("href");
      if (!href) continue;

      try {
        const formatted = await this.assetLinkRenderer.format(href);
        link.textContent = formatted;
      } catch (error) {
        console.warn("Failed to format asset link:", href, error);
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
  frontmatter: Record<string, unknown>,
): ValidationResult {
  const allowed = new Set(ALLOWED_PROPERTIES[type]);

  for (const key of Object.keys(frontmatter)) {
    if (!allowed.has(key)) {
      return {
        valid: false,
        error: `Forbidden property "${key}". Allowed: ${Array.from(allowed).join(", ")}`,
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
  localName: string; // ❌ Not in spec - added for convenience
  label?: string; // ❌ Not in spec - "makes sense"
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
  updates: Record<string, any>,
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

    const aliasKeys = Object.keys(result).filter((k) => k === "aliases");
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
  for (const [type, forbidden] of Object.entries(
    FORBIDDEN_PROPERTIES_BY_TYPE,
  )) {
    for (const prop of forbidden) {
      it(`should reject ${type} with forbidden property "${prop}"`, () => {
        const frontmatter = { metadata: type, uri: "test://", [prop]: "value" };
        expect(() => validate(frontmatter)).toThrow(
          `Forbidden property: ${prop}`,
        );
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
const specAllowed = new Set([
  "metadata",
  "uri",
  "aliases",
  "subject",
  "predicate",
  "object",
]);
const actual = Object.keys(currentImplementation.interface);

const violations = actual.filter((prop) => !specAllowed.has(prop));
if (violations.length > 0) {
  throw new Error(`Spec violations found: ${violations.join(", ")}`);
}
```

### Metrics

| Approach           | PRs Required | Total Steps | Time       |
| ------------------ | ------------ | ----------- | ---------- |
| Spec-first (ideal) | 1            | ~150        | 2-3 hours  |
| Iterative (actual) | 3            | ~450        | 8-10 hours |
| Overhead           | +2 PRs       | +300 steps  | +6 hours   |

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

> **Historical example**: the `docs/semantic-search/` deliverable shown below no longer exists in the repo (semantic-search feature was removed). The deliverable structure remains the template to follow for future research tasks.

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

| Model            | Local | Speed  | Quality | Size  |
| ---------------- | ----- | ------ | ------- | ----- |
| all-MiniLM-L6-v2 | ✅    | Fast   | Good    | 22MB  |
| bge-small-en     | ✅    | Fast   | Better  | 33MB  |
| nomic-embed-text | ✅    | Medium | Best    | 274MB |
| OpenAI ada-002   | ❌    | Fast   | Best    | API   |

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

| Phase          | Effort | Value                           |
| -------------- | ------ | ------------------------------- |
| Research       | 30%    | High (prevents wrong choices)   |
| Documentation  | 20%    | High (enables future decisions) |
| Implementation | 50%    | Depends on research quality     |

**Reference**: Issue #1354 - Embedding model research (January 2026, 59 steps)

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
const triples = await converter.convertVault(); // ← 500-800ms every time
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
  version: string; // CLI version for compatibility
  timestamp: number; // Cache creation time
  vaultPath: string; // Absolute path to vault
  tripleCount: number; // Number of triples cached
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
    buildFn: () => Promise<Triple[]>,
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

    return cacheMtime > vaultMtime; // Cache newer than vault
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

| Strategy         | Complexity | Accuracy | Use Case                                   |
| ---------------- | ---------- | -------- | ------------------------------------------ |
| **mtime-based**  | Low        | Medium   | Default - fast checks, covers most changes |
| **content-hash** | High       | High     | When exact invalidation needed             |
| **manual**       | None       | N/A      | Add `--force-rebuild` option               |

### Performance Results

| Metric                          | Before | After (cached) | Improvement       |
| ------------------------------- | ------ | -------------- | ----------------- |
| First query                     | 800ms  | 800ms          | N/A (cache build) |
| Second query                    | 800ms  | 10ms           | **80x faster**    |
| 10 sequential queries           | 8000ms | 890ms          | **9x faster**     |
| Validator workflow (15 queries) | 12s    | 1.2s           | **10x faster**    |

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

| Question            | Threshold               | Issue #2083 Result        |
| ------------------- | ----------------------- | ------------------------- |
| Active users?       | <5% of user base        | 0% (experimental)         |
| Bundle impact?      | >20% of total size      | 75% (1.5MB of 2.0MB)      |
| Maintenance cost?   | >10% of codebase        | 8% (104 of ~1200 files)   |
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
type ViewMode = "table" | "graph" | "raw";

// AFTER: ViewModeSelector.tsx
type ViewMode = "table" | "raw";
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

| Metric            | Before | After  | Change             |
| ----------------- | ------ | ------ | ------------------ |
| Bundle size       | 2.0 MB | 0.5 MB | **-75%**           |
| Source files      | 1,200  | 1,096  | **-104 files**     |
| Dependencies      | 45     | 42     | **-3 packages**    |
| Lines of code     | ~180k  | ~50k   | **-129,442 lines** |
| BRAT install time | 23s    | <10s   | **-57%**           |

### Follow-up Issues Pattern

Major removals often trigger follow-up work:

| Issue | Purpose                 | Steps |
| ----- | ----------------------- | ----- |
| #2086 | Main removal PR         | 170   |
| #2087 | Fix coverage thresholds | 30    |
| #2088 | Update CI workflow      | 25    |

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
const uid = wikilinkValue.replace(/\[\[|\]\]/g, "");
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
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog]]")).toBe(
      "ems__EffortStatusBacklog",
    );
  });

  it("extracts UID from aliased wikilink (English)", () => {
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog|Backlog]]")).toBe(
      "ems__EffortStatusBacklog",
    );
  });

  it("extracts UID from aliased wikilink (Russian)", () => {
    expect(extractWikilinkTarget("[[ems__EffortStatusBacklog|Беклог]]")).toBe(
      "ems__EffortStatusBacklog",
    );
  });

  it("extracts UUID from aliased wikilink", () => {
    expect(
      extractWikilinkTarget(
        "[[753a44d5-846c-4b82-9196-4fd9a4d48777|Custom Label]]",
      ),
    ).toBe("753a44d5-846c-4b82-9196-4fd9a4d48777");
  });

  it("returns original string for non-wikilink input", () => {
    expect(extractWikilinkTarget("plain text")).toBe("plain text");
  });
});
```

### Where This Pattern Applies

| Component                 | Purpose                            | Implementation                |
| ------------------------- | ---------------------------------- | ----------------------------- |
| StatusSelectPropertyField | Parse status for button rendering  | Extract UID before comparison |
| BodyLinkPatch             | Beautify links in note body        | Preserve user aliases         |
| PropertiesLinkPatch       | Beautify links in Properties block | Preserve user aliases         |
| LinkRenderer (SPARQL)     | Render links in query results      | Already handles aliases       |

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
  const cachedStart = cachedState.get(cacheKey + ":start");
  const cachedEnd = cachedState.get(cacheKey + ":end");

  // Skip if this is a sync event (end timestamp already matches expected shift)
  if (cachedStart && cachedEnd) {
    const expectedDelta =
      new Date(currentStart).getTime() - new Date(cachedStart).getTime();
    const actualEndDelta =
      new Date(currentEnd).getTime() - new Date(cachedEnd).getTime();

    // If end timestamp already shifted by the same delta, this is a sync - skip
    if (Math.abs(expectedDelta - actualEndDelta) < 1000) {
      // Update cache to current values
      cachedState.set(cacheKey + ":start", currentStart);
      cachedState.set(cacheKey + ":end", currentEnd);
      return; // Already applied - idempotent
    }
  }

  // Apply the shift (first-time or local change)
  const deltaMs = calculateDelta(cachedStart, currentStart);
  await this.shiftEndTimestamp(file, deltaMs);

  // Update cache
  cachedState.set(cacheKey + ":start", currentStart);
  cachedState.set(cacheKey + ":end", newEndTimestamp);
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
    _lastTimestampOperationHash: hash(`${currentStart}-${newEnd}`),
  });
}
```

### When to Apply Idempotency

| Scenario                           | Apply Idempotency | Reason                        |
| ---------------------------------- | ----------------- | ----------------------------- |
| Timestamp shift on property change | ✅ Yes            | Sync causes duplicate events  |
| Status change button click         | ❌ No             | User action, not event-driven |
| Cache refresh on file modify       | ❌ No             | Read-only operation           |
| Automatic metadata correction      | ✅ Yes            | Could fire on sync            |

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

| Package   | Size    | Used By                | Status After #2083 |
| --------- | ------- | ---------------------- | ------------------ |
| d3        | ~250 KB | SPARQLGraphView        | Dead code          |
| immer     | ~15 KB  | Graph stores (Zustand) | Dead code          |
| zundo     | ~5 KB   | Nothing (never used)   | Dead code          |
| @types/d3 | -       | TypeScript             | Dead code          |

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

| Metric           | Change                            |
| ---------------- | --------------------------------- |
| Lines removed    | 762 (mostly package-lock.json)    |
| Packages removed | 4 (d3, @types/d3, immer, zundo)   |
| Bundle size      | ~270 KB smaller                   |
| Build time       | Faster (fewer modules to process) |

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

| Test Case                                    | Expected Behavior                    |
| -------------------------------------------- | ------------------------------------ |
| Valid lowercase UUID                         | `isUUID()` returns true              |
| Valid uppercase UUID                         | `isUUID()` returns true              |
| Non-UUID string                              | `isUUID()` returns false             |
| UUID without dashes                          | `isUUID()` returns false             |
| UUID on `exo__Asset_prototype` (file exists) | Returns `[IRI, Literal]`             |
| UUID on any other predicate (file exists)    | Returns `[IRI]` (single element)     |
| Non-UUID wikilink                            | Returns `[IRI]` (single element)     |
| UUID wikilink (file missing)                 | Returns `[Literal]` (single element) |
| Array of UUID on prototype                   | Each element produces 2 triples      |

### Benefits

- **SPARQL flexibility**: Query by either File IRI or UUID Literal
- **No breaking changes**: File IRI still works for graph navigation
- **Additive**: Existing queries continue to work
- **Selective**: Only applies to UUID wikilinks (no overhead for regular wikilinks)

### When to Apply

- **Only `exo__Asset_prototype`** — dual storage is scoped to this predicate only (Fix #ff3858e5, v15.160.1)
- Other UUID-wikilink predicates emit a single file IRI; dual-storage on other predicates causes `sh:maxCount=1` SHACL violations
- Knowledge graphs where UUID-based prototype/template queries are needed without file path resolution

### Performance Considerations

- **Additional triples**: Each UUID wikilink produces 2 triples instead of 1
- **Index size**: RDF store grows ~proportionally to UUID wikilink count
- **Query speed**: Literal lookup may be faster than IRI lookup (shorter strings)

**Acceptable overhead**: For a vault with 10,000 notes and 50% UUID references:

- Additional triples: ~5,000 (negligible for modern RDF stores)
- Query performance: Unchanged (both patterns indexed)

**Reference**: Issue #2102, PR #2104 - Dual storage for UUID-based wikilinks (72 steps, +296 lines, February 2026)

---

## Side-Channel Triple Emission Pattern

**When to use**: A private converter method needs to emit additional RDF triples with a _different subject_ from the one it is currently populating — without changing its return type or breaking callers.

### Problem

`valueToRDFObject` returns `(IRI | Literal)[]` — objects for triples where the source note is the subject. When resolving an enum instance wikilink (e.g. `[[pmbok__ClosureOutcomeAllAccepted]]`), SHACL `sh:class` requires a triple:

```turtle
pmbok:ClosureOutcomeAllAccepted  rdf:type  pmbok:ClosureOutcome .
```

The subject here is the _enum class IRI_, not the source note. Returning it from `valueToRDFObject` would pollute the return type.

### Solution: `pendingExtraTriples` class field

```typescript
// Class field — reset at start of each convertLegacyNote call
private pendingExtraTriples: Triple[] = [];

private async convertLegacyNote(file, frontmatter): Promise<Triple[]> {
  this.pendingExtraTriples = [];           // reset
  const triples: Triple[] = [];
  // ... frontmatter loop calling valueToRDFObject ...
  triples.push(...this.pendingExtraTriples); // flush before body links
  this.pendingExtraTriples = [];
  const bodyLinkTriples = await this.convertBodyWikilinks(file, subject);
  triples.push(...bodyLinkTriples);
  return triples;
}

private emitTypeTripleForEnumInstance(classIRI: IRI, targetFile: IFile): void {
  const targetFm = this.vault.getFrontmatter(targetFile);
  if (!targetFm) return;
  const raw = Array.isArray(targetFm["exo__Instance_class"])
    ? targetFm["exo__Instance_class"][0]
    : targetFm["exo__Instance_class"];
  if (typeof raw !== "string") return;
  const parentClassIRI = this.valueToClassURI(raw);
  if (parentClassIRI instanceof IRI) {
    this.pendingExtraTriples.push(
      new Triple(classIRI, Namespace.RDF.term("type"), parentClassIRI)
    );
  }
}

private async valueToRDFObject(value, sourceFile, predicate?): Promise<(IRI | Literal)[]> {
  // ... existing logic ...
  const basenameClassIRI = this.expandClassValue(targetFile.basename);
  if (basenameClassIRI) {
    this.emitTypeTripleForEnumInstance(basenameClassIRI, targetFile); // side-channel
    return [basenameClassIRI];
  }
  // ...
}
```

### Key invariants

- **Reset before, flush after**: `pendingExtraTriples = []` at the start of the public method; `push(...pendingExtraTriples)` before body-link step.
- **Single-threaded safety**: JavaScript event loop guarantees no concurrent `convertLegacyNote` calls interleave — class field is safe.
- **External API unchanged**: `valueToRDFObject` return type stays `(IRI | Literal)[]`.
- **Flush before body links**: extra triples are frontmatter-derived; they must appear before body-link triples for consistent ordering.

### Alternative: refactor return type

If the number of side-channel types grows, consider `{objects: (IRI|Literal)[], extraTriples: Triple[]}`. Prefer the class field while side-channel usage is limited to one call site.

**Reference**: PR #3070 (Fix #ff3858e5) — `emitTypeTripleForEnumInstance` in `NoteToRDFConverter.ts`

---

## Baseline Test Count Before Bug Fix

**Workflow note** — establish a pre-fix baseline before changing behavior-affecting code.

### Problem

When a bug fix changes existing behavior (e.g., narrowing dual-storage from all predicates to one), some existing tests may _already_ be failing for unrelated reasons (e.g., a companion feature added triples that tests don't account for). Without a baseline, it's impossible to tell which test failures your fix introduced vs. which were pre-existing.

### Practice

```bash
# Before writing any fix code — run the affected test file
npx jest --config packages/core/jest.config.js <path/to/test.ts> --no-coverage

# Record: N passed, M failed
# Then implement the fix
# After fix: re-run and compare
# New failures = caused by your fix (update tests intentionally)
# Failures present in both = pre-existing (note in PR but don't hide)
```

### Why it matters

- Avoids spending time "fixing" tests that were already broken
- Gives you a clear attribution: "5 test updates caused by Fix 1, 3 were pre-existing failures from Issue #2807"
- Makes PR review easier — reviewer understands which test changes are intentional behavior changes

**Reference**: Post-mortem 2026-05-03 SHACL fix (IssueItem ff3858e5) — Lesson 4

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

| Step | Action              | Validation                          |
| ---- | ------------------- | ----------------------------------- |
| 1    | Verify unused       | `grep` returns zero results in src/ |
| 2    | Check tsconfig.json | Remove from `references` if present |
| 3    | Remove directory    | `rm -rf packages/package-name/`     |
| 4    | Clean lockfile      | Run `npm install` to regenerate     |
| 5    | Verify build        | `npm run build` passes              |
| 6    | Run tests           | All tests pass                      |

---

## Dual Identifier Backward Compatibility Pattern

**When to use**: Migrating from string-based identifiers (e.g., `ems__TaskPrototype`) to UID-based identifiers (e.g., `75302770-279e-4a59-ba85-09df29725713`) while maintaining backward compatibility.

### Pattern Description

When renaming asset files from human-readable names to UID-based names (for consistency and uniqueness), the code must recognize both identifier formats to avoid breaking existing vaults.

> **Note 2026-06**: the original implementation steps from Issue #2110 referenced code that has since been removed (`AssetClass.TASK_PROTOTYPE_UID`, `AssetVisibilityRules.canCreateInstance`, `CreationButtonGroupBuilder` — all gone with the pre-homoiconic command layer). The pattern itself remains valid; the **surviving in-repo example** is the dual `classTemplates` entry in `ExocortexSettings.ts` shown below.

### Implementation Structure

```
1. Find every map/rule keyed by the string identifier
   ↓
2. Add a parallel entry/check for the UID identifier (same behavior)
   ↓
3. Write parameterized tests covering BOTH identifiers
```

### Surviving Code Example (Issue #2110)

```typescript
// packages/obsidian-plugin/src/domain/settings/ExocortexSettings.ts (DEFAULT_DISPLAY_NAME_SETTINGS)
classTemplates: {
  ems__TaskPrototype: "{{exo__Asset_label}} (TaskPrototype)",
  // UID-based identifier for ems__TaskPrototype (Issue #2110)
  "75302770-279e-4a59-ba85-09df29725713":
    "{{exo__Asset_label}} (TaskPrototype)",
}
```

String-form class constants still live in `packages/core/src/domain/constants/AssetClass.ts` (`AssetClass.TASK_PROTOTYPE = "ems__TaskPrototype"`); when a consumer must accept both forms, add the UID alongside the label at the **consumer's keying site** (as above), not as a parallel enum member.

### Test Pattern

```typescript
it.each([
  ["string-based", "ems__TaskPrototype"],
  ["UID-based", "75302770-279e-4a59-ba85-09df29725713"],
])("resolves display template for %s identifier", (_, classKey) => {
  expect(resolveTemplate(classKey)).toBe(
    "{{exo__Asset_label}} (TaskPrototype)",
  );
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 58                   |
| Lines added        | 63                   |
| Lines removed      | 1                    |
| Files modified     | 5                    |
| Tests added        | 53 lines             |
| Time               | ~18 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

### Success Factors

1. **Clear issue specification**: Issue #2110 had detailed implementation steps
2. **Existing patterns**: Followed established AssetClass constant pattern
3. **Focused scope**: Single prototype class migration (not all at once)
4. **Comprehensive tests**: 53 lines of tests ensured backward compatibility

**Reference**: Issue #2110, PR #2111 - Support UID-based class identifier for ems\_\_TaskPrototype (58 steps, +63 lines, February 2026)

---

## Metadata Cache Fallback Pattern

**When to use**: Plugin features that depend on Obsidian's `metadataCache.getFileCache()` must work even when the cache is unavailable (during vault indexing after startup).

### Problem

When Obsidian indexes a vault (first launch or after cache invalidation), `metadataCache.getFileCache()` returns `null` until indexing completes. This causes:

- UI components like "Create Instance" buttons to be hidden
- Plugin features to fail silently
- Poor UX during vault initialization

### Solution Pattern

Use direct YAML parsing as fallback when metadata cache is unavailable (generic technique — there is no dedicated class for this in the codebase; inline it where needed):

```typescript
import { App, TFile } from "obsidian";
import yaml from "js-yaml";

async function getFrontmatterWithFallback(
  app: App,
  file: TFile,
): Promise<Record<string, any> | null> {
  // Primary path: Use cache (fast, normal operation)
  const cache = app.metadataCache.getFileCache(file);
  if (cache?.frontmatter) {
    return cache.frontmatter;
  }

  // Fallback path: Direct YAML parsing (during indexing)
  try {
    const content = await app.vault.read(file);
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const parsed = yaml.load(match[1]);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, any>)
      : null;
  } catch (error) {
    console.error("Frontmatter fallback failed:", error);
    return null;
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 65                   |
| Files modified     | 3                    |
| Tests added        | 5                    |
| Time               | ~30 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

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
  start1: number,
  end1: number,
  start2: number,
  end2: number,
): boolean => {
  return start1 <= end2 && start2 <= end1;
};

// Memoized calculation of all overlapping tasks
const tasksWithOverlaps = useMemo(() => {
  const tasksByPlanned = tasks.filter(
    (t) =>
      t.metadata.ems__Effort_plannedStartTimestamp &&
      t.metadata.ems__Effort_plannedEndTimestamp,
  );

  const overlapping = new Set<string>();

  // O(n²) pairwise comparison - acceptable for <100 tasks
  for (let i = 0; i < tasksByPlanned.length; i++) {
    const task1 = tasksByPlanned[i];
    const start1 = new Date(
      task1.metadata.ems__Effort_plannedStartTimestamp as string,
    ).getTime();
    const end1 = new Date(
      task1.metadata.ems__Effort_plannedEndTimestamp as string,
    ).getTime();

    for (let j = i + 1; j < tasksByPlanned.length; j++) {
      const task2 = tasksByPlanned[j];
      const start2 = new Date(
        task2.metadata.ems__Effort_plannedStartTimestamp as string,
      ).getTime();
      const end2 = new Date(
        task2.metadata.ems__Effort_plannedEndTimestamp as string,
      ).getTime();

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
  background-color: rgba(139, 0, 0, 0.12); /* DarkRed with 12% opacity */
}

/* Dark theme variant */
.theme-dark .task-overlap-conflict {
  background-color: rgba(178, 34, 34, 0.15); /* Firebrick, slightly lighter */
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 113                  |
| Files modified     | 3                    |
| Tests added        | 6                    |
| Time               | ~40 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

**Reference**: Issue #2108, PR #2108 - Highlight overlapping planned task periods in DailyNote table (113 steps, February 2026)

---

## UUID Wikilink Resolution Pattern

**When to use**: CLI or plugin must resolve wikilinks that reference files by UUID (e.g., `[[ebf717aa-4070-4b37-abde-10a700e354fc|Label]]`).

### Problem

Obsidian files can be named by UUID (e.g., `ebf717aa-4070-4b37-abde-10a700e354fc.md`). When frontmatter contains wikilinks like:

```yaml
exo__Class_superClass:
  - "[[ems__EffortPrototype]]" # ✅ Resolves (relative path)
  - "[[ebf717aa-4070-4b37-abde-10a700e354fc|exo__Prototype]]" # ❌ May NOT resolve
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
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const file of files) {
      const basename = path.basename(file.path, ".md");
      if (uuidRegex.test(basename)) {
        this.uuidIndex.set(basename.toLowerCase(), file.path);
      }
    }
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): IFile | null {
    // Strip wikilink alias: "uuid|label" → "uuid"
    const cleanLinkpath = linkpath.split("|")[0].trim();

    // Check if linkpath is a UUID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 56                   |
| Files modified     | 2                    |
| Tests added        | 8                    |
| Time               | ~25 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

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
const scrollbarWidth =
  parentRef.current.offsetWidth - parentRef.current.clientWidth;
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 53                   |
| Files modified     | 2                    |
| Lines added        | 16                   |
| Time               | ~15 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

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
      ? classes.some((c: string) => c.includes("ems__Context"))
      : typeof classes === "string" && classes.includes("ems__Context");

    return start != null && end != null && !isContext;
  });

  // Step 2: Run detection only on eligible tasks
  return detectOverlaps(eligibleTasks);
}, [tasks]);
```

### Handling Multiple Class Formats

`exo__Instance_class` can appear in several formats - handle all of them:

```typescript
function hasClass(
  metadata: Record<string, unknown>,
  targetClass: string,
): boolean {
  const classes = metadata.exo__Instance_class;

  if (!classes) return false;

  // Format 1: Single string - "ems__Task"
  if (typeof classes === "string") {
    return classes.includes(targetClass);
  }

  // Format 2: Array - ["ems__Task", "ems__Context"]
  if (Array.isArray(classes)) {
    return classes.some(
      (c: string) => typeof c === "string" && c.includes(targetClass),
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

| Metric             | Value                |
| ------------------ | -------------------- |
| Steps              | 55                   |
| Files modified     | 2                    |
| Test cases added   | 5                    |
| Time               | ~45 minutes          |
| Errors encountered | 0                    |
| CI status          | ✅ All checks passed |

**Reference**: Issue #2128, PR #2128 - Exclude ems\_\_Context tasks from overlap detection (55 steps, February 2026)

---

## Command Implementation Pattern with Timestamp Service

**When to use**: Adding new asset-level commands that update frontmatter timestamps

> **Rewritten 2026-06**: the per-command class layer (`MarkReviewedCommand`, `EffortVisibilityRules`, etc.) was **removed** (#3201/#3386/#3262). Per-asset commands are now **vault-declared** (`exocmd__Command` + grounding + precondition, RFC-009). `CommandRegistry` survives only as a thin registry: global UI-only commands + delegation to `CommandResolver.resolveForAsset` (see its JSDoc, RFC-009 §5.3). `StatusTimestampService` survives as the shared timestamp service.

### Architecture (current)

```
Vault assets:
  exocmd__Command + exocmd__Grounding   ← what the command does
  exocmd__Precondition                  ← when it is visible (SPARQL ASK / host fn)
  exocmd__CommandBinding                ← which class shows it
        ↓
Code:
  CommandRegistry.ts                    ← thin: global UI commands + CommandResolver delegation
  GroundingExecutor                     ← executes grounding (property_set / service_call / …)
  StatusTimestampService.ts             ← shared timestamp service (service_call target,
                                          registered in ServiceRegistryPopulator.ts)
  FrontmatterService.ts                 ← low-level frontmatter ops
```

### Step-by-Step Implementation

#### 1. Timestamp logic — service method (`packages/core/src/services/StatusTimestampService.ts`)

Surviving example — `addReviewTimestamp` (StatusTimestampService.ts:57):

```typescript
async addReviewTimestamp(taskFile: IFile): Promise<void> {
  // reads file, writes ems__Effort_lastReviewTimestamp via FrontmatterService
}
```

For a **simple property write** prefer a declarative grounding (`property_set` with timestamp expression) over a new service method — Issues #3132/#3134 migrated former `service_call` consumers to declarative `property_append` / `property_increment` grounding types precisely to avoid code growth.

#### 2. Visibility — vault `exocmd__Precondition`

Class/archive gating that used to live in `*VisibilityRules.ts` is now a SPARQL ASK (and/or host function) on the precondition asset. Verify the stored IRI forms empirically before writing literal IRIs into the ASK.

#### 3. Command — vault `exocmd__Command` + `exocmd__CommandBinding`

Declare the command asset (label, grounding wikilink, precondition wikilink) and bind it to the target class. No plugin code, no registration call.

#### 4. Only if a new service primitive is required

Register the service instance in `ServiceRegistryPopulator.ts` so a `service_call` grounding can reach it by serviceId.

### Key Pattern Elements

1. **Declarative first**: prefer `property_set`/`property_append`/`property_increment` groundings over new service methods
2. **Reuse Services**: use existing `StatusTimestampService` for timestamp consistency when a service is genuinely needed
3. **Single Responsibility**: grounding orchestrates, service does the work
4. **Vault↔code parity**: a `service_call` serviceId or host-function name declared in vault MUST be registered in code — otherwise silent failure (fail-open for host functions)

### Test Checklist

- [ ] Service method creates timestamp property
- [ ] Service method updates existing timestamp
- [ ] Grounding executes via integration test (real `GroundingExecutor` against fixtures, `packages/cli/tests/integration/**`)
- [ ] Precondition ASK verified against actual stored IRI forms

**Reference**: Issue #2124 (historical ICommand-based 'Reviewed' command, since migrated); RFC-009 vault-declared commands; Issues #3132/#3134 — service_call → declarative grounding migrations

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

| Method                 | Effect                               | Use Case           |
| ---------------------- | ------------------------------------ | ------------------ |
| `Decoration.widget()`  | Adds element (doesn't hide original) | Icons, badges      |
| `Decoration.replace()` | Replaces text with widget            | Label substitution |
| `Decoration.mark()`    | Applies CSS class to range           | Highlighting       |

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
  showLabelsInLivePreview: boolean; // Default: true
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

| Metric             | Value                          |
| ------------------ | ------------------------------ |
| Steps              | 102                            |
| Files modified     | 7                              |
| New files created  | 1 (WikilinkLabelViewPlugin.ts) |
| Test cases added   | ~10                            |
| Time               | ~90 minutes                    |
| Errors encountered | 0                              |
| CI status          | ✅ All checks passed           |

**Reference**: Issue #2126, PR #2126 - Display wikilinks by exo\_\_Asset_label in live preview (102 steps, February 2026)

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
function hasClassDirectly(
  metadata: FrontmatterCache,
  className: string,
): boolean {
  const classes = metadata.exo__Instance_class || [];
  const classArray = Array.isArray(classes) ? classes : [classes];
  return classArray.some((c) => typeof c === "string" && c.includes(className));
}

// Step 2: Resolve prototype's classes
async function resolvePrototypeClasses(
  metadata: FrontmatterCache,
  app: ObsidianApp,
): Promise<string[]> {
  // ⚠️ CRITICAL: Use exo__Asset_prototype, NOT exo__Instance_prototype
  const prototypeRef = metadata.exo__Asset_prototype;
  if (!prototypeRef) return [];

  const prototypeUid = extractUidFromWikilink(prototypeRef);
  if (!prototypeUid) return [];

  const prototypeFile = app.metadataCache.getFirstLinkpathDest(
    prototypeUid,
    "",
  );
  if (!prototypeFile) return [];

  const prototypeMeta = app.metadataCache.getFileCache(prototypeFile);
  return prototypeMeta?.frontmatter?.exo__Instance_class || [];
}

// Step 3: Combined check
async function hasClassDirectlyOrThroughPrototype(
  metadata: FrontmatterCache,
  className: string,
  app: ObsidianApp,
): Promise<boolean> {
  if (hasClassDirectly(metadata, className)) return true;

  const prototypeClasses = await resolvePrototypeClasses(metadata, app);
  return prototypeClasses.some((c) => c.includes(className));
}
```

### Critical Property Name

| ❌ WRONG                                        | ✅ CORRECT                                |
| ----------------------------------------------- | ----------------------------------------- |
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
      exo__Instance_class: [], // No direct class
    };

    mockGetFileCache.mockReturnValueOnce({
      frontmatter: {
        exo__Instance_class: ["[[ems__Context]]"],
      },
    });

    const result = await hasClassDirectlyOrThroughPrototype(
      task,
      "ems__Context",
      mockApp,
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

| Issue                             | Steps | Result     |
| --------------------------------- | ----- | ---------- |
| #2131 (feat: prototype detection) | 62    | +340 lines |
| #2135 (fix: property name)        | 74    | +74 lines  |

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
  target: string; // UUID or path
  alias?: string; // Custom display name |...|
  blockId?: string; // Block reference (^abc123)
  headingRef?: string; // Heading reference (#Heading)
  isBlock: boolean; // true if ^, false if heading
}

function parseWikilink(value: string): WikilinkParsed | null {
  const match = value.match(
    /^\[\[([^#\]|]+)(?:#(\^)?([^\]|]+))?(?:\|([^\]]+))?\]\]$/,
  );
  if (!match) return null;

  return {
    target: match[1].trim(),
    isBlock: match[2] === "^",
    blockId: match[2] === "^" ? match[3]?.trim() : undefined,
    headingRef: match[2] !== "^" ? match[3]?.trim() : undefined,
    alias: match[4]?.trim(),
  };
}
```

### Display Formatting

```typescript
function formatDisplayName(label: string, parsed: WikilinkParsed): string {
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

| Mode         | Implementation         | Component                    |
| ------------ | ---------------------- | ---------------------------- |
| Live Preview | CodeMirror ViewPlugin  | `WikilinkLabelViewPlugin.ts` |
| Reading View | MutationObserver + DOM | `BodyLinkPatch.ts`           |

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

| Metric           | Value |
| ---------------- | ----- |
| Steps            | 74    |
| Files modified   | 4     |
| Lines added      | +546  |
| Lines deleted    | -43   |
| Unit tests added | 24    |

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

| Count | Interpretation           | Action                          |
| ----- | ------------------------ | ------------------------------- |
| 0     | Property doesn't exist   | Verify ontology, check spelling |
| 1-10  | Test data or schema only | Probably wrong, investigate     |
| 100+  | Real usage               | Correct property name           |
| 1000+ | Core property            | Definitely correct              |

### Integration into Development Flow

1. **Before implementation**: Run grep to verify property name
2. **If count < 100**: Stop and verify in ontology
3. **Add to test name**: "should use exo**Asset_prototype (not exo**Instance_prototype)"
4. **Document in PR**: Include occurrence count for validation

### Defensive Test Pattern

```typescript
describe("Property name validation", () => {
  // Explicit test name prevents future property name confusion
  it("should resolve prototype using exo__Asset_prototype (NOT exo__Instance_prototype)", () => {
    const metadata = {
      exo__Asset_prototype: "[[prototype-uid]]", // Correct property
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
  ? currentText === `${file.basename}#^${blockId}` // Standard format
  : false;

const matchesBlockRefWithoutCaret = blockId
  ? currentText === `${file.basename}#${blockId}` // Without caret
  : false;

const matchesBlockRefSeparatorFormat = blockId
  ? currentText === `${file.basename} > ^${blockId}` // Separator format
  : headingRef
    ? currentText === `${file.basename} > ${headingRef}`
    : false;

// Update guard clause to include all formats
const hasUserAlias =
  currentText !== "" &&
  !matchesBasename &&
  !matchesDataHref &&
  !matchesBlockRefText &&
  !matchesBlockRefWithoutCaret && // NEW
  !matchesBlockRefSeparatorFormat && // NEW
  !wasAlreadyPatched;
```

### Known Obsidian Wikilink Text Formats

| Link Type                      | Possible Text Formats                       |
| ------------------------------ | ------------------------------------------- |
| Simple `[[page]]`              | `page`, `page.md`                           |
| Block ref `[[page#^id]]`       | `page#^id`, `page#id`, `page > ^id`, `page` |
| Heading ref `[[page#Heading]]` | `page#Heading`, `page > Heading`, `page`    |
| With alias `[[page\|Alias]]`   | `Alias` (always preserved)                  |

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
GraphNode.prototype.getDisplayText = function () {
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

| Aspect              | Direct Assignment   | FunctionReplacer     |
| ------------------- | ------------------- | -------------------- |
| Cleanup             | Manual tracking     | Automatic restorer   |
| Multiple prototypes | Fails silently      | Maps each prototype  |
| Enable/disable      | Re-implements logic | Calls restorer       |
| Original reference  | Lost on reassign    | Preserved in closure |
| Testing             | Hard to mock        | Can inject factory   |

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
    this.restorers.forEach((restore) => restore());
    this.restorers.clear();

    // 2. Unregister events
    this.eventRefs.forEach((ref) => this.app.workspace.offref(ref));
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
      this.app.workspace.on("layout-change", debouncedRefresh),
    );

    // Metadata changes may affect labels
    this.eventRefs.push(
      this.app.metadataCache.on("changed", (file) => {
        // Only refresh if relevant file changed
        if (this.isRelevantFile(file)) {
          this.refreshAll();
        }
      }),
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
  .addToggle((toggle) =>
    toggle
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
      }),
  );
```

### Common Issues and Solutions

| Issue                      | Symptom                            | Solution                                  |
| -------------------------- | ---------------------------------- | ----------------------------------------- |
| Race condition at startup  | Feature doesn't work on first open | Use `onLayoutReady()` or debounced enable |
| Toggle doesn't take effect | Need to close/reopen view          | Call `refreshAll()` after enable/disable  |
| Events leak on disable     | Memory bloat, stale handlers       | Store `EventRef[]`, call `offref()`       |
| Patch applied twice        | Duplicate labels, errors           | Guard with `restorers.has(proto)`         |

**Reference**: Issues #2149, #2157 - Graph View patch lifecycle (February 2026)

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
        const links = node.querySelectorAll("a.internal-link");
        links.forEach((link) => this.patchLink(link));
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
        if (node.matches("a.internal-link")) {
          this.patchLink(node as HTMLAnchorElement);
        }

        // Case 2: Node CONTAINS target elements (tables, divs, etc.)
        node.querySelectorAll("a.internal-link").forEach((link) => {
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
  childList: true, // Watch for added/removed children
  subtree: true, // Required for nested elements (tables!)
  characterData: false, // Usually not needed
  attributes: false, // Only if watching attribute changes
});
```

### Common Obsidian Rendering Contexts

| Context       | DOM Structure                   | Special Handling            |
| ------------- | ------------------------------- | --------------------------- |
| Paragraph     | `<p><a class="internal-link">`  | Standard `querySelectorAll` |
| List item     | `<li><a class="internal-link">` | Standard `querySelectorAll` |
| Table cell    | `<td><a class="internal-link">` | Requires `subtree: true`    |
| Callout       | `<div class="callout"><a>`      | Nested container            |
| Embedded note | `<div class="markdown-embed">`  | Separate observer may fire  |

### Testing DOM Coverage

```typescript
describe("MutationObserver coverage", () => {
  it("should patch links in paragraph", async () => {
    container.innerHTML = '<p><a class="internal-link">Link</a></p>';
    await waitForObserver();
    expect(container.querySelector("a")?.textContent).toBe("Patched");
  });

  it("should patch links in table cell", async () => {
    container.innerHTML =
      '<table><tr><td><a class="internal-link">Link</a></td></tr></table>';
    await waitForObserver();
    expect(container.querySelector("a")?.textContent).toBe("Patched");
  });

  it("should patch link added directly (not as child)", async () => {
    const link = document.createElement("a");
    link.className = "internal-link";
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
  `---\naliases:\n  - ${newAlias}\n---`,
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
      aliases: ["existing-alias-1", "existing-alias-2"],
    });

    await command.execute(file);

    const fm = await readFrontmatter(file);
    expect(fm.aliases).toEqual([
      "existing-alias-1",
      "existing-alias-2",
      "test", // Old basename appended
    ]);
  });

  it("should not duplicate existing alias", async () => {
    const file = createMockFile("test.md", {
      aliases: ["test"], // Already contains basename
    });

    await command.execute(file);

    const fm = await readFrontmatter(file);
    expect(fm.aliases).toEqual(["test"]); // No duplicate
  });
});
```

**Reference**: Issue #2180 - Rename to UID breaks frontmatter with aliases (63 steps, February 2026)

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
    const cells = headerRef.current.querySelectorAll("th");
    const widths = Array.from(cells).map((cell) => cell.offsetWidth);
    setColumnWidths(widths);
  }
}, [columns]);

// Step 2: Apply widths to virtualized rows
const renderVirtualizedRow = (row: Row, style: CSSProperties) => (
  <tr style={style}>
    {columns.map((col, i) => (
      <td
        key={col.id}
        style={{
          width: columnWidths[i] || "auto",
          minWidth: columnWidths[i] || "auto",
          maxWidth: columnWidths[i] || "auto",
        }}
      >
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
    display: "grid",
    gridTemplateColumns: columns.map((c) => c.width || "1fr").join(" "),
  }}
>
  {virtualItems.map((virtualRow) => (
    <div
      key={virtualRow.index}
      style={{
        position: "absolute",
        transform: `translateY(${virtualRow.start}px)`,
        display: "contents", // Allows children to participate in grid
      }}
    >
      {columns.map((col) => (
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
      const cells = headerRef.current.querySelectorAll("th");
      const widths = Array.from(cells).map((cell) => cell.offsetWidth);
      setColumnWidths(widths);
    }
  }, 100);

  window.addEventListener("resize", handleResize);
  return () => window.removeEventListener("resize", handleResize);
}, []);
```

### Virtualization Threshold

```typescript
const VIRTUALIZATION_THRESHOLD = 50;

const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;

return shouldVirtualize
  ? renderVirtualizedTable(rows) // Uses explicit widths
  : renderStandardTable(rows); // Uses table-layout: fixed
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
  view.dispatch({}); // Trigger redraw
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
    { name: "exocortex-ui-settings" }, // Persist to localStorage
  ),
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
  if (!minutes || minutes === 0) return "";

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

## Copy Command Pattern

**When to use**: Implementing clipboard copy affordances for asset properties

> **Rewritten 2026-06**: the original `CopyLabelCommand` (ICommand-based palette command) was removed with the pre-homoiconic command layer. The surviving clipboard-copy implementation is `PropertiesUidCopyPatch` (`packages/obsidian-plugin/src/presentation/properties/PropertiesUidCopyPatch.ts`) — a MutationObserver-based patch that injects a copy button next to `exo__Asset_uid` in Obsidian's native Properties block (Issue #2320, Option C).

### Key Implementation Details (PropertiesUidCopyPatch)

1. **Surface**: button injected into `metadata-property[data-property-key="exo__Asset_uid"]` value container — works in both Reading view and Live Preview
2. **Detection**: MutationObserver + `layout-change` event re-patch (see «MutationObserver DOM Coverage Pattern» in this document)
3. **Feedback**: optimistic icon swap to checkmark for 1.5s + notification via `INotificationService`

### Common Gotcha: Incomplete Implementation

Lesson from the historical Issues #2200/#2202 pair (#2202 existed because #2200 shipped half-done): always verify a copy affordance works in **every surface** it is expected on — Reading view, Live Preview, all relevant asset types — before declaring done.

**Reference**: Issue #2320 — UID copy button (`PropertiesUidCopyPatch`); Issues #2200/#2202 — historical `CopyLabelCommand` (removed)

---

## RDF/IRI Validation Pattern

**When to use**: Handling invalid IRIs in RDF triples gracefully

### Pattern Description

Validate and sanitize IRIs before using in RDF operations to prevent parsing failures.

### Implementation (Issue #2205)

```typescript
// IRI validation pattern
const IRI_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function validateIRI(iri: string): {
  valid: boolean;
  sanitized?: string;
  error?: string;
} {
  // Check basic structure
  if (!iri || typeof iri !== "string") {
    return { valid: false, error: "IRI must be a non-empty string" };
  }

  // Check scheme
  if (!IRI_REGEX.test(iri)) {
    return { valid: false, error: `Invalid IRI scheme: ${iri}` };
  }

  // Check for problematic characters
  const problematic = iri.match(/[\s<>"{}|\\^`]/g);
  if (problematic) {
    const sanitized = iri.replace(/[\s<>"{}|\\^`]/g, (char) =>
      encodeURIComponent(char),
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
  return triples.filter((triple) => {
    const subjectValid = validateIRI(triple.subject);
    const predicateValid = validateIRI(triple.predicate);

    if (!subjectValid.valid) {
      console.warn(`Skipping triple with invalid subject: ${triple.subject}`);
      return false;
    }

    if (!predicateValid.valid) {
      console.warn(
        `Skipping triple with invalid predicate: ${triple.predicate}`,
      );
      return false;
    }

    return true;
  });
}
```

**Reference**: Issue #2205 - Invalid IRI handling (96 steps, February 2026)

---

## Button Group Implementation Pattern

**When to use**: Adding new button groups to asset layouts (e.g., Criticality Zone, Quick Actions)

> **Rewritten 2026-06**: the original per-feature static builders (`CriticalityZoneButtonGroupBuilder`, `TaskVisibilityRules`, etc.) were **removed**. Since RFC-009 all button groups are **vault-declared** and served by a single universal builder — `DynamicCommandButtonGroupBuilder` (`packages/obsidian-plugin/src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder.ts`), the only builder registered in `ButtonGroupsBuilder.ts`.

### Architecture (homoiconic, RFC-009)

```
Vault assets (declarations):
  exocmd__Command        — button label + grounding/precondition wikilinks
  exocmd__CommandBinding — binds a command to a target class (where the button shows)
  exocmd__Precondition   — visibility gate (SPARQL ASK and/or host function)
  exocmd__Grounding      — what the click does (property_set, service_call, composite, …)
        ↓ (indexed at runtime)
Code (generic, no per-button classes):
  CommandResolver.findBindings(class)      — discovers commands for the asset's class
  PreconditionEvaluator.evaluate(...)      — per-button visibility evaluation
  DynamicCommandButtonGroupBuilder         — renders the group
  CommandExecutionFlow → GroundingExecutor — executes the click
```

Domain services that groundings call via `service_call` (e.g. `CriticalityZoneService`, which writes `ems__Task_zone`) still live in `packages/core/src/services/` and are registered in `container.ts` / `tokens.ts`.

### Implementation Checklist (new button = vault assets, usually zero plugin code)

- [ ] Create `exocmd__Command` asset (UUID-named) with label + grounding wikilink
- [ ] Create `exocmd__Grounding` asset describing the mutation
- [ ] (Optional) `exocmd__Precondition` with `sparqlAsk` / `hostFunction` for visibility — verify the stored IRI form empirically via `npx @kitelev/exocortex-cli query` before writing literal IRIs into the ASK
- [ ] Create `exocmd__CommandBinding` targeting the class whose pages show the button
- [ ] If the precondition references a host function — verify it is registered in code (`preconditionHostFunctions.ts` / plugin wiring); an unregistered name fails **open** on the inline-button surface (button visible everywhere)
- [ ] Reload plugin, verify the button on a target-class asset page

Plugin code changes are needed only when a grounding requires a **new service primitive** (new `service_call` serviceId) or a **new host function**.

**Reference**: RFC-009 dynamic command buttons (`DynamicCommandButtonGroupBuilder`); Issue #2231 — Criticality Zone Buttons (historical: originally implemented via static builders, since migrated to vault-declared commands)

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
        `Try: EXOCORTEX_SPARQL_TIMEOUT=60 npx @kitelev/exocortex-cli query "..."`,
    );
    this.name = "QueryTimeoutError";
  }
}
```

### Usage

```bash
# Default timeout (30s)
npx @kitelev/exocortex-cli query "SELECT ?s WHERE { ?s ?p ?o }"

# Extended timeout (60s)
EXOCORTEX_SPARQL_TIMEOUT=60 npx @kitelev/exocortex-cli query "SELECT ..."

# Very long timeout for analytical queries (5 min)
EXOCORTEX_SPARQL_TIMEOUT=300 npx @kitelev/exocortex-cli query "SELECT (COUNT(*) AS ?count) WHERE { ... }"
```

### Investigation Pattern for Timeout Issues

When facing SPARQL timeout issues:

1. **Identify query complexity**:

   ```bash
   # Check estimated result size
   npx @kitelev/exocortex-cli query "SELECT (COUNT(*) AS ?n) WHERE { ... }"
   ```

2. **Profile with extended timeout**:

   ```bash
   EXOCORTEX_SPARQL_TIMEOUT=120 time npx @kitelev/exocortex-cli query "..."
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

| Component     | Implementation         | Status         |
| ------------- | ---------------------- | -------------- |
| Regular Tasks | ✅ Updated Time column | Done in #2236  |
| Empty Slots   | ❌ Missed initially    | Fixed in #2238 |

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
const variants = ["regularTasks", "emptySlots", "groupedTasks"];

// 2. Ensure metadata structure is consistent
function createEmptySlot(start: string, end: string) {
  return {
    metadata: {
      // Map timestamps to expected property names
      ems__Effort_startTimestamp: start,
      ems__Effort_endTimestamp: end,
    },
  };
}

// 3. Feature works for all variants
variants.forEach((variant) => {
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

---

## Archive/Unarchive CLI Pattern

**When to use**: Implementing vault archival and restoration commands with cross-vault operations

### Architecture

```
Command (archive.ts / unarchive.ts)
  └── ArchiveExecutor.ts          # Orchestrates archive workflow
        ├── ArchiveService.ts       # Core move logic (active → archive vault)
        ├── ArchiveCascadeService.ts # Iterative chain resolution
        ├── ArchiveVerifyService.ts  # Integrity checks (broken links, missing ontologies)
        ├── ArchiveStatsService.ts   # Vault statistics (asset counts, classes)
        └── UnarchiveService.ts     # Reverse operation (archive → active vault)
```

### CLI Flags

```bash
# Basic archive: move Done assets to archive vault
npx @kitelev/exocortex-cli archive --vault /active --archive-vault /archive --class ems__Task --year 2025

# Cascade: resolve archived-to-archived reference chains
npx @kitelev/exocortex-cli archive --cascade --vault /active --archive-vault /archive

# Verify: check cross-vault integrity (no broken links)
npx @kitelev/exocortex-cli archive --verify --vault /active --archive-vault /archive

# Stats: show asset counts and class distribution
npx @kitelev/exocortex-cli archive --stats --vault /active --archive-vault /archive

# Skip referenced: archive even if referenced by active assets
npx @kitelev/exocortex-cli archive --no-referenced --vault /active --archive-vault /archive

# Unarchive: restore single asset by UUID
npx @kitelev/exocortex-cli unarchive --uuid <UUID> --vault /active --archive-vault /archive

# All flags support --dry-run for preview without changes
```

### Key Files

- `packages/cli/src/commands/archive.ts` - Command definition with flags
- `packages/cli/src/commands/unarchive.ts` - Reverse command
- `packages/cli/src/executors/ArchiveExecutor.ts` - Orchestration
- `packages/cli/src/services/Archive*.ts` - Service layer (5 services)

### Key Design Decisions

1. **Two-vault model**: Active vault (daily work) + archive vault (cold storage), never mix
2. **Reference safety**: Default behavior skips assets referenced by non-archived assets
3. **Cascade resolution**: `--cascade` iteratively moves assets whose only references are already archived
4. **Ontology rewrite**: `exo__Asset_isDefinedBy` updated from active to archive ontology on move

**Reference**: PRs #2331-#2356 - Archive/Unarchive CLI Feature (March 2026)

---

## PrintNameRule Pattern

**When to use**: Implementing dynamic display names driven by ontology-level `exoob__PrintNameRule` assets

### Pattern Description

`PrintNameRuleService` scans the vault for `exoob__PrintNameRule` assets and resolves display name templates per class. Templates use `{{property}}` placeholders that expand to frontmatter values at render time.

### Key Interface

```typescript
interface PrintNameRule {
  className: string; // e.g. "ems__Task"
  template: string; // e.g. "{{exo__Asset_label}} ({{ems__Effort_status}})"
  priority: number; // Higher priority wins
  sourceFile: string; // Vault file that defines the rule
}
```

### How It Works

1. **Scan**: `initialize()` reads all vault files for `exoob__PrintNameRule` instances
2. **Lookup**: `getTemplateForClass(className)` returns the highest-priority template
3. **Inheritance**: If no direct rule, walks `exo__Class_superClass` chain
4. **Resolve**: `createMetadataResolver()` expands `[[wikilinks]]` to frontmatter metadata

### Key File

- `packages/obsidian-plugin/src/domain/display-name/PrintNameRuleService.ts`

### Usage in Display Name Resolution

```typescript
const service = new PrintNameRuleService(app);
service.initialize();

const rule = service.getTemplateForClass("ems__Task");
if (rule) {
  // rule.template = "{{exo__Asset_label}} [{{ems__Effort_status}}]"
  // Expand placeholders with actual metadata values
}
```

**Reference**: PR #2330 - PrintNameRule Dynamic Display Names (March 2026)

---

## Cross-Vault SPARQL Pattern

**When to use**: Querying across multiple Obsidian vaults (e.g., active + archive) in a single SPARQL query

### CLI Usage

```bash
# Query active vault only (default)
npx @kitelev/exocortex-cli query --vault /path/to/active "SELECT ?s WHERE { ?s a ems:Task }"

# Query active + archive vault together
npx @kitelev/exocortex-cli query \
  --vault /path/to/active \
  --also /path/to/archive \
  "SELECT ?s ?label WHERE { ?s exo:Asset_label ?label }"

# Multiple --also flags for 3+ vaults
npx @kitelev/exocortex-cli query \
  --vault /main \
  --also /archive-2024 \
  --also /archive-2025 \
  "SELECT (COUNT(*) AS ?total) WHERE { ?s a ems:Task }"
```

### Implementation

The `--also` flag is repeatable. Each additional vault is converted to RDF triples and merged into the same in-memory triple store before query execution.

```typescript
// In sparql-query.ts:
const alsoVaults = options.also || [];
for (const alsoPath of alsoVaults) {
  const alsoAdapter = new FileSystemVaultAdapter(resolvedPath);
  const alsoTriples = await new NoteToRDFConverter(alsoAdapter).convertVault();
  triples = triples.concat(alsoTriples);
}
```

### Key Considerations

- **Namespace conflicts**: Both vaults must use compatible ontologies (same `exo__Ontology_url`)
- **Performance**: Each `--also` vault adds conversion time; use `--timeout` for large vaults
- **Duplicate detection**: Assets with same UUID in multiple vaults appear once per vault in results
- **Use case**: Analytics spanning archived and active data (e.g., yearly productivity reports)

### Key File

- `packages/cli/src/commands/sparql-query.ts` (lines 221-233: flag definition; lines 357-374: vault loading)

**Reference**: PR #2332 - Cross-Vault SPARQL Query Support (March 2026)

---

## First-Launch Modal Pattern (E2E-safe)

> **Historical note**: the original consumer of this pattern (`ChangelogModal` + `shouldShowChangelog`) was **removed** in #2993 — no startup modal exists in the plugin today. The gate technique below remains valid generic advice for any future startup-triggered UI.

**When to use**: Adding any startup-triggered modal, toast, or notice that appears conditionally based on stored plugin state (e.g. "what's new in vX.Y.Z", onboarding prompts, feature-announcement dialogs).

**Problem**: Naïve implementation shows the modal on fresh installs too — which breaks E2E runs. The test vault at `packages/obsidian-plugin/tests/e2e/test-vault/.obsidian/plugins/exocortex/` ships only `main.js` + `manifest.json`, no `data.json`. On boot, `plugin.loadData()` returns `null` → any "show if stored version ≠ current" gate evaluates `undefined !== "15.x.y"` → `true` → modal opens → intercepts first UI click → first Playwright retry → `NoFlakyReporter` (`packages/obsidian-plugin/playwright-no-flaky-reporter.ts`) fails CI on flaky detection.

**Solution**: Distinguish fresh install from upgrade by capturing the raw `loadData()` result before merging with defaults:

```typescript
export default class MyPlugin extends Plugin {
  /** True when data.json did not exist at startup — brand-new install. */
  private isFreshInstall = false;

  async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.isFreshInstall = rawData == null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    const currentVersion = this.manifest.version;
    if (this.isFreshInstall) {
      // Silent seed — fresh install has no prior state to contrast against
      this.settings.lastShownVersion = currentVersion;
      void this.saveSettings();
    } else if (this.settings.lastShownVersion !== currentVersion) {
      // ...show the startup UI (debounced), then persist currentVersion...
    }
  }
}
```

**Why `loadData()` return value is the signal**:

- `loadData()` returns `null` **only** on the first load when `data.json` does not exist
- After the first `saveSettings()`, it returns the stored object (possibly empty)
- Gating on a missing setting _field_ is unreliable (merge with defaults hides the distinction)

**Validation**: run `npm run test:e2e` locally before push when modifying plugin startup sequence — the in-repo `npm run test:all` does NOT include Docker E2E, so flaky-modal races only surface in CI.

**Reference**: RFC-024 Phase 0 (#2833) / PR #2838 — E2E flaky `daily-archive-filter.spec.ts` was caused by the (since-removed) `ChangelogModal` intercepting archive-toggle clicks on fresh test vault; fixed by `isFreshInstall` gate.

## BFS subClass Closure via metadataCache

For plugin code that needs "all assets of class X or any subclass thereof" — synchronous BFS over `exo__Class_superClass` triples in the metadataCache. No SPARQL engine dependency, no async lifecycle complexity.

**Reference implementation**: `PropertiesLabelPatch.resolvePropertyClassUids` (RFC-030, PR #3246).

**Pattern**:

1. Iterate `app.vault.getMarkdownFiles()` and build a child→parents map from frontmatter:

   ```ts
   const superClassMap: Map<string, Set<string>> = new Map();
   for (const file of files) {
     const fm = app.metadataCache.getFileCache(file)?.frontmatter;
     if (!fm) continue;
     const uid = fm["exo__Asset_uid"];
     if (typeof uid !== "string") continue;
     const supers = normalizeClassList(fm["exo__Class_superClass"]); // unwrap wikilinks
     superClassMap.set(uid.trim(), new Set(supers));
   }
   ```

2. BFS fixpoint from a known root UID (hardcoded constant, e.g. `EXO_PROPERTY_ROOT_UID = "38277bfa-..."`):

   ```ts
   const result = new Set<string>([ROOT_UID]);
   let changed = true;
   while (changed) {
     changed = false;
     for (const [childUid, parentUids] of superClassMap) {
       if (result.has(childUid)) continue;
       for (const parentUid of parentUids) {
         if (result.has(parentUid)) {
           result.add(childUid);
           changed = true;
           break;
         }
       }
     }
   }
   ```

3. Use the resulting Set as a class-filter predicate in a downstream pass:
   ```ts
   const classUids = normalizeClassList(fm["exo__Instance_class"]);
   if (!classUids.some((uid) => result.has(uid))) continue; // skip — not a subclass
   ```

**Performance**: For ~30 class assets + 138 property-class subclasses in current TBox, BFS converges in 2-3 iterations, ~5-10 ms total at index build time.

**Why not SPARQL `rdfs:subClassOf*`**: Plugin code runs before the SPARQL engine may be ready (metadataCache.resolved fires before any user query). BFS over metadataCache is sync and dependency-free.

**Cycle safety**: The `result.has(childUid)` guard prevents infinite loops if `exo__Class_superClass` contains a cycle (A→B, B→A). Cycles not connected to the root are silently excluded.

**Reference**: RFC-030 §3.2 + PR #3246 (`PropertiesLabelPatch.ts:194-232`).

**Pitfall — single-UID root is not enough**: Three independent reviewers (RFC-030 review iterations) all missed that a filter checking only direct `exo__Property` UID excluded `exo__ObjectProperty` instances (87/138 property assets). Always verify empirically: `grep -rln '"\[\[<root-uid>\]\]"' assetspaces/ | wc -l` shows direct count; if substantially smaller than expected total, you need closure.

## Collision Guard Pattern for Cache Deduplication

When a cache key can be populated from multiple sources (e.g. different files with the same `exo__Asset_label`), default `cache.set(key, value)` silently overwrites. For diagnostic purposes you want **first-write-wins + console.warn**.

```ts
function setWithCollisionGuard<K, V extends { file: { path: string } }>(
  cache: Map<K, V>,
  key: K,
  value: V,
): void {
  const existing = cache.get(key);
  if (existing && existing.file.path !== value.file.path) {
    console.warn(
      `[CacheCollision] Key "${String(key)}": ` +
        `keeping ${existing.file.path}, ignoring ${value.file.path}`,
    );
    return; // first-write-wins
  }
  cache.set(key, value);
}
```

**Properties**:

- Deterministic by source enumeration order (e.g. `vault.getMarkdownFiles()`)
- Same-file rewrite (same `file.path`) is silent — no spurious warnings on idempotent re-indexing
- Cross-file collision logs both paths so the user can manually pick the winner (rename / archive / merge)
- Audit query for systematic detection (SPARQL or shell):
  ```bash
  grep -rh 'exo__Asset_label:' assetspaces/ | sort | uniq -d
  ```

**When to use**: cache builders that consume frontmatter values which are conventionally-but-not-formally unique (label, alias, displayName). Pure-UID keys (which are guaranteed unique by definition) don't need this.

**Reference**: `PropertiesLabelPatch.setWithCollisionGuard` (RFC-030, PR #3246). Empirical collisions found pre-merge: `exo__Asset_label: exo__Asset_updatedAt` ×2, `exo__Asset_label: ems__Initiative` ×2 — surfaced via console.warn after deployment, not blocked.

---

## Archived — sprint & post-mortem retrospectives

Dated sprint retrospectives and a post-mortem (records of _what was done_ in specific past
work batches — issue/step/line tables — rather than reusable coding techniques) were moved
out of this catalog to a frozen archive (as of 2026-06-19):

- Documentation, Feature-Removal, Settings-Cleanup, SPARQL-Feature, CLI-UX-Enhancement,
  Test-Coverage and Security-Fix sprint write-ups; RFC-013 post-mortem patterns. Their
  reusable process insights live on in the kept patterns (Sequential Related Tasks,
  Feature Cluster Development, Major Feature Removal, Post-Removal Dependency Cleanup).

See [docs/history/PATTERNS-sprint-retrospectives-2026-06-19.md](docs/history/PATTERNS-sprint-retrospectives-2026-06-19.md).
