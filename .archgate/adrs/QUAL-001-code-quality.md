---
id: QUAL-001
title: Code Quality Standards
domain: backend
rules: true
files: ["packages/core/src/**/*.ts"]
---

# Code Quality Standards

## Context

With multiple AI agents working in parallel, code quality standards must be automatically enforced. Manual code review cannot catch all violations consistently.

## Decision

### DI Injectable Services

All service classes in the core package must use `@injectable()` decorator for DI container management.

### No Console in Core

Core package (`packages/core`) should use structured logging via `ILogger` interface, not direct `console.*` calls. Exceptions: benchmarks, infrastructure logging services.

## Do's and Don'ts

### Do

- Use `@injectable()` on all service classes
- Use `ILogger` interface for logging in services
- Keep console usage in infrastructure/CLI adapters only

### Don't

- Create service classes without DI decorators
- Use `console.log` for debugging in production code
- Mix logging approaches within same layer
