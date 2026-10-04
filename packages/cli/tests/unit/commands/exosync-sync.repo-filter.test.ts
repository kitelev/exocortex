/**
 * @jest-environment node
 *
 * req 84033d13 — `exocortex exosync <sync|pull|push> --repo <owner/name>`
 * (repeatable) limits the run to the named materialized repos; without the
 * flag every repo runs exactly as before; an unknown name is refused (exit 2)
 * before the engine makes a single REST request.
 *
 * Motivation (P22, roadmap 9bbda2be): a bot vault mounts 23 repos and the
 * engine walks them sequentially (~2.3 s each), while the bot writes to 6.
 *
 * Fixture: TWO declared + materialized repos with DISJOINT names (`alpha`,
 * `beta` — neither is a substring of the other, so a URL check cannot pass by
 * accident). The transport is the production-shape `FakeGitHubRepo` wrapped by
 * a recorder; "repo X was (not) touched" is read from the REQUEST URLS, i.e.
 * from what the engine actually asked the network for.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { FakeGitHubRepo, mdAsset } from "../../../../core/tests/unit/services/sync/fakeGitHub";
import {
  exosyncCommand,
  runExosyncSync,
  selectReposForRun,
} from "../../../src/commands/exosync-sync";
import type { RestCommitTransport, SyncRepoSpec } from "@kitelev/exocortex-core";

const REQ = "84033d13-7a17-4e1d-ab7c-97ddf9916cd6";
const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const FAKE_PAT = "ghp_" + "D".repeat(36);

function makeTwoRepoVault(): { vault: string; cleanup: () => void } {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-repo-filter-"));
  for (const repo of ["alpha", "beta"]) {
    writeFileSync(
      path.join(vault, `decl-${repo}.md`),
      `---\nexo__Asset_uid: decl-${repo}\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${repo}\n---\n\nDeclaration\n`,
    );
    const full = path.join(vault, `assetspaces/${OWNER}/${repo}`, "assets/a.md");
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, mdAsset(`u-${repo}`));
  }
  return { vault, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

async function run(
  vault: string,
  repo: string[] | undefined,
): Promise<{ code: number; lines: string[]; urls: string[] }> {
  const gh = new FakeGitHubRepo({ "assets/a.md": mdAsset("u-remote") });
  const urls: string[] = [];
  const inner = gh.transport();
  const recording: RestCommitTransport = async (req) => {
    urls.push(req.url);
    return inner(req);
  };
  const lines: string[] = [];
  const code = await runExosyncSync(
    "push",
    { vault, token: FAKE_PAT, ...(repo !== undefined ? { repo } : {}) },
    { transportFactory: () => recording, out: (l: string) => lines.push(l), env: {} },
  );
  return { code, lines, urls };
}

const touched = (urls: string[], repo: string): boolean =>
  urls.some((u) => u.includes(`/repos/${OWNER}/${repo}/`));

describe(`exosync --repo (req ${REQ})`, () => {
  it(`R1 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 one --repo runs only that repo; the other gets no request`, async () => {
    const fx = makeTwoRepoVault();
    try {
      const r = await run(fx.vault, [`${OWNER}/alpha`]);
      expect(r.lines.join("\n")).toMatch(/ExoSync push: 1 repo\(s\)/);
      expect(r.urls.length).toBeGreaterThan(0);
      expect(touched(r.urls, "alpha")).toBe(true);
      expect(touched(r.urls, "beta")).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  it(`R2 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 --repo is repeatable: both named repos run`, async () => {
    const fx = makeTwoRepoVault();
    try {
      const r = await run(fx.vault, [`${OWNER}/beta`, `${OWNER}/alpha`]);
      expect(r.lines.join("\n")).toMatch(/ExoSync push: 2 repo\(s\)/);
      expect(touched(r.urls, "alpha")).toBe(true);
      expect(touched(r.urls, "beta")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it(`R3 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 without --repo every materialized repo runs, as before`, async () => {
    const fx = makeTwoRepoVault();
    try {
      const r = await run(fx.vault, undefined);
      expect(r.lines.join("\n")).toMatch(/ExoSync push: 2 repo\(s\)/);
      expect(touched(r.urls, "alpha")).toBe(true);
      expect(touched(r.urls, "beta")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it(`R4 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 an unknown name exits 2 before any REST request and names what is available`, async () => {
    const fx = makeTwoRepoVault();
    try {
      const r = await run(fx.vault, [`${OWNER}/alpha`, `${OWNER}/nope`]);
      expect(r.code).toBe(2);
      expect(r.urls).toEqual([]);
      const text = r.lines.join("\n");
      expect(text).toMatch(/--repo: not among the 2 materialized repo\(s\): test-owner\/nope\./);
      expect(text).toMatch(/Available: .*test-owner\/alpha/);
      expect(text).toMatch(/Available: .*test-owner\/beta/);
      expect(text).not.toMatch(/ExoSync push:/);
    } finally {
      fx.cleanup();
    }
  });

  it(`R5 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 both key forms select the repo: owner/name and owner/name#branch`, () => {
    const specs = [
      { repoKey: `${OWNER}/alpha#main` },
      { repoKey: `${OWNER}/beta#main` },
    ] as unknown as SyncRepoSpec[];
    for (const name of [`${OWNER}/alpha`, `${OWNER}/alpha#main`]) {
      const sel = selectReposForRun(specs, [name]);
      expect(sel.unknown).toEqual([]);
      expect(sel.specs.map((s) => s.repoKey)).toEqual([`${OWNER}/alpha#main`]);
    }
    // A different branch of a known repo is NOT a match.
    expect(selectReposForRun(specs, [`${OWNER}/alpha#dev`]).unknown).toEqual([
      `${OWNER}/alpha#dev`,
    ]);
  });

  // R6 and R7 are split so that each guard (the option's NAME, its DEFAULT)
  // is reddened by its own mutant alone — one shared axis made two different
  // mutants indistinguishable.
  it(`R6 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 every direction subcommand declares a repeatable --repo`, () => {
    const root = exosyncCommand();
    for (const direction of ["sync", "pull", "push"]) {
      const sub = root.commands.find((c) => c.name() === direction);
      expect(sub).toBeDefined();
      const opt = sub?.options.find((o) => o.long === "--repo");
      expect(opt).toBeDefined();
      // Commander folds repeated values through parseArg — no sub.parse()
      // (it would run the action and exit the worker).
      const once = opt?.parseArg?.("a/x", []);
      expect(opt?.parseArg?.("b/y", once)).toEqual(["a/x", "b/y"]);
    }
  });

  it(`R7 @req:84033d13-7a17-4e1d-ab7c-97ddf9916cd6 the repo option defaults to an empty list (no filter)`, () => {
    const root = exosyncCommand();
    for (const direction of ["sync", "pull", "push"]) {
      const sub = root.commands.find((c) => c.name() === direction);
      const opt = sub?.options.find((o) => (o.long ?? "").startsWith("--repo"));
      expect(opt?.defaultValue).toEqual([]);
    }
  });
});
