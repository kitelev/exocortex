import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * Action-pin-drift guard — revert-verify binding (issue #4487).
 *
 * `scripts/check-action-pin-drift.mjs` enforces that every pinned GitHub Action
 * resolves to ONE version across all of `.github/` — workflows AND nested
 * composite actions. The defect it exists for is invisible to Dependabot:
 * its `github-actions` ecosystem scans `.github/workflows` only, so a pin in
 * `.github/actions/<name>/action.yml` never gets a bump PR. On 2026-10-01 that
 * left `setup-node-pnpm/action.yml` on `setup-node@v4` + `cache@v4` while the
 * workflow level had moved to v7/v6 — on the hot path of every required check.
 *
 * These axes drive the REAL guard script (not a reimplementation) against
 * fixture trees via `ACTION_PIN_ROOT`, and assert the revert-verify contract
 * the issue demands: a manufactured version divergence reds it, convergence
 * greens it.
 *
 * ⛤ Why the axes go beyond that single flip. The obvious guard — grep the tree
 * for `actions/setup-node@` and demand one distinct line — passes a
 * divergence/convergence pair too, yet is wrong in BOTH directions:
 *   • D1/D3 separate "reads composite actions" from "reads workflows". A guard
 *     scanning only `.github/workflows` passes D3 and fails D1 — and D1 is the
 *     entire point of #4487.
 *   • D4 is the false-RED half. This repo contains a TRUE past-tense comment
 *     ("Aggregator previously ran `actions/setup-node@v4`") plus README prose.
 *     A substring guard reds on those, i.e. demands a historical statement be
 *     falsified to go green. The guard must read `uses:` keys, not substrings.
 *   • D5/D8 are the population floor: zero findings over zero input is not a
 *     pass, and a parser that silently stops matching must be loud (exit 2).
 *   • D6 pins the grouping granularity at the RELEASE unit (`owner/repo`), so
 *     sibling sub-actions out of one repo cannot drift apart.
 *   • D7 keeps container images and local composite refs out of the invariant.
 *
 * Issue #4487. Bug-fix / CI-config change — no `@req:` binding (RFC 0003
 * exempts bug fixes from req-first), consistent with the other guard axes in
 * this directory.
 */
