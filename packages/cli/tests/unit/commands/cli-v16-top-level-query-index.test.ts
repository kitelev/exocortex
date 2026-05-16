import { describe, it, expect } from "@jest/globals";
import { Command } from "commander";

/**
 * RFC 8e83442b CLI v16.0 — T1.7/T1.8: top-level `query` and `index` commands
 * registered alongside the existing `exoql` namespace.
 *
 * Like exoql-alias.test.ts, this replicates the structural registration
 * pattern locally to avoid pulling in heavy ESM deps (ora, etc.) through
 * src/index.ts. Validates the command surface contract documented in the
 * RFC — both top-level aliases coexist with the `exoql` namespace until
 * T2.5 removes it.
 */
describe("CLI v16 — top-level query/index commands", () => {
  function makeDummyQuery(): Command {
    return new Command("query").description("ExoQL query — dummy").action(() => {});
  }
  function makeDummyIndex(): Command {
    return new Command("index").description("ExoQL index — dummy").action(() => {});
  }

  function buildProgram(): Command {
    const program = new Command();
    program.name("exocortex");

    const exoql = program.command("exoql").description("ExoQL query execution and cache management");
    exoql.addCommand(makeDummyQuery());
    exoql.addCommand(makeDummyIndex());

    // T1.7 / T1.8 additive top-level aliases
    program.addCommand(makeDummyQuery());
    program.addCommand(makeDummyIndex());

    return program;
  }

  it("registers 'query' as a top-level command", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("query");
  });

  it("registers 'index' as a top-level command", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("index");
  });

  it("keeps the 'exoql' namespace alongside the new top-level commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("exoql");

    const exoql = program.commands.find((c) => c.name() === "exoql")!;
    const subs = exoql.commands.map((c) => c.name());
    expect(subs).toContain("query");
    expect(subs).toContain("index");
  });

  it("top-level 'query' is structurally distinct from 'exoql query' (independent Command instance)", () => {
    const program = buildProgram();
    const topQuery = program.commands.find((c) => c.name() === "query")!;
    const exoql = program.commands.find((c) => c.name() === "exoql")!;
    const exoqlQuery = exoql.commands.find((c) => c.name() === "query")!;
    expect(topQuery).not.toBe(exoqlQuery);
    expect(topQuery.description()).toBe(exoqlQuery.description());
  });

  it("top-level 'index' is structurally distinct from 'exoql index'", () => {
    const program = buildProgram();
    const topIndex = program.commands.find((c) => c.name() === "index")!;
    const exoql = program.commands.find((c) => c.name() === "exoql")!;
    const exoqlIndex = exoql.commands.find((c) => c.name() === "index")!;
    expect(topIndex).not.toBe(exoqlIndex);
    expect(topIndex.description()).toBe(exoqlIndex.description());
  });
});
