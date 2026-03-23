---
id: REACT-001
title: React Component Standards
domain: frontend
rules: true
files: ["packages/obsidian-plugin/src/presentation/**/*.tsx"]
---

# React Component Standards

## Context

Exocortex uses React 19 for interactive UI. With multiple AI agents generating code, component conventions must be enforced automatically.

## Decision

- All React components must be **functional** (no class components except ErrorBoundary)
- ErrorBoundary is the only justified exception (React API requires class for error boundaries)

## Do's and Don'ts

### Do

- Use functional components with hooks
- Use React.FC<Props> for typing

### Don't

- Create class components (use functional + hooks instead)
- Use class-based lifecycle methods

## References

- [ADR-0004: React for Interactive Tables](../../docs/adr/0004-react-for-interactive-tables.md)
