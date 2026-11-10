/**
 * @jest-environment node
 *
 * ems__Bug 24f760d3 — G21: the DEFAULT runner of `resolveGhToken` hands
 * `execFileSync` exactly `gh auth token`, each PRODUCTION limit uncapped
 * (15 s, 30 s, 60 s) and `env: process.env`. Nothing is spawned:
 * `node:child_process` is replaced before the subject is imported. The
 * real-spawn axes cannot see a cap (their limits are ≤ 10 s) and must not run
 * without the `env` line (they would reach the user's real gh), so this
 * wiring is locked here.
 */
import { describe, it, expect, jest } from "@jest/globals";

type Call = { file: string; args: string[]; opts: Record<string, unknown> };
const calls: Call[] = [];

jest.unstable_mockModule("node:child_process", () => ({
  execFileSync: (file: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ file, args, opts });
    throw Object.assign(new Error("spawnSync gh ETIMEDOUT"), {
      code: "ETIMEDOUT",
      errno: -60,
      signal: "SIGTERM",
      status: null,
    });
  },
}));

describe("RestPushService.resolveGhToken — default runner wiring (ems__Bug 24f760d3)", () => {
  it("G21 the default runner passes each production limit uncapped, with process.env", async () => {
    const { RestPushService } = await import("../../../src/services/RestPushService");
    expect(() => RestPushService.resolveGhToken()).toThrow(/timed out \(ETIMEDOUT\)/);
    expect(calls.map((c) => c.opts.timeout)).toEqual([15_000, 30_000, 60_000]);
    expect(calls.every((c) => c.file === "gh" && c.args.join(" ") === "auth token")).toBe(true);
    expect(calls.every((c) => c.opts.env === process.env)).toBe(true);
  });
});
