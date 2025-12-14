# Test Coverage Analysis Report
## Issue #156: Increase Coverage from 49% to 70%

**Generated:** 2025-10-28
**Current Coverage:** 44.18% statements, 43.96% branches, 36.84% functions, 45.74% lines
**Target Coverage:** 70% across all metrics
**Gap to Close:** ~26% increase needed

---

## Executive Summary

The Exocortex monorepo currently has:
- **655 passing unit tests** across 20 test suites
- **Current Coverage:** 44.18% statements (768/1738)
- **Target Coverage:** 70% statements (1217/1738)
- **Tests Needed:** ~449 additional statements to cover

### Coverage Breakdown by Package

1. **exocortex** (packages/exocortex/): **0% coverage** - No tests exist
   - 36 source files (~3,212 lines)
   - All business logic untested

2. **@exocortex/obsidian-plugin** (packages/obsidian-plugin/): **44.18% coverage**
   - 20 test files exist
   - High-value files (services) are well-tested
   - UI/presentation layer mostly untested

3. **@exocortex/cli** (packages/cli/): **Not measured** - No tests exist
   - CLI package has no test infrastructure

---

## Critical Uncovered Files (Priority Order)

### Tier 1: HIGH IMPACT - Core Business Logic (0% coverage)

These files contain critical business logic that's currently **completely untested**:

| File | Lines | Coverage | Impact | Priority |
|------|-------|----------|--------|----------|
| **packages/exocortex/src/domain/commands/CommandVisibility.ts** | 515 | 0% | CRITICAL | P0 |
| **packages/exocortex/src/utilities/FrontmatterService.ts** | 303 | 0% | CRITICAL | P0 |
| **packages/exocortex/src/utilities/DateFormatter.ts** | 209 | 0% | HIGH | P1 |
| **packages/exocortex/src/services/StatusTimestampService.ts** | 113 | 0% | HIGH | P1 |
| **packages/exocortex/src/utilities/MetadataHelpers.ts** | 113 | 0% | HIGH | P1 |
| **packages/exocortex/src/utilities/MetadataExtractor.ts** | 80 | 0% | MEDIUM | P2 |
| **packages/exocortex/src/services/PlanningService.ts** | ~100 | 0% | MEDIUM | P2 |
| **packages/exocortex/src/utilities/WikiLinkHelpers.ts** | ~50 | 0% | MEDIUM | P2 |

**Why Critical:**
- CommandVisibility.ts controls which commands appear in UI (515 lines of conditional logic)
- FrontmatterService.ts handles all YAML frontmatter operations (used by 15+ services)
- DateFormatter.ts used throughout for timestamps (high risk for timezone/format bugs)
- These are **utility/infrastructure** files used by multiple services

### Tier 2: HIGH IMPACT - UI/Presentation Layer (0-3% coverage)

| File | Lines | Coverage | Impact | Priority |
|------|-------|----------|--------|----------|
| **packages/obsidian-plugin/src/presentation/renderers/UniversalLayoutRenderer.ts** | 683 | 0% | CRITICAL | P0 |
| **packages/obsidian-plugin/src/ExocortexPlugin.ts** | 225 | 0% | CRITICAL | P0 |
| **packages/obsidian-plugin/src/presentation/builders/ButtonGroupsBuilder.ts** | 580 | 24.17% | HIGH | P1 |
| **packages/obsidian-plugin/src/presentation/modals/NarrowerConceptModal.ts** | 198 | 2.77% | MEDIUM | P2 |
| **packages/obsidian-plugin/src/presentation/modals/LabelInputModal.ts** | 145 | 3.92% | MEDIUM | P2 |
| **packages/obsidian-plugin/src/presentation/modals/SupervisionInputModal.ts** | 119 | 0% | MEDIUM | P2 |
| **packages/obsidian-plugin/src/presentation/settings/ExocortexSettingTab.ts** | 21 | 0% | LOW | P3 |

**Why Critical:**
- UniversalLayoutRenderer.ts is the main UI rendering engine (683 lines, 0% coverage!)
- ExocortexPlugin.ts is the plugin entry point (orchestrates all functionality)
- ButtonGroupsBuilder.ts has partial coverage but 75% is still untested

