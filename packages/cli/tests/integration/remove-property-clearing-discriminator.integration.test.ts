/**
 * @file `remove-property` distinguishes guarded properties by whether a CLEARING
 * command exists — and only where none does is an audited `--force` accepted.
 *
 * ⛤ Why integration and not unit: the guarantee is about the sentence the user
 * reads and the file on disk. `clearingRouteFor` can be perfectly correct while
 * the command still routes both cases through the old branch — reverting the
 * wiring in `remove-property.ts` leaves every unit axis green, because none of
 * them goes through the command.
 *
 * ⛔ The bearing pair is A1 (clearing command EXISTS → refuse, name it) against
 * A5 (`--force` on that same property → still refused). Without A5 the flag
 * would be a universal repeal of the guard rather than a widening of it.
 *
 * req 148ce5a4-f9b8-4544-9897-e5bd9755981a
 */
import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

const { removePropertyCommand } =
  await import("../../src/commands/remove-property.js");

const REQ = "148ce5a4-f9b8-4544-9897-e5bd9755981a";
const TARGET_REL = "assetspaces/kitelev/exoas-my/my/target.md";

/** A vault whose target carries BOTH a no-clearing property and a clearable one. */
function buildVault(vault: string): void {
  const target = path.join(vault, TARGET_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      "---",
      "exo__Asset_uid: cafe0000-0000-0000-0000-0000000000c1",
      "exo__Asset_label: target",
      'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
      "ems__Effort_endTimestamp: 2026-08-21T10:00:00",
      "---",
      "",
    ].join("\n"),
    "utf-8",
  );
  // `re-open` clears endTimestamp; it must RESOLVE for the route to be offered.
  const cmdDir = path.join(vault, "assetspaces/kitelev/exoas-exocmd/exocmd");
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const name of ["re-open", "mark-done"]) {
    fs.writeFileSync(
      path.join(cmdDir, `${name}.md`),
      ["---", `exocmd__Command_cliName: ${name}`, "---", ""].join("\n"),
      "utf-8",
    );
  }
}

describe(`remove-property clearing discriminator @req:${REQ}`, () => {
  let vault: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-clearing-"));
    buildVault(vault);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never) as never);
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((() => true) as never);
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  const stderrText = (): string => errorSpy.mock.calls.flat().join("\n");
  const frontmatter = (): string =>
    fs.readFileSync(path.join(vault, TARGET_REL), "utf-8");

  const run = async (...extra: string[]): Promise<void> => {
    await removePropertyCommand().parseAsync(
      [TARGET_REL, "--vault", vault, ...extra],
      { from: "user" },
    );
  };

  it(`A1 clearing command exists → refuse naming ONLY the clearer @req:${REQ}`, async () => {
    await run("--property", "ems__Effort_endTimestamp");
    const out = stderrText();
    expect(out).toContain("dedicated guarded command");
    expect(out).toContain("re-open");
    // `mark-done` owns the property but SETS it — naming it answers a question
    // the user did not ask and reads as a path that does not remove anything.
    expect(out).not.toContain("mark-done");
    expect(frontmatter()).toContain("ems__Effort_endTimestamp");
  });

  it(`A2 no clearing command → refusal says so and offers --force @req:${REQ}`, async () => {
    await run("--property", "ems__Effort_status");
    const out = stderrText();
    expect(out).toContain("no dedicated command clears it");
    expect(out).toContain("--force");
    expect(out).toContain("--reason");
    // ⛔ The setters must NOT be offered: they cannot remove the key.
    expect(out).not.toContain("move-to-backlog");
    expect(frontmatter()).toContain("ems__Effort_status");
  });

  it(`A3 --force without --reason is refused @req:${REQ}`, async () => {
    await run("--property", "ems__Effort_status", "--force");
    expect(stderrText()).toContain("no dedicated command clears it");
    expect(frontmatter()).toContain("ems__Effort_status");
  });

  it(`A4 --force --reason removes it and records the reason @req:${REQ}`, async () => {
    await run(
      "--property",
      "ems__Effort_status",
      "--force",
      "--reason",
      "facet moved to 7db5eeff",
      "--yes",
    );
    const fm = frontmatter();
    expect(fm).not.toContain("ems__Effort_status");
    expect(fm).toContain("exo__Asset_updatedAt");
    const out = stderrText();
    expect(out).toContain("guard-bypass");
    expect(out).toContain("facet moved to 7db5eeff");
  });

  it(`A5 --force does NOT override a property that HAS a clearer @req:${REQ}`, async () => {
    await run(
      "--property",
      "ems__Effort_endTimestamp",
      "--force",
      "--reason",
      "I want to",
      "--yes",
    );
    const out = stderrText();
    expect(out).toContain("dedicated guarded command");
    expect(out).toContain("re-open");
    expect(frontmatter()).toContain("ems__Effort_endTimestamp");
  });
});
