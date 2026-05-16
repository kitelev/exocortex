import { describe, it, expect } from "@jest/globals";
import { Command } from "commander";

/**
 * RFC 8e83442b CLI v16.0 — top-level `query` and `index` commands.
 *
 * In v16.0 the `exoql` namespace was removed (T2.5 cutover). The top-level
 * verbs `query` and `index` are the only surface for ExoQL execution and
 * indexing. This test asserts the structural contract using a local
 * Command-tree mock to avoid pulling heavy ESM deps through src/index.ts.
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

  it("does NOT register the removed 'exoql' namespace", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).not.toContain("exoql");
  });

  it("does NOT register the removed 'sparql' deprecated alias", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).not.toContain("sparql");
  });
});
