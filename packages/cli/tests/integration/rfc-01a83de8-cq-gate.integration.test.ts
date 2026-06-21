/**
 * RFC `01a83de8` §5 (Competency Questions) + EV7 — STRICT-mode CQ gate.
 *
 * RFC 01a83de8 makes the profile class Maven-style: `_includes` →
 * AssetSpace (direct lib) and `_imports` → Profile (BOM composition). The
 * effective classpath (CQ2) is the closure
 *   `_includes ∪ transitive(_imports*)`
 * over the RDF graph. EV7 mandates that `_imports` / `_includes` values are
 * UUID-form wikilinks (`[[<uid>]]`): a label-form wikilink (`[[profile-work]]`)
 * cannot be resolved to an IRI by NoteToRDFConverter and is stored as a bare
 * RDF Literal. When that literal flows into the subject position of the
 * downstream `?p exo:Profile_includes ?as` pattern, the literal-safety guard
 * (Issue #2997 / #3282) fires — and **silently yields 0 solutions** for that
 * branch, collapsing the CQ closure without any test failure.
 *
 * This suite is the post-migration CQ gate (Issue #3427). It exercises the
 * full ExoQL pipeline (NoteToRDFConverter → InMemoryTripleStore → parser →
 * translator → executor) against a fixture vault with a KNOWN `_imports`
 * depth and asserts an EXACT row-count, and proves the UUID-form mandate is
 * enforced under `EXOCORTEX_SPARQL_STRICT=1` (the guard throws instead of
 * swallowing the literal).
 *
 * Fixture (depth-2 — root imports one parent):
 *   AS-A, AS-B, AS-C            : 3 exo__AssetSpace instances
 *   P-parent  _includes [AS-B, AS-C]
 *   P-root    _includes [AS-A]   _imports [P-parent]
 *   CQ2 effective set for P-root = {AS-A, AS-B, AS-C}  → EXACTLY 3 rows.
 *
 * ── Revert-verify discipline ──────────────────────────────────────────────
 * (per ~/dotfiles/.claude/rules/integration-test-revert-verify.md)
 * The STRICT throw-mode lives in BGPExecutor.warnLiteralGuard /
 * PropertyPathExecutor.execute behind `PropertyPathExecutor.isStrictModeEnabled()`.
 * The "label-form throws under STRICT" test FAILS if that throw block is
 * reverted to warn-only (the query then returns the partial 1-row result
 * instead of rejecting) and PASSES with the throw-mode in place. Empirically
 * verified pre-merge: revert the `if (isStrictModeEnabled()) throw …` blocks
 * in both executors → this suite goes RED; restore → GREEN.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  ExoQLAlgebraTranslator,
  ExoQLParser,
  ExoQLQueryExecutor,
  InMemoryTripleStore,
  NoteToRDFConverter,
  type DomainTriple as Triple,
} from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

// ── Fixture UIDs (deterministic) ────────────────────────────────────────────
/** Real TBox UID of `exo__AssetSpace` (label drives `exo:Instance_class exo:AssetSpace`). */
const AS_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
/** Real TBox UID of `exo__Class` (metaclass — `exo__Instance_class` of the class defs). */
const EXO_CLASS_METACLASS_UID = "8619c4fc-64f1-4869-b17e-e34186cacca9";
/** Real TBox UID of `exo__Profile`. */
const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

const AS_A_UID = "11111111-1111-4111-8111-111111111111";
const AS_B_UID = "22222222-2222-4222-8222-222222222222";
const AS_C_UID = "33333333-3333-4333-8333-333333333333";
/** A non-AssetSpace asset ALSO declared in P-parent `_includes` — makes the
 *  CQ2 `exo:Instance_class exo:AssetSpace` type-guard load-bearing (it must be
 *  filtered out of the closure, so the count distinguishes 3 from 4). */
const NOTE_X_UID = "44444444-4444-4444-8444-444444444444";
const P_PARENT_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_ROOT_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const EXO = "https://exocortex.my/ontology/exo#";

// Subject IRI a file gets from NoteToRDFConverter (subjectIriPrefix = "").
function fileIRI(relPath: string): string {
  return `obsidian://vault/${relPath}`;
}
const P_ROOT_IRI = fileIRI(`assetspaces/shared-identities/${P_ROOT_UID}.md`);
const P_PARENT_IRI = fileIRI(`assetspaces/shared-identities/${P_PARENT_UID}.md`);

/** CQ2 — effective classpath of P-root: `_includes ∪ transitive(_imports*)`. */
const CQ2 = `
PREFIX exo: <${EXO}>
SELECT DISTINCT ?as WHERE {
  <${P_ROOT_IRI}> exo:Profile_imports* ?p .
  ?p exo:Profile_includes ?as .
  ?as exo:Instance_class exo:AssetSpace .
}
`;

