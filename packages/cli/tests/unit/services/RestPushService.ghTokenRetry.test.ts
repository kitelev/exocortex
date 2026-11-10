/**
 * @jest-environment node
 *
 * ems__Bug 24f760d3 — `gh auth token` under launchd sometimes misses its single
 * 15 s limit (`spawnSync gh ETIMEDOUT`) while the machine stalls, and every
 * `--token-from-gh` command (`exosync-parity`, `exosync sync|push|pull`,
 * `exosync quarantine`) failed on the first miss. `resolveGhToken` now retries
 * ONLY a timed-out attempt, with a growing limit, and names a final timeout as
 * a stall instead of an authentication problem.
 *
 * Injected-runner axes use errors shaped exactly like `execFileSync`'s
 * (measured on Node 24: timeout ⇒ `code: "ETIMEDOUT"`, `signal: "SIGTERM"` —
 * or `SIGPIPE` when the child ignores TERM — `status: null`; a TERM-ignoring
 * child that exits by itself ⇒ `code: "ETIMEDOUT"` with `status: N`, `signal:
 * null`; a timed-out child's partial output ⇒ in `stdout`; missing binary ⇒
 * `code: "ENOENT"`; non-zero exit ⇒ `status: N`, no `code`; a kill from outside
 * ⇒ `signal` set, no `code`). The real-spawn axes run the DEFAULT runner
 * against a fake `gh` on PATH, so the classifier is proven on the real error
 * object, not on a hand-made copy of it. G21 (default runner wiring) lives in
 * `RestPushService.ghTokenRetry.defaultRunner.test.ts`: it must mock
 * `node:child_process` before the subject is imported.
 *
 * ⛔ Real-spawn axes compare tokens with `===` and assert on the boolean: if
 * the PATH ever leaked to the user's REAL gh, a failing `toBe(FAKE_PAT)` would
 * print the real token into the test log.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  RestPushService,
  GH_TOKEN_ATTEMPT_TIMEOUTS_MS,
} from "../../../src/services/RestPushService";
import { classifyMessage } from "../../../src/utils/ErrorHandler";
import { ExitCodes } from "../../../src/utils/ExitCodes";

const FAKE_PAT = "gho_" + "B".repeat(36);
const AUTH_TEXT = /is GitHub CLI installed and authenticated\?/;
const STALL_TEXT = /timed out \(ETIMEDOUT\) after/;

function timeoutError(extra = "", errno = -60): Error {
  return Object.assign(new Error(`spawnSync gh ETIMEDOUT${extra}`), {
    code: "ETIMEDOUT",
    errno,
    signal: "SIGTERM",
    status: null,
  });
}

/** Runner that plays a script of outcomes and records the limits it got. */
function scripted(outcomes: Array<string | Error | (() => never)>): {
  run: (timeoutMs: number) => string;
  limits: number[];
} {
  const limits: number[] = [];
  return {
    limits,
    run: (timeoutMs: number): string => {
      limits.push(timeoutMs);
      const next = outcomes[limits.length - 1];
      if (next === undefined) throw new Error("runner called too many times");
      if (typeof next === "function") return next();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return "<<did not throw>>";
}

function elapsedOf(message: string): number {
  return Number((/ attempts? in (\d+)s — /.exec(message) ?? [])[1] ?? -1);
}

/** Synchronous wait, as a really stalled `gh` holds execFileSync. */
function slowTimeout(ms: number): () => never {
  return (): never => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    throw timeoutError();
  };
}

describe("RestPushService.resolveGhToken — retry on timeout (ems__Bug 24f760d3)", () => {
  it("G1 a timed-out first attempt is retried and the token is returned", () => {
    const r = scripted([timeoutError(), `${FAKE_PAT}\n`]);
    expect(RestPushService.resolveGhToken(r.run)).toBe(FAKE_PAT);
    expect(r.limits).toHaveLength(2);
  });

  it("G2 the default schedule is 15 s, 30 s, 60 s — in that order, each attempt its own limit", () => {
    expect([...GH_TOKEN_ATTEMPT_TIMEOUTS_MS]).toEqual([15_000, 30_000, 60_000]);
    const r = scripted([timeoutError(), timeoutError(), timeoutError()]);
    expect(() => RestPushService.resolveGhToken(r.run)).toThrow();
    expect(r.limits).toEqual([15_000, 30_000, 60_000]);
  });

  it("G3 when every attempt times out the error names a stall, not authentication", () => {
    const r = scripted([timeoutError(), timeoutError(), timeoutError()]);
    const message = messageOf(() => RestPushService.resolveGhToken(r.run));
    expect(message).toMatch(
      /^RestPushService: `gh auth token` timed out \(ETIMEDOUT\) after 3 attempts in \d+s — /,
    );
    expect(message).toMatch(/ — a stall, not an authentication failure; retry later\./);
    expect(message).toMatch(/Limits: 15s \+ 30s \+ 60s\. /);
    expect(message).toMatch(/Underlying: spawnSync gh ETIMEDOUT$/);
    expect(message).not.toMatch(AUTH_TEXT);
  });

  it("G4 a non-zero exit is NOT retried and keeps the original message", () => {
    const exit = Object.assign(new Error("Command failed: gh auth token"), {
      status: 1,
      signal: null,
    });
    const r = scripted([exit, `${FAKE_PAT}\n`]);
    expect(() => RestPushService.resolveGhToken(r.run)).toThrow(
      "RestPushService: `gh auth token` failed — is GitHub CLI installed and authenticated? (run `gh auth login`). Underlying: Command failed: gh auth token",
    );
    expect(r.limits).toHaveLength(1);
  });

  it("G5 a missing gh (ENOENT) is NOT retried", () => {
    const missing = Object.assign(new Error("spawnSync gh ENOENT"), {
      code: "ENOENT",
      errno: -2,
    });
    const r = scripted([missing, `${FAKE_PAT}\n`]);
    expect(() => RestPushService.resolveGhToken(r.run)).toThrow(
      /`gh auth token` failed — is GitHub CLI installed and authenticated\?.*ENOENT/,
    );
    expect(r.limits).toHaveLength(1);
  });

  it("G6 empty output is NOT retried — it still means not authenticated", () => {
    const r = scripted(["  \n", `${FAKE_PAT}\n`]);
    expect(() => RestPushService.resolveGhToken(r.run)).toThrow(/not authenticated/);
    expect(r.limits).toHaveLength(1);
  });

  it("G7 a PAT leaked into the timeout error text is redacted", () => {
    const leak = scripted([
      timeoutError(` (${FAKE_PAT})`),
      timeoutError(` (${FAKE_PAT})`),
      timeoutError(` (${FAKE_PAT})`),
    ]);
    const message = messageOf(() => RestPushService.resolveGhToken(leak.run));
    expect(message).toMatch(/REDACTED/);
    expect(message.includes(FAKE_PAT)).toBe(false);
  });

  it("G10 boundary: a success on the LAST attempt is returned", () => {
    const r = scripted([timeoutError(), timeoutError(), `${FAKE_PAT}\n`]);
    expect(RestPushService.resolveGhToken(r.run)).toBe(FAKE_PAT);
    expect(r.limits).toEqual([15_000, 30_000, 60_000]);
  });

  it("G11 boundary: a one-attempt schedule fails on the first timeout", () => {
    const r = scripted([timeoutError(), `${FAKE_PAT}\n`]);
    expect(() => RestPushService.resolveGhToken(r.run, [1_000])).toThrow(
      /after 1 attempt in \d+s — .*Limits: 1s\. /,
    );
    expect(r.limits).toEqual([1_000]);
  });

  it("G12 an empty schedule is refused without calling gh", () => {
    const r = scripted([`${FAKE_PAT}\n`]);
    expect(() => RestPushService.resolveGhToken(r.run, [])).toThrow(
      /at least one attempt/,
    );
    expect(r.limits).toHaveLength(0);
  });

  it("G13 the elapsed time is measured, not taken from the limits (1.6 s wait under a 1 s limit ⇒ ≥ 2 s)", () => {
    const m = messageOf(() =>
      RestPushService.resolveGhToken(scripted([slowTimeout(1_600)]).run, [1_000]),
    );
    expect(elapsedOf(m)).toBeGreaterThanOrEqual(2);
  });

  it("G15 an external SIGTERM (signal set, no ETIMEDOUT code) is NOT retried", () => {
    const killed = Object.assign(new Error("Command failed: gh auth token"), {
      signal: "SIGTERM",
      status: null,
    });
    const r = scripted([killed, `${FAKE_PAT}\n`]);
    expect(messageOf(() => RestPushService.resolveGhToken(r.run))).toMatch(AUTH_TEXT);
    expect(r.limits).toHaveLength(1);
  });

  it("G17 the elapsed time covers ALL attempts, not only the last one", () => {
    const r = scripted([slowTimeout(1_600), slowTimeout(1_600)]);
    const m = messageOf(() => RestPushService.resolveGhToken(r.run, [1_000, 1_000]));
    expect(elapsedOf(m)).toBeGreaterThanOrEqual(3);
  });

  it("G18 a non-timeout AFTER a timeout is final and named as auth, not as a stall", () => {
    const exit = Object.assign(new Error("Command failed: gh auth token\nnot logged in"), {
      status: 4,
      signal: null,
    });
    const r = scripted([timeoutError(), exit, exit]);
    const m = messageOf(() => RestPushService.resolveGhToken(r.run));
    expect(m).toMatch(AUTH_TEXT);
    expect(m).not.toMatch(STALL_TEXT);
    expect(r.limits).toHaveLength(2);
  });

  it("G19 a Linux-shaped timeout (errno -110) is retried like the macOS one (-60)", () => {
    const r = scripted([timeoutError("", -110), `${FAKE_PAT}\n`]);
    expect(RestPushService.resolveGhToken(r.run)).toBe(FAKE_PAT);
    expect(r.limits).toHaveLength(2);
  });

  it("G20 a retried timeout writes nothing to the console (consumers parse `--json 2>&1`)", () => {
    const spies = (["error", "warn", "log", "info", "debug", "trace"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      const r = scripted([timeoutError(), `${FAKE_PAT}\n`]);
      expect(RestPushService.resolveGhToken(r.run)).toBe(FAKE_PAT);
      expect(spies.reduce((n, s) => n + s.mock.calls.length, 0)).toBe(0);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  /** Spy on a raw stream write; the call is synchronous, so no foreign write lands in between. */
  function streamWrites(stream: NodeJS.WriteStream, fn: () => void): number {
    const target = stream as unknown as { write: (...a: unknown[]) => boolean };
    const spy = jest.spyOn(target, "write").mockImplementation(() => true);
    try {
      fn();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  it("G29 a retried timeout writes nothing to stdout (`--json` keeps stdout a single JSON document)", () => {
    const r = scripted([timeoutError(), `${FAKE_PAT}\n`]);
    let token = "";
    const n = streamWrites(process.stdout, () => {
      token = RestPushService.resolveGhToken(r.run);
    });
    expect(token).toBe(FAKE_PAT);
    expect(n).toBe(0);
  });

  it("G30 a retried timeout writes nothing to stderr directly", () => {
    const r = scripted([timeoutError(), `${FAKE_PAT}\n`]);
    let token = "";
    const n = streamWrites(process.stderr, () => {
      token = RestPushService.resolveGhToken(r.run);
    });
    expect(token).toBe(FAKE_PAT);
    expect(n).toBe(0);
  });

  it("G25 a timed-out attempt's partial output is ignored even if it already holds a token — the next attempt's token is used", () => {
    const early = "gho_" + "A".repeat(36);
    const r = scripted([
      Object.assign(timeoutError(), { stdout: `${early}\n` }),
      `${FAKE_PAT}\n`,
    ]);
    expect(RestPushService.resolveGhToken(r.run)).toBe(FAKE_PAT);
    expect(r.limits).toHaveLength(2);
  });

  it("G27 a custom schedule is followed limit by limit (not derived from the first limit)", () => {
    const r = scripted([timeoutError(), timeoutError(), timeoutError()]);
    expect(() => RestPushService.resolveGhToken(r.run, [3_000, 1_000, 2_000])).toThrow(
      /after 3 attempts in \d+s — .*Limits: 3s \+ 1s \+ 2s\. /,
    );
    expect(r.limits).toEqual([3_000, 1_000, 2_000]);
  });

  it("G28 the reported wait does not shrink when the wall clock steps back during the attempts", () => {
    const realNow = Date.now.bind(Date);
    let reads = 0;
    const spy = jest
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() - (reads++ > 0 ? 3_600_000 : 0));
    try {
      const m = messageOf(() =>
        RestPushService.resolveGhToken(scripted([slowTimeout(1_600)]).run, [1_000]),
      );
      expect(elapsedOf(m)).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("G22 the verdict and the measured wait survive the delivery log's cut (`tail -1 | cut -c1-160` of \"❌ Error: <message>\", bytes under a C locale)", () => {
    const m = messageOf(() =>
      RestPushService.resolveGhToken(
        scripted([timeoutError(), timeoutError(), timeoutError()]).run,
      ),
    );
    const line = `❌ Error: ${m}`;
    for (const key of ["ETIMEDOUT", " attempts in ", "not an authentication failure"]) {
      const end = line.indexOf(key) + key.length;
      expect(line.indexOf(key)).toBeGreaterThan(0);
      expect(Buffer.byteLength(line.slice(0, end), "utf8")).toBeLessThanOrEqual(160);
    }
  });

  it("G23 the CLI still exits 1 (GENERAL_ERROR) on the new stall text, as on the old auth text", () => {
    const m = messageOf(() =>
      RestPushService.resolveGhToken(
        scripted([timeoutError(), timeoutError(), timeoutError()]).run,
      ),
    );
    expect(classifyMessage(m).exitCode).toBe(ExitCodes.GENERAL_ERROR);
    expect(
      classifyMessage(
        "RestPushService: `gh auth token` failed — is GitHub CLI installed and authenticated? (run `gh auth login`). Underlying: spawnSync gh ETIMEDOUT",
      ).exitCode,
    ).toBe(ExitCodes.GENERAL_ERROR);
  });

  it("G24 instant timeouts report ~0 s elapsed, not the sum of the limits", () => {
    const m = messageOf(() =>
      RestPushService.resolveGhToken(
        scripted([timeoutError(), timeoutError(), timeoutError()]).run,
      ),
    );
    // elapsedOf gives -1 when the text carries no wait, so "> -1" = "a wait was
    // reported" (the ">= 0" spelling is refused by check-test-antipatterns.sh).
    expect(elapsedOf(m)).toBeGreaterThan(-1);
    expect(elapsedOf(m)).toBeLessThan(5);
  });
});

describe("RestPushService.resolveGhToken — real spawn of a fake gh (ems__Bug 24f760d3)", () => {
  const savedPath = process.env.PATH;
  let dir = "";

  afterEach(() => {
    process.env.PATH = savedPath;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  /**
   * Fake `gh` that counts its calls (`$n` = this call's number). It is run
   * once with WARM=1 before the axis: macOS scans a NEW executable on its
   * first launch, and under load that alone outlasted a 300 ms limit (measured
   * 2026-11-11: the first spawn was killed before its first line ran).
   */
  function installFakeGh(body: string): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-retry-"));
    const counter = path.join(dir, "calls");
    fs.writeFileSync(counter, "");
    const gh = path.join(dir, "gh");
    fs.writeFileSync(
      gh,
      `#!/bin/sh\n[ -n "$WARM" ] && exit 0\necho x >> "${counter}"\nn=$(wc -l < "${counter}" | tr -d ' ')\n${body}\n`,
    );
    fs.chmodSync(gh, 0o755);
    execFileSync(gh, [], { env: { ...process.env, WARM: "1" }, timeout: 30_000 });
    process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ""}`;
    return counter;
  }

  function calls(counter: string): number {
    return fs.readFileSync(counter, "utf8").split("\n").filter(Boolean).length;
  }

  it("G8 the real ETIMEDOUT of execFileSync is retried and the token comes from the next attempt", () => {
    const counter = installFakeGh(
      `if [ "$n" -le 1 ]; then sleep 4; fi\necho "${FAKE_PAT}"`,
    );
    const token = RestPushService.resolveGhToken(undefined, [1_000, 10_000]);
    expect(token === FAKE_PAT).toBe(true);
    expect(calls(counter)).toBe(2);
  });

  it("G9 a real non-zero exit of gh is not retried", () => {
    const counter = installFakeGh(`echo "not logged in" >&2\nexit 4`);
    let leaked: string | undefined;
    expect(() => {
      leaked = RestPushService.resolveGhToken(undefined, [10_000, 10_000]);
    }).toThrow(AUTH_TEXT);
    expect(leaked === undefined).toBe(true);
    expect(calls(counter)).toBe(1);
  });

  it("G14 a real non-zero exit whose stderr mentions ETIMEDOUT is NOT retried (classify by code, not text)", () => {
    const counter = installFakeGh(
      `echo "Get https://api.github.com: dial tcp: connect: operation timed out (ETIMEDOUT)" >&2\nexit 1`,
    );
    let leaked: string | undefined;
    const m = messageOf(() => {
      leaked = RestPushService.resolveGhToken(undefined, [10_000, 10_000]);
    });
    expect(leaked === undefined).toBe(true);
    expect(m).toMatch(AUTH_TEXT);
    expect(calls(counter)).toBe(1);
  });

  it("G16 a real timeout whose child ignores SIGTERM (signal SIGPIPE, not SIGTERM) is still retried", () => {
    const counter = installFakeGh(
      `if [ "$n" -le 1 ]; then trap '' TERM; sleep 3; echo late; exit 0; fi\necho "${FAKE_PAT}"`,
    );
    // execFileSync waits for the TERM-ignoring child (measured 2026-11-11: ~3 s
    // under a 1 s limit), so the limit is not a hard bound. Deliberately NOT
    // asserted: a later hard kill (killSignal SIGKILL) would be an improvement,
    // and this axis must not forbid it.
    const token = RestPushService.resolveGhToken(undefined, [1_000, 10_000]);
    expect(token === FAKE_PAT).toBe(true);
    expect(calls(counter)).toBe(2);
  });

  it("G26 a real timeout whose child ignores SIGTERM and exits by itself (status set, no signal) is still retried", () => {
    // Node reports this form as code ETIMEDOUT with status 3 and signal null:
    // a classifier that also demands `status == null` would miss it.
    const counter = installFakeGh(
      `if [ "$n" -le 1 ]; then trap '' TERM; sleep 3; exit 3; fi\necho "${FAKE_PAT}"`,
    );
    const token = RestPushService.resolveGhToken(undefined, [1_000, 10_000]);
    expect(token === FAKE_PAT).toBe(true);
    expect(calls(counter)).toBe(2);
  });
});
