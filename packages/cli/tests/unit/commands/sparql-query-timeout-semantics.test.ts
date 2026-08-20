import { describe, it, expect } from "@jest/globals";
import { ExoQLQueryExecutor } from "@kitelev/exocortex-core";
import { executeWithTimeout } from "../../../src/commands/sparql-query";

/**
 * What the query timeout IS, and what it is not.
 *
 * ⛔ `sparql-query.ts` carried
 *
 *     if (typeof executor.setTimeout === "function") { executor.setTimeout(ms); }
 *
 * around a method `ExoQLQueryExecutor` does not have. A permanently-false
 * `typeof` guard is worse than either alternative: it reads as "supported when
 * available" while being dead, so nobody goes looking for the missing
 * capability. Removed in favour of stating the truth (#4075, defect 2).
 *
 * ⛤ These axes exist because the 31 tests in sparql-query-timeout.test.ts cover
 * only PARSING (`--timeout 30s`, env var, invalid formats) — not one of them
 * asserts that a timeout ever fires. Deleting the branch would therefore have
 * been unguarded: the suite could not tell a working timeout from none at all.
 *
 * The distinction they pin is the one the deleted branch blurred:
 *   - wall-clock timeout: the CALLER stops waiting.       ← what exists
 *   - cooperative cancellation: the QUERY stops running.  ← what does not
 */
describe("sparql-query — timeout semantics (#4075 defect 2)", () => {
  it("the executor has no setTimeout — the removed guard was permanently false", () => {
    const executor = new ExoQLQueryExecutor({
      // Minimal store stand-in: the axis is about the executor's SHAPE, and
      // constructing it is all that is needed to ask about the member.
      match: () => [],
      add: () => {},
      size: () => 0,
    } as never);

    expect(
      (executor as unknown as Record<string, unknown>).setTimeout
    ).toBeUndefined();
  });

  it("rejects when the query outlives the budget", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5_000));

    await expect(executeWithTimeout(slow, 20, Date.now())).rejects.toThrow();
  });

  it("the timeout error names the budget", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5_000));

    // The message is what a user sees when a query gives up; it has to say WHAT
    // the budget was, not merely that something timed out.
    //
    // ⛤ The budget here is 1000ms, not the 20ms the neighbouring axes use, and
    // deliberately so: the message renders SECONDS, so any sub-second budget
    // prints "limit: 0s" and this axis would assert against a rounded-away
    // value. That rounding is a real (if cosmetic) gap in the message, but it
    // is NOT this change's subject — widening the axis to cover it would be
    // scope creep, and silently asserting on "0s" would be worse: it would
    // freeze the rounding as intended behaviour.
    await expect(executeWithTimeout(slow, 1000, Date.now())).rejects.toThrow(
      /limit: 1s/
    );
  });

  it("⛔ does NOT cancel the query — it only stops waiting for it", async () => {
    // This is the honest limitation the deleted branch pretended to address.
    // If cooperative cancellation is ever implemented, THIS axis is the one
    // that must be rewritten — which is the point of stating it.
    let settled = false;
    const slow = new Promise((resolve) =>
      setTimeout(() => {
        settled = true;
        resolve(undefined);
      }, 60)
    );

    await expect(executeWithTimeout(slow, 20, Date.now())).rejects.toThrow();
    expect(settled).toBe(false); // still running at the moment we gave up

    await new Promise((r) => setTimeout(r, 80));
    expect(settled).toBe(true); // it ran to completion regardless
  });

  it("CANARY: a query inside the budget resolves normally", async () => {
    // Green in both states — pins that the wrapper is not simply always
    // rejecting, which every axis above would tolerate.
    const fast = Promise.resolve("ok");

    await expect(executeWithTimeout(fast, 5_000, Date.now())).resolves.toBe("ok");
  });
});
