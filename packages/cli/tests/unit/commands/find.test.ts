import { describe, it, expect } from "@jest/globals";
import { findCommand } from "../../../src/commands/find.js";

describe("CLI v16 — find command (RFC 8e83442b T1.1)", () => {
  it("registers as a Commander command named 'find'", () => {
    const cmd = findCommand();
    expect(cmd.name()).toBe("find");
  });

  it("declares the --sparql option", () => {
    const cmd = findCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--sparql");
  });

  it("declares the --vault option", () => {
    const cmd = findCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--vault");
  });

  it("declares the repeatable --also option", () => {
    const cmd = findCommand();
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--also");
  });

  it("has a description mentioning SPARQL", () => {
    const cmd = findCommand();
    expect(cmd.description().toLowerCase()).toContain("sparql");
  });
});
