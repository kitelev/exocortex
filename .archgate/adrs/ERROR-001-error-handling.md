---
id: ERROR-001
title: Error Handling Standards
domain: backend
rules: true
files: ["packages/*/src/**/*.ts"]
---

# Error Handling Standards

## Context

Swallowed errors (empty catch blocks) hide bugs and make debugging impossible. All errors must be logged or rethrown.

## Decision

- No empty catch blocks — every catch must log, rethrow, or explicitly handle
- Error parameters should be properly typed

## Do's and Don'ts

### Do

- Log errors: `catch(e) { this.logger.error("...", e); }`
- Rethrow: `catch(e) { throw new ServiceError("...", e); }`
- Handle explicitly: `catch(e) { return fallbackValue; }`

### Don't

- Swallow errors: `catch(e) { }` or `catch { }`
- Ignore without comment: `catch(e) { /* TODO */ }`
