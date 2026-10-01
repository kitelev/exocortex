import { createServer, type Server } from "http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { execFileSync, spawn } from "child_process";

/**
 * Dependabot-alert ratchet — revert-verify binding (task 689a7dc5).
 *
 * Nine Dependabot alerts sat open for up to 25 days with zero open PRs and a GREEN CI.
 * MEASURED on `d1c775d4`: the release gate runs `npm audit --omit=dev --audit-level=high`,
 * those two filters do not overlap, and together they judged NONE of the nine — `--omit=dev`
 * dropped js-yaml (the only high), `--audit-level=high` dropped moment. Six of the nine sat on
 * `packages/core/package-lock.json`, a file no job installs from and whose pins CONTRADICTED
 * the installed tree. `scripts/check-dependabot-alert-baseline.mjs` is the ratchet that makes a
 * NEW vulnerable name anywhere in the lock graph go red while a baselined one stays silent.
 *
 * These axes drive the REAL script as a process. Stood in for: the tree (`DEPENDABOT_RATCHET_ROOT`
 * = a throw-away git repo), the baseline file (`DEPENDABOT_RATCHET_BASELINE`) and the advisory
 * endpoint (`npm_config_registry` → a local HTTP stub). NOT stood in for: the `npm audit`
 * invocation, `git ls-files`, the report parse, the ratchet arithmetic — i.e. the production
 * resolution path is the thing under test (self-authored-claim-loses-its-provenance §A59:
 * replacing the whole command would take that path out from under every axis).
 *
 * ⛤ Why the axes go past the single "new name ⇒ red" flip: a ratchet that only ever says red is
 * useless, and one that cannot say "I did not judge" is WORSE than nothing — it reads green when
 * the advisory endpoint is down, which is exactly the shape that silently costs releases (#4489).
 * So the three outcomes (0 / 1 / 2) each get axes, and the fail-open ones (R4-R6) are the floor.
 *
 * Task 689a7dc5. CI-config / tooling change — no `@req:` binding (RFC 0003 exempts these),
 * consistent with the sibling guard axes in this directory.
 */
