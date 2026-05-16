/**
 * Integration test for `exocortex find --class <value>` (RFC 8e83442b T1.10 / onto-RFC 245b8493).
 *
 * Mocks a tiny vault containing:
 *   - a `find__Alias` instance with exo:Asset_label "class" and a sparql fragment
 *     that resolves `?path` via `exo:Instance_class` → target class label
 *   - the `ems__Task` class asset (exo:Asset_label "ems__Task")
 *   - a task instance pointing at that class
 *
 * Verifies that running the find command with `--class ems__Task` produces
 * the task instance's vault-relative path on stdout.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { findCommand } from "../../src/commands/find.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = resolve(__dirname, "../fixtures/find-class-alias");

describe("CLI v16 — find --class (T1.10, alias-driven)", () => {
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let captured: string;
  let capturedErr: string;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    captured = "";
    capturedErr = "";
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        return true;
      });
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        capturedErr +=
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        return true;
      });
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("resolves --class via find__Alias and emits the matching path", async () => {
    const cmd = findCommand();
    await cmd.parseAsync(
      ["--vault", FIXTURE_VAULT, "--class", "ems__Task"],
      { from: "user" },
    );

    if (capturedErr.includes("Error")) {
      throw new Error(`find command emitted error: ${capturedErr}`);
    }
    const lines = captured.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(
      lines.some((l) => l.includes("bbbbbbbb-0000-0000-0000-000000000001")),
    ).toBe(true);
  }, 30_000);

  it("declares the --class option", () => {
    const cmd = findCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--class");
  });
});