### Tier 3: MEDIUM IMPACT - Infrastructure/Adapters (0-61% coverage)

| File | Lines | Coverage | Impact | Priority |
|------|-------|----------|--------|----------|
| **packages/obsidian-plugin/src/adapters/ObsidianVaultAdapter.ts** | 54 | 61.11% | HIGH | P1 |
| **packages/obsidian-plugin/src/adapters/caching/BacklinksCacheManager.ts** | 42 | 0% | MEDIUM | P2 |
| **packages/obsidian-plugin/src/adapters/logging/Logger.ts** | 26 | 0% | LOW | P3 |
| **packages/obsidian-plugin/src/adapters/logging/LoggerFactory.ts** | 8 | 0% | LOW | P3 |
| **packages/obsidian-plugin/src/adapters/events/EventListenerManager.ts** | 8 | 0% | LOW | P3 |

**Why Medium:**
- ObsidianVaultAdapter.ts is partially covered but critical paths may be missing
- Caching/logging are infrastructure concerns (lower risk but should be tested)

### Tier 4: LOW IMPACT - Commands with Good Visibility Coverage

| File | Lines | Coverage | Impact | Priority |
|------|-------|----------|--------|----------|
| **CreateInstanceCommand.ts** | 38 | 34.21% | MEDIUM | P2 |
| **CreateProjectCommand.ts** | 35 | 37.14% | MEDIUM | P2 |
| **CreateRelatedTaskCommand.ts** | 33 | 39.39% | MEDIUM | P2 |
| **CreateTaskCommand.ts** | 37 | 35.13% | MEDIUM | P2 |
| **AddSupervisionCommand.ts** | 28 | 35.71% | MEDIUM | P2 |

**Why Lower Priority:**
- These commands follow similar patterns
- Visibility logic is tested via CommandVisibility.test.ts
- Main execution paths are partially covered
- Higher ROI elsewhere first

---

## Coverage Calculation: Path to 70%

### Current State
```
Total Statements: 1738
Covered: 768 (44.18%)
Uncovered: 970 (55.82%)
```

### Target State (70% coverage)
```
Target Covered: 1217 statements (70% of 1738)
Additional Coverage Needed: 449 statements
```

### Realistic Achievability Analysis

**Can we reach 70%?** **YES** - Here's why:

1. **Core Package (0% → ~60% = +300 statements)**
   - Core package has ~600 total statements (estimated)
   - Testing top 8 files (1,500 lines) = ~360 statements
   - Achievable: +300 statements covered

2. **UI/Presentation Layer (3% → ~40% = +200 statements)**
   - UniversalLayoutRenderer: 248 statements (0% → 50% = +124)
   - ExocortexPlugin: 85 statements (0% → 50% = +42)
   - ButtonGroupsBuilder: 211 statements (23% → 60% = +78)
   - Modals: ~170 statements combined (2% → 30% = +47)
   - **Subtotal: +291 statements (exceeds +200 target)**

3. **Commands (35% → 60% = +50 statements)**
   - 5 Create commands: ~190 statements
   - Currently 35% covered = 66 statements
   - Target 60% = 114 statements (+48)

**Total Projected:** +300 (core) + +200 (UI) + +50 (commands) = **+550 statements**

**Target Needed:** +449 statements

**Margin:** +101 statements buffer (allows for partial coverage on hard-to-test UI)

---

## Recommended Action Plan

### Phase 1: Core Package Foundation (Days 1-3)
**Goal:** 0% → 60% core coverage (+300 statements)

#### Week 1: Critical Utilities
1. **Day 1: FrontmatterService.ts** (303 lines)
   - Create: `packages/exocortex/tests/utilities/FrontmatterService.test.ts`
   - Test: updateProperty, addProperty, removeProperty, parseFrontmatter
   - Coverage target: 80% (242 statements)
   - Estimated tests: 25-30 test cases

