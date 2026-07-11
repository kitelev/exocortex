/**
 * req 2678df55 — CLI `run-query <uid>` (read-side NamedQuery verb) + homoiconic
 * `classes`/`describe-class` (introspection SPARQL read from vault
 * query__NamedQuery assets, not hardcode).
 *
 * Production-shape: a real temp vault (class instances + canonical query assets)
 * is hydrated through the REAL pipeline —
 *   FileSystemVaultAdapter → NoteToRDFConverter → InMemoryTripleStore →
 *   FsQueryBodyResolver → NamedQueryRunner
 * — and driven through the actual `runQueryCommand()` / `classesCommand()`
 * commander actions (no stubs). Assertions read captured stdout / the runner's
 * SELECT rows.
 *
 * Revert-verify (documented in the PR body):
 *  • run-query executes the vault body — a query asset's ```sparql body drives
 *    the printed result; different bodies → different output.
 *  • classes reads from vault, NOT hardcode — the canonical class-list asset
 *    carries a distinctive FILTER that excludes one class; `classes` omits it.
 *    Reverting `classes` to the old hardcoded (unfiltered) SPARQL makes the
 *    excluded class reappear → RED. Editing the fixture body flips WHICH class
 *    is omitted, proving the output is vault-driven.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  InMemoryTripleStore,
  NoteToRDFConverter,
} from "@kitelev/exocortex-core";

const { runQueryCommand } = await import("../../src/commands/run-query.js");
const { classesCommand } = await import("../../src/commands/classes.js");
const { buildNamedQueryRunner } = await import(
  "../../src/services/NamedQueryCliRunner.js"
);
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

const REQ = "2678df55-ef74-4b45-a168-90db5e958882";

// Canonical introspection UIDs (must match classes.ts constants).
const LIST_UID = "b6aa1da9-96b9-4066-99a9-f81cc8b316aa";
const COUNT_UID = "5ba1031d-2c6e-4528-ab81-fb768d8e061a";
const PROPS_UID = "efb7bb79-6378-44b0-b1ca-9a27e3eeb684";
// Test-local NamedQuery assets exercising the other run-query shapes.
const ASK_UID = "a5000000-0000-4000-8000-0000000000a1";
const CONSTRUCT_UID = "c5000000-0000-4000-8000-0000000000c1";
const CURRENT_UID = "ca000000-0000-4000-8000-0000000000a1";
const WIDGET1_UID = "11111111-0000-4000-8000-000000000001";

const RDF_PREFIX = "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>";

function instanceMd(uid: string, className: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    "exo__Instance_class:",
    `  - "[[${className}]]"`,
    "---",
    `# ${uid}`,
    "",
  ].join("\n");
}

/** A query__NamedQuery asset (needs Instance_class to be indexed by convertVault). */
function queryMd(uid: string, label: string, sparql: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    "exo__Instance_class:",
    '  - "[[query__NamedQuery]]"',
    "---",
    `# ${label}`,
    "",
    "```sparql",
    sparql,
    "```",
    "",
  ].join("\n");
}

const LIST_SPARQL_EXCLUDE_GADGET = [
  RDF_PREFIX,
  "SELECT ?class (COUNT(?instance) AS ?count)",
  '  WHERE { ?instance rdf:type ?class . FILTER(!CONTAINS(STR(?class), "Gadget")) }',
  "GROUP BY ?class",
  "ORDER BY DESC(?count)",
].join("\n");

const LIST_SPARQL_EXCLUDE_WIDGET = [
  RDF_PREFIX,
  "SELECT ?class (COUNT(?instance) AS ?count)",
  '  WHERE { ?instance rdf:type ?class . FILTER(!CONTAINS(STR(?class), "Widget")) }',
  "GROUP BY ?class",
  "ORDER BY DESC(?count)",
].join("\n");

const COUNT_SPARQL = [
  RDF_PREFIX,
  "SELECT (COUNT(?instance) AS ?count)",
  "  WHERE { ?instance rdf:type ?class . FILTER(CONTAINS(STR(?class), $className)) }",
].join("\n");

const PROPS_SPARQL = [
  RDF_PREFIX,
  "SELECT ?property (COUNT(?value) AS ?usageCount)",
  "  WHERE { ?instance rdf:type ?class . ?instance ?property ?value .",
  "          FILTER(CONTAINS(STR(?class), $className)) FILTER(?property != rdf:type) }",
  "GROUP BY ?property",
  "ORDER BY DESC(?usageCount)",
].join("\n");

