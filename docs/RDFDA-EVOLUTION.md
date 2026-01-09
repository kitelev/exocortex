# RDF-Driven Architecture Evolution

> **Tracking the Evolution of RDF-Driven Architecture in Exocortex**
>
> This document chronicles the major milestones and architectural changes as the RDF-Driven Architecture matures.

---

## Table of Contents

- [Overview](#overview)
- [Version History](#version-history)
  - [v14.0 - ActionInterpreter Integration & Legacy Cleanup](#v140---actioninterpreter-integration--legacy-cleanup)
  - [v1.3-v2.0 - Foundation and Evaluation](#v13-v20---foundation-and-evaluation)
- [Architecture Diagram](#architecture-diagram)
- [Related Documentation](#related-documentation)

---

## Overview

The RDF-Driven Architecture in Exocortex moves UI configuration from hardcoded TypeScript to declarative RDF definitions. This enables:

- **Declarative Configuration**: Buttons, commands, layouts defined as RDF data
- **Runtime Introspection**: Query your own UI via SPARQL
- **CLI/Plugin Parity**: Same definitions work across all platforms
- **Extensibility**: Add UI elements without recompilation

For a detailed analysis of what RDF achieves (and what it doesn't), see [RDF-DRIVEN-EVALUATION.md](./RDF-DRIVEN-EVALUATION.md).

---

## Version History

### v14.0 - ActionInterpreter Integration & Legacy Cleanup

**Date:** January 2026
**Issues:** #1997-#2058
**Status:** ✅ Complete

#### Summary

v14.0 marks the completion of the RDF button migration with full ActionInterpreter integration and removal of all legacy button components. This phase achieved:

1. **ActionBridge Integration** - Bridge between RDF commands and ActionInterpreter
2. **Generic RdfButton Component** - Single component replacing 18 specialized buttons
3. **Legacy Code Removal** - 20+ deprecated button components deleted
4. **Feature Flag Removal** - `useRdfButtons` flag removed (RDF buttons now default)

#### Key Components

##### ActionBridge (`packages/obsidian-plugin/src/application/bridges/ActionBridge.ts`)

The ActionBridge serves as an adapter between RDF action definitions and ActionInterpreter's execution engine:

```typescript
// Converts RDF URI types to ActionInterpreter's prefixed format
const bridge = new ActionBridge();
const definition = bridge.toActionDefinition({
  type: "https://exocortex.my/ontology/exo-ui#CreateAssetAction",
  params: { assetClass: "Task" }
});
// Result: { type: "exo-ui:CreateAssetAction", params: { assetClass: "Task" } }
```

**Supported Action Types (8 Fixed Verbs):**

| Action Type | Purpose |
|-------------|---------|
| `CreateAssetAction` | Create new asset from template |
| `UpdatePropertyAction` | Update asset property |
| `NavigateAction` | Navigate to asset |
| `ExecuteSPARQLAction` | Execute SPARQL query |
| `ShowModalAction` | Show modal dialog |
| `TriggerHookAction` | Trigger external webhook |
| `CustomHandlerAction` | Delegate to TypeScript handler |
| `CompositeAction` | Execute multiple actions in sequence |

##### RdfButton Component (`packages/obsidian-plugin/src/presentation/components/RdfButton.tsx`)

Generic button component that renders any button from RDF definition:

```tsx
<RdfButton
  definition={{
    uri: "exo-ui:StartButton",
    label: "Start",
    icon: "play",
    variant: "primary",
    action: "exo-ui:StartAction",
  }}
  onClick={async (def) => {
    await actionInterpreter.execute(def.action, context);
  }}
/>
```

**Features:**
- Label and icon from RDF definition
- Variant styling (primary, secondary, success, warning, danger)
- Tooltip support
- Loading and disabled states

#### Cleanup Metrics

| Metric | Value |
|--------|-------|
| **PRs Merged** | 22 cleanup PRs |
| **Lines Deleted** | **20,719 LOC** |
| **Lines Added** | 451 LOC |
| **Net Reduction** | **20,268 LOC** |
| **Files Removed** | 35+ TypeScript files |

##### Removed Components

The following legacy button components were removed in v14.0:

| Component | PR | LOC Removed |
|-----------|-----|-------------|
| `ArchiveTaskButton` | #2039 | 350 |
| `CleanEmptyPropertiesButton` | #2040 | 237 |
| `CreateInstanceButton` | #2041 | 220 |
| `CreateProjectButton` | #2042 | 50 |
| `CreateTaskButton` | #2043 | 193 |
| `MarkTaskDoneButton` | #2044 | 277 |
| `MoveToAnalysisButton` | #2046 | 50 |
| `MoveToBacklogButton` | #2047 | 341 |
| `MoveToToDoButton` | #2048 | 50 |
| `PlanOnTodayButton` | #2049 | 319 |
| `RenameToUidButton` | #2050 | 57 |
| `RepairFolderButton` | #2051 | 234 |
| `RollbackStatusButton` | #2052 | 52 |
| `ShiftDayBackwardButton` | #2053 | 50 |
| `ShiftDayForwardButton` | #2054 | 50 |
| `StartEffortButton` | #2055 | 365 |
| `TrashEffortButton` | #2056 | 45 |
| `VoteOnEffortButton` | #2057 | 373 |
| `canVoteOnEffort` visibility rule | #2058 | 283 |
| `ButtonGroupsBuilder` (legacy) | #1528 | 2,826 |
| `CommandRegistry` (legacy) | #1536 | 14,102 |

#### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       v14.0 Button Architecture                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │   RDF Ontology  │  Button definitions in exo-ui namespace            │
│  │   (Turtle/MD)   │  - 29 buttons defined                              │
│  └────────┬────────┘  - 8 action types                                  │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Triple Store (Oxigraph)                       │   │
│  └────────┬────────────────────────────────────────────────────────┘   │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐     ┌─────────────────┐                           │
│  │ RdfButtonGroups │────▶│ ConditionEval.  │  Evaluates visibility     │
│  │    Builder      │     │                 │  via SPARQL                │
│  └────────┬────────┘     └─────────────────┘                           │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   RdfButton     │────▶│   ActionBridge  │────▶│ActionInterpreter│   │
│  │   Component     │     │   (Adapter)     │     │   (Executor)    │   │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘   │
│                                                                         │
│  PRESENTATION LAYER          APPLICATION LAYER        DOMAIN LAYER      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Data Flow

1. **Load Phase**: `RdfButtonGroupsBuilder` queries triple store for button definitions
2. **Filter Phase**: `ConditionEvaluator` checks visibility conditions via SPARQL
3. **Render Phase**: `RdfButton` renders buttons with labels, icons, variants from RDF
4. **Execute Phase**: Click triggers `ActionBridge` → `ActionInterpreter` → action handler

#### Impact

| Before v14.0 | After v14.0 |
|--------------|-------------|
| 18+ specialized button components | 1 generic `RdfButton` component |
| Hardcoded button configurations | RDF-driven button definitions |
| `useRdfButtons` feature flag | Direct RDF integration |
| ~21,000 LOC button code | ~800 LOC generic infrastructure |
| Per-button TypeScript files | Per-button RDF triples |

---

### v1.3-v2.0 - Foundation and Evaluation

**Date:** January 2026
**Issues:** #1416-#1468
**Status:** ✅ Complete

#### Summary

Initial RDF-Driven Architecture implementation establishing:

1. **ems-ui Ontology** - Button definitions namespace
2. **RdfButtonGroupsBuilder** - Loads buttons from RDF
3. **ActionInterpreter** - 8 Fixed Verb action types
4. **SHACL Validation** - Schema validation for RDF definitions
5. **Metrics Evaluation** - Honest assessment of what RDF achieves

See [RDF-DRIVEN-EVALUATION.md](./RDF-DRIVEN-EVALUATION.md) for detailed metrics and analysis.

#### Milestones

| Milestone | Focus | Status |
|-----------|-------|--------|
| v1.2 | Button Migration | ✅ Complete |
| v1.3 | Command Migration | ✅ Complete |
| v1.4 | Validation (SHACL) | ✅ Complete |
| v1.5 | Layout Migration | ✅ Complete |
| v2.0 | Metrics & Evaluation | ✅ Complete |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [RDF-DRIVEN-EVALUATION.md](./RDF-DRIVEN-EVALUATION.md) | Honest metrics and analysis |
| [BUTTONS.md](./BUTTONS.md) | All 29 RDF-driven buttons |
| [COMMANDS.md](./COMMANDS.md) | All 36 RDF-driven commands |
| [LAYOUTS.md](./LAYOUTS.md) | RDF-driven layout system |
| [VALIDATION.md](./VALIDATION.md) | SHACL validation |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Overall system architecture |

---

## Version History of This Document

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-09 | Initial document with v14.0 achievements |