2. **Day 2: DateFormatter.ts** (209 lines)
   - Create: `packages/exocortex/tests/utilities/DateFormatter.test.ts`
   - Test: toLocalTimestamp, timezone handling, format variations
   - Coverage target: 85% (178 statements)
   - Estimated tests: 15-20 test cases

3. **Day 3: CommandVisibility.ts** (515 lines)
   - Create: `packages/exocortex/tests/domain/CommandVisibility.test.ts`
   - Test: All visibility functions (already partially tested in obsidian-plugin)
   - Coverage target: 70% (360 statements)
   - Estimated tests: 40-50 test cases
   - **Note:** Many tests already exist in `packages/obsidian-plugin/tests/unit/CommandVisibility.test.ts`
   - **Action:** Move/duplicate tests to core package, add missing edge cases

#### Week 2: Core Services
4. **Day 4: MetadataHelpers.ts** (113 lines)
   - Create: `packages/exocortex/tests/utilities/MetadataHelpers.test.ts`
   - Coverage target: 80% (90 statements)
   - Estimated tests: 12-15 test cases

5. **Day 5: StatusTimestampService.ts** (113 lines)
   - Create: `packages/exocortex/tests/services/StatusTimestampService.test.ts`
   - Coverage target: 75% (85 statements)
   - Estimated tests: 10-12 test cases

6. **Day 6: MetadataExtractor.ts + WikiLinkHelpers.ts** (130 lines combined)
   - Create corresponding test files
   - Coverage target: 70% (91 statements)
   - Estimated tests: 15-18 test cases