/** CQ2 minus the `exo:Instance_class exo:AssetSpace` type-guard — control
 *  query proving the guard is load-bearing (includes the non-AssetSpace
 *  NOTE-X target, so this returns one MORE row than CQ2). */
const CQ2_NO_TYPE_GUARD = `
PREFIX exo: <${EXO}>
SELECT DISTINCT ?as WHERE {
  <${P_ROOT_IRI}> exo:Profile_imports* ?p .
  ?p exo:Profile_includes ?as .
}
`;

/** CQ1 — all libraries (AssetSpaces) in the vault. */
const CQ1 = `
PREFIX exo: <${EXO}>
SELECT DISTINCT ?as WHERE {
  ?as exo:Instance_class exo:AssetSpace .
}
`;

/** CQ3 — BOM consumers: which profiles import P-parent (UUID-form object IRI). */
const CQ3 = `
PREFIX exo: <${EXO}>
SELECT DISTINCT ?p WHERE {
  ?p exo:Profile_imports <${P_PARENT_IRI}> .
}
`;

type ImportsForm = "uuid" | "label";

/**
 * Write a minimal fixture vault. `importsForm` controls how P-root declares
 * its `_imports` value:
 *   "uuid"  → `[[<P_PARENT_UID>]]`  (resolves to an IRI — CQ closure works)
 *   "label" → `[[profile-parent]]`  (no matching file → bare Literal — the
 *             mandate violation EV7 guards against)
 */
