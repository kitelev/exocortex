# Rollback — Phase 3.5 X11 Stabilization (T5.5 / RFC 32a64ed9)

If the T5.1 V1+V2 default (`-extension MIT-SHM` + lean 720p+dpi framebuffer)
shipped in `packages/obsidian-plugin/docker-entrypoint-e2e.sh` regresses CI
pass-rate or wall-clock vs. pre-Phase-3.5 baseline, revert via env-flip
**without code change**:

## One-line rollback

In `.github/workflows/e2e.yml` (or whichever workflow invokes the
`Dockerfile.e2e` entrypoint), add to the e2e-shard job's `env:` block:

```yaml
env:
  XVFB_VARIANT: baseline
```

This restores the pre-Phase-3.5 args (`xvfb-run --auto-servernum` with no
`--server-args`). No code revert, no rebuild required beyond the workflow
re-run.

## Verifying rollback

1. Push the workflow change on a branch.
2. Run any e2e-shard job and inspect the entrypoint banner — must read
   `XVFB_VARIANT: baseline`.
3. Confirm `Launching with xvfb-run (baseline: status quo)...` line in stderr.

## Full code revert (if needed)

If the harness itself is suspect (not just the default), revert the T5.5
commit on a hotfix branch:

```sh
git revert <T5.5-commit-sha>
```

This restores the pre-T5.5 single-command `xvfb-run --auto-servernum "$@"`
invocation. The 4 evidence-trail commits (3 spike docs + ADR) remain in
history regardless.

## Escalation rungs (per ADR §4)

If T6.1 N=50 of `v1+v2` shows residual flake >0% with X11-tagged stderr,
escalate one rung at a time. Rung-1/2/3 branches in
`docker-entrypoint-e2e.sh` are currently stubs (`exit 2`) and require a
dedicated activation task (image deps + branch implementation) before flip.

- **Rung 1** — `XVFB_VARIANT=per-spec` (T5.2 V2). Requires Decision B
  re-relax (breaches ≤220s gate by ~+5%).
- **Rung 2** — `XVFB_VARIANT=xpra` (T5.3 V1). Requires `xpra` package in
  `Dockerfile.e2e`.
- **Rung 3** — `XVFB_VARIANT=weston` (T5.3 V3). Requires Weston + Wayland
  stack in `Dockerfile.e2e` and Electron `--ozone-platform=wayland` flag.

See `ADR_FLAKY_X11_STRATEGY.md` §4 for trigger criteria and §6.2 for risk
profile.