describe("check-dependabot-alert-baseline.mjs — a NEW vulnerable name goes red, a baselined one stays silent (689a7dc5)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const script = path.join(
    repoRoot,
    "scripts/check-dependabot-alert-baseline.mjs",
  );

  let server: Server;
  let port = 0;
  /** Packages the stubbed advisory endpoint reports as vulnerable. Mutable per-axis. */
  let advisoryFor: string[] = [];
  /**
   * When true the stub answers the FIRST audit request and then kills the connection.
   * That is the only way to reach the PARTIAL-sweep branch: when every lockfile fails the
   * script exits earlier, at `parsed === 0` (§A124 — the guard under test was unreachable
   * from the input the axis supplied, which read as "the axis does not discriminate").
   */
  let failAfterFirst = false;
  let postCount = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === "POST") {
        postCount += 1;
        if (failAfterFirst && postCount > 1) {
          req.socket.destroy();
          return;
        }
        // `npm audit` POSTs the installed name→versions map to the bulk advisory endpoint.
        const body: Record<string, unknown[]> = {};
        for (const name of advisoryFor) {
          body[name] = [
            {
              id: 1,
              url: "https://github.com/advisories/GHSA-q2hr-2g5m-vwhr",
              title: "stub advisory for " + name,
              severity: "high",
              vulnerable_versions: "*",
              cwe: ["CWE-400"],
              cvss: { score: 7.5, vectorString: null },
            },
          ];
        }
        const payload = JSON.stringify(body);
        res.writeHead(200, {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }
      // Packument fetches (npm resolves "fix available") — 404 is harmless for audit.
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  type Tree = {
    dir: string;
    /** Absolute path of the baseline file the script will read/write. */
    baseline: string;
  };

  /**
   * Build a throw-away git tree with `lockfiles` lockfiles.
   *
   * ⛔ `git init` is required, not cosmetic: the sweep enumerates lockfiles through
   * `git ls-files` so that a lockfile added tomorrow enters the sweep by construction. A plain
   * directory would make every axis report "lockfiles 0" and exit 2.
   */
  function makeTree(
    lockfiles: { dirRel: string; deps: Record<string, string> }[],
  ): Tree {
    const dir = mkdtempSync(path.join(tmpdir(), "ratchet-fx-"));
    for (const { dirRel, deps } of lockfiles) {
      const abs = dirRel === "." ? dir : path.join(dir, dirRel);
      mkdirSync(abs, { recursive: true });
      writeFileSync(
        path.join(abs, "package.json"),
        JSON.stringify(
          { name: "fx-" + dirRel.replace(/\W/g, "-"), version: "1.0.0", private: true, dependencies: deps },
          null,
          2,
        ) + "\n",
      );
      const packages: Record<string, unknown> = {
        "": { name: "fx", version: "1.0.0", dependencies: deps },
      };
      for (const [name, version] of Object.entries(deps)) {
        packages["node_modules/" + name] = { version, resolved: "https://registry.npmjs.org/" + name, license: "MIT" };
      }
      writeFileSync(
        path.join(abs, "package-lock.json"),
        JSON.stringify({ name: "fx", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2) + "\n",
      );
    }
    execFileSync("git", ["init", "-q", "."], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    return { dir, baseline: path.join(dir, "baseline.json") };
  }

  /**
   * ⛔ ASYNC on purpose. The advisory stub lives in THIS process, so a synchronous
   * `execFileSync` would hold the event loop while `npm audit` waits on the stub — a deadlock
   * that surfaces as "network timeout at http://127.0.0.1:<port>", i.e. as a TRANSIENT endpoint
   * error rather than as a harness defect. MEASURED: every content axis reported rc=2 until the
   * child was spawned asynchronously. A blocking child also makes jest's per-test timeout
   * unable to fire (integration-test-revert-verify §A116), so the run stalls with no verdict.
   */
  function run(
    tree: Tree,
    opts: { update?: boolean; registry?: string } = {},
  ): Promise<{ rc: number; out: string }> {
    const args = [script];
    if (opts.update) args.push("--update");
    return new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: tree.dir,
        env: {
          ...process.env,
          DEPENDABOT_RATCHET_ROOT: tree.dir,
          DEPENDABOT_RATCHET_BASELINE: tree.baseline,
          npm_config_registry: opts.registry ?? `http://127.0.0.1:${port}`,
          npm_config_fund: "false",
          // ⛔ Per-tree npm cache, and this is CORRECTNESS, not hygiene. `npm audit` caches the
          // bulk-advisory response in the shared `~/.npm/_cacache`, keyed on the request body —
          // two axes with the same lockfile hit the cache and the stub is never consulted, so a
          // later axis silently judges an EARLIER axis's advisory set. MEASURED: R9 kept
          // reporting a GHSA id that no longer existed in the stub. It also kept this harness
          // from writing into the user's real npm cache (integration-test-revert-verify §A61 —
          // a harness must not mutate shared state it does not own).
          npm_config_cache: path.join(tree.dir, ".npm-cache"),
          // ⛔ Retries OFF, load-bearing rather than a speed tweak: npm's default back-off
          // (2 retries, 10 s min) turns the dead-endpoint axis into a multi-minute hang.
          // ⚠ BOTH bounds must move together — npm refuses the request when mintimeout >
          // maxtimeout ("minTimeout is greater than maxTimeout"), and the script then reads
          // that as a TRANSIENT error, i.e. a self-inflicted rc=2 on every axis.
          npm_config_fetch_retries: "0",
          npm_config_fetch_timeout: "20000",
          npm_config_fetch_retry_mintimeout: "100",
          npm_config_fetch_retry_maxtimeout: "1000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (out += String(d)));
      const killer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.on("close", (code) => {
        clearTimeout(killer);
        resolve({ rc: code ?? -1, out });
      });
    });
  }

  beforeEach(() => {
    failAfterFirst = false;
    postCount = 0;
  });

  const ONE_LOCK = [{ dirRel: ".", deps: { "left-pad": "1.3.0" } }];

  it("R1 a NEW vulnerable name fails the ratchet and names it", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    const { rc, out } = await run(tree);
    expect(out).toContain("NEW vulnerable package");
    expect(out).toContain("left-pad");
    expect(rc).toBe(1);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R2 a baselined name stays silent and the run is green", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    await run(tree, { update: true });
    const { rc, out } = await run(tree);
    expect(out).toContain("baselined (not blocking)");
    expect(out).not.toContain("NEW vulnerable package");
    expect(rc).toBe(0);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R3 a baselined key that is no longer reported fails LOUD (the baseline must not become a licence)", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    await run(tree, { update: true });
    // The advisory is gone; the stale entry must be pruned rather than silently kept.
    advisoryFor = [];
    const { rc, out } = await run(tree);
    expect(out).toContain("stale baseline entry");
    expect(rc).toBe(1);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R4 an unreadable baseline is NOT JUDGED (rc=2), never green", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    // no baseline file written at all
    const { rc, out } = await run(tree);
    expect(out).toContain("not judged");
    expect(rc).toBe(2);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R5 zero lockfiles is NOT JUDGED (rc=2) — an empty sweep is not a clean sweep", async () => {
    advisoryFor = [];
    const dir = mkdtempSync(path.join(tmpdir(), "ratchet-empty-"));
    execFileSync("git", ["init", "-q", "."], { cwd: dir });
    const tree: Tree = { dir, baseline: path.join(dir, "baseline.json") };
    writeFileSync(tree.baseline, "[]\n");
    const { rc, out } = await run(tree);
    expect(out).toContain("matched NO lockfile");
    expect(rc).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("R6 a dead advisory endpoint is NOT JUDGED (rc=2), not a green partial sweep", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    // Nothing listens on this port — npm's audit request fails at transport.
    const { rc, out } = await run(tree, { registry: "http://127.0.0.1:1" });
    expect(rc).toBe(2);
    expect(out).toMatch(/not a single lockfile was audited|INCOMPLETE/);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R7 EVERY lockfile is swept, including one no job installs from", async () => {
    // The class the ratchet exists for: the drift lived in a SECOND lockfile that nothing
    // installs from, so no gate keyed on the install path could ever see it.
    advisoryFor = ["left-pad"];
    const tree = makeTree([
      { dirRel: ".", deps: { "left-pad": "1.3.0" } },
      { dirRel: "packages/inner", deps: { "left-pad": "1.3.0" } },
    ]);
    writeFileSync(tree.baseline, "[]\n");
    const { rc, out } = await run(tree);
    expect(out).toContain("lockfiles 2");
    expect(out).toContain("packages/inner::left-pad");
    expect(out).toContain("<root>::left-pad");
    expect(rc).toBe(1);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R8 the green run still PRINTS its scope — the limitation lives where the verdict is read", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    await run(tree, { update: true });
    const { rc, out } = await run(tree);
    expect(rc).toBe(0);
    expect(out).toContain("NOT the Dependabot alert");
    expect(out).toContain("dependabot/alerts");
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R10 a PARTIAL sweep is NOT JUDGED (rc=2) — one lockfile answering does not clear the other", async () => {
    // ⛔ Distinct from R6: there EVERY lockfile fails and the script exits at `parsed === 0`.
    // Here one lockfile is audited successfully and the second's request is killed, which is
    // the only input that reaches the partial-sweep guard. Without this axis that guard was
    // exercised by nothing, and its mutant reddened nothing (§A130: build the input the guard
    // actually fires on, rather than concluding the axis cannot discriminate).
    advisoryFor = ["left-pad"];
    failAfterFirst = true;
    const tree = makeTree([
      { dirRel: ".", deps: { "left-pad": "1.3.0" } },
      { dirRel: "packages/inner", deps: { "left-pad": "1.3.0" } },
    ]);
    writeFileSync(tree.baseline, "[]\n");
    const { rc, out } = await run(tree);
    expect(out).toContain("INCOMPLETE");
    expect(rc).toBe(2);
    rmSync(tree.dir, { recursive: true, force: true });
  });

  it("R9 --update NAMES what it grandfathers, never just a count", async () => {
    advisoryFor = ["left-pad"];
    const tree = makeTree(ONE_LOCK);
    writeFileSync(tree.baseline, "[]\n");
    const { rc, out } = await run(tree, { update: true });
    expect(rc).toBe(0);
    expect(out).toContain("GRANDFATHERED");
    expect(out).toContain("left-pad");
    expect(JSON.parse(readFileSync(tree.baseline, "utf8"))).toEqual([
      "<root>::left-pad::GHSA-q2hr-2g5m-vwhr",
    ]);
    rmSync(tree.dir, { recursive: true, force: true });
  });
});