function buildFixtureVault(importsForm: ImportsForm): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "exo-cq-gate-"));

  const write = (relDir: string, uid: string, body: string): void => {
    const dir = path.join(root, relDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${uid}.md`), body);
  };

  // exo__AssetSpace class def — label makes `exo:Instance_class exo:AssetSpace` resolve.
  write(
    "assetspaces/exo",
    AS_CLASS_UID,
    `---\n` +
      `exo__Asset_uid: ${AS_CLASS_UID}\n` +
      `exo__Asset_label: exo__AssetSpace\n` +
      `exo__Instance_class: "[[${EXO_CLASS_METACLASS_UID}]]"\n` +
      `---\n`,
  );
  // exo__Profile class def (label drives Profile membership if ever queried).
  write(
    "assetspaces/exo",
    PROFILE_CLASS_UID,
    `---\n` +
      `exo__Asset_uid: ${PROFILE_CLASS_UID}\n` +
      `exo__Asset_label: exo__Profile\n` +
      `exo__Instance_class: "[[${EXO_CLASS_METACLASS_UID}]]"\n` +
      `---\n`,
  );

  const assetSpace = (uid: string, label: string): string =>
    `---\n` +
    `exo__Asset_uid: ${uid}\n` +
    `exo__Asset_label: ${label}\n` +
    `exo__Instance_class: "[[${AS_CLASS_UID}]]"\n` +
    `---\n`;
  write("assetspaces/as-a", AS_A_UID, assetSpace(AS_A_UID, "AS A"));
  write("assetspaces/as-b", AS_B_UID, assetSpace(AS_B_UID, "AS B"));
  write("assetspaces/as-c", AS_C_UID, assetSpace(AS_C_UID, "AS C"));

  // A NON-AssetSpace asset (instance_class = ems__Task) — declared in the
  // parent profile's `_includes` so the CQ2 type-guard must filter it out.
  write(
    "assetspaces/notes",
    NOTE_X_UID,
    `---\n` +
      `exo__Asset_uid: ${NOTE_X_UID}\n` +
      `exo__Asset_label: Not An AssetSpace\n` +
      `exo__Instance_class: ems__Task\n` +
      `---\n`,
  );

  // Parent profile: includes AS-B + AS-C + a non-AssetSpace note (NOTE-X).
  write(
    "assetspaces/shared-identities",
    P_PARENT_UID,
    `---\n` +
      `exo__Asset_uid: ${P_PARENT_UID}\n` +
      `exo__Asset_label: Profile Parent\n` +
      `exo__Instance_class: "[[${PROFILE_CLASS_UID}]]"\n` +
      `exo__Profile_includes:\n` +
      `  - "[[${AS_B_UID}]]"\n` +
      `  - "[[${AS_C_UID}]]"\n` +
      `  - "[[${NOTE_X_UID}]]"\n` +
      `---\n`,
  );

  // Root profile: includes AS-A, imports Parent (UUID-form vs label-form).
  const importsValue =
    importsForm === "uuid" ? `"[[${P_PARENT_UID}]]"` : `"[[profile-parent]]"`;
  write(
    "assetspaces/shared-identities",
    P_ROOT_UID,
    `---\n` +
      `exo__Asset_uid: ${P_ROOT_UID}\n` +
      `exo__Asset_label: Profile Root\n` +
      `exo__Instance_class: "[[${PROFILE_CLASS_UID}]]"\n` +
      `exo__Profile_includes:\n` +
      `  - "[[${AS_A_UID}]]"\n` +
      `exo__Profile_imports: ${importsValue}\n` +
      `---\n`,
  );

  return root;
}

async function loadVault(vaultPath: string): Promise<Triple[]> {
  const adapter = new FileSystemVaultAdapter(vaultPath);
  const converter = new NoteToRDFConverter(adapter);
  return converter.convertVault();
}

async function runQuery(vaultPath: string, query: string): Promise<unknown[]> {
  const triples = await loadVault(vaultPath);
  const store = new InMemoryTripleStore();
  await store.addAll(triples);

  const parser = new ExoQLParser();
  const ast = parser.parse(query);
  const translator = new ExoQLAlgebraTranslator();
  const algebra = translator.translate(ast);
  const executor = new ExoQLQueryExecutor(store);

  const rows: unknown[] = [];
  for await (const solution of executor.execute(algebra)) {
    rows.push(solution);
  }
  return rows;
}

describe("RFC 01a83de8 §5 CQ gate — STRICT-mode profile-imports closure (Issue #3427)", () => {
  let vaults: string[];
  let originalStrictEnv: string | undefined;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    vaults = [];
    originalStrictEnv = process.env.EXOCORTEX_SPARQL_STRICT;
    delete process.env.EXOCORTEX_SPARQL_STRICT;
    // The literal-safety guard logs via console.error in both modes — silence
    // it so the (expected) diagnostics don't pollute the test output.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (originalStrictEnv === undefined) {
      delete process.env.EXOCORTEX_SPARQL_STRICT;
    } else {
      process.env.EXOCORTEX_SPARQL_STRICT = originalStrictEnv;
    }
    for (const v of vaults) rmSync(v, { recursive: true, force: true });
  });

  function fixture(form: ImportsForm): string {
    const root = buildFixtureVault(form);
    vaults.push(root);
    return root;
  }

  describe("UUID-form `_imports` (mandate satisfied)", () => {
    it("CQ2 closure returns EXACTLY the 3 expected AssetSpaces (non-strict)", async () => {
      const rows = await runQuery(fixture("uuid"), CQ2);
      expect(rows).toHaveLength(3);
    });

    it("CQ2 closure returns EXACTLY 3 AssetSpaces under STRICT (no false throw)", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "1";
      const rows = await runQuery(fixture("uuid"), CQ2);
      expect(rows).toHaveLength(3);
    });

    it("zero behaviour change: STRICT and non-strict yield identical CQ2 row-counts", async () => {
      const root = fixture("uuid");
      const nonStrict = await runQuery(root, CQ2);
      process.env.EXOCORTEX_SPARQL_STRICT = "1";
      const strict = await runQuery(root, CQ2);
      expect(strict).toHaveLength(nonStrict.length);
      expect(strict).toHaveLength(3);
    });

    it("CQ1 lists all 3 libraries (AssetSpaces) in the vault", async () => {
      const rows = await runQuery(fixture("uuid"), CQ1);
      expect(rows).toHaveLength(3);
    });

    it("the `exo:Instance_class exo:AssetSpace` type-guard is load-bearing", async () => {
      // The parent profile `_includes` a non-AssetSpace note (NOTE-X). The
      // type-guard must exclude it: CQ2 = 3, the un-guarded control = 4.
      const root = fixture("uuid");
      expect(await runQuery(root, CQ2)).toHaveLength(3);
      expect(await runQuery(root, CQ2_NO_TYPE_GUARD)).toHaveLength(4);
    });

    it("CQ3 finds the single BOM consumer that imports the parent profile", async () => {
      const rows = await runQuery(fixture("uuid"), CQ3);
      expect(rows).toHaveLength(1);
    });
  });

  describe("label-form `_imports` (mandate violated — EV7)", () => {
    it("STRICT mode THROWS instead of silently collapsing the closure @req:70e12858-9e9e-4e2d-84fe-e582bfa02513", async () => {
      process.env.EXOCORTEX_SPARQL_STRICT = "1";
      await expect(runQuery(fixture("label"), CQ2)).rejects.toThrow(
        /Literal in subject position/,
      );
    });

    it("non-strict mode silently UNDER-counts (the recall loss EV7 guards against)", async () => {
      // Without STRICT the literal-safety guard warns and yields 0 solutions
      // for the broken `_imports` branch: only AS-A (declared directly on the
      // root via the zero-step `_imports*`) survives — AS-B/AS-C behind the
      // unresolved import are silently dropped. This is exactly why the STRICT
      // gate exists: 1 row here looks "successful" but is a 2/3 recall loss.
      const rows = await runQuery(fixture("label"), CQ2);
      expect(rows).toHaveLength(1);
      expect(rows.length).toBeLessThan(3);
    });
  });
});
