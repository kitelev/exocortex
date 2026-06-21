/**
 * ExoSync secret-scan (RFC 4e4dc453 A3 engineering baseline, R5).
 *
 * Last-line defence against accidentally committing a credential: the
 * engine scans every push payload (canonical sync pushes AND quarantine
 * entry contents) and refuses to ship anything that matches a known
 * secret shape. Reported findings carry the PATH and the pattern KIND
 * only — never the matched secret itself.
 *
 * The PAT patterns intentionally mirror the redaction regexes in the two
 * production transports (`GitHubRestClient.PAT_REGEX` in the plugin,
 * `RestPushService` in the CLI) — keep all three in sync:
 *   - classic tokens: `gh[pousr]_…` (ghp_/gho_/ghu_/ghs_/ghr_), ≥36 chars
 *   - fine-grained tokens: `github_pat_<22+ id>_<59+ secret>`
 */

export interface SecretFinding {
  path: string;
  /** Pattern family that matched — safe to log/surface. */
  kind: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  {
    kind: "github-token",
    re: /gh[pousr]_[A-Za-z0-9_]{36,}/,
  },
  {
    kind: "github-fine-grained-token",
    re: /github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,}/,
  },
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
];

/**
 * Scan file contents for secret shapes. Returns one finding per
 * (path, kind) pair; an empty array means the payload is clean.
 */
export function scanForSecrets(
  files: ReadonlyMap<string, string>,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [path, content] of files) {
    for (const { kind, re } of SECRET_PATTERNS) {
      if (re.test(content)) findings.push({ path, kind });
    }
  }
  return findings;
}

/**
 * Replace every secret match with `[REDACTED:<kind>]`. Used for quarantine
 * entry contents (D17): a conflict copy whose text embeds a credential is
 * still preserved durably — minus the secret — instead of being dropped
 * (the canonical sync push, by contrast, REFUSES outright via
 * {@link scanForSecrets}).
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { kind, re } of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, "g"), `[REDACTED:${kind}]`);
  }
  return out;
}
