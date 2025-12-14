# GitHub Copilot Instructions for Exocortex

This file provides context and guidance for GitHub Copilot when working with the Exocortex Obsidian Plugin repository.

## Project Overview

Exocortex is a comprehensive task management and knowledge organization system for Obsidian with automatic layout rendering, hierarchical organization, and effort tracking. It transforms notes into an interconnected task management system through ontology-driven layouts and semantic capabilities.

**Repository:** TypeScript/React monorepo with production-grade quality standards
**Architecture:** Clean Architecture with domain-driven design (DDD)
**Tech Stack:** TypeScript 5.9.3, React 19.2.0, Obsidian API 1.5.0+, ESBuild

## Key Documentation

Before making changes, always consult:
- `AGENTS.md` - Development workflow guidelines
- `ARCHITECTURE.md` - System design, patterns, and component responsibilities
- `CLAUDE.md` - Detailed development guidelines and rules (valuable context even for Copilot)
- `README.md` - Feature documentation and usage examples
- `.claude/agents/` - Specialized domain patterns (QA, architecture, security, performance)

## Monorepo Structure

```
packages/
├── core/                 # exocortex - Storage-agnostic business logic
├── obsidian-plugin/      # @exocortex/obsidian-plugin - Obsidian UI integration
└── cli/                  # @exocortex/cli - Command-line automation tool
```

Work primarily in the workspace context - changes often affect multiple packages.

## Code Style & Quality Standards

### TypeScript
- Use strict mode with comprehensive type safety (`noImplicitAny`, `strictNullChecks`)
- Prefer explicit error handling with Result pattern (see `CLAUDE.md` for details)
- Use meaningful variable and function names
- Double quotes for strings, semicolons required
- Prefer `const` and immutability where possible

### React Components
- Use functional components with hooks (React 19.2.0)
- Follow existing component patterns in `packages/obsidian-plugin/src/ui/`
- Proper cleanup of event listeners and subscriptions to prevent memory leaks
- Optimize for performance - this plugin handles large vaults (thousands of notes)

### Code Organization
- Follow Clean Architecture layers: Domain → Application → Infrastructure → Presentation
- Domain logic is storage-agnostic and lives in `exocortex`
- UI-specific code belongs in `@exocortex/obsidian-plugin`
- Keep services focused on single responsibilities (SOLID principles)

### Documentation
- Use JSDoc comments for public APIs and complex functions
- Include usage examples in documentation
- Update relevant markdown docs when behavior changes
- Prefer inline documentation over separate files for small features

## Development Commands

### Setup
```bash
npm install              # Install all workspace dependencies
```

### Building
```bash
npm run build           # Production build (all packages + type check)
npm run dev             # Development mode with watch (plugin only)
```

### Code Quality
```bash
npm run lint            # Run ESLint
npm run lint:fix        # Auto-fix linting issues
npm run format          # Format code with Prettier
npm run format:check    # Check formatting without changes
npm run check:types     # TypeScript type checking
npm run check:all       # Run all quality checks
```

### Testing
```bash
npm test                # Run all standard tests (unit + UI + component)
npm run test:unit       # Unit tests with Jest
npm run test:ui         # UI integration tests
npm run test:component  # Component tests with Playwright
npm run test:e2e:local  # E2E tests (requires Docker)
npm run test:all        # ALL tests including E2E

npm run bdd:coverage    # Check BDD scenario coverage
npm run bdd:check       # Enforce ≥80% BDD coverage (CI requirement)
```

## Testing Requirements

**CRITICAL:** All changes MUST pass quality gates before merging:

