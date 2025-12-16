# AI Development Patterns

> Lessons learned from 96+ completed GitHub Issues (December 2025)

This document captures patterns discovered through AI-driven development, distilled from actual implementation experience.

---

## Table of Contents

1. [SPARQL Feature Implementation Pattern](#sparql-feature-implementation-pattern)
2. [Layout System Component Pattern](#layout-system-component-pattern)
3. [Code Quality Sprint Pattern](#code-quality-sprint-pattern)
4. [Parallel Issue Resolution Pattern](#parallel-issue-resolution-pattern)
5. [Complex Component Implementation Pattern](#complex-component-implementation-pattern)

---

## SPARQL Feature Implementation Pattern

**When to use**: Implementing SPARQL 1.1/1.2 spec features (functions, operators, syntax extensions)

**Evidence**: Issues #956-989 (datetime, string functions, RDF-Star support)

### Characteristics

| Metric | Value |
|--------|-------|
| Average steps | 70-100 |
| Success rate | 100% (all merged) |
| Typical PR time | 2-4 hours |

### Implementation Workflow

```
1. Research Phase (15 min)
   ├── Read SPARQL 1.1/1.2 specification
   ├── Find reference implementations
   └── Check existing codebase patterns

2. Implementation Phase (45-60 min)
   ├── Create/extend executor or function
   ├── Add type definitions
   └── Handle edge cases

3. Testing Phase (30-45 min)
   ├── Unit tests for happy path
   ├── Edge case tests (null, empty, boundary)
   └── Integration tests if needed

4. Documentation Phase (10 min)
   ├── JSDoc comments
   └── Update SPARQL feature matrix
```

### Key Success Factors

1. **Spec compliance first**: Always start by reading the W3C specification
2. **Test boundary conditions**: Empty inputs, null values, type mismatches
3. **Consistent naming**: `execute*()` for functions, `*Executor` for handlers
4. **Reuse existing infrastructure**: FilterExecutor, TypeCoercion utilities

### Real-world Examples

**DateTime Subtraction (Issue #972, #962, #963)**:
- Pattern: `xsd:dateTime - xsd:dateTime = xsd:dayTimeDuration`
- Implementation: ArithmeticOperator with type-aware dispatch
- Test coverage: Positive/negative durations, timezone handling

**String Functions (Issue #982, #983)**:
- Pattern: NORMALIZE(), FOLD() following XPath/XQuery semantics
- Implementation: StringFunctionExecutor with Unicode support
- Test coverage: NFC/NFD/NFKC/NFKD normalization forms

**RDF-Star Support (Issue #956, #957, #979)**:
- Pattern: Quoted triples in BGP and CONSTRUCT
- Implementation: Extended parser + TriplePattern model
- Test coverage: Nested annotations, reification queries

---

## Layout System Component Pattern

**When to use**: Building presentation layer components (renderers, tables, views)

**Evidence**: Issues #964-977 (Layout System implementation)

### Dependency Order

```
1. Domain Models (#964)        → Data structures (LayoutConfig, ColumnDefinition)
2. Parser Infrastructure (#965) → LayoutParser, validation
3. Core Renderer (#967)         → TableLayoutRenderer (most complex)
4. Orchestrator (#968)          → LayoutService coordination
5. Secondary Renderers (#970-977) → Kanban, Graph, Calendar, Code Block
6. Action Integration (#998)     → Command buttons, user interaction
```

### Lessons from Issue #967 (TableLayoutRenderer)

**Problem observed**: 25+ execution attempts before successful merge (307 steps)

**Root causes identified**:
- Complex component with many dependencies
- State management between cells and rows
- Event handling for sorting/filtering
- Integration with existing table infrastructure

**Solution pattern**:
```typescript
// 1. Start with minimal viable renderer
class TableLayoutRenderer {
  render(config: LayoutConfig): HTMLElement {
    // Scaffold structure first
    const table = createEl("table");
    return table;
  }
}

// 2. Add features incrementally
// - Column rendering (iteration 2)
// - Row rendering (iteration 3)
// - Sorting (iteration 4)
// - Filtering (iteration 5)
// - Events (iteration 6)
```

### Post-First-Component Acceleration

| Component | Steps | Time | Notes |
|-----------|-------|------|-------|
| TableLayoutRenderer (#967) | 307 | ~5 hours | First, most complex |
| KanbanLayoutRenderer (#970) | 84 | ~1.5 hours | Learned from #967 |
| GraphLayoutRenderer (#971) | 151 | ~2.5 hours | D3.js integration |
| CalendarLayoutRenderer (#977) | 94 | ~1.5 hours | Temporal handling |

**Key insight**: First component establishes patterns; subsequent components benefit from warm context.

---

## Code Quality Sprint Pattern

**When to use**: Addressing CodeQL/security scanning alerts at scale

**Evidence**: Issues #896-905 (P0→P3 code scanning fixes)

### Prioritization Order

```
P0 (Critical - Same Day)
├── ReDoS vulnerabilities (#897)
├── Weak cryptography (#898)
└── Property overwrite bugs (#896)

P1 (High - Within 24h)
├── Incomplete sanitization (#902)
├── Superfluous arguments (#899)
├── Useless assignments (#900)
└── Code quality warnings (#901)

P2 (Medium - Within Week)
└── Source code unused variables (#903)

P3 (Low - Batch Processing)
├── Test unused variables (#904)
└── Semicolon warnings (#905)
```

### Execution Pattern

```bash
# 1. Group by category for batch fixing
grep -r "unused" packages/*/src/ | wc -l  # Count scope

# 2. Fix by package (maintain focus)
# packages/core → packages/obsidian-plugin → packages/cli

# 3. Run targeted tests after each fix
npm test -- --testPathPattern="packages/core"

# 4. Commit by severity level
git commit -m "fix(security): address ReDoS vulnerabilities (P0)"
git commit -m "fix(quality): remove unused variables (P3)"
```

### Efficiency Metrics

| Priority | Avg Steps | Typical Time | Automation Potential |
|----------|-----------|--------------|---------------------|
| P0 | 90-120 | 2-3 hours | Low (manual analysis) |
| P1 | 60-90 | 1-2 hours | Medium (lint --fix) |
| P2/P3 | 50-70 | 1 hour | High (batch sed/awk) |

---

## Parallel Issue Resolution Pattern

**When to use**: Multiple independent issues can be worked simultaneously

**Evidence**: Issue #967 showed 25+ "Completed, Steps: 0" entries, suggesting parallel execution attempts

### Anti-Pattern: Race Condition on Same Issue

```
Agent A: Start Issue #967, create worktree
Agent B: Start Issue #967, create worktree (CONFLICT!)
Agent A: Implement feature, create PR
Agent B: Implement same feature, create PR (DUPLICATE!)
```

**Solution**: Issue Lock mechanism (see CLAUDE.md § Issue Lock)

### Safe Parallelism Pattern

```
Agent A: Issue #967 (TableLayoutRenderer)
Agent B: Issue #970 (KanbanLayoutRenderer) ← Different component
Agent C: Issue #983 (SPARQL function)      ← Different subsystem
```

**Selection criteria for parallel work**:
1. Different subsystems (presentation vs infrastructure vs core)
2. No shared dependencies between issues
3. Clear ownership through issue assignment
4. Lock acquired before starting work

---

## Complex Component Implementation Pattern

**When to use**: Components with 200+ step counts or multiple failure attempts

**Evidence**: Issues #932 (SPARQL compliance suite, 230 steps), #967 (307 steps), #904 (252 steps)

### Indicators of Complexity

- Multiple domain integrations (UI + data + events)
- State management requirements
- External dependencies (D3.js, Obsidian API)
- Large test surface area

### Mitigation Strategies

1. **Spike First**: Create throwaway prototype to validate approach
2. **Incremental Commits**: Commit working state every 30-50 steps
3. **Test-Driven**: Write tests before complex logic
4. **Checkpoint Branches**: Push to remote frequently for recovery

### Recovery from Failed Attempts

```bash
# If implementation fails after 100+ steps:
# 1. Document what didn't work
# 2. Identify root cause (architecture? approach? dependencies?)
# 3. Create new branch from clean main
# 4. Apply lessons learned to new attempt

git checkout main
git pull origin main
git worktree add ../worktrees/retry-feature -b feature/retry
# Start fresh with new approach
```

### Success Metrics for Complex Components

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Steps to merge | < 150 | 150-250 | > 250 |
| Failed attempts | 0-1 | 2-3 | > 3 |
| Time to merge | < 4h | 4-8h | > 8h |

---

## Summary Statistics

Based on 96 completed issues (December 15-16, 2025):

| Category | Issues | Avg Steps | Success Rate |
|----------|--------|-----------|--------------|
| SPARQL features | 45+ | 85 | 100% |
| Layout System | 12 | 140 | 100% |
| Code Quality | 15 | 90 | 100% |
| RDF-Star | 4 | 95 | 100% |

**Total productivity**: ~96 issues in 2 days = ~48 issues/day

**Key enablers**:
1. Warm context from sequential related tasks
2. Clear specification (SPARQL W3C, Layout DSL)
3. Established test patterns
4. Issue lock preventing duplicate work

---

## References

- Issue #967: TableLayoutRenderer (complex component case study)
- Issues #956-989: SPARQL feature sprint
- Issues #896-905: Code quality sprint
- CLAUDE.md § Sequential Related Tasks Pattern
- PATTERNS.md § SPARQL Test Coverage Pattern