/** Builds the temp vault. Returns its root; the class-list body is overridable. */
function buildVault(listSparql: string = LIST_SPARQL_EXCLUDE_GADGET): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runquery-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  // Instances: 3 Widget, 1 Gadget, 2 Doohickey.
  write(WIDGET1_UID, instanceMd(WIDGET1_UID, "test__Widget"));
  write(
    "11111111-0000-4000-8000-000000000002",
    instanceMd("11111111-0000-4000-8000-000000000002", "test__Widget"),
  );
  write(
    "11111111-0000-4000-8000-000000000003",
    instanceMd("11111111-0000-4000-8000-000000000003", "test__Widget"),
  );
  write(
    "22222222-0000-4000-8000-000000000001",
    instanceMd("22222222-0000-4000-8000-000000000001", "test__Gadget"),
  );
  write(
    "33333333-0000-4000-8000-000000000001",
    instanceMd("33333333-0000-4000-8000-000000000001", "test__Doohickey"),
  );
  write(
    "33333333-0000-4000-8000-000000000002",
    instanceMd("33333333-0000-4000-8000-000000000002", "test__Doohickey"),
  );

  // Canonical introspection queries (UIDs referenced by classes.ts).
  write(LIST_UID, queryMd(LIST_UID, "list classes", listSparql));
  write(COUNT_UID, queryMd(COUNT_UID, "class instance count", COUNT_SPARQL));
  write(PROPS_UID, queryMd(PROPS_UID, "class properties", PROPS_SPARQL));

  // Extra NamedQuery shapes for run-query coverage.
  write(ASK_UID, queryMd(ASK_UID, "ask any", "ASK { ?s ?p ?o }"));
  write(
    CONSTRUCT_UID,
    queryMd(
      CONSTRUCT_UID,
      "construct types",
      `${RDF_PREFIX}\nCONSTRUCT { ?s rdf:type ?c } WHERE { ?s rdf:type ?c }`,
    ),
  );
  write(
    CURRENT_UID,
    queryMd(
      CURRENT_UID,
      "current asset triples",
      "SELECT ?p ?o WHERE { $currentAsset ?p ?o }",
    ),
  );

  return root;
}

