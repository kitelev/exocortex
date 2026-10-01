import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * Release gate — revert-verify binding (issue #4488).
 *
 * `auto-release.yml` was gated on `github.event.workflow_run.conclusion == 'success'`, i.e. on
 * the verdict of the WHOLE CI run. A job OUTSIDE branch protection's required set drags that
 * verdict to `cancelled`/`failure`, so the release is silently not cut while every required
 * check is green. MEASURED on merge `fb832b34` (#4188, 2026-10-01): 14/14 required `success`,
 * the `e2e-tests` aggregator `cancelled` at 155 s against its 2-minute budget, run `cancelled`,
 * `Auto Release` `skipped`, v17.7.25 never published.
 *
 * These axes drive the REAL script (`.github/scripts/release-required-gate.mjs`) as a process,
 * against a local HTTP server standing in for api.github.com via the platform's own
 * `GITHUB_API_URL`. Nothing is reimplemented here, and the production resolution path — URL
 * choice, request headers, paging, retry — is the thing under test.
 *
 * ⛤ Why the axes go well past the single flip D1. "Required green ⇒ release" passes a
 * naive guard that always says `true`, and such a guard trades today's silent SKIP for a silent
 * WRONG release, which is strictly worse:
 *   • D6/D7/D8 are the fail-open floor. An empty / unreadable required set makes "nothing is
 *     failing and nothing is missing" VACUOUSLY true, so the gate must fall back to the old
 *     predicate and SAY it did (`judged=false`) rather than publish on a broken measurement.
 *     That is exactly the shape `ci-watch.py` had to guard after a transient protection 403.
 *   • D12 pins the DERIVATION. A hardcoded context list would pass D1-D5 forever and silently
 *     stop gating on any newly added required check; the mutant that re-points the fetch at the
 *     admin-only endpoint (403) must therefore red D12.
 *   • D14 holds the stale-window guard in place: the SAME listing URL served an answer 12
 *     days stale, so the request's `Cache-Control` is part of the contract, asserted at the
 *     SERVER (what was received) rather than at the caller.
 *   • D10/D11 are the two "looks green but is not" shapes: an unknown conclusion must block, and
 *     a stale duplicate must not shadow a re-run's success.
 *   • D16-D21 are the class DETECTOR (the issue's second acceptance item): a skipped release at
 *     a green required set has to go RED, while every legitimate reason for publishing nothing
 *     stays green — otherwise the detector gets trained away.
 *
 * Issue #4488. Bug-fix / CI-config change — no `@req:` binding (RFC 0003 exempts bug fixes),
 * consistent with the sibling guard axes in this directory.
 */
describe("release-required-gate.mjs — release gates on the required SET, not the run verdict (#4488)", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const script = path.join(
    repoRoot,
    ".github/scripts/release-required-gate.mjs",
  );

  const REQUIRED = [
    "typecheck",
    "test-coverage",
    "archgate",
    "test-component",
    "e2e-shard (1)",
    "lint",
    "detect-changes",
    "parity-gate",
    "requirements-trace",
  ];

  type CheckRun = {
    name: string;
    status?: string;
    conclusion: string | null;
    started_at?: string;
    id?: number;
  };

  type Scenario = {
    /** `null` ⇒ the branch endpoint answers 403, as the admin-only ones really do. */
    contexts: string[] | null;
    checkRuns: CheckRun[];
    /** Serve `checkRuns` across pages of this size (exercises the pager). */
    pageSize?: number;
  };

  let server: Server;
  let base = "";
  let scenario: Scenario;
  /** Every request the script actually made — the material for D12/D13/D14. */
  let seen: { url: string; cacheControl: string | undefined }[] = [];
  let tmp = "";

  const green = (names: string[]): CheckRun[] =>
    names.map((name, i) => ({
      name,
      status: "completed",
      conclusion: "success",
      started_at: "2026-10-01T17:00:00Z",
      id: 100 + i,
    }));

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";
      seen.push({
        url,
        cacheControl: req.headers["cache-control"] as string | undefined,
      });
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (/\/branches\/[^/]+$/.test(url)) {
        if (scenario.contexts === null) {
          return json(403, {
            message: "Resource not accessible by integration",
          });
        }
        return json(200, {
          name: "main",
          protection: {
            enabled: true,
            required_status_checks: { contexts: scenario.contexts },
          },
        });
      }

      if (url.includes("/check-runs")) {
        const size = scenario.pageSize ?? 100;
        const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? "1");
        const slice = scenario.checkRuns.slice((page - 1) * size, page * size);
        return json(200, {
          total_count: scenario.checkRuns.length,
          check_runs: slice,
        });
      }

      return json(404, { message: `unexpected path ${url}` });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen = [];
    tmp = mkdtempSync(path.join(tmpdir(), "release-gate-"));
    scenario = { contexts: [...REQUIRED], checkRuns: green(REQUIRED) };
  });

  afterEach(() => {
    if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Run the script as a child process and collect rc + output.
   *
   * ⛔ ASYNCHRONOUS on purpose. `spawnSync` deadlocks here: it blocks this process's event loop,
   * and the loop is what serves the stand-in API — so the child waits for a response that cannot
   * be produced until the child exits. The symptom is a run that hangs with an empty log, not a
   * failing assertion, which is why it is written down rather than left to be rediscovered.
   */
  const run = (
    args: string[],
    env: Partial<Record<string, string>>,
  ): Promise<{ rc: number; stdout: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: repoRoot,
        env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      });
      let buf = "";
      child.stdout.on("data", (d) => (buf += String(d)));
      child.stderr.on("data", (d) => (buf += String(d)));
      child.on("error", reject);
      child.on("close", (code) => resolve({ rc: code ?? -1, stdout: buf }));
    });

  /** Run the gate as the workflow runs it; return its outputs plus rc and stdout. */
  const runGate = async (
    overrides: Partial<Record<string, string>> = {},
  ): Promise<{ rc: number; out: Record<string, string>; stdout: string }> => {
    const outputFile = path.join(
      tmp,
      `gh-output-${Math.random().toString(36).slice(2)}`,
    );
    const { rc, stdout } = await run([], {
      GITHUB_API_URL: base,
      GITHUB_REPOSITORY: "kitelev/exocortex",
      HEAD_SHA: "fb832b34657d4e10ae6a08df62e8bc8a2cd72260",
      GH_TOKEN: "test-token",
      GITHUB_OUTPUT: outputFile,
      GATE_RETRY_BACKOFF_MS: "1",
      GITHUB_STEP_SUMMARY: "",
      ...overrides,
    });
    const out: Record<string, string> = {};
    if (existsSync(outputFile)) {
      for (const line of readFileSync(outputFile, "utf8").split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    return { rc, out, stdout };
  };

  /** Run the audit mode as the workflow runs it. */
  const runAudit = (
    env: Partial<Record<string, string>>,
  ): Promise<{ rc: number; stdout: string }> =>
    run(["--audit"], { GITHUB_STEP_SUMMARY: "", ...env });

  /* ── The gate ─────────────────────────────────────────────────────────────────────────── */

  it("D1 releases when every required check is green even though the RUN was cancelled", async () => {
    // The #4488 flip, on the real historical input: a non-required job took the run verdict
    // down, the required set did not notice, and the release must still be cut.
    const { rc, out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.release).toBe("true");
    expect(out.judged).toBe("true");
    expect(out.required_n).toBe(String(REQUIRED.length));
    expect(out.green_n).toBe(String(REQUIRED.length));
    expect(rc).toBe(0);
  });

  it("D2 refuses when a required check failed, whatever the run verdict says", async () => {
    scenario.checkRuns = [
      ...green(REQUIRED.filter((n) => n !== "lint")),
      { name: "lint", status: "completed", conclusion: "failure", id: 1 },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(out.release).toBe("false");
    expect(out.judged).toBe("true");
    expect(out.reason).toContain("lint=failure");
  });

  it("D3 refuses when a required context has no check-run at all (missing ≠ satisfied)", async () => {
    scenario.checkRuns = green(REQUIRED.filter((n) => n !== "parity-gate"));
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(out.release).toBe("false");
    expect(out.reason).toContain("parity-gate");
    expect(out.green_n).toBe(String(REQUIRED.length - 1));
  });

  it("D4 refuses while a required check is still pending (conclusion null)", async () => {
    scenario.checkRuns = [
      ...green(REQUIRED.filter((n) => n !== "archgate")),
      { name: "archgate", status: "in_progress", conclusion: null, id: 2 },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.release).toBe("false");
    expect(out.reason).toContain("archgate=pending");
  });

  it("D5 ignores a NON-required job that failed — that is the whole point of the fix", async () => {
    scenario.checkRuns = [
      ...green(REQUIRED),
      {
        name: "e2e-tests",
        status: "completed",
        conclusion: "cancelled",
        id: 3,
      },
      {
        name: "npm-audit-exocortex",
        status: "completed",
        conclusion: "failure",
        id: 4,
      },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "failure" });
    expect(out.release).toBe("true");
    expect(out.judged).toBe("true");
  });

  it("D6 does NOT release on an empty required set — a vacuous green is no verdict", async () => {
    scenario.contexts = [];
    const { rc, out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.judged).toBe("false");
    expect(out.release).toBe("false"); // the fallback predicate, which `cancelled` fails
    expect(out.reason).toContain("required-set-unavailable");
    expect(rc).toBe(2); // "no verdict", distinct from a judged false
  });

  it("D7 falls back to the old predicate when the required set is unreadable (403)", async () => {
    scenario.contexts = null;
    const good = await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(good.out.judged).toBe("false");
    expect(good.out.release).toBe("true"); // never LOOSER than the predicate it replaced
    expect(good.rc).toBe(2);

    const bad = await runGate({ WORKFLOW_CONCLUSION: "failure" });
    expect(bad.out.release).toBe("false");
  });

  it("D8 withholds a verdict when the check-run listing is empty but the required set is not", async () => {
    scenario.checkRuns = [];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.judged).toBe("false");
    expect(out.reason).toContain("check-runs listing empty");
  });

  it("D9 treats skipped/neutral required checks as satisfied (docs-only runs still release)", async () => {
    scenario.checkRuns = [
      ...green(
        REQUIRED.filter(
          (n) => !["e2e-shard (1)", "test-component"].includes(n),
        ),
      ),
      {
        name: "e2e-shard (1)",
        status: "completed",
        conclusion: "skipped",
        id: 5,
      },
      {
        name: "test-component",
        status: "completed",
        conclusion: "neutral",
        id: 6,
      },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(out.release).toBe("true");
    expect(out.green_n).toBe(String(REQUIRED.length));
  });

  it("D10 blocks on an UNKNOWN conclusion rather than reading it as green", async () => {
    scenario.checkRuns = [
      ...green(REQUIRED.filter((n) => n !== "typecheck")),
      { name: "typecheck", status: "completed", conclusion: "stale", id: 7 },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(out.release).toBe("false");
    expect(out.reason).toContain("typecheck=stale");
  });

  it("D11 prefers the most recent check-run when a name appears twice (re-run beats stale red)", async () => {
    scenario.checkRuns = [
      ...green(REQUIRED.filter((n) => n !== "lint")),
      {
        name: "lint",
        status: "completed",
        conclusion: "failure",
        started_at: "2026-10-01T17:00:00Z",
        id: 10,
      },
      {
        name: "lint",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-01T18:30:00Z",
        id: 11,
      },
    ];
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.release).toBe("true");
  });

  it("D12 DERIVES the required set from the branch object (not from a list in the repo)", async () => {
    await runGate({ WORKFLOW_CONCLUSION: "success" });
    const branchCalls = seen.filter((s) => /\/branches\//.test(s.url));
    expect(branchCalls.length).toBeGreaterThan(0);
    // The admin-only endpoints answer 403 to a job token (measured), so the gate must not use
    // them; and nothing may be read from a file in the repo.
    expect(branchCalls.every((s) => !s.url.includes("/protection"))).toBe(true);
    expect(seen.some((s) => s.url.includes("/check-runs"))).toBe(true);
  });

  it("D13 pages the check-run listing instead of judging page 1 only", async () => {
    const filler: CheckRun[] = Array.from({ length: 140 }, (_, i) => ({
      name: `filler-${i}`,
      status: "completed",
      conclusion: "success",
      id: 1000 + i,
    }));
    // The required contexts sit AFTER the first page, so a non-paging gate reads them as missing.
    scenario.checkRuns = [...filler, ...green(REQUIRED)];
    scenario.pageSize = 100;
    const { out } = await runGate({ WORKFLOW_CONCLUSION: "cancelled" });
    expect(out.release).toBe("true");
    expect(
      seen.filter((s) => s.url.includes("/check-runs")).length,
    ).toBeGreaterThan(1);
  });

  it("D14 sends Cache-Control: no-cache on every API read (stale windows measured at 12 days)", async () => {
    await runGate({ WORKFLOW_CONCLUSION: "success" });
    expect(seen.length).toBeGreaterThan(0);
    // Asserted on what the SERVER received: a caller-side assertion would survive the header
    // being dropped on the wire. The guard is kept for its cost asymmetry (free against a false
    // release verdict), NOT for a measured rate — see the script's `api()` header — and an axis
    // is what keeps a free guard from falling off unnoticed.
    expect(seen.every((s) => (s.cacheControl ?? "").includes("no-cache"))).toBe(
      true,
    );
  });

  /* ── The class detector ───────────────────────────────────────────────────────────────── */

  it("D16 goes RED when the required set is green and the release job did NOT run", async () => {
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "true",
      GATE_REASON: "every one of 14 required context(s) is satisfied",
      AR_RESULT: "skipped",
    });
    expect(rc).toBe(1);
    expect(stdout).toContain("SILENT-SKIP");
  });

  it("D17 stays green on a release that actually happened", async () => {
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "true",
      AR_RESULT: "success",
      AR_HAS_COMMITS: "true",
      AR_TAG_EXISTS: "false",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("RELEASED");
  });

  it("D18 stays green when there was nothing to release", async () => {
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "true",
      AR_RESULT: "success",
      AR_HAS_COMMITS: "false",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("NOTHING-TO-RELEASE");
  });

  it("D19 stays green when the computed tag already exists", async () => {
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "true",
      AR_RESULT: "success",
      AR_HAS_COMMITS: "true",
      AR_TAG_EXISTS: "true",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("ALREADY-RELEASED");
  });

  it("D20 does not cry wolf when the gate could not judge (transient 403)", async () => {
    // A red run on every transient would train the reader to ignore this job, so an unjudged
    // outcome gets its OWN name and stays green.
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "false",
      GATE_RELEASE: "false",
      GATE_REASON:
        "required-set-unavailable — fell back to workflow_run.conclusion=cancelled",
      AR_RESULT: "skipped",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("UNJUDGED");
  });

  it("D21 stays green when the gate legitimately refused to release", async () => {
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "false",
      GATE_REASON: "required not satisfied — failing=[lint=failure] missing=[]",
      AR_RESULT: "skipped",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("NO-RELEASE-EXPECTED");
  });

  it("D22 does not read an ABSENT release output as a `false` (missing ≠ false)", async () => {
    // `AR_HAS_COMMITS` unset must not be classified as "nothing to release": that would hide a
    // genuine miss behind a legitimate-looking reason.
    const { rc, stdout } = await runAudit({
      GATE_JUDGED: "true",
      GATE_RELEASE: "true",
      AR_RESULT: "success",
    });
    expect(rc).toBe(0);
    expect(stdout).toContain("RELEASED");
    expect(stdout).not.toContain("NOTHING-TO-RELEASE");
  });
});
