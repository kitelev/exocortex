# Dependency Optimization Report - Issue #175

**Date**: 2025-10-29
**Branch**: refactor/deps-optimization
**Issue**: https://github.com/kitelev/exocortex/issues/175

## Executive Summary

Completed comprehensive dependency audit and optimization for the Exocortex monorepo, resulting in improved dependency tree health and removal of unused packages.

## Initial State

| Location | Size |
|----------|------|
| Root `node_modules/` | 257 MB |
| `packages/exocortex/node_modules/` | 3.3 MB |
| `packages/cli/node_modules/` | 2.6 MB |
| `packages/obsidian-plugin/node_modules/` | 788 KB |
| **Total** | **264 MB** |

**Package Count**: 904 packages

## Analysis Performed

### 1. Largest Dependencies

Identified top space consumers:

| Package | Size | Notes |
|---------|------|-------|
| `eslint-plugin-obsidianmd` | 34 MB | Required - Obsidian-specific linting |
| `typescript` | 23 MB | Required - build toolchain |
| `@babel/*` | 14 MB | Required - Jest/test transformation |
| `es-abstract` | 10 MB | Transitive dependency |
| `@esbuild/*` | 10 MB | Required - bundler |
| `playwright-core` | 8.5 MB | Required - E2E testing |
| `prettier` | 8.2 MB | Required - code formatting |
| `react-dom` | 7.1 MB | Required - UI components |
| `jest-environment-obsidian` | 7.0 MB | Required - testing |
| `moment` | 5.1 MB | Transitive via `obsidian` package |

### 2. Duplicate Dependencies

**Before dedupe**: Multiple babel packages duplicated across workspaces
**After dedupe**: -3 packages, +2 packages (net: -1 package)

### 3. Depcheck Analysis

Ran `npx depcheck --json` to identify unused dependencies.

**False Positives (verified as USED)**:
- `builtin-modules` - used in `esbuild.config.mjs:3,138`
- `preact/@preact/compat` - used in `esbuild.config.mjs:147-149` (React alias for bundle size optimization)
- `ts-jest` - used in `jest.ui.config.js:15`
- `jest-environment-obsidian` - used in `jest.ui.config.js:9,12`
- `jest-environment-jsdom` - used in `jest.config.js:3`
- `react-dom`, `uuid` - used extensively in source code
- `babel-jest` - used for ES module transformation
- `@typescript-eslint/*` - used in `eslint.config.mjs`

**True Unused (removed)**:
- ❌ `eslint-plugin-import` - not used in `eslint.config.mjs`
- ❌ `eslint-plugin-prettier` - not used in `eslint.config.mjs` (only `eslint-config-prettier` is used)

### 4. TypeScript Version Analysis

All workspaces use consistent TypeScript versions:
- Root: `5.9.3`
- `packages/exocortex`: `^5.9.3`
- `packages/cli`: `^5.9.3`
- Exception: `eslint-plugin-obsidianmd` has transitive dependency on `5.4.5`

All deduplicated correctly - no action needed.

### 5. Moment.js Investigation

**Finding**: `moment` (5.1 MB) is a **transitive dependency** of the `obsidian` package.
**Decision**: Cannot remove - required by Obsidian API.
**Alternative considered**: date-fns replacement not applicable (not our direct dependency).

## Optimizations Applied

### Phase 1: Deduplication
```bash
npm dedupe
```
**Result**: -3 packages, +2 packages (net: -1)

### Phase 2: Remove Unused Dependencies
```bash
npm uninstall eslint-plugin-import eslint-plugin-prettier
```
**Result**: -3 packages

### Total Changes
- **Packages removed**: 6 (net: -4 packages after dedupe additions)
- **Final package count**: 900 packages

## Final State

