/** ExoSync A3 — secret-scan (R5 engineering baseline). */

import { redactSecrets, scanForSecrets } from "../../../../src";

const CLASSIC_PAT = `ghp_${"a1B2".repeat(10)}`; // 40 chars after prefix
const FINE_GRAINED_PAT = `github_pat_${"A".repeat(22)}_${"b".repeat(59)}`;

describe("scanForSecrets", () => {
  it("flags classic and fine-grained GitHub tokens by path + kind only", () => {
    const files = new Map<string, string>([
      ["a.md", `body with token ${CLASSIC_PAT} embedded`],
      ["b.md", `---\nkey: ${FINE_GRAINED_PAT}\n---\n`],
      ["clean.md", "nothing to see"],
    ]);

    const findings = scanForSecrets(files);

    expect(findings).toEqual([
      { path: "a.md", kind: "github-token" },
      { path: "b.md", kind: "github-fine-grained-token" },
    ]);
    // findings never embed the secret itself
    expect(JSON.stringify(findings)).not.toContain(CLASSIC_PAT);
  });

  it("flags private key blocks", () => {
    const files = new Map([
      ["key.md", "-----BEGIN OPENSSH PRIVATE KEY-----\nxxx"],
    ]);
    expect(scanForSecrets(files)).toEqual([
      { path: "key.md", kind: "private-key" },
    ]);
  });

  it("passes clean payloads and short token-like strings", () => {
    const files = new Map([
      ["a.md", "ghp_tooShort and github_pat_short_short are not tokens"],
    ]);
    expect(scanForSecrets(files)).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it("replaces every secret with a kind marker, preserving the rest", () => {
    const text = `before ${CLASSIC_PAT} middle ${FINE_GRAINED_PAT} after`;
    const out = redactSecrets(text);
    expect(out).toBe(
      "before [REDACTED:github-token] middle [REDACTED:github-fine-grained-token] after",
    );
    expect(out).not.toContain(CLASSIC_PAT);
  });

  it("is a no-op on clean text", () => {
    expect(redactSecrets("plain text")).toBe("plain text");
  });
});
