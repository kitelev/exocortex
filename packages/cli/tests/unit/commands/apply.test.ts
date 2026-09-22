import { describe, it, expect } from "@jest/globals";
import { applyCommand } from "../../../src/commands/apply.js";

describe("CLI v16 — apply command (RFC 8e83442b T1.2)", () => {
  it("registers as a Commander command named 'apply'", () => {
    const cmd = applyCommand();
    expect(cmd.name()).toBe("apply");
  });

  it("declares two positional arguments: <cmd> and [path]", () => {
    const cmd = applyCommand();
    // Commander stores registered args on `registeredArguments` (modern commander)
    // or accessible via `.args` after parsing. Inspect _args / registeredArguments.
    const args =
      (cmd as unknown as { registeredArguments?: Array<{ name(): string; required: boolean }> })
        .registeredArguments ?? [];
    expect(args.length).toBe(2);
    expect(args[0].name()).toBe("cmd");
    expect(args[0].required).toBe(true);
    expect(args[1].name()).toBe("path");
    expect(args[1].required).toBe(false);
  });

  it("B9 --input help states the asset-reference contract: BARE uid, a copied [[uid]] is accepted and unwrapped @req:b06129dc-a6da-40d1-90b5-1789fb927a63", () => {
    // req b06129dc (ticket 52199c53): set-parent / set-blocker take the
    // reference through `$input.<key>`; the help is the only place a CLI user
    // learns that `[[uid]]` (the form copied from another frontmatter) is
    // unwrapped rather than double-wrapped. Dropping the sentence makes this RED.
    const cmd = applyCommand();
    const input = cmd.options.find((o) => o.long === "--input");
    expect(input).toBeDefined();
    expect(input!.description).toMatch(/set-parent: --input '\{"parent":"<uid>"\}'/);
    expect(input!.description).toMatch(/BARE uid/);
    expect(input!.description).toMatch(/\[\[uid\]\].*accepted and unwrapped/);
  });

  it("declares --dry-run, --yes, --input, --vault options", () => {
    const cmd = applyCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--dry-run");
    expect(opts).toContain("--yes");
    expect(opts).toContain("--input");
    expect(opts).toContain("--vault");
  });

  it("declares --seed and --frozen-clock determinism options (Phase 0 Task 0.3)", () => {
    const cmd = applyCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--seed");
    expect(opts).toContain("--frozen-clock");
  });

  it("--help text describes --seed and --frozen-clock", () => {
    const cmd = applyCommand();
    const help = cmd.helpInformation();
    expect(help).toMatch(/--seed <uuid>/);
    expect(help).toMatch(/Deterministic UID seed/);
    expect(help).toMatch(/--frozen-clock <iso>/);
    expect(help).toMatch(/Freeze clock to ISO timestamp/);
  });

  it("description mentions exocmd__Command", () => {
    const cmd = applyCommand();
    expect(cmd.description()).toContain("exocmd__Command");
  });

  // Issue #4230 — the --input example for set-label named the `value` key, but the
  // "Set label composite (#3779)" grounding declares inputSchema required ["label"],
  // so a call copied from --help is refused (rc=5). Commander word-wraps the option
  // description, so the help text is whitespace-normalised before matching.
  it("--help names the set-label input key as `label`, not `value` (#4230)", () => {
    const help = applyCommand().helpInformation().replace(/\s+/g, " ");
    expect(help).toContain(`set-label: --input '{"label":"New label"}'`);
    expect(help).not.toContain(`set-label: --input '{"value"`);
  });

  // The neighbouring examples were verified against their own groundings in the same
  // sweep (all four declare the key the help already prints), so they are locked too —
  // a future edit that "unifies" them onto one key must fail here.
  it("--help keeps the value-key examples that match their groundings (#4230)", () => {
    const help = applyCommand().helpInformation().replace(/\s+/g, " ");
    expect(help).toContain(
      `set-planned-start / set-scheduled-date: --input '{"value":"<ISO>"}'`,
    );
    expect(help).toContain(`set-parent: --input '{"parent":"<uid>"}'`);
    expect(help).toContain(`set-blocker: --input '{"blocker":"<uid>"}'`);
  });
});