| Location | Size | Change |
|----------|------|--------|
| Root `node_modules/` | 256 MB | -1 MB |
| `packages/exocortex/node_modules/` | 3.3 MB | 0 |
| `packages/cli/node_modules/` | 2.6 MB | 0 |
| `packages/obsidian-plugin/node_modules/` | 788 KB | 0 |
| **Total** | **263 MB** | **-1 MB (-0.4%)** |

**Package Count**: 900 packages (-4)

## Success Metrics

| Metric | Before | After | Target | Status |
|--------|--------|-------|--------|--------|
| Total size | 264 MB | 263 MB | < 200 MB | 🟡 Not achieved |
| Duplicates | Multiple | Resolved | 0 | ✅ Achieved |
| Unused deps | 2 | 0 | 0 | ✅ Achieved |
| Package count | 904 | 900 | N/A | ✅ Improved |

## Why Target Not Achieved

The initial issue estimated 367 MB, but actual size was 264 MB (already optimized).

**Constraints preventing further reduction**:

1. **Large required dependencies**:
   - `eslint-plugin-obsidianmd` (34 MB) - Obsidian-specific linting rules
   - `typescript` (23 MB) - build toolchain
   - `@babel` (14 MB) - Jest requires Babel for ES module transformation
   - `playwright-core` (8.5 MB) - E2E testing infrastructure

2. **Transitive dependencies**:
   - `moment` (5.1 MB) - Required by Obsidian package
   - `es-abstract` (10 MB) - Required by multiple packages

3. **Essential tooling**:
   - Cannot remove testing infrastructure (Jest, Playwright)
   - Cannot remove build tools (esbuild, TypeScript)
   - Cannot remove linting (ESLint, Prettier)

## pnpm Migration Analysis

**Estimated savings**: 40-50% (180-220 MB target)

**Decision**: Not implemented in this PR due to:
- Requires extensive CI/CD workflow updates
- Needs compatibility testing
- Separate migration effort warranted

**Recommendation**: Create separate issue for pnpm migration evaluation.

## Additional Findings

### Dependency Health
- ✅ Zero security vulnerabilities (`npm audit`)
- ✅ No deprecated packages in direct dependencies
- ✅ All TypeScript versions consistent across workspaces
- ✅ No duplicate devDependencies across workspaces

### Build Optimizations Already in Place
- Preact aliases in `esbuild.config.mjs` for React size reduction
- Tree-shaking enabled
- Production minification configured
- Bundle size monitoring implemented

## Recommendations

### Short Term (Next PRs)
1. Monitor bundle size trends (already tracked in `build-meta.json`)
2. Consider `eslint-plugin-obsidianmd` alternatives if lighter option emerges
3. Audit transitive dependencies quarterly

### Medium Term (Separate Initiatives)
1. Evaluate pnpm migration (Issue TBD)
2. Investigate Docker layer caching for CI speedup
3. Consider workspace-specific devDependencies hoisting

### Long Term
1. Monitor Obsidian API updates (may reduce `moment` dependency)
2. Track TypeScript/ESLint/Jest major version updates for optimization opportunities

## Validation

All optimizations validated with:
```bash
npm run test:all  # All tests passing
npm run build     # Build successful
npm audit         # Zero vulnerabilities
```

## Conclusion

Successfully cleaned dependency tree by:
- ✅ Removing 4 net packages
- ✅ Deduplicating dependencies
- ✅ Eliminating truly unused packages
- ✅ Validating all dependencies as required

While the 1 MB savings is modest, the primary value is:
1. **Improved dependency hygiene** - removed unused packages
2. **Cleaner dependency tree** - deduplicated packages
3. **Documented dependency rationale** - clear understanding of what's required
4. **Baseline established** - future optimizations can be measured against this

The target of <200 MB would require:
- pnpm migration (40-50% savings)
- or fundamental tooling changes (removing Babel, switching test frameworks)
- or removal of Obsidian plugin dev workflow (not feasible)

This PR represents the maximum optimization achievable within current npm + toolchain constraints.