// @req:2678df55-ef74-4b45-a168-90db5e958882 — LITERAL binding for the static
// `requirements audit` scanner. The it() titles below build the tag via a
// `@req:${REQ}` template literal, which the audit's static `@req:<uuid>` regex
// cannot resolve — so without this literal line the now-Active req reads as
// unbound and reds `requirements-trace` on every PR (cross-session blast radius).
describe("req 2678df55 — run-query + homoiconic classes read-axis", () => {
  let root: string | undefined;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  /** Invoke a commander subcommand; return captured stdout+stderr. */
  async function runCli(
    cmd: { name(): string; parseAsync(argv: string[]): Promise<unknown> },
    args: string[],
  ): Promise<string> {
    consoleLogSpy.mockClear();
    consoleErrorSpy.mockClear();
    try {
      await cmd.parseAsync(["node", cmd.name(), ...args]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
    const logs = consoleLogSpy.mock.calls.map((c) => c.map(String).join(" "));
    const errs = consoleErrorSpy.mock.calls.map((c) => c.map(String).join(" "));
    return [...logs, ...errs].join("\n");
  }

  async function buildRunner(vaultRoot: string) {
    const converter = new NoteToRDFConverter(
      new FileSystemVaultAdapter(vaultRoot),
    );
    const store = new InMemoryTripleStore();
    await store.addAll(await converter.convertVault());
    return buildNamedQueryRunner(store, vaultRoot);
  }

  describe("run-query <uid>", () => {
    it(`@req:${REQ} executes a query__NamedQuery SELECT body and prints a table`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [LIST_UID, "--vault", root]);
      // The vault body (excludes Gadget) drives the printed result.
      expect(out).toContain("?class");
      expect(out).toContain("test#Widget");
      expect(out).toContain("test#Doohickey");
      expect(out).not.toContain("test#Gadget");
    });

    it(`@req:${REQ} emits a JSON envelope for --format json`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [
        LIST_UID,
        "--vault",
        root,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(out);
      expect(parsed.success).toBe(true);
      expect(parsed.data.kind).toBe("select");
      const classes = parsed.data.rows.map((r: { class: string }) => r.class);
      expect(classes.some((c: string) => c.includes("test#Widget"))).toBe(true);
      expect(classes.some((c: string) => c.includes("test#Gadget"))).toBe(false);
    });

    it(`@req:${REQ} prints an ASK result as a boolean`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [ASK_UID, "--vault", root]);
      expect(out).toContain("true");
    });

    it(`@req:${REQ} substitutes a literal --param into the query body`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [
        COUNT_UID,
        "--param",
        "className=Widget",
        "--vault",
        root,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(out);
      // 3 Widget instances matched $className="Widget".
      expect(parsed.data.rows[0].count).toContain('"3"');
    });

    it(`@req:${REQ} injects --current-asset as $currentAsset`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [
        CURRENT_UID,
        "--current-asset",
        `${WIDGET1_UID}.md`,
        "--vault",
        root,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(out);
      // widget1's own triples (its Instance_class points at test#Widget).
      const objects = parsed.data.rows.map((r: { o: string }) => r.o).join(" ");
      expect(objects).toContain("test#Widget");
    });

    it(`@req:${REQ} renders a CONSTRUCT result`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [
        CONSTRUCT_UID,
        "--vault",
        root,
      ]);
      expect(out).toContain("CONSTRUCT");
      expect(out).toContain("triple");
    });

    it(`@req:${REQ} fails closed on an unresolvable UID`, async () => {
      root = buildVault();
      const out = await runCli(runQueryCommand(), [
        "00000000-0000-4000-8000-000000000000",
        "--vault",
        root,
      ]);
      expect(out).toContain("No resolvable query__NamedQuery");
      expect(out).toContain("00000000-0000-4000-8000-000000000000");
      expect(processExitSpy).toHaveBeenCalled();
    });
  });

  describe("classes/describe-class read SPARQL from vault", () => {
    it(`@req:${REQ} classes executes the vault class-list query (revert-verify: FILTER excludes Gadget)`, async () => {
      root = buildVault(LIST_SPARQL_EXCLUDE_GADGET);
      const out = await runCli(classesCommand(), ["--vault", root]);
      // Vault body excludes Gadget → the local names reflect the vault query,
      // not a hardcoded (unfiltered) list. A revert to hardcode makes Gadget
      // reappear here (→ RED).
      expect(out).toContain("Widget");
      expect(out).toContain("Doohickey");
      expect(out).not.toContain("Gadget");
    });

    it(`@req:${REQ} editing the vault SPARQL body changes classes output (body-driven)`, async () => {
      // Same command, DIFFERENT vault body: now excludes Widget instead.
      root = buildVault(LIST_SPARQL_EXCLUDE_WIDGET);
      const out = await runCli(classesCommand(), ["--vault", root]);
      expect(out).toContain("Gadget");
      expect(out).toContain("Doohickey");
      expect(out).not.toContain("Widget");
    });

    it(`@req:${REQ} describe-class runs the vault count+props queries parametrized by $className`, async () => {
      root = buildVault();
      const out = await runCli(classesCommand(), ["Widget", "--vault", root]);
      expect(out).toContain("Class: Widget");
      // Widget instances carry these predicates (from the props NamedQuery).
      expect(out).toContain("Asset_uid");
      expect(out).toContain("Instance_class");
    });

    it(`@req:${REQ} classes --format json emits a structured class list`, async () => {
      root = buildVault();
      // `--output json` selects JSON *and* suppresses the text loading preamble
      // (the `📦 Loading…` line is gated on the text output format), so stdout is
      // pure JSON.
      const out = await runCli(classesCommand(), [
        "--vault",
        root,
        "--output",
        "json",
      ]);
      const parsed = JSON.parse(out);
      expect(parsed.success).toBe(true);
      const names = parsed.data.classes.map((c: { name: string }) => c.name);
      expect(names).toContain("Widget");
      expect(names).not.toContain("Gadget");
    });
  });

  describe("read-side runner (production-shape)", () => {
    it(`@req:${REQ} NamedQueryRunner.run executes the vault body over the real store`, async () => {
      root = buildVault();
      const runner = await buildRunner(root);
      const result = await runner.run(LIST_UID);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("select");
      if (result!.kind !== "select") throw new Error("expected select");
      const classIris = result!.rows
        .map((r) => r.get("class")?.toString() ?? "")
        .join(" ");
      expect(classIris).toContain("test#Widget");
      expect(classIris).not.toContain("test#Gadget");
    });

    it(`@req:${REQ} run() returns null for an unknown UID (fail-closed data path)`, async () => {
      root = buildVault();
      const runner = await buildRunner(root);
      const result = await runner.run(
        "00000000-0000-4000-8000-000000000000",
      );
      expect(result).toBeNull();
    });
  });
});
