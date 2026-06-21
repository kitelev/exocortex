---
id: ARCH-008
title: Clean Architecture Layer Dependencies
domain: architecture
rules: true
files: ["packages/*/src/**/*.ts"]
---

# Clean Architecture Layer Dependencies

## Context

Exocortex uses Clean Architecture with four layers: Domain → Application → Infrastructure → Presentation.
The Dependency Rule states: **inner layers NEVER depend on outer layers**.

## Decision

- **Domain** must not import from Application, Infrastructure, or Presentation
- **Application** must not import from Infrastructure or Presentation
- **Core package** (packages/core) must not import from consumer packages (obsidian-plugin, cli)

## Do's and Don'ts

### Do

- Import only from inner layers or same layer
- Use dependency injection for cross-layer communication
- Define interfaces in inner layers, implement in outer layers

### Don't

- Import `obsidian` in core package
- Import presentation components in application services
- Import infrastructure adapters directly in domain code

## Consequences

### Positive

- Testability: domain logic testable without framework mocks
- Reusability: core works in CLI, plugin, and future adapters
- Maintainability: changes isolated to specific layers

### Negative

- More abstractions (interfaces, DI tokens)
- Learning curve for new contributors

## References

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