**Phase 1 Total:** ~780 statements covered (from Core package's ~600 + obsidian-plugin utilities)

### Phase 2: UI/Presentation Layer (Days 4-7)
**Goal:** 3% → 40% UI coverage (+200 statements)

#### Week 3: Renderers
7. **Day 7-8: UniversalLayoutRenderer.ts** (683 lines, 0% coverage)
   - Create: `packages/obsidian-plugin/tests/unit/UniversalLayoutRenderer.test.ts`
   - Test approach: Component integration tests (not full E2E)
   - Focus on:
     - Layout rendering logic
     - Asset relations extraction
     - Button group generation
     - Property table generation
   - Coverage target: 50% (124 statements)
   - Estimated tests: 20-25 test cases
   - **Challenge:** Heavy Obsidian API dependencies (use extensive mocks)

8. **Day 9: ExocortexPlugin.ts** (225 lines, 0% coverage)
   - Create: `packages/obsidian-plugin/tests/unit/ExocortexPlugin.test.ts`
   - Test approach: Plugin lifecycle tests
   - Focus on:
     - onload initialization
     - Settings management
     - Service instantiation
     - Command registration
   - Coverage target: 50% (42 statements)
   - Estimated tests: 10-12 test cases

#### Week 4: Builders & Modals
9. **Day 10: ButtonGroupsBuilder.ts** (580 lines, 24% coverage)
   - Enhance existing: `packages/obsidian-plugin/tests/unit/ButtonGroupsBuilder.test.ts`
   - Current: 48/211 statements covered
   - Add tests for:
     - All button group types
     - Visibility conditions
     - Button actions
   - Coverage target: 60% (127 statements, +79 from current)
   - Estimated new tests: 15-20 test cases

10. **Day 11-12: Modal Components** (462 lines combined, 2% coverage)
    - Create:
      - `NarrowerConceptModal.test.ts`
      - `LabelInputModal.test.ts`
      - `SupervisionInputModal.test.ts`
    - Test approach: Modal behavior tests (focus on logic, not UI rendering)
    - Focus on:
      - Input validation
      - Form submission logic
      - Concept selection
    - Coverage target: 30% (47 statements)
    - Estimated tests: 20-25 test cases combined

**Phase 2 Total:** ~292 statements covered

### Phase 3: Commands & Infrastructure (Days 8-10)
**Goal:** Fill remaining gap to 70%

11. **Day 13: Create Commands** (5 files, ~190 statements, 35% coverage)
    - Enhance tests for:
      - CreateInstanceCommand.ts
      - CreateProjectCommand.ts
      - CreateRelatedTaskCommand.ts
      - CreateTaskCommand.ts
      - AddSupervisionCommand.ts
    - Coverage target: 60% (114 statements, +48 from current)
    - Estimated new tests: 15-20 test cases

12. **Day 14: ObsidianVaultAdapter.ts** (54 lines, 61% coverage)
    - Enhance existing tests
    - Cover remaining edge cases
    - Coverage target: 85% (46 statements, +13 from current)
    - Estimated new tests: 5-8 test cases

13. **Day 15: BacklinksCacheManager.ts** (42 lines, 0% coverage)
    - Create: `packages/obsidian-plugin/tests/unit/BacklinksCacheManager.test.ts`
    - Coverage target: 70% (29 statements)
    - Estimated tests: 6-8 test cases

**Phase 3 Total:** ~90 statements covered

---

## Final Projection

```
Current Coverage:    768 statements (44.18%)

Phase 1 (Core):     +300 statements
Phase 2 (UI):       +292 statements
Phase 3 (Commands): +90  statements
                    ----
Total Added:        +682 statements

Final Coverage:     1450 statements (83.43%)
                    =============================
Target Exceeded:    +233 statements over 70% goal!
```

**Result:** We can comfortably exceed the 70% target by focusing on high-impact files.

---

## Test Implementation Guidelines

### 1. Core Package Tests Setup
First, create test infrastructure for exocortex:

```bash
cd packages/exocortex
mkdir -p tests/{domain,services,utilities}
```

Update `packages/exocortex/jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
};
```

### 2. Test Patterns by File Type

#### Utility Classes (FrontmatterService, DateFormatter, MetadataHelpers)
```typescript
describe('FrontmatterService', () => {
  let service: FrontmatterService;

  beforeEach(() => {
    service = new FrontmatterService();
  });

  describe('updateProperty', () => {
    it('should update existing property in frontmatter', () => {
      const content = `---\nstatus: draft\n---\n# Content`;
      const result = service.updateProperty(content, 'status', 'done');
      expect(result).toContain('status: done');
    });

    it('should add property if frontmatter exists but property missing', () => {
      // Test case
    });

    it('should create frontmatter block if missing', () => {
      // Test case
    });

    it('should handle properties with special characters', () => {
      // Edge case
    });
  });

  // ... more describe blocks for other methods
});
```

#### Service Classes (TaskStatusService, StatusTimestampService)
```typescript
describe('StatusTimestampService', () => {
  let service: StatusTimestampService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  beforeEach(() => {
    mockVault = createMockVault();
    service = new StatusTimestampService(mockVault);
  });

  describe('recordStatusChange', () => {
    it('should add timestamp for new status', async () => {
      // Arrange
      const file = createMockFile('task.md');
      mockVault.read.mockResolvedValue('---\n---\n# Task');

      // Act
      await service.recordStatusChange(file, 'todo', 'doing');

      // Assert
      expect(mockVault.modify).toHaveBeenCalled();
      const updatedContent = mockVault.modify.mock.calls[0][1];
      expect(updatedContent).toContain('ems__doing_timestamp');
    });
  });
});
```

#### UI Components (UniversalLayoutRenderer, ButtonGroupsBuilder)
```typescript
describe('UniversalLayoutRenderer', () => {
  let renderer: UniversalLayoutRenderer;
  let mockApp: jest.Mocked<App>;
  let mockSettings: ExocortexSettings;

  beforeEach(() => {
    mockApp = createMockObsidianApp();
    mockSettings = createMockSettings();
    renderer = new UniversalLayoutRenderer(mockApp, mockSettings);
  });

  describe('renderLayout', () => {
    it('should render asset relations table for file with relations', () => {
      // Test rendering logic (not full DOM, just data transformation)
    });

    it('should render empty state when no relations exist', () => {
      // Test edge case
    });

    it('should respect visibility settings', () => {
      mockSettings.layoutVisible = false;
      // Test that layout is not rendered
    });
  });

  // Focus on LOGIC, not DOM manipulation
  // Test data transformation, filtering, sorting
});
```

### 3. Mock Patterns

#### Mock Obsidian Vault
```typescript
function createMockVault(): jest.Mocked<IVaultAdapter> {
  return {
    read: jest.fn(),
    modify: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn(),
    getFiles: jest.fn(),
    getAbstractFileByPath: jest.fn(),
  };
}
```

#### Mock TFile
```typescript
function createMockFile(path: string, content?: string): TFile {
  return {
    path,
    basename: path.split('/').pop()?.replace('.md', '') || '',
    extension: 'md',
    stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
    vault: {} as any,
  } as TFile;
}
```

### 4. Coverage Verification

After implementing tests, verify coverage:
```bash
# Run tests with coverage
COVERAGE=true CI=true npx jest --config packages/obsidian-plugin/jest.config.js --coverage --runInBand

