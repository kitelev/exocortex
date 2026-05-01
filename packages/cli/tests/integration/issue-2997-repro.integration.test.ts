/**
 * Reproduction test for issue #2997 — Phase 1 of the fix.
 *
 * Issue: `npx @kitelev/exocortex-cli sparql query` crashes with
 * `Literals cannot appear in subject position` on a SELECT that uses
 * `FILTER(CONTAINS(STR(?var), …))` after the loader emits 11 skip-warnings
 * for files that fail pre-validation. The hypothesis (RFC
 * `0810aad3-90fc-46bb-a103-26ca8172970b`) is that some triples leak into
 * the store from a side code path even though the file-level validator
 * marks the asset as skipped, and the algebra/executor pipeline then
 * encounters a literal where it expects a node.
 *
 * Phase 1 deliverables (this file):
 *  - synthetic fixture vault under `tests/fixtures/issue-2997/`
 *  - reproduction test (this suite) that loads the fixture and runs the
 *    issue query, expecting the crash → marked `.skip` until Phases 2/3
 *    land the loader + translator fixes
 *  - control test that loads only the well-formed subtree and confirms
 *    the same query returns the expected row
 *
 * Both tests are wrapped with `describe.skip(...)` so they document the
 * regression without breaking CI. Drop the `.skip` once Phase 2 (loader
 * all-or-nothing) and Phase 3 (translator literal-safety guard) land —
 * the suite then becomes the regression gate for #2997.
 */
import { describe, it, expect } from "@jest/globals";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ExoQLAlgebraTranslator,
  ExoQLParser,
  ExoQLQueryExecutor,
  InMemoryTripleStore,
  NoteToRDFConverter,
  type Triple,
} from "exocortex";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(__dirname, "../fixtures/issue-2997");

const ISSUE_QUERY = `
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
SELECT DISTINCT ?task ?label ?status ?updated ?phase WHERE {
  ?task ems:Effort_parent ?phase .
  ?phase ems:Effort_parent ?root .
  ?task exo:Instance_class ?cls .
  ?task exo:Asset_label ?label .
  OPTIONAL { ?task ems:Effort_status ?status }
  OPTIONAL { ?task exo:Asset_updatedAt ?updated }
  FILTER(STRENDS(STR(?cls), '#Task'))
  FILTER(CONTAINS(STR(?root), '5b4030aa-f0c1-43dc-996a-896b0a1a6dfb'))
}
ORDER BY ?phase ?label
`;

async function loadVault(vaultPath: string): Promise<Triple[]> {
  const adapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(adapter);
  return converter.convertVault();
}

async function runIssueQuery(vaultPath: string): Promise<unknown[]> {
  const triples = await loadVault(vaultPath);
  const store = new InMemoryTripleStore();
  await store.addAll(triples);

  const parser = new ExoQLParser();
  const ast = parser.parse(ISSUE_QUERY);
  const translator = new ExoQLAlgebraTranslator();
  const algebra = translator.translate(ast);
  const executor = new ExoQLQueryExecutor(store);

  const rows: unknown[] = [];
  for await (const solution of executor.execute(algebra)) {
    rows.push(solution);
  }
  return rows;
}

// Active regression gate for #2997 — both fix layers are in place:
//   • Phase 2 (loader all-or-nothing) lands the file-level invariant
//     validator in `NoteToRDFConverter.convertVaultWithValidation`,
//     so partial-state literals never leak into the store.
//   • Phase 3 (translator literal-safety guard) reinforces the same
//     property at the algebra layer — even if a literal somehow
//     reached subject position, the executor would surface a
//     diagnostic instead of crashing.
// With both layers active the issue query resolves cleanly on the
// full fixture vault. The control test always passes; the
// full-fixture case is the regression gate.
describe("Issue #2997 reproduction (regression gate, Phases 2+3)", () => {
  it("issue query on full fixture vault returns rows without throwing", async () => {
    // Expected post-fix behaviour: query resolves and returns at least
    // the row from the well-formed subtree (Project → Phase → Task with
    // the Project UUID `5b4030aa-…`). Until Phases 2 (loader
    // all-or-nothing) and 3 (translator literal-safety guard) land, this
    // assertion is the regression target. The `.skip` is dropped once
    // the fixes are in.
    //
    // Current production failure mode (CLI v15.29.0 against the user's
    // 129K-triple vault) is:
    //   ❌ Error: Literals cannot appear in subject position
    // emitted from the SPARQL executor when a variable that sits in
    // subject position elsewhere in the BGP gets bound to a literal —
    // either because the loader leaked partial triples from an asset
    // that pre-validation marked as skip, or because a property like
    // `ems__Effort_parent` resolved an unresolvable wikilink to a
    // Literal (NoteToRDFConverter#valueToRDFObject line 715).
    const rows = await runIssueQuery(FIXTURE_ROOT);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("control: same query on the well-formed subtree returns the expected row", async () => {
    const rows = await runIssueQuery(`${FIXTURE_ROOT}/valid-tree`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
