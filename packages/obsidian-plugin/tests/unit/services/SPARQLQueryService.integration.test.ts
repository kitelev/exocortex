/**
 * SPARQLQueryService — INTEGRATION tests with REAL collaborators.
 *
 * Test-quality audit 2026-06-22 (P1.1c) HYBRID-LIFT: the old over-mock unit
 * (`SPARQLQueryService.test.ts`) fully mocked the central collaborator
 * (`VaultRDFIndexer`) and therefore only asserted pass-through delegation
 * (`mockIndexer.initialize/refresh/dispose toHaveBeenCalled`). The service's
 * PRIMARY method — `query()` actually parsing + executing SPARQL against the
 * vault's triples — was never exercised (explicitly omitted as "complex
 * mocking"). That unit verified nothing real, so it was deleted and replaced
 * by this integration suite.
 *
 * Here the WHOLE engine stack is REAL — exactly as the engine layer is tested:
 * a realistic in-memory Obsidian `App` (vault + metadataCache holding actual
 * markdown assets with frontmatter) is driven through the REAL
 * `ObsidianVaultAdapter` → REAL `NoteToRDFConverter` → REAL
 * `InMemoryTripleStore` → REAL `ExoQLParser`/translator/optimizer/executor.
 * `service.query()` genuinely walks the vault, builds triples, parses the
 * SPARQL, and executes it — assertions are on real solution mappings.
 *
 * Nothing in `@kitelev/exocortex-core` is mocked (jest maps it to the real
 * source). Only the Obsidian platform boundary (vault/metadataCache) is faked,
 * which is the correct seam (test-fixture-realism): the fake mirrors the real
 * Obsidian read contract `getMarkdownFiles()` / `getFileCache().frontmatter` /
 * `read()` rather than stubbing engine results.
 */

import { TFile } from "obsidian";
import type { App } from "obsidian";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";

const EXO = "https://exocortex.my/ontology/exo#";

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Builds a realistic in-memory Obsidian `App` whose vault + metadataCache the
 * REAL ObsidianVaultAdapter can walk. Files added after construction are picked
 * up by a subsequent `getMarkdownFiles()` call — that is what lets a `refresh()`
 * re-index the new vault state (real behaviour, not a spy).
 */
function buildApp(seed: SeedFile[]): {
  app: App;
  addFile: (f: SeedFile) => void;
  tfileFor: (path: string) => TFile;
  setFrontmatter: (path: string, fm: Record<string, unknown>) => void;
} {
  const files: TFile[] = [];
  const fmByPath = new Map<string, Record<string, unknown>>();
  const contentByPath = new Map<string, string>();

  const renderYaml = (fm: Record<string, unknown>): string =>
    "---\n" +
    Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n") +
    "\n---\n";

  const add = (f: SeedFile): void => {
    const tfile = new TFile(f.path);
    files.push(tfile);
    fmByPath.set(f.path, f.frontmatter);
    contentByPath.set(f.path, renderYaml(f.frontmatter));
  };
  seed.forEach(add);

  const tfileFor = (path: string): TFile => {
    const f = files.find((x) => x.path === path);
    if (!f) throw new Error(`no such seeded file: ${path}`);
    return f;
  };
  const setFrontmatter = (
    path: string,
    fm: Record<string, unknown>,
  ): void => {
    fmByPath.set(path, fm);
    contentByPath.set(path, renderYaml(fm));
  };

  const vault = {
    getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
    getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
    read: async (f: TFile) => contentByPath.get(f.path) ?? "",
    on: () => ({}) as unknown,
    off: () => {},
    offref: () => {},
  };

  const metadataCache = {
    getFileCache: (f: TFile) => {
      const fm = fmByPath.get(f.path);
      return fm ? { frontmatter: fm } : null;
    },
    getFirstLinkpathDest: (linkpath: string) => {
      const base = linkpath.replace(/\.md$/, "");
      return files.find((f) => f.basename === base) ?? null;
    },
    resolvedLinks: {},
  };

  const app = { vault, metadataCache } as unknown as App;
  return { app, addFile: add, tfileFor, setFrontmatter };
}

/** Read the lexical value of an RDF binding term (Literal/IRI). */
function lex(term: unknown): string {
  if (term && typeof term === "object" && "value" in term) {
    return String((term as { value: unknown }).value);
  }
  return String(term);
}