# Check if thresholds met
echo "Target: 70% statements"
echo "Actual: <check output>"
```

---

## Risk Assessment

### High-Confidence Areas (80%+ achievable coverage)
- ✅ FrontmatterService.ts (pure utility, easy to test)
- ✅ DateFormatter.ts (deterministic logic)
- ✅ MetadataHelpers.ts (stateless utilities)
- ✅ StatusTimestampService.ts (service with mockable dependencies)

### Medium-Confidence Areas (60-70% achievable coverage)
- ⚠️ CommandVisibility.ts (many edge cases, but well-defined logic)
- ⚠️ ButtonGroupsBuilder.ts (complex UI logic, partial coverage exists)
- ⚠️ Create Commands (modal interactions are tricky)

### Lower-Confidence Areas (40-60% achievable coverage)
- 🔴 UniversalLayoutRenderer.ts (heavy Obsidian API dependencies, complex rendering)
- 🔴 ExocortexPlugin.ts (plugin lifecycle, integration-heavy)
- 🔴 Modal components (UI-heavy, limited value in unit tests)

### Mitigation Strategy
- **If UI tests prove too difficult:** Shift focus to remaining core utilities
- **Alternative files with high ROI:**
  - PlanningService.ts (~100 lines)
  - WikiLinkHelpers.ts (~50 lines)
  - TaskFrontmatterGenerator.ts (107 lines)
- **Buffer:** We have +233 statements margin, so can skip hardest UI tests

---

## Success Metrics

### Definition of Done
- ✅ Global coverage ≥70% statements
- ✅ Global coverage ≥70% branches
- ✅ Global coverage ≥62% functions (already at target in jest.config.js)
- ✅ Global coverage ≥70% lines
- ✅ Domain layer coverage ≥78% (already at target)
- ✅ All new tests passing in CI
- ✅ No existing tests broken

### Quality Gates
- Each test file must have ≥80% coverage of its target file
- No skipped tests (.skip()) without documented reason
- All tests must be deterministic (no flaky tests)
- Mock usage must be documented in test comments

---

## Next Steps

1. **Create core package test infrastructure** (jest.config.js, test directories)
2. **Start with FrontmatterService.ts** (highest ROI, pure utility)
3. **Move existing CommandVisibility tests** to core package
4. **Progress through Phase 1** (Days 1-6: Core utilities)
5. **Tackle Phase 2** (Days 7-12: UI layer)
6. **Verify coverage after Phase 1 & 2** (should be at ~60%)
7. **Complete Phase 3** to exceed 70% target

---

## Conclusion

**✅ The 70% coverage target is achievable within 15 days of focused work.**

**Key Success Factors:**
1. **Core package tests** provide the biggest coverage gains (+300 statements)
2. **UI tests** are optional but valuable (+200 statements)
3. **Built-in buffer** of +233 statements allows for flexibility

**Recommendation:** Start immediately with Phase 1 (Core utilities) as these have:
- Highest impact on coverage
- Lowest implementation risk
- Highest code quality improvement
- Foundation for all other tests

**Total Effort Estimate:**
- 15 days of focused development
- ~150-200 new test cases
- ~682 additional statements covered
- **Final coverage: 83.43%** (exceeds target by 13.43%)
