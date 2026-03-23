---
id: ARCH-006
title: Pure Functions Separation
domain: architecture
rules: false
---

# Pure Functions Separation

Business logic must be isolated as pure functions without side effects — no framework dependencies, highly testable, reusable across adapters.

Side effect enforcement is covered by ARCH-008 rule `no-domain-side-effects`.

## References

- [ADR-0006: Pure Functions Separation](../../docs/adr/0006-pure-functions-separation.md)
