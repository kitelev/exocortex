# Changelog

> **This file is retired.** Human-readable release notes now live in
> **[GitHub Releases](https://github.com/kitelev/exocortex/releases)**, which are
> generated automatically by the Auto Release workflow on every merge to `main`.

## Why

This hand-maintained `CHANGELOG.md` drifted out of sync with the actual release
cadence: the last manually recorded release was **v12.15.54 (2025-10-18)**, after
which the project shipped hundreds of automated releases (v12.16 → v16.x) that
were never transcribed here. Rather than keep a perpetually-stale second source of
truth, the project relies on the auto-generated GitHub Releases notes.

## Where to look

| You want… | Go to |
| --- | --- |
| **Release notes for a specific version** | [GitHub Releases](https://github.com/kitelev/exocortex/releases) |
| **What changed between two versions** | `git log <tagA>..<tagB>` or the Releases "compare" view |
| **The historical pre-2025-10 changelog** | Earlier git history of this file (`git log -- CHANGELOG.md`) |
| **Architecture / feature deep-dives** | [`docs/`](docs/README.md) — e.g. [profile.md](docs/profile.md), [exosync.md](docs/exosync.md) |

## For contributors

Releases are versioned by the Auto Release workflow (semantic-version bump on
merge); you do **not** edit this file. Describe user-facing changes in your PR
title/body — those flow into the generated release notes.
