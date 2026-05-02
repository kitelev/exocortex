# Production cron example — Exocortex CLI `dyncommand exec`

Reference setup for running an Exocortex `exocmd:Command` on a real cron-driven
server. Materialises a fresh `Lunch` instance from a vault prototype every day
at 13:00, then verifies the result at 23:55. Mirrors RFC `94e520da` § Phase 5
acceptance criterion **М5** ("production cron example на реальной машине ≥7
дней без manual intervention").

## What this directory contains

| File | Purpose |
| --- | --- |
| `lunch-tracker.sh` | Cron-invoked script that calls `dyncommand exec` for the `Create Instance` command against today's daily note. |
| `verify-cron.sh` | Nightly verifier that asserts today's instance exists and emits a JSON heartbeat. |
| `crontab.example` | Drop-in crontab fragment with both jobs. |

The triple is intentionally minimal: one execution path, one verification
path, one crontab. Anything more complex is a custom deployment, not a
reference example.

## Why a separate example (and not just a README snippet)?

The CLI README (`packages/cli/README.md`) shows the *idea* of a cron-driven
`dyncommand exec`. This directory is the **soak target** — what an operator
deploys on a real machine to accumulate the ≥7-day evidence the RFC requires.

Per the RFC's "Killer feature exocortex" framing, the same `CREATE_INSTANCE_CMD`
UID is reused by the plugin button, the Telegram bot, and this cron — one
RDF-defined command, three runtimes, zero hardcoded TS per use case.

## Setup (one-time)

1. Locate the `Create Instance` command UID in your vault:
   ```bash
   npx @kitelev/exocortex-cli dyncommand list --vault "$VAULT" --output json \
     | jq -r '.[] | select(.label | test("Create Instance")) | .uid'
   ```
   This is the value for `CREATE_INSTANCE_CMD` below. If `list` returns nothing,
   the vault is on a UUID-wikilink-only shape; rebuild the index or pass
   `--target` explicitly (see CLI README troubleshooting section).

2. Stage the scripts on the production host:
   ```bash
   sudo install -Dm755 lunch-tracker.sh /opt/exocortex/lunch-tracker.sh
   sudo install -Dm755 verify-cron.sh   /opt/exocortex/verify-cron.sh
   sudo touch /var/log/exocortex-lunch.log /var/log/exocortex-cron-verify.log
   sudo chown "$USER:$USER" /var/log/exocortex-*.log
   ```

3. Install the crontab:
   ```bash
   crontab -l > /tmp/cron.bak 2>/dev/null || true
   cat crontab.example >> /tmp/cron.bak
   crontab /tmp/cron.bak
   ```
   Edit the `VAULT=` and `CREATE_INSTANCE_CMD=` lines first — the example UID
   is a placeholder.

4. Smoke-test before waiting on cron:
   ```bash
   VAULT=/home/exocortex/vault \
   CREATE_INSTANCE_CMD=<your-uid> \
     /opt/exocortex/lunch-tracker.sh

   VAULT=/home/exocortex/vault \
     /opt/exocortex/verify-cron.sh
   ```
   Both should exit 0 and the verifier should print a `"status":"ok"` JSON
   line.

## Soak protocol (≥7 days)

The RFC measures success by absence of operator intervention over a week. The
recommended monitoring loop:

1. After each daily 13:00 run, `tail -n 1 /var/log/exocortex-lunch.log` should
   show a CLI JSON result with `"success": true`.
2. After each 23:55 run, `tail -n 1 /var/log/exocortex-cron-verify.log` should
   show `"status":"ok"`.
3. Any `"status":"missing"` line is a soak failure — file an issue, do not
   silently re-run the missing job.
4. After 7 consecutive `ok` heartbeats, the soak window has closed; the cron
   is considered production-ready and М5 is satisfied.

A counter-snippet for log scrape:

```bash
grep -c '"status":"ok"' /var/log/exocortex-cron-verify.log
```

## Failure modes worth knowing

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `precondition not satisfied` | Today's daily note missing or daily note's frontmatter changed | Recreate daily note before 13:00; precondition is intentional. |
| `Service "..." not implemented in CLI runtime` | Grounding uses a plugin-only `service_call` (Phase 1 fail-loud) | Switch to a `create_instance` / `property_set` / `composite` grounding; CLI cannot run plugin-only services. |
| `Command with UID "..." not found` | UUID-wikilink discovery glitch (RFC § Phase 2) | Run `dyncommand list` again; if still empty, pass the explicit `--target` IRI. |
| Verifier says `missing` but `lunch-tracker.log` says `success` | Vault drift / wrong `LABEL_PREFIX` / clock skew | Check `EXPECTED_LABEL` in verifier output vs created instance label. |

## Cross-references

- CLI README cron snippet: `../../packages/cli/README.md` — Example 3.
- RFC: vault asset `94e520da-c6f7-48af-944c-51298d68da45` § Phase 5.
- Architecture diagram: repository root `README.md`.
