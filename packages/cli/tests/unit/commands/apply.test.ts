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

  it("declares --dry-run, --yes, --input, --vault options", () => {
    const cmd = applyCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--dry-run");
    expect(opts).toContain("--yes");
    expect(opts).toContain("--input");
    expect(opts).toContain("--vault");
  });

  it("description mentions exocmd__Command", () => {
    const cmd = applyCommand();
    expect(cmd.description()).toContain("exocmd__Command");
  });
});