const TASK_ALPHA: SeedFile = {
  path: "assetspaces/ems/task-alpha.md",
  frontmatter: {
    exo__Asset_uid: "task-alpha-uid",
    exo__Asset_label: "Alpha Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

const TASK_BETA: SeedFile = {
  path: "assetspaces/ems/task-beta.md",
  frontmatter: {
    exo__Asset_uid: "task-beta-uid",
    exo__Asset_label: "Beta Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

describe("SPARQLQueryService (integration — real engine)", () => {
  describe("query() really executes SPARQL", () => {
    let service: SPARQLQueryService;

    beforeEach(async () => {
      const { app } = buildApp([TASK_ALPHA, TASK_BETA]);
      service = new SPARQLQueryService(app);
      await service.initialize();
    });

    afterEach(async () => {
      await service.dispose();
    });

    it("returns the real labels produced by walking the vault", async () => {
      const rows = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?s ?label WHERE { ?s exo:Asset_label ?label }`,
      );

      const labels = rows.map((b) => lex(b.get("label"))).sort();
      expect(labels).toEqual(["Alpha Task", "Beta Task"]);

      // Subjects are real note IRIs derived from the vault path (not a stub).
      for (const b of rows) {
        expect(lex(b.get("s"))).toContain("obsidian://vault/");
      }
    });

    it("executes a real BGP join across two patterns on the same subject", async () => {
      // exo:Asset_filename is emitted for every parsed file; joining it with
      // the label on ?s proves a genuine BGP join, not a single-pattern scan.
      const rows = await service.query(
        `PREFIX exo: <${EXO}>
         SELECT ?label ?fn WHERE {
           ?s exo:Asset_label ?label .
           ?s exo:Asset_filename ?fn .
         }`,
      );

      expect(rows).toHaveLength(2);
      const byLabel = new Map(rows.map((b) => [lex(b.get("label")), lex(b.get("fn"))]));
      expect(byLabel.get("Alpha Task")).toBe("task-alpha");
      expect(byLabel.get("Beta Task")).toBe("task-beta");
    });

    it("applies a real FILTER to narrow the result set", async () => {
      const rows = await service.query(
        `PREFIX exo: <${EXO}>
         SELECT ?label WHERE {
           ?s exo:Asset_label ?label .
           FILTER(STR(?label) = "Alpha Task")
         }`,
      );

      expect(rows).toHaveLength(1);
      expect(lex(rows[0].get("label"))).toBe("Alpha Task");
    });

    it("returns an empty result set for a predicate no asset carries", async () => {
      const rows = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?x WHERE { ?x exo:DefinitelyNotAPredicate ?y }`,
      );
      expect(rows).toEqual([]);
    });

    it("returns [] for an ASK query (service contract)", async () => {
      // SPARQLQueryService.query() returns SolutionMapping[]; for ASK it runs
      // the boolean query and returns [] (the boolean is consumed elsewhere).
      const rows = await service.query(
        `PREFIX exo: <${EXO}> ASK { ?s exo:Asset_label ?label }`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe("auto-initialization", () => {
    it("query() auto-initializes when called before initialize()", async () => {
      const { app } = buildApp([TASK_ALPHA]);
      const service = new SPARQLQueryService(app);

      // No explicit initialize() — query() must initialize the engine itself.
      const rows = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );

      expect(rows.map((b) => lex(b.get("label")))).toEqual(["Alpha Task"]);
      await service.dispose();
    });

    it("is idempotent: a redundant initialize() does not corrupt query results", async () => {
      const { app } = buildApp([TASK_ALPHA, TASK_BETA]);
      const service = new SPARQLQueryService(app);

      await service.initialize();
      await service.initialize(); // redundant — must be a harmless no-op

      const rows = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(rows.map((b) => lex(b.get("label"))).sort()).toEqual([
        "Alpha Task",
        "Beta Task",
      ]);
      await service.dispose();
    });
  });

  describe("refresh() re-indexes the current vault state", () => {
    it("a newly added asset becomes queryable after refresh()", async () => {
      const { app, addFile } = buildApp([TASK_ALPHA]);
      const service = new SPARQLQueryService(app);
      await service.initialize();

      const before = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(before.map((b) => lex(b.get("label")))).toEqual(["Alpha Task"]);

      // Add a new asset to the vault, then refresh — a real re-walk must
      // surface it (the over-mock unit could only assert refresh was *called*).
      addFile(TASK_BETA);
      await service.refresh();

      const after = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(after.map((b) => lex(b.get("label"))).sort()).toEqual([
        "Alpha Task",
        "Beta Task",
      ]);
      await service.dispose();
    });
  });

  describe("updateFile() incrementally re-indexes a single asset", () => {
    it("a frontmatter edit becomes queryable after updateFile()", async () => {
      const { app, tfileFor, setFrontmatter } = buildApp([TASK_ALPHA]);
      const service = new SPARQLQueryService(app);
      await service.initialize();

      const before = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(before.map((b) => lex(b.get("label")))).toEqual(["Alpha Task"]);

      // Edit the asset's label, then push a single-file update — a real
      // incremental re-index must replace the old triple with the new one
      // (the over-mock unit could only assert updateFile was *called*).
      setFrontmatter(TASK_ALPHA.path, {
        ...TASK_ALPHA.frontmatter,
        exo__Asset_label: "Alpha Renamed",
      });
      await service.updateFile(tfileFor(TASK_ALPHA.path));

      const after = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(after.map((b) => lex(b.get("label")))).toEqual(["Alpha Renamed"]);
      await service.dispose();
    });
  });

  describe("dispose() resets the service for a clean re-init", () => {
    it("after dispose(), a subsequent query() re-initializes and still works", async () => {
      const { app } = buildApp([TASK_ALPHA]);
      const service = new SPARQLQueryService(app);
      await service.initialize();
      expect(service.isReady()).toBe(true);

      await service.dispose();
      expect(service.isReady()).toBe(false);

      // query() after dispose must transparently re-initialize and return data.
      const rows = await service.query(
        `PREFIX exo: <${EXO}> SELECT ?label WHERE { ?s exo:Asset_label ?label }`,
      );
      expect(rows.map((b) => lex(b.get("label")))).toEqual(["Alpha Task"]);
      expect(service.isReady()).toBe(true);
      await service.dispose();
    });
  });

  describe("getTripleStore() exposes the populated real store", () => {
    it("returns a store containing the walked triples", async () => {
      const { app } = buildApp([TASK_ALPHA]);
      const service = new SPARQLQueryService(app);
      await service.initialize();

      const store = service.getTripleStore();
      const count = await store.count();
      // Real triples were produced (filename + label + uid + instance_class …),
      // so the store is non-empty — not the empty `{}` the over-mock returned.
      expect(count).toBeGreaterThan(0);
      await service.dispose();
    });
  });
});