describe("check-action-pin-drift.mjs — one version per pinned action under .github (#4487)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const scriptPath = path.join(repoRoot, "scripts/check-action-pin-drift.mjs");

  let fixtureRoot: string;

  /** Write `<fixtureRoot>/<rel>`, creating parents. */
  const write = (rel: string, body: string) => {
    const full = path.join(fixtureRoot, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  /** A minimal workflow whose only interesting content is its `uses:` pins. */
  const workflow = (...pins: string[]) =>
    [
      "name: fixture",
      "on: push",
      "jobs:",
      "  job:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      ...pins.map((p) => `      - uses: ${p}`),
      "",
    ].join("\n");

  /** A minimal composite action whose only interesting content is its pins. */
  const composite = (...pins: string[]) =>
    [
      "name: fixture composite",
      "description: fixture",
      "runs:",
      "  using: composite",
      "  steps:",
      ...pins.map((p) => `    - uses: ${p}`),
      "",
    ].join("\n");

  const runGuard = () =>
    spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ACTION_PIN_ROOT: fixtureRoot },
    });

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "action-pin-drift-"));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  // ── The flip the issue asks for ───────────────────────────────────────────

  it("D1 FAILS (exit 1) when a nested composite action pins a different version than the workflows", () => {
    write(
      ".github/workflows/ci.yml",
      workflow("actions/checkout@v7", "actions/setup-node@v7"),
    );
    write(
      ".github/actions/setup-node-pnpm/action.yml",
      composite("actions/setup-node@v4"),
    );

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "actions/setup-node is pinned to 2 versions (v4, v7)",
    );
    // Both sides of the divergence must be NAMED — a guard that only says
    // "drift" leaves the reader to find the stale pin by hand, and the stale
    // one is precisely the file Dependabot never touches.
    expect(r.stderr).toContain(".github/actions/setup-node-pnpm/action.yml");
    expect(r.stderr).toContain(".github/workflows/ci.yml");
  });

  it("D2 PASSES (exit 0) once the composite action is bumped to the workflow version (revert-verify GREEN)", () => {
    write(
      ".github/workflows/ci.yml",
      workflow("actions/checkout@v7", "actions/setup-node@v7"),
    );
    write(
      ".github/actions/setup-node-pnpm/action.yml",
      composite("actions/setup-node@v7"),
    );

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check-action-pin-drift guard OK");
    // The success line reports the INPUT SIZE next to the finding count, so a
    // pass over a shrunken tree is readable as such rather than as a clean one.
    expect(r.stdout).toContain("2 yaml file(s)");
  });

  it("D3 FAILS (exit 1) when the drift is entirely inside .github/workflows (no composite involved)", () => {
    write(".github/workflows/a.yml", workflow("actions/upload-artifact@v7"));
    write(".github/workflows/b.yml", workflow("actions/upload-artifact@v6"));

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "actions/upload-artifact is pinned to 2 versions (v6, v7)",
    );
  });

  // ── The false-RED half: commentary and prose are not pins ─────────────────

  it("D4 PASSES (exit 0) when an older version is only MENTIONED in a comment or in prose", () => {
    // Shape taken verbatim from the live tree: ci.yml carries a true past-tense
    // note about the version this repo used to run, and the composite action's
    // README describes the action in prose. Neither is in effect.
    write(
      ".github/workflows/ci.yml",
      [
        "name: fixture",
        "on: push",
        "jobs:",
        "  job:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      # Aggregator previously ran `actions/setup-node@v4` + `npm install -D`",
        "      # — replaced by the cached composite action.",
        "      - uses: actions/setup-node@v7",
        "      # - uses: actions/setup-node@v4   (commented-out step, not in effect)",
        "",
      ].join("\n"),
    );
    write(".github/actions/x/action.yml", composite("actions/setup-node@v7"));
    write(
      ".github/actions/x/README.md",
      '1. `actions/setup-node@v4` with `cache: "npm"`.\n',
    );

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check-action-pin-drift guard OK");
  });

  // ── Population floor: zero findings over zero input is not a pass ─────────

  it("D5 is BROKEN (exit 2) when yaml files exist but no pin matches, instead of reporting clean", () => {
    write(".github/dependabot.yml", "version: 2\nupdates: []\n");
    write(".github/codeql/codeql-config.yml", "name: fixture\nqueries: []\n");

    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("BROKEN");
    expect(r.stderr).toContain("matched 0 action pin(s)");
  });

  it("D8 is BROKEN (exit 2) when there is no .github directory at all", () => {
    // Nothing written — the fixture root is empty.
    const r = runGuard();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("BROKEN");
    expect(r.stderr).toContain("found no *.yml/*.yaml");
  });

  // ── Grouping granularity: the release unit, not the action path ───────────

  it("D6 FAILS (exit 1) when sibling sub-actions of ONE repo are pinned to different versions", () => {
    // github/codeql-action/{init,analyze} are two action paths out of one repo
    // with one release train; grouping by full path would call this clean.
    write(
      ".github/workflows/codeql.yml",
      workflow(
        "github/codeql-action/init@v4",
        "github/codeql-action/analyze@v5",
      ),
    );

    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "github/codeql-action is pinned to 2 versions (v4, v5)",
    );
  });

  // ── Out of scope by construction ──────────────────────────────────────────

  it("D7 PASSES (exit 0) for DIGEST-pinned docker:// images and local ./ composite refs", () => {
    // ⛔ The digest form is load-bearing for this axis. A tag-pinned
    // `docker://alpine:3.19` carries no `@` and is already excluded by the
    // "no version" check, so it would exercise nothing — the fixture would be
    // green whether or not the guard special-cases container images. A
    // DIGEST-pinned ref does carry `@`, so without the `docker://` skip these
    // two would be grouped as one release unit pinned to two "versions" and
    // the guard would red on a correct tree.
    write(
      ".github/workflows/a.yml",
      workflow(
        "docker://ghcr.io/acme/img@sha256:aaaaaaaaaaaa",
        "./.github/actions/x",
        "actions/checkout@v7",
      ),
    );
    write(
      ".github/workflows/b.yml",
      workflow(
        "docker://ghcr.io/acme/img@sha256:bbbbbbbbbbbb",
        "./.github/actions/x",
      ),
    );

    const r = runGuard();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check-action-pin-drift guard OK");
    // Exactly one release unit was counted — the two container digests and the
    // two local refs contributed nothing.
    expect(r.stdout).toContain("1 release unit(s)");
  });
});