### Coverage Thresholds (Enforced in CI)
- Global coverage: ≥55-64% (branches: 55%, functions: 60%, lines: 64%, statements: 63%)
- Domain layer: ≥78-80% (higher standards for business logic; **aspirational, currently disabled in CI – see [issue #197](https://github.com/kitelev/exocortex-obsidian-plugin/issues/197)**)
- Long-term aspirational targets (not currently enforced): 70% global / 85% domain (current enforced targets are lower; see above and COVERAGE_QUICK_REFERENCE.md)

### Test Types
1. **Unit Tests**: Business logic, services, utilities (jest + ts-jest)
2. **Component Tests**: React components (Playwright Component Testing)
3. **UI Tests**: Obsidian-specific integrations (jest-environment-obsidian)
4. **E2E Tests**: Full workflow validation (Playwright in Docker)
5. **BDD Coverage**: ≥80% scenario coverage required for CI

### Test-Driven Development
- Write tests for new features BEFORE implementation when possible
- Follow existing test patterns in `specs/features/` (BDD) and `tests/`
- Keep tests focused and maintainable
- Test both happy paths and edge cases

## Common Patterns

### Result Pattern
Use for error handling instead of throwing exceptions:
```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };
```

### Service Pattern
Services encapsulate business logic:
```typescript
class TaskCreationService {
  constructor(private adapter: IFileSystemAdapter) {}
  
  async createTask(params: CreateTaskParams): Promise<Result<Task>> {
    // Implementation
  }
}
```

### Adapter Pattern
Abstract storage operations:
```typescript
interface IFileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  // ... other methods
}
```

## Property Schema

### Core Properties (exo__Asset_*)
- `exo__Instance_class` - Asset type (required): ems__Task, ems__Project, ems__Area, etc.
- `exo__Asset_uid` - UUID v4 identifier
- `exo__Asset_label` - Human-readable name
- `exo__Asset_isDefinedBy` - Parent container reference
- `exo__Asset_isArchived` - Archive status (boolean)

### Effort Properties (ems__Effort_*)
- `ems__Effort_status` - Workflow status (Draft → Backlog → Analysis → ToDo → Doing → Done)
- `ems__Effort_day` - Scheduled date ([[YYYY-MM-DD]])
- `ems__Effort_startTimestamp` - ISO 8601 timestamp (set when status → Doing)
- `ems__Effort_endTimestamp` - ISO 8601 timestamp (set when status → Done/Trashed)
- `ems__Effort_votes` - Priority voting counter
- `ems__Effort_parent` - Parent project/effort
- `ems__Effort_area` - Organizational area

See README.md for complete property reference.

## Performance Considerations

The plugin is optimized for large vaults (10,000+ notes):
- **O(1) lookups**: Use reverse index cache for relations
- **Smart caching**: Invalidate only on metadata changes
- **Memory management**: Clean up event listeners properly
- **Lazy rendering**: Render components only when visible
- **Race-free operations**: Use promise-based locking
- **Scroll preservation**: Maintain position during refreshes

Target benchmarks:
- Relation lookup: <1ms for 10,000 notes
- Full layout render: <50ms typical
- Cache invalidation: <10ms on metadata change

## Security & Safety

- Never commit secrets or sensitive data
- Validate all user input
- Use safe property access patterns
- Handle edge cases gracefully
- Follow the principle of least privilege

## Release Process

**DO NOT manually bump versions or create releases.** Coordinate with maintainers for release automation.

## Workflow Guidelines

1. **Plan deliberately** - Understand requirements and architecture before coding
2. **Work incrementally** - Make focused, minimal changes
3. **Test frequently** - Run relevant tests after each change
4. **Document decisions** - Update docs when behavior changes
5. **Review patterns** - Check existing code for established patterns before introducing new ones

## Common Tasks

### Adding a New Command
1. Define command in command manager service
2. Add command registration in plugin main
3. Implement command handler with proper error handling
4. Add corresponding UI buttons if needed
5. Write tests (unit + integration)
6. Update documentation

### Adding a New Property
1. Define property in schema (domain layer)
2. Update relevant services to handle the property
3. Add UI rendering in properties table
4. Update validation logic
5. Add tests for property handling
6. Document in README.md property reference

### Adding a New Feature
1. Review ARCHITECTURE.md for proper layer placement
2. Implement in appropriate layer (domain/application/infrastructure/presentation)
3. Follow existing patterns and conventions
4. Write comprehensive tests (aim for >80% coverage)
5. Update relevant documentation
6. Run full test suite before creating PR

## Issue Resolution

When fixing bugs:
1. Reproduce the issue locally
2. Write a failing test that captures the bug
3. Fix the bug with minimal changes
4. Verify the test now passes
5. Run full test suite to ensure no regressions
6. Document the fix in code comments if the solution isn't obvious

## Quality Checklist

Before considering your work complete:
- [ ] All tests pass (`npm run test:all`)
- [ ] Code coverage meets thresholds
- [ ] BDD coverage ≥80% (`npm run bdd:check`)
- [ ] TypeScript compiles without errors (`npm run check:types`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is formatted (`npm run format:check`)
- [ ] Relevant documentation updated
- [ ] No console errors or warnings
- [ ] Performance benchmarks maintained

## Resources

- **Obsidian API Docs**: https://docs.obsidian.md/
- **React Docs**: https://react.dev/
- **TypeScript Docs**: https://www.typescriptlang.org/docs/
- **Clean Architecture**: See ARCHITECTURE.md for implementation details
- **BDD Testing**: See specs/features/ for feature specifications

---

**Remember:** This is a production-grade codebase with strict quality expectations. Take time to understand existing patterns before making changes. When in doubt, consult the documentation or ask for clarification.
