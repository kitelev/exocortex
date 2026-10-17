/**
 * @jest-environment node
 *
 * ticket 0b24c5d1, req e312155b — `exosync sync|pull|push --json`: stdout carries the result
 * array and nothing else; the header, `--repo:` scope line and refusals go to
 * stderr, all of them BEFORE the array (a caller merging the streams with
 * `2>&1` must still get the array in one piece).
 *
 * K4–K6 lock the pull-only list warnings of BOTH commands: the shared helper
 * `collectVaultSpecsOrRefuse` already mirrors them on stderr, so under --json
 * the caller must skip them (one copy, on stderr) — and only under --json
 * (the human mode keeps one copy on each stream, as before).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  FakeGitHubRepo,
  mdAsset,
} from "../../../../core/tests/unit/services/sync/fakeGitHub";
import { runExosyncSync } from "../../../src/commands/exosync-sync";
import { runExosyncParity } from "../../../src/commands/exosync-parity";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const FAKE_PAT = "ghp_" + "E".repeat(36);

// The pull-only list names a repo that is not materialized: the run proceeds
// and the list layer emits exactly one warning (req c0810b83).
const GHOST_WARNING = `warn: pull-only list .exocortex/exosync-pull-only line 1 names ${OWNER}/ghost, which is not a materialized sync unit on this device — nothing to protect`;

// A declaration whose source is not a GitHub URL: the collector skips it with a
// warning that is NOT a pull-only one (it takes the caller's own `warn:` path).
const BAD_DECL_WARNING =
  "warn: skipped AssetSpace at decl-bad.md: source is not a plain https://github.com/<owner>/<repo> URL";

function makeVault(
  opts: {
    ghostList?: boolean;
    malformedList?: boolean;
    badDecl?: boolean;
  } = {},
): { vault: string; cleanup: () => void } {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-json-stdout-"));
  if (opts.ghostList === true || opts.malformedList === true) {
    mkdirSync(path.join(vault, ".exocortex"), { recursive: true });
    writeFileSync(
      path.join(vault, ".exocortex/exosync-pull-only"),
      opts.malformedList === true
        ? `${OWNER}/alpha # note\n`
        : `${OWNER}/ghost\n`,
    );
  }
  if (opts.badDecl === true) {
    writeFileSync(
      path.join(vault, "decl-bad.md"),
      `---\nexo__Asset_uid: decl-bad\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://example.org/not-github\n---\n\nDeclaration\n`,
    );
  }
  for (const repo of ["alpha", "beta"]) {
    writeFileSync(
      path.join(vault, `decl-${repo}.md`),
      `---\nexo__Asset_uid: decl-${repo}\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${repo}\n---\n\nDeclaration\n`,
    );
    const full = path.join(
      vault,
      `assetspaces/${OWNER}/${repo}`,
      "assets/a.md",
    );
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, mdAsset(`u-${repo}`));
  }
  return {
    vault,
    cleanup: () => rmSync(vault, { recursive: true, force: true }),
  };
}

async function run(
  vault: string,
  repo: string[] | undefined,
  json: boolean,
): Promise<{ code: number; out: string[]; err: string[]; both: string[] }> {
  const gh = new FakeGitHubRepo({ "assets/a.md": mdAsset("u-remote") });
  const out: string[] = [];
  const err: string[] = [];
  const both: string[] = [];
  const code = await runExosyncSync(
    "push",
    { vault, token: FAKE_PAT, json, ...(repo !== undefined ? { repo } : {}) },
    {
      transportFactory: () => gh.transport(),
      out: (l: string) => {
        out.push(l);
        both.push(l);
      },
      err: (l: string) => {
        err.push(l);
        both.push(l);
      },
      env: {},
    },
  );
  return { code, out, err, both };
}

async function runParity(
  vault: string,
  json: boolean,
): Promise<{ code: number; out: string[]; err: string[] }> {
  const gh = new FakeGitHubRepo({ "assets/a.md": mdAsset("u-remote") });
  const out: string[] = [];
  const err: string[] = [];
  const code = await runExosyncParity(
    { vault, token: FAKE_PAT, json },
    {
      transportFactory: () => gh.transport(),
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      env: {},
    },
  );
  return { code, out, err };
}

function count(lines: string[], line: string): number {
  return lines.filter((l) => l === line).length;
}

describe("exosync --json keeps stdout machine-readable (ticket 0b24c5d1)", () => {
  it("K1 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd the whole stdout parses as the result array; header and --repo line are on stderr", async () => {
    const fx = makeVault();
    try {
      const r = await run(fx.vault, [`${OWNER}/alpha`], true);
      expect(r.out).toHaveLength(1);
      const results = JSON.parse(r.out.join("\n")) as { repoKey: string }[];
      expect(results.map((x) => x.repoKey)).toEqual([`${OWNER}/alpha#main`]);
      expect(r.err).toContain(
        `ExoSync push: 1 repo(s), vault ${path.resolve(fx.vault)}`,
      );
      expect(
        r.err.some((l) => l.startsWith("--repo: 1 of 2 materialized repo(s)")),
      ).toBe(true);
      expect(r.both[r.both.length - 1]).toMatch(/^\[/);
    } finally {
      fx.cleanup();
    }
  });

  it("K2 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd an unknown --repo under --json leaves stdout empty and puts the refusal on stderr", async () => {
    const fx = makeVault();
    try {
      const r = await run(fx.vault, [`${OWNER}/nope`], true);
      expect(r.code).toBe(2);
      expect(r.out).toEqual([]);
      expect(r.err.join("\n")).toMatch(
        /--repo: not among the 2 materialized repo\(s\)/,
      );
    } finally {
      fx.cleanup();
    }
  });

  it("K3 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd without --json the header and the refusal stay on stdout (human mode unchanged)", async () => {
    const fx = makeVault();
    try {
      const ok = await run(fx.vault, [`${OWNER}/alpha`], false);
      expect(ok.out[0]).toBe(
        `ExoSync push: 1 repo(s), vault ${path.resolve(fx.vault)}`,
      );
      expect(ok.err).toEqual([]);
      const refused = await run(fx.vault, [`${OWNER}/nope`], false);
      expect(refused.out.join("\n")).toMatch(
        /--repo: not among the 2 materialized repo\(s\)/,
      );
      expect(refused.err).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it("K4 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd sync --json: a pull-only list warning is printed ONCE, on stderr, and stdout stays the bare array", async () => {
    const fx = makeVault({ ghostList: true });
    try {
      const r = await run(fx.vault, undefined, true);
      expect(r.code).toBe(0);
      expect(r.out).toHaveLength(1);
      expect(Array.isArray(JSON.parse(r.out.join("\n")))).toBe(true);
      expect(count(r.err, GHOST_WARNING)).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it("K5 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd parity --json: a pull-only list warning is printed ONCE, on stderr, and stdout stays the bare document", async () => {
    const fx = makeVault({ ghostList: true });
    try {
      const r = await runParity(fx.vault, true);
      expect(r.out).toHaveLength(1);
      expect(typeof (JSON.parse(r.out.join("\n")) as { ok: unknown }).ok).toBe(
        "boolean",
      );
      expect(count(r.err, GHOST_WARNING)).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it("K6 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd without --json both commands keep ONE copy of the list warning on EACH stream (human mode unchanged)", async () => {
    const fx = makeVault({ ghostList: true });
    try {
      const s = await run(fx.vault, undefined, false);
      expect(count(s.out, GHOST_WARNING)).toBe(1);
      expect(count(s.err, GHOST_WARNING)).toBe(1);
      const p = await runParity(fx.vault, false);
      expect(count(p.out, GHOST_WARNING)).toBe(1);
      expect(count(p.err, GHOST_WARNING)).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it("K7 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd sync --json: a malformed pull-only list refuses with exit 2, an EMPTY stdout and the refusal on stderr", async () => {
    const fx = makeVault({ malformedList: true });
    try {
      const r = await run(fx.vault, undefined, true);
      expect(r.code).toBe(2);
      expect(r.out).toEqual([]);
      expect(r.err.join("\n")).toMatch(
        /invalid pull-only list \.exocortex\/exosync-pull-only line 1/,
      );
    } finally {
      fx.cleanup();
    }
  });

  it("K8 @req:e312155b-b14b-4a3b-9320-ccdc4dfe65fd --json: a collector warning that is NOT about the pull-only list goes to stderr once, never to stdout (both commands)", async () => {
    const fx = makeVault({ badDecl: true });
    try {
      const s = await run(fx.vault, undefined, true);
      expect(s.out).toHaveLength(1);
      expect(Array.isArray(JSON.parse(s.out.join("\n")))).toBe(true);
      expect(count(s.err, BAD_DECL_WARNING)).toBe(1);
      const p = await runParity(fx.vault, true);
      expect(p.out).toHaveLength(1);
      expect(count(p.err, BAD_DECL_WARNING)).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});
