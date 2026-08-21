/**
 * @file The refusal SENTENCE is rendered against the live vault — wiring axis.
 *
 * The unit axes next door (`guardedRouteResolution.test.ts`) lock what
 * `renderGuardedRouteResolved` DOES. They cannot lock that the two mutation
 * primitives actually CALL it: revert the wiring in `set-property.ts` back to
 * the unfiltered `GUARDED_PROPERTIES` string and every one of them stays green,
 * because they never go through the command.
 *
 * ⛤ So this file drives the real command against a real temp vault, and asserts
 * on what a user would read. Same shape as the sibling name-validation
 * integration test, and for the same reason: the guarantee is about the sentence
 * the command prints, not about a helper's return value.
 *
 * req 72419d3c-b425-4a0e-ad42-346853efc9cf · issue #4103
 */
import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";

const { setPropertyCommand } =
  await import("../../src/commands/set-property.js");
const { removePropertyCommand } =
  await import("../../src/commands/remove-property.js");

// `@req:${REQ}` in an it() title is not statically resolvable, so the binding is
// declared as a literal here too (archgate REQ-001, same as the sibling file).
const REQ = "72419d3c-b425-4a0e-ad42-346853efc9cf";

const TARGET_REL = "assetspaces/kitelev/exoas-my/my/target.md";

/** A vault holding ONE real command asset — `mark-done` resolves, the rest do not. */
function buildVault(vault: string, withCommands: boolean): void {
  const target = path.join(vault, TARGET_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      "---",
      "exo__Asset_uid: cafe0000-0000-0000-0000-000000000001",
      "exo__Asset_label: target",
      'ems__Effort_status: "[[753a44d5-846c-4b82-9196-4fd9a4d48777]]"',
      // ⛤ req 148ce5a4: the remove-side axis below needs a property that HAS a
      // clearing command — `ems__Effort_status` no longer renders a route at all
      // (all five of its commands set a value). `endTimestamp` is cleared by
      // `re-open`, so it still exercises the live-registry filter this file locks.
      "ems__Effort_endTimestamp: 2026-08-21T10:00:00",
      "---",
      "",
    ].join("\n"),
    "utf-8",
  );
  if (!withCommands) return;

  const cmdDir = path.join(vault, "assetspaces/kitelev/exoas-exocmd/exocmd");
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const name of ["mark-done", "re-open"]) {
    fs.writeFileSync(
      path.join(cmdDir, `${name}.md`),
      ["---", `exocmd__Command_cliName: ${name}`, "---", ""].join("\n"),
      "utf-8",
    );
  }
}

describe("guarded-route resolution reaches the user @req:72419d3c-b425-4a0e-ad42-346853efc9cf", () => {
  let vault: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let exitSpy: ReturnType<typeof jest.spyOn>;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let stdoutSpy: ReturnType<typeof jest.spyOn>;
  let stderrSpy: ReturnType<typeof jest.spyOn>;

  const spies = (): void => {
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
  };

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  const stderrText = (): string => errorSpy.mock.calls.flat().join("\n");

  it(`set-property names ONLY the resolving command @req:${REQ}`, async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-guardres-"));
    buildVault(vault, true);
    spies();

    await setPropertyCommand().parseAsync(
      [
        TARGET_REL,
        "--property",
        "ems__Effort_status",
        "--value",
        "x",
        "--vault",
        vault,
      ],
      { from: "user" },
    );

    const out = stderrText();
    expect(out).toContain("dedicated guarded command");
    expect(out).toContain("mark-done");
    // These are real names in the routing table but absent from THIS vault, so
    // offering them would be the very defect: a path `apply` cannot resolve.
    expect(out).not.toContain("move-to-backlog");
    expect(out).not.toContain("start-effort");
  });

  it(`remove-property is wired the same way @req:${REQ}`, async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-guardres-"));
    buildVault(vault, true);
    spies();

    await removePropertyCommand().parseAsync(
      [TARGET_REL, "--property", "ems__Effort_endTimestamp", "--vault", vault],
      { from: "user" },
    );

    const out = stderrText();
    // `re-open` clears the property AND resolves in this vault → it is offered.
    expect(out).toContain("re-open");
    // `mark-done` resolves here too, but it SETS the property — the narrowed
    // route withholds it (req 148ce5a4). Both filters are exercised at once.
    expect(out).not.toContain("mark-done");
  });

  it(`⛔ an UNMOUNTED registry keeps today's full sentence — fail-open @req:${REQ}`, async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-guardres-"));
    buildVault(vault, false); // no exocmd assetspace at all
    spies();

    await setPropertyCommand().parseAsync(
      [
        TARGET_REL,
        "--property",
        "ems__Effort_status",
        "--value",
        "x",
        "--vault",
        vault,
      ],
      { from: "user" },
    );

    const out = stderrText();
    expect(out).toContain("dedicated guarded command");
    // Every listed name is still offered — a partial mount must not turn a
    // correct refusal into a false or empty one.
    expect(out).toContain("mark-done");
    expect(out).toContain("move-to-backlog");
    expect(out).toContain("start-effort");
  });
});
