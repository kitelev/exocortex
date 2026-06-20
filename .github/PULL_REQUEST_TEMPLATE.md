<!--
Thanks for contributing! Keep PRs focused and single-purpose.
The PR title flows into the auto-generated release notes — make it user-facing.
-->

## What & why

<!-- A short description of the change and the problem it solves. Link issues: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / internal
- [ ] Other:

## Requirements (RFC 0003)

<!--
For a PR that changes USER-FACING FUNCTIONAL behavior, reference the
req__Requirement it implements and (for a verified binding) the revert-verify
evidence. These tokens are grep-able by archgate + the `requirements-trace` CI
job. See docs/requirements-authoring.md. Delete this section for non-functional
PRs (refactors, docs, NFR/architecture — those live as .archgate ADRs).

Req: <requirement-uid>
Revert-verified: @req:<requirement-uid> reverting <prod-ref> → <test> RED (<failure shape>); restored → GREEN
-->

## Checklist

- [ ] `npm run test:all` passes locally
- [ ] New/changed behavior is covered by tests
- [ ] Engine/domain logic lives in the `exocortex` core (UI/CLI Parity); both clients get bindings if user-facing
- [ ] No command is gated desktop-only (Desktop ↔ Mobile parity) — N/A if not a command
- [ ] Docs updated if behavior/flags/commands changed
- [ ] Functional behavior change references its `req__Requirement` (`Req: <uid>`) — N/A otherwise (RFC 0003)
- [ ] No secrets / personal absolute paths added

## Notes for reviewers

<!-- Anything reviewers should pay special attention to, screenshots, etc. -->
