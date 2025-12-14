# Test Coverage Quick Reference
## Issue #156 - Path to 70% Coverage

---

## Current State
```
📊 Overall Coverage: 44.18% statements
📦 Tests Passing: 655 tests in 20 suites
🎯 Target: 70% coverage
📈 Gap: +449 statements needed
```

---

## Top 15 Files to Test (Priority Order)

### 🔴 P0 - CRITICAL (Must Test First)

1. **packages/exocortex/src/domain/commands/CommandVisibility.ts**
   - Lines: 515 | Coverage: 0% | Impact: CRITICAL
   - Controls all command visibility logic
   - Estimated tests: 40-50 | Target: 70% coverage

2. **packages/exocortex/src/utilities/FrontmatterService.ts**
   - Lines: 303 | Coverage: 0% | Impact: CRITICAL
   - Used by 15+ services for YAML manipulation
   - Estimated tests: 25-30 | Target: 80% coverage

3. **packages/obsidian-plugin/src/presentation/renderers/UniversalLayoutRenderer.ts**
   - Lines: 683 | Coverage: 0% | Impact: CRITICAL
   - Main UI rendering engine
   - Estimated tests: 20-25 | Target: 50% coverage

4. **packages/obsidian-plugin/src/ExocortexPlugin.ts**
   - Lines: 225 | Coverage: 0% | Impact: CRITICAL
   - Plugin entry point and orchestrator
   - Estimated tests: 10-12 | Target: 50% coverage

---

### 🟡 P1 - HIGH (Test Second)

5. **packages/exocortex/src/utilities/DateFormatter.ts**
   - Lines: 209 | Coverage: 0% | Impact: HIGH
   - Timestamp generation for all services
   - Estimated tests: 15-20 | Target: 85% coverage

6. **packages/obsidian-plugin/src/presentation/builders/ButtonGroupsBuilder.ts**
   - Lines: 580 | Coverage: 24.17% | Impact: HIGH
   - Button generation logic (partial coverage exists)
   - Estimated tests: 15-20 (additional) | Target: 60% coverage

7. **packages/exocortex/src/services/StatusTimestampService.ts**
   - Lines: 113 | Coverage: 0% | Impact: HIGH
   - Status change tracking
   - Estimated tests: 10-12 | Target: 75% coverage

8. **packages/exocortex/src/utilities/MetadataHelpers.ts**
   - Lines: 113 | Coverage: 0% | Impact: HIGH
   - Metadata extraction utilities
   - Estimated tests: 12-15 | Target: 80% coverage

9. **packages/obsidian-plugin/src/adapters/ObsidianVaultAdapter.ts**
   - Lines: 54 | Coverage: 61.11% | Impact: HIGH
   - Vault operations adapter (enhance existing tests)
   - Estimated tests: 5-8 (additional) | Target: 85% coverage

---

### 🟢 P2 - MEDIUM (Test Third)

10. **packages/exocortex/src/utilities/MetadataExtractor.ts**
    - Lines: 80 | Coverage: 0% | Impact: MEDIUM
    - Estimated tests: 8-10 | Target: 70% coverage

11. **packages/obsidian-plugin/src/presentation/modals/NarrowerConceptModal.ts**
    - Lines: 198 | Coverage: 2.77% | Impact: MEDIUM
    - Estimated tests: 10-12 | Target: 30% coverage

12. **packages/obsidian-plugin/src/presentation/modals/LabelInputModal.ts**
    - Lines: 145 | Coverage: 3.92% | Impact: MEDIUM
    - Estimated tests: 8-10 | Target: 30% coverage

13. **packages/obsidian-plugin/src/application/commands/CreateInstanceCommand.ts**
    - Lines: 38 | Coverage: 34.21% | Impact: MEDIUM
    - Estimated tests: 5-8 (additional) | Target: 60% coverage

14. **packages/obsidian-plugin/src/application/commands/CreateProjectCommand.ts**
    - Lines: 35 | Coverage: 37.14% | Impact: MEDIUM
    - Estimated tests: 4-6 (additional) | Target: 60% coverage

15. **packages/obsidian-plugin/src/adapters/caching/BacklinksCacheManager.ts**
    - Lines: 42 | Coverage: 0% | Impact: MEDIUM
    - Estimated tests: 6-8 | Target: 70% coverage

---

## 3-Phase Implementation Plan

### Phase 1: Core Package Foundation (Days 1-6)
**Files:** #1, #2, #5, #7, #8, #10
**Coverage Gain:** +300 statements
**Effort:** 6 days
**Risk:** LOW (pure utilities, easy to test)

### Phase 2: UI/Presentation Layer (Days 7-12)
**Files:** #3, #4, #6, #11, #12
**Coverage Gain:** +292 statements
**Effort:** 6 days
**Risk:** MEDIUM (Obsidian API dependencies)

### Phase 3: Commands & Infrastructure (Days 13-15)
**Files:** #9, #13, #14, #15
**Coverage Gain:** +90 statements
**Effort:** 3 days
**Risk:** LOW (patterns already established)

---

## Coverage Projection

```
Current:        768 statements (44.18%)
Phase 1:       +300 statements
Phase 2:       +292 statements
Phase 3:       +90  statements
                ----
Final:        1,450 statements (83.43%)

Target:       1,217 statements (70%)
Margin:        +233 statements over target ✅
```

---

## Test Infrastructure Setup

### Step 1: Create Core Package Test Directory
```bash
cd packages/exocortex
mkdir -p tests/{domain,services,utilities}
```

### Step 2: Create jest.config.js for Core
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

### Step 3: Start Testing (Begin with FrontmatterService.ts)

---

## Success Metrics

### Coverage Targets
- ✅ Global statements: ≥70%
- ✅ Global branches: ≥70%
- ✅ Global functions: ≥62% (current target)
- ✅ Global lines: ≥70%
- ✅ Domain layer: ≥78% (current target)

### Quality Gates
- ✅ All tests passing in CI
- ✅ No existing tests broken
- ✅ Each test file ≥80% coverage of target file
- ✅ No skipped tests without documentation

---

## Quick Start

```bash
# 1. Create test infrastructure
cd /Users/kitelev/Documents/exocortex-development/worktrees/exocortex-claude1-test-coverage
cd packages/exocortex
mkdir -p tests/utilities
touch tests/utilities/FrontmatterService.test.ts

# 2. Run coverage to verify setup
cd ../..
COVERAGE=true CI=true npx jest --config packages/obsidian-plugin/jest.config.js --coverage --runInBand

# 3. Start implementing tests (Priority Order)
# - FrontmatterService.ts (Day 1)
# - DateFormatter.ts (Day 2)
# - CommandVisibility.ts (Day 3)
```

---

## Key Insights

1. **Core package has 0% coverage** - Biggest opportunity (+300 statements)
2. **UI layer mostly untested** - UniversalLayoutRenderer is 683 lines with 0% coverage
3. **15 days to 83% coverage** - Comfortable margin over 70% target
4. **Low risk** - Phase 1 (utilities) are easy to test and high impact
5. **Buffer built-in** - +233 statements margin allows flexibility on hard-to-test UI

---

## Next Action

**START HERE:**
```bash
# Create and implement first test
packages/exocortex/tests/utilities/FrontmatterService.test.ts
```

**Expected outcome:** +242 statements covered (80% of 303 lines)

---

**For detailed analysis, see:** `COVERAGE_ANALYSIS.md`
