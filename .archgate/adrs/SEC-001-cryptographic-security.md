---
id: SEC-001
title: Cryptographic Security Standards
domain: backend
rules: true
files: ["packages/*/src/**/*.ts"]
---

# Cryptographic Security Standards

## Context

AI agents generating code may inadvertently use insecure random number generation or weak hashing algorithms. These must be caught automatically.

## Decision

- **No `Math.random()`** for any identifier or token generation — use `crypto.randomUUID()` or `crypto.randomBytes()`
- **No MD5 or SHA1** for hashing — use SHA-256 or SHA-512
- **No weak crypto** in any security-sensitive context

## Do's and Don'ts

### Do

- Use `crypto.randomUUID()` for unique identifiers
- Use `crypto.randomBytes()` for tokens
- Use `createHash('sha256')` for content hashing

### Don't

- Use `Math.random()` for IDs or tokens
- Use `createHash('md5')` or `createHash('sha1')`
- Roll custom random generation

## References

- Issues #1059, #1060 (Cryptographic Security Fixes)
- OWASP Cryptographic Storage Cheat Sheet
