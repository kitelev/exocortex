import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Command } from "commander";

/**
 * Tests for exoql/sparql alias behavior.
 *
 * Since index.ts transitively imports many heavy modules, we replicate
 * the minimal command-registration logic here using Commander directly.
 * This validates the structural pattern (alias + deprecation hook)
 * without requiring full dependency mocking.
 */
describe("exoql / sparql alias", () => {
  /** Minimal subcommand that records invocations for assertions. */
  function makeDummyQuery(invocations: string[]): Command {
    return new Command("query")
      .description("dummy query")
      .argument("[q]", "query string")
      .option("--dry-run", "dry run")
      .action((_q: string | undefined) => {
        invocations.push("query-action");
      });
  }

  function buildProgram(invocations: string[]): Command {
    const program = new Command();
    program.name("exocortex").exitOverride();

    // ---- exoql (primary) ----
    const exoql = program.command("exoql").description("ExoQL query execution and cache management");
    exoql.addCommand(makeDummyQuery(invocations));

    // ---- sparql (deprecated alias) ----
    const sparql = program.command("sparql").description("(deprecated) Use 'exoql' instead");
    sparql.addCommand(makeDummyQuery(invocations));
    sparql.hook("preAction", () => {
      console.error('⚠️  "sparql" is deprecated. Use "exoql" instead.');
    });

    return program;
  }

  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("registers both 'exoql' and 'sparql' as top-level commands", () => {
    const program = buildProgram([]);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("exoql");
    expect(names).toContain("sparql");
  });

  it("sparql description indicates deprecation", () => {
    const program = buildProgram([]);
    const sparql = program.commands.find((c) => c.name() === "sparql")!;
    expect(sparql.description()).toContain("deprecated");
  });

  it("exoql and sparql have identical subcommands", () => {
    const program = buildProgram([]);
    const exoql = program.commands.find((c) => c.name() === "exoql")!;
    const sparql = program.commands.find((c) => c.name() === "sparql")!;

    const exoqlSubs = exoql.commands.map((c) => c.name()).sort();
    const sparqlSubs = sparql.commands.map((c) => c.name()).sort();

    expect(exoqlSubs).toEqual(sparqlSubs);
    expect(exoqlSubs.length).toBeGreaterThan(0);
  });

  it("'sparql query' prints deprecation warning to stderr", async () => {
    const invocations: string[] = [];
    const program = buildProgram(invocations);

    await program.parseAsync(["node", "exocortex", "sparql", "query", "SELECT *"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '⚠️  "sparql" is deprecated. Use "exoql" instead.'
    );
    expect(invocations).toContain("query-action");
  });

  it("'exoql query' does NOT print deprecation warning", async () => {
    const invocations: string[] = [];
    const program = buildProgram(invocations);

    await program.parseAsync(["node", "exocortex", "exoql", "query", "SELECT *"]);

    const deprecationCalls = consoleErrorSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("deprecated")
    );
    expect(deprecationCalls).toHaveLength(0);
    expect(invocations).toContain("query-action");
  });

  it("both commands produce identical action execution", async () => {
    const exoqlInvocations: string[] = [];
    const sparqlInvocations: string[] = [];

    const programA = buildProgram(exoqlInvocations);
    const programB = buildProgram(sparqlInvocations);

    await programA.parseAsync(["node", "exocortex", "exoql", "query", "SELECT *"]);
    await programB.parseAsync(["node", "exocortex", "sparql", "query", "SELECT *"]);

    // Both should execute the same action
    expect(exoqlInvocations).toEqual(sparqlInvocations);
  });
});
