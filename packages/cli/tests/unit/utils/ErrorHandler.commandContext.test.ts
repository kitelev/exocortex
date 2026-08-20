import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ErrorHandler } from "../../../src/utils/ErrorHandler";

/**
 * An error must say WHICH command produced it.
 * @req:a6dc3074-601c-4610-b23d-f36e44efcc4a
 *
 * ⛔ `ErrorHandler.handle(error: Error): never` took ONE argument, and five
 * ExoSync call sites passed a second — `{ command: "exosync-parity" }` and
 * friends. The argument was silently discarded, so a failure in a 24-repo sync
 * round did not name the command that produced it: exactly the information
 * wanted at that moment.
 *
 * ⛤ The code STATED an intent it did not deliver, which is worse than having no
 * context at all: five call sites look like working plumbing, so the next author
 * copies the shape and adds a sixth dead one.
 *
 * The compiler never objected because packages/cli/src is type-checked nowhere
 * — the root tsconfig excludes it and esbuild does not check types. Surfaced by
 * the ratchet in #4074 (issue #4075, defect 3).
 *
 * ⛤ The last two axes are CANARIES for the ~40 call sites that pass NO context.
 * Widening a shared signature is exactly the change that can move output for
 * everyone; those axes pin that it does not.
 */
describe("ErrorHandler — command context", () => {
  // ⛔ NOT `jest.SpyInstance` — that member does not exist in this jest's types
  // (TS2694). The neighbouring ErrorHandler.test.ts uses it and passes only
  // because its errors are grandfathered into the check-test-types baseline;
  // copying the shape from a file whose debt is FROZEN reproduces the debt in a
  // file that has none. Deriving the type from the factory keeps it honest and
  // moves with jest.
  const spyOnConsole = (method: "error" | "log") =>
    jest.spyOn(console, method).mockImplementation(() => {});

  let consoleErrorSpy: ReturnType<typeof spyOnConsole>;
  let consoleLogSpy: ReturnType<typeof spyOnConsole>;
  // Same factory trick: `jest.spyOn` is overloaded, so naming its return type
  // directly does not resolve (TS2344/TS2635). Deriving it from a call does.
  const spyOnExit = () =>
    jest.spyOn(process, "exit").mockImplementation(((
      code?: string | number | null
    ): never => {
      // The real signature is (code?: string | number | null); narrowing it to
      // number is what TS2345 was reporting.
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

  let processExitSpy: ReturnType<typeof spyOnExit>;

  beforeEach(() => {
    consoleErrorSpy = spyOnConsole("error");
    consoleLogSpy = spyOnConsole("log");
    processExitSpy = spyOnExit();
    ErrorHandler.setFormat("text");
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  /** Every string this call printed to stderr, joined. */
  function stderrOf(fn: () => void): string {
    try {
      fn();
    } catch {
      // process.exit is mocked to throw
    }
    return consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  }

  /** The parsed JSON object this call printed to stdout. */
  function jsonOf(fn: () => void): Record<string, unknown> {
    try {
      fn();
    } catch {
      // process.exit is mocked to throw
    }
    const raw = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("text output names the command", () => {
    const out = stderrOf(() =>
      ErrorHandler.handle(new Error("remote rejected"), {
        command: "exosync push",
      })
    );

    // ⛔ Before the fix the context was dropped and this said only
    //    "❌ Error: remote rejected".
    expect(out).toContain("exosync push");
    expect(out).toContain("remote rejected");
  });

  it("json output carries the command in a field, not glued into the message", () => {
    ErrorHandler.setFormat("json");

    const obj = jsonOf(() =>
      ErrorHandler.handle(new Error("remote rejected"), {
        command: "exosync quarantine list",
      })
    );

    // Consumers parse this object; the command belongs in its own field so the
    // message stays comparable across runs.
    expect(JSON.stringify(obj)).toContain("exosync quarantine list");
  });

  it("keeps distinct commands distinct", () => {
    // A single-command axis would pass against a fix that hardcoded any string.
    const a = stderrOf(() =>
      ErrorHandler.handle(new Error("x"), { command: "exosync-parity" })
    );
    consoleErrorSpy.mockClear();
    const b = stderrOf(() =>
      ErrorHandler.handle(new Error("x"), { command: "exosync dedup-uids" })
    );

    expect(a).toContain("exosync-parity");
    expect(b).toContain("exosync dedup-uids");
    expect(a).not.toContain("dedup-uids");
  });

  it("CANARY: text output without context is unchanged", () => {
    // Green in BOTH states — ~40 call sites pass no context and must not move.
    const out = stderrOf(() => ErrorHandler.handle(new Error("plain failure")));

    expect(out).toContain("❌ Error: plain failure");
  });

  it("CANARY: json output without context keeps its existing shape", () => {
    ErrorHandler.setFormat("json");

    const obj = jsonOf(() => ErrorHandler.handle(new Error("plain failure")));

    expect(obj).toHaveProperty("success", false);
    expect(JSON.stringify(obj)).toContain("plain failure");
  });
});
