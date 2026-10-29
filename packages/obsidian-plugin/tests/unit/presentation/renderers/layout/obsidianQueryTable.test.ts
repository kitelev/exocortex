/**
 * RFC 9821a379 AC5 (ticket 058bad52) — the text of an IRI cell is the asset's
 * DISPLAY NAME (the resolver the Relations table uses), and a path that is not
 * an existing file is not a link (opening it would create a note).
 *
 * revert-verify: `obsidianQueryTable.spec.json`.
 */
import { TFile } from "obsidian";
import {
  IRI,
  InMemoryTripleStore,
  NamedQueryRunner,
  Triple,
  vaultPathToIRI,
  type QueryTableBlock,
} from "@kitelev/exocortex-core";
import {
  createObsidianQueryTableLinkText,
  createObsidianQueryTableProvider,
} from "../../../../../src/presentation/renderers/layout/obsidianQueryTable";
import { ObsidianQueryBodyResolver } from "../../../../../src/infrastructure/ObsidianQueryBodyResolver";

/** A TFile at `path` (the obsidian.d.ts constructor takes no arguments). */
function fileAt(path: string): TFile {
  return Object.assign(new TFile(), {
    path,
    extension: "md",
    basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
  });
}

function app(files: Record<string, Record<string, unknown> | null>) {
  return {
    vault: {
      getAbstractFileByPath: (path: string) =>
        path in files ? fileAt(path) : null,
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = files[file.path];
        return fm === null ? null : { frontmatter: fm };
      },
    },
  } as never;
}

const plugin = {
  printNameRuleService: undefined,
  settings: {
    displayNameSettings: {
      defaultTemplate: "✓ {{exo__Asset_label}}",
      classTemplates: {},
      projectTBoxNames: true,
    },
  },
} as never;

describe("query-table link text (RFC 9821a379 AC5, ticket 058bad52)", () => {
  it("L1 @req:23f10730-82f7-4037-b566-da79d5fa3378 an existing asset reads as its display name, not its bare label", () => {
    const text = createObsidianQueryTableLinkText(
      app({ "my/ep-1.md": { exo__Asset_label: "Утро" } }),
      plugin,
    );
    expect(text("my/ep-1.md")).toBe("✓ Утро");
  });

  it("L2 @req:23f10730-82f7-4037-b566-da79d5fa3378 a path that is not an existing file gives no link text", () => {
    const text = createObsidianQueryTableLinkText(app({}), plugin);
    expect(text("my/missing.md")).toBeNull();
  });

  it("L3 @req:23f10730-82f7-4037-b566-da79d5fa3378 an asset without a label falls back to its file name inside the display name", () => {
    const text = createObsidianQueryTableLinkText(
      app({ "my/0a1b.md": {} }),
      plugin,
    );
    expect(text("my/0a1b.md")).toBe("✓ 0a1b");
  });
  it("L4 @req:23f10730-82f7-4037-b566-da79d5fa3378 a vault exo__DisplayNameSpec rule applies, as in the Relations table", () => {
    const withRules = {
      printNameRuleService: {
        getParticipatingRules: (assetClass: string) =>
          assetClass === "ems__Task"
            ? [
                {
                  sourceFile: "spec.md",
                  priority: 0,
                  template: "🔄 {{exo__Asset_label}}",
                },
              ]
            : [],
        createMetadataResolver: () => null,
      },
      settings: {
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}}",
          classTemplates: {},
          projectTBoxNames: true,
        },
      },
    } as never;
    const text = createObsidianQueryTableLinkText(
      app({
        "my/t.md": {
          exo__Asset_label: "Задача",
          exo__Instance_class: ["[[ems__Task]]"],
        },
      }),
      withRules,
    );
    expect(text("my/t.md")).toBe("🔄 Задача");
  });

  describe("the plugin's provider factory (real body resolver + runner)", () => {
    const EXO = "https://exocortex.my/ontology/exo#";
    function vault(body: string) {
      const files: Record<
        string,
        { fm: Record<string, unknown>; content: string }
      > = {
        "q/query.md": {
          fm: { exo__Asset_uid: "q-uid", exo__Asset_label: "Эпизоды" },
          content:
            "---\nexo__Asset_uid: q-uid\n---\n```sparql\n" + body + "\n```\n",
        },
        "my/ep-1.md": { fm: { exo__Asset_label: "Утро" }, content: "" },
      };
      return {
        vault: {
          getMarkdownFiles: () => Object.keys(files).map(fileAt),
          getAbstractFileByPath: (p: string) => (p in files ? fileAt(p) : null),
          cachedRead: async (f: TFile) => files[f.path].content,
        },
        metadataCache: {
          getFileCache: (f: TFile) =>
            f.path in files ? { frontmatter: files[f.path].fm } : null,
        },
      } as never;
    }
    function provider(body: string) {
      const a = vault(body);
      const store = new InMemoryTripleStore();
      store.add(
        new Triple(
          new IRI(vaultPathToIRI("my/ep-1.md")),
          new IRI(`${EXO}Instance_class`),
          new IRI(`${EXO}Asset`),
        ),
      );
      const bodies = new ObsidianQueryBodyResolver(a);
      return createObsidianQueryTableProvider({
        app: a,
        plugin,
        runner: new NamedQueryRunner(bodies, store),
        queryLabels: bodies,
      });
    }
    const block = {
      kind: "query-table",
      uid: "b",
      title: "T",
      collapsed: false,
      layoutRef: "L",
      order: 1,
      sourcePath: "b.md",
      query: "q-uid",
      limit: 100,
      emptyText: "—",
    } as QueryTableBlock;

    it("O1 @req:23f10730-82f7-4037-b566-da79d5fa3378 rows of the query found by uid; an asset cell links with its display name", async () => {
      const out = await provider(
        `SELECT ?e WHERE { ?e <${EXO}Instance_class> ?k }`,
      )({ path: "n.md" }, block);
      expect(out).toMatchObject({
        kind: "rows",
        queryLabel: "Эпизоды",
        rows: [[{ kind: "link", path: "my/ep-1.md", text: "✓ Утро" }]],
      });
    });

    it("O2 @req:23f10730-82f7-4037-b566-da79d5fa3378 a problem is named by the query's own label", async () => {
      const out = await provider(
        `SELECT ?e WHERE { ?e <${EXO}Instance_class> $kind }`,
      )({ path: "n.md" }, block);
      expect(out).toEqual({
        kind: "unset-token",
        queryLabel: "Эпизоды",
        tokens: ["kind"],
      });
    });
  });
});
