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
  vaultPathToIRI,
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

  // ems__Bug 72cbd6fc — `NamedQueryRunner.substitute` handed the FORMATTED value
  // to `String.replace` as a replacement STRING, so `$$`, `$&`, `` $` `` and `$'`
  // inside a value were read as replacement patterns: `$'` pasted the rest of the
  // query into the value (in an IRI — a parse error), `$&` pasted the token name
  // (`$&x` was looked up as `$topicx` and FOUND that other record), `$$` collapsed
  // to `$`.
  // ⛔ On a pattern WITHOUT capture groups exactly these four forms corrupt —
  // `$1`, `$01`, `$<x>`, `$s` and a lone `$` are inert (measured through the same
  // regexp in grooming, 08.10) — so the axes carry only the four.
  // Every axis drives the REAL CLI action (or the real runner) over a REAL temp
  // vault. Mutants — `run-query-param-dollar-72cbd6fc.spec.json`: per `.replace`
  // site of `substitute` — string replacement back (M1-M3), lazy formatting
  // (M5-M7), first occurrence only (M8-M10) — plus partial `$&` escaping
  // (M11, M12) and a control on C1 (M4).
  describe("ems__Bug 72cbd6fc — a substituted value is inserted verbatim", () => {
    const ECHO_UID = "e1000000-0000-4000-8000-0000000000e1";
    const LABEL_UID = "e1000000-0000-4000-8000-0000000000e2";
    const NODE_UID = "e1000000-0000-4000-8000-0000000000e3";
    const CLASS_UID = "e1000000-0000-4000-8000-0000000000e4";
    // The same token TWICE in one body — a replacement that stops at the first
    // occurrence leaves `$topic` behind as an unbound SPARQL variable.
    const ECHO2_UID = "e1000000-0000-4000-8000-0000000000e5";
    const ASSET2_UID = "e1000000-0000-4000-8000-0000000000e6";
    const CLASS2_UID = "e1000000-0000-4000-8000-0000000000e7";
    const EXO_PREFIX = "PREFIX exo: <https://exocortex.my/ontology/exo#>";

    function oddMd(uid: string, label: string): string {
      return [
        "---",
        `exo__Asset_uid: ${uid}`,
        `exo__Asset_label: "${label}"`,
        "exo__Instance_class:",
        '  - "[[test__Odd]]"',
        "---",
        `# ${label}`,
        "",
      ].join("\n");
    }

    /** A vault whose LABELS and PATHS carry the four corrupting forms, each next
     *  to the DECOY the defect turns it into (`$&x`→`$topicx`, `a$$b`→`a$b`,
     *  `e$$f.md`→`e$f.md`), so the defect shows as the WRONG record, not as
     *  an empty answer. */
    function buildDollarVault(): string {
      const r = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runquery-dollar-"));
      const put = (rel: string, md: string) => {
        fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
        fs.writeFileSync(path.join(r, rel), md, "utf-8");
      };
      put(`${ECHO_UID}.md`, queryMd(ECHO_UID, "echo topic", "SELECT ?k WHERE { BIND($topic AS ?k) }"));
      put(
        `${LABEL_UID}.md`,
        queryMd(
          LABEL_UID,
          "asset by label",
          `${EXO_PREFIX}\nSELECT ?s WHERE { ?s exo:Asset_label ?l . FILTER(?l = $topic) }`,
        ),
      );
      // The three path-addressed queries read ONE predicate, so a hit counts
      // exactly once (the converter emits a label under more than one predicate).
      put(`${NODE_UID}.md`, queryMd(NODE_UID, "node label", `${EXO_PREFIX}\nSELECT ?o WHERE { $node exo:Asset_label ?o }`));
      put(`${CLASS_UID}.md`, queryMd(CLASS_UID, "class label", `${EXO_PREFIX}\nSELECT ?o WHERE { $currentClass exo:Asset_label ?o }`));
      put(CURRENT_UID + ".md", queryMd(CURRENT_UID, "current asset label", `${EXO_PREFIX}\nSELECT ?o WHERE { $currentAsset exo:Asset_label ?o }`));
      put(`${ECHO2_UID}.md`, queryMd(ECHO2_UID, "echo topic twice", "SELECT ?a ?b WHERE { BIND($topic AS ?a) BIND($topic AS ?b) }"));
      put(`${ASSET2_UID}.md`, queryMd(ASSET2_UID, "current asset twice", "SELECT ?a ?b WHERE { BIND(STR($currentAsset) AS ?a) BIND(STR($currentAsset) AS ?b) }"));
      put(`${CLASS2_UID}.md`, queryMd(CLASS2_UID, "current class twice", "SELECT ?a ?b WHERE { BIND(STR($currentClass) AS ?a) BIND(STR($currentClass) AS ?b) }"));
      // Label pairs: the value and the decoy the defect turns it into.
      put("labels/l1.md", oddMd("e2000000-0000-4000-8000-000000000001", "$&x"));
      put("labels/l2.md", oddMd("e2000000-0000-4000-8000-000000000002", "$topicx"));
      put("labels/l3.md", oddMd("e2000000-0000-4000-8000-000000000003", "a$$b"));
      put("labels/l4.md", oddMd("e2000000-0000-4000-8000-000000000004", "a$b"));
      // Path pairs: `encodeURI` keeps `$`, `&`, `'` — so they reach the IRI.
      put("odd/a$&b.md", oddMd("e3000000-0000-4000-8000-000000000001", "target-amp"));
      put("odd/e$$f.md", oddMd("e3000000-0000-4000-8000-000000000002", "target-dollar"));
      put("odd/e$f.md", oddMd("e3000000-0000-4000-8000-000000000003", "decoy-dollar"));
      put("odd/c$'d.md", oddMd("e3000000-0000-4000-8000-000000000004", "target-quote"));
      return r;
    }

    async function echo(value: string): Promise<string> {
      root = buildDollarVault();
      const out = await runCli(runQueryCommand(), [
        ECHO_UID, "--param", `topic=${value}`, "--vault", root, "--format", "json",
      ]);
      return out;
    }

    async function rowsOf(args: string[]): Promise<string> {
      root = buildDollarVault();
      return runCli(runQueryCommand(), [...args, "--vault", root, "--format", "json"]);
    }

    /** How many result rows carry `needle` in a binding. ⛔ Count, not
     *  presence: `$'` / `` $` `` COPY a part of the query into the value, so a
     *  presence check (`toContain`) is blind to a duplicated hit. */
    function rowsCarrying(out: string, needle: string): number {
      const rows: Array<Record<string, string>> = JSON.parse(out).data.rows;
      return rows.filter((r) => Object.values(r).some((v) => String(v).includes(needle))).length;
    }

    it(`S1 @req:${REQ} literal --param keeps $$ byte-identical`, async () => {
      const out = await echo("a$$b");
      expect(JSON.parse(out).data.rows).toEqual([{ k: "a$$b" }]);
    });

    it(`S2 @req:${REQ} literal --param keeps $& byte-identical`, async () => {
      const out = await echo("a$&b");
      expect(JSON.parse(out).data.rows).toEqual([{ k: "a$&b" }]);
    });

    it(`S3 @req:${REQ} literal --param keeps $\` byte-identical`, async () => {
      const out = await echo("a$`b");
      expect(JSON.parse(out).data.rows).toEqual([{ k: "a$`b" }]);
    });

    it(`S4 @req:${REQ} literal --param keeps $' byte-identical (no parse error)`, async () => {
      const out = await echo("a$'b");
      expect(JSON.parse(out).data.rows).toEqual([{ k: "a$'b" }]);
    });

    it(`S5 @req:${REQ} --param "$&x" finds the "$&x" record, not "$topicx"`, async () => {
      const out = await rowsOf([LABEL_UID, "--param", "topic=$&x"]);
      expect(JSON.parse(out).data.rows.map((r: { s: string }) => r.s)).toEqual([
        expect.stringContaining("labels/l1.md"),
      ]);
    });

    it(`S6 @req:${REQ} --param "a$$b" finds the "a$$b" record, not "a$b"`, async () => {
      const out = await rowsOf([LABEL_UID, "--param", "topic=a$$b"]);
      expect(JSON.parse(out).data.rows.map((r: { s: string }) => r.s)).toEqual([
        expect.stringContaining("labels/l3.md"),
      ]);
    });

    it(`S7 @req:${REQ} --param-iri keeps a path with $& verbatim`, async () => {
      const out = await rowsOf([NODE_UID, "--param-iri", "node=odd/a$&b.md"]);
      expect(rowsCarrying(out, "target-amp")).toBe(1);
    });

    it(`S8 @req:${REQ} --current-asset keeps a path with $& verbatim`, async () => {
      const out = await rowsOf([CURRENT_UID, "--current-asset", "odd/a$&b.md"]);
      expect(rowsCarrying(out, "target-amp")).toBe(1);
    });

    it(`S9 @req:${REQ} --current-asset "e$$f.md" reads e$$f.md, not the decoy e$f.md`, async () => {
      const out = await rowsOf([CURRENT_UID, "--current-asset", "odd/e$$f.md"]);
      expect(rowsCarrying(out, "target-dollar")).toBe(1);
      expect(rowsCarrying(out, "decoy-dollar")).toBe(0);
    });

    it(`S10 @req:${REQ} --current-asset keeps a path with $' verbatim (no parse error)`, async () => {
      const out = await rowsOf([CURRENT_UID, "--current-asset", "odd/c$'d.md"]);
      expect(rowsCarrying(out, "target-quote")).toBe(1);
    });

    // `$currentClass` has no CLI flag and no production caller today — the
    // runner's own contract is the only surface, so this axis drives the runner.
    it(`S11 the runner keeps a $currentClass IRI with $& verbatim`, async () => {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      const result = await runner.run(CLASS_UID, {
        currentClass: vaultPathToIRI("odd/a$&b.md"),
      });
      if (result?.kind !== "select") throw new Error("expected select");
      const hits = result.rows.filter((r) => (r.get("o")?.toString() ?? "").includes("target-amp"));
      expect(hits).toHaveLength(1);
    });

    // The fix keeps every value formatted BEFORE `.replace` (a function then
    // returns the ready string). A lazy `() => formatIri(...)` would stop
    // refusing a malformed IRI whose token the body never mentions — the
    // refusal is the runner's own contract (`formatIri` docstring), so these
    // axes drive the runner with a body that has no `$currentAsset`,
    // `$currentClass` or `$node` token. Green on the base too: no regression.
    const MALFORMED_IRI = "x> ?a ?b . ?evil <y";
    const topicOnly = { topic: { value: "x", kind: "literal" as const } };

    it(`S12 the runner refuses a malformed $currentAsset even when the body has no such token`, async () => {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      await expect(
        runner.run(ECHO_UID, { currentAsset: MALFORMED_IRI, params: topicOnly }),
      ).rejects.toThrow(/malformed IRI/);
    });

    it(`S13 the runner refuses a malformed $currentClass even when the body has no such token`, async () => {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      await expect(
        runner.run(ECHO_UID, { currentClass: MALFORMED_IRI, params: topicOnly }),
      ).rejects.toThrow(/malformed IRI/);
    });

    it(`S14 the runner refuses a malformed IRI param even when the body has no such token`, async () => {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      await expect(
        runner.run(ECHO_UID, {
          params: { ...topicOnly, node: { value: MALFORMED_IRI, kind: "iri" } },
        }),
      ).rejects.toThrow(/malformed IRI/);
    });

    // A token used TWICE: every occurrence is replaced, not only the first —
    // a leftover `$topic` is a legal (unbound) SPARQL variable, so the miss is
    // silent: the second binding is simply absent.
    it(`S15 @req:${REQ} --param fills EVERY occurrence of its token`, async () => {
      root = buildDollarVault();
      const out = await runCli(runQueryCommand(), [
        ECHO2_UID, "--param", "topic=a$&b", "--vault", root, "--format", "json",
      ]);
      expect(JSON.parse(out).data.rows).toEqual([{ a: "a$&b", b: "a$&b" }]);
    });

    it(`S16 @req:${REQ} --current-asset fills EVERY occurrence of $currentAsset`, async () => {
      const out = await rowsOf([ASSET2_UID, "--current-asset", "odd/a$&b.md"]);
      const rows: Array<{ a?: string; b?: string }> = JSON.parse(out).data.rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].a).toContain("odd/a$&b.md");
      expect(rows[0].b).toBe(rows[0].a);
    });

    it(`S17 the runner fills EVERY occurrence of $currentClass`, async () => {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      const result = await runner.run(CLASS2_UID, {
        currentClass: vaultPathToIRI("odd/a$&b.md"),
      });
      if (result?.kind !== "select") throw new Error("expected select");
      expect(result.rows).toHaveLength(1);
      const a = result.rows[0].get("a")?.toString() ?? "";
      expect(a).toContain("odd/a$&b.md");
      expect(result.rows[0].get("b")?.toString()).toBe(a);
    });

    // `$$` and `$'` on the two surfaces S7 / S11 cover with `$&` only — an
    // implementation escaping `$&` alone would otherwise pass them.
    it(`S18 @req:${REQ} --param-iri "e$$f.md" reads e$$f.md, not the decoy e$f.md`, async () => {
      const out = await rowsOf([NODE_UID, "--param-iri", "node=odd/e$$f.md"]);
      expect(rowsCarrying(out, "target-dollar")).toBe(1);
      expect(rowsCarrying(out, "decoy-dollar")).toBe(0);
    });

    it(`S19 @req:${REQ} --param-iri keeps a path with $' verbatim`, async () => {
      const out = await rowsOf([NODE_UID, "--param-iri", "node=odd/c$'d.md"]);
      expect(rowsCarrying(out, "target-quote")).toBe(1);
    });

    async function classLabels(relPath: string): Promise<string[]> {
      root = buildDollarVault();
      const runner = await buildRunner(root);
      const result = await runner.run(CLASS_UID, {
        currentClass: vaultPathToIRI(relPath),
      });
      if (result?.kind !== "select") throw new Error("expected select");
      return result.rows.map((r) => r.get("o")?.toString() ?? "");
    }

    it(`S20 the runner reads $currentClass "e$$f.md", not the decoy e$f.md`, async () => {
      const labels = await classLabels("odd/e$$f.md");
      expect(labels.filter((l) => l.includes("target-dollar"))).toHaveLength(1);
      expect(labels.filter((l) => l.includes("decoy-dollar"))).toHaveLength(0);
    });

    it(`S21 the runner keeps a $currentClass IRI with $' verbatim`, async () => {
      const labels = await classLabels("odd/c$'d.md");
      expect(labels.filter((l) => l.includes("target-quote"))).toHaveLength(1);
    });

    it(`C1 @req:${REQ} control — a value with " and \\ still round-trips byte-identical`, async () => {
      const out = await echo('q"x\\y');
      expect(JSON.parse(out).data.rows).toEqual([{ k: 'q"x\\y' }]);
    });
  });
});
