/**
 * exo-layout action button precondition ASK gating — INTEGRATION (#3654 Part 1).
 *
 * Real engine end-to-end: a realistic in-memory Obsidian `App` (vault +
 * metadataCache holding actual markdown frontmatter) is driven through the REAL
 * `SPARQLApi` (REAL `NoteToRDFConverter` → `InMemoryTripleStore` → ExoQL
 * parser/translator/optimizer/executor) and the REAL
 * `LayoutCodeBlockProcessor.checkPrecondition` gate. Only the Obsidian platform
 * boundary (vault/metadataCache) is faked — the correct seam per
 * test-fixture-realism; nothing in the engine is mocked. The asset's `$target`
 * IRI is the store's ACTUAL `?asset` subject value, not a synthetic shape.
 *
 * Binds req c5542956-dded-4892-b35c-011a03227562.
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { SPARQLApi } from "../../../../src/application/api/SPARQLApi";
import { LayoutCodeBlockProcessor } from "../../../../src/application/processors/LayoutCodeBlockProcessor";
import type ExocortexPlugin from "../../../../src/ExocortexPlugin";

const EXO = "https://exocortex.my/ontology/exo#";
const REQ = "@req:c5542956-dded-4892-b35c-011a03227562";

interface SeedFile {
  path: string;
  frontmatter: Record<string, unknown>;
}

function buildApp(seed: SeedFile[]): App {
  const files: TFile[] = [];
  const fmByPath = new Map<string, Record<string, unknown>>();
  const contentByPath = new Map<string, string>();
  const renderYaml = (fm: Record<string, unknown>): string =>
    "---\n" +
    Object.entries(fm)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n") +
    "\n---\n";
  for (const f of seed) {
    const tfile = new TFile(f.path);
    files.push(tfile);
    fmByPath.set(f.path, f.frontmatter);
    contentByPath.set(f.path, renderYaml(f.frontmatter));
  }
  const vault = {
    getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
    getAbstractFileByPath: (p: string) =>
      files.find((f) => f.path === p) ?? null,
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
  return { vault, metadataCache } as unknown as App;
}

// A real asset whose vault path contains SLASHES — this is what makes the
// dual-IRI form matter (encodeURI keeps `/`; encodeURIComponent → `%2F`).
const TASK_ALPHA: SeedFile = {
  path: "assetspaces/ems/task-alpha.md",
  frontmatter: {
    exo__Asset_uid: "task-alpha-uid",
    exo__Asset_label: "Alpha Task",
    exo__Instance_class: ["[[ems__Task]]"],
  },
};

interface PreconditionGate {
  checkPrecondition(sparql: string, assetUri: string): Promise<boolean>;
}

describe(`LayoutCodeBlockProcessor — action button precondition ASK gating [${REQ}]`, () => {
  let api: SPARQLApi;
  let processor: LayoutCodeBlockProcessor;
  let assetIri: string;

  beforeEach(async () => {
    const app = buildApp([TASK_ALPHA]);
    const apiPlugin = {
      app,
      settings: { excludedFolders: [] },
    } as unknown as ExocortexPlugin;
    api = new SPARQLApi(apiPlugin);

    // The store's REAL subject IRI for the asset — exactly the `?asset` value
    // LayoutService threads into the row's metadata (production-shape).
    const res = await api.query(
      `PREFIX exo: <${EXO}> SELECT ?s WHERE { ?s exo:Asset_label "Alpha Task" }`,
    );
    assetIri = String((res.bindings[0].get("s") as { value: unknown }).value);

    const procPlugin = {
      app,
      getSPARQLApi: () => api,
      notifier: { error: () => {} },
    } as unknown as ExocortexPlugin;
    processor = new LayoutCodeBlockProcessor(procPlugin);
  });

  afterEach(async () => {
    processor.cleanup();
    await api.dispose();
  });

  const check = (sparql: string, iri: string): Promise<boolean> =>
    (processor as unknown as PreconditionGate).checkPrecondition(sparql, iri);

  it(`shows a button whose precondition ASK holds for the asset [${REQ}]`, async () => {
    // Every parsed asset carries exo:Asset_label → the ASK holds → button shown.
    const ask = `PREFIX exo: <${EXO}> ASK { $target exo:Asset_label ?l }`;
    await expect(check(ask, assetIri)).resolves.toBe(true);
  });

  it(`hides a button whose precondition ASK does not hold for the asset [${REQ}]`, async () => {
    // No asset carries this predicate → the ASK is false → button hidden.
    const ask = `PREFIX exo: <${EXO}> ASK { $target exo:DefinitelyNotAPredicate ?l }`;
    await expect(check(ask, assetIri)).resolves.toBe(false);
  });

  it(`substitutes $target with the store's real subject IRI — the over-encoded form mis-gates [${REQ}]`, async () => {
    const ask = `PREFIX exo: <${EXO}> ASK { $target exo:Asset_label ?l }`;

    // The REAL store IRI (encodeURI: slashes preserved) matches the subject.
    expect(assetIri).toBe("obsidian://vault/assetspaces/ems/task-alpha.md");
    await expect(check(ask, assetIri)).resolves.toBe(true);

    // The over-encoded form (encodeURIComponent → `%2F`) is a DIFFERENT,
    // non-existent subject → the SAME true precondition silently evaluates
    // false. This is the mis-gating the LayoutService metadata threading
    // prevents by passing the store's real `?asset` IRI downstream.
    const overEncoded = `obsidian://vault/${encodeURIComponent(
      "assetspaces/ems/task-alpha.md",
    )}`;
    expect(overEncoded).toContain("%2F");
    await expect(check(ask, overEncoded)).resolves.toBe(false);
  });
});
