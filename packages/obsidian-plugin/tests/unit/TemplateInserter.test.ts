/**
 * Unit tests — TemplateInserter (homoiconic templating Веха 2: "Insert
 * template", project 17f58ebe / vision 09a3fbec).
 *
 * The editor "Insert template" command enumerates the user's vault for
 * `exotemplate__Template` assets (homoiconic — templates ARE vault assets, not
 * hardcoded blocks), lets the user fuzzy-pick one, then inserts its body at the
 * cursor with `$token` substitution markers resolved via the shared
 * SubstitutionResolverRegistry (interview Q6 — reuse, not a duplicate).
 *
 * Fakes mirror the real Obsidian contract (test-fixture-realism):
 *   - `metadataCache.getFileCache(file)?.frontmatter` returns the parsed YAML
 *     object; wikilink values keep their `[[…]]` brackets as literal strings,
 *     and `exo__Instance_class` is an ARRAY of such strings.
 *   - `vault.getMarkdownFiles()` returns `{ path }`-shaped files.
 */

import {
  EXOTEMPLATE_TEMPLATE_CLASS_LABEL,
  EXOTEMPLATE_TEMPLATE_CLASS_UID,
  collectTemplateChoices,
  extractTemplateBody,
  resolveTemplateForInsert,
  type TemplateInserterApp,
} from "../../src/infrastructure/adapters/TemplateInserter";
import {
  clearResolvers,
  installDefaultResolvers,
  registerResolver,
} from "exocortex";

interface FakeFile {
  path: string;
}

function makeApp(
  files: Array<{ path: string; frontmatter: Record<string, unknown> | null }>,
): TemplateInserterApp {
  const fmByPath = new Map(files.map((f) => [f.path, f.frontmatter]));
  return {
    vault: {
      getMarkdownFiles: () => files.map((f) => ({ path: f.path }) as FakeFile),
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const fm = fmByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as TemplateInserterApp;
}

const TPL = `"[[${EXOTEMPLATE_TEMPLATE_CLASS_UID}]]"`;

describe("collectTemplateChoices — enumerate exotemplate__Template assets", () => {
  it("returns only assets whose exo__Instance_class includes the Template class UID", () => {
    const app = makeApp([
      {
        path: "tpl/project.md",
        frontmatter: {
          exo__Instance_class: [TPL],
          exo__Asset_label: "Project body",
        },
      },
      {
        path: "notes/random.md",
        frontmatter: {
          exo__Instance_class: ['"[[1b20a8f0-d745-4e93-91db-4531b3df120e]]"'],
          exo__Asset_label: "Some Task",
        },
      },
      { path: "notes/no-fm.md", frontmatter: null },
    ]);
    const choices = collectTemplateChoices(app);
    expect(choices.map((c) => c.path)).toEqual(["tpl/project.md"]);
    expect(choices[0].label).toBe("Project body");
  });

  it("matches the symbolic class label form too (`[[exotemplate__Template]]`)", () => {
    const app = makeApp([
      {
        path: "tpl/sym.md",
        frontmatter: {
          exo__Instance_class: [`"[[${EXOTEMPLATE_TEMPLATE_CLASS_LABEL}]]"`],
          exo__Asset_label: "Sym template",
        },
      },
    ]);
    expect(collectTemplateChoices(app).map((c) => c.path)).toEqual(["tpl/sym.md"]);
  });

  it("matches the alias wikilink form `[[uid|alias]]` and a scalar (non-array) class value", () => {
    const app = makeApp([
      {
        path: "tpl/alias.md",
        frontmatter: {
          exo__Instance_class: `"[[${EXOTEMPLATE_TEMPLATE_CLASS_UID}|exotemplate__Template]]"`,
          exo__Asset_label: "Alias template",
        },
      },
    ]);
    expect(collectTemplateChoices(app).map((c) => c.path)).toEqual(["tpl/alias.md"]);
  });

  it("falls back to the file basename when exo__Asset_label is missing", () => {
    const app = makeApp([
      {
        path: "tpl/8bdf4506-no-label.md",
        frontmatter: { exo__Instance_class: [TPL] },
      },
    ]);
    expect(collectTemplateChoices(app)[0].label).toBe("8bdf4506-no-label");
  });

  it("sorts choices by label (case-insensitive) for a stable picker order", () => {
    const app = makeApp([
      {
        path: "tpl/z.md",
        frontmatter: { exo__Instance_class: [TPL], exo__Asset_label: "Zebra" },
      },
      {
        path: "tpl/a.md",
        frontmatter: { exo__Instance_class: [TPL], exo__Asset_label: "apple" },
      },
    ]);
    expect(collectTemplateChoices(app).map((c) => c.label)).toEqual([
      "apple",
      "Zebra",
    ]);
  });
});

describe("extractTemplateBody — strip leading frontmatter", () => {
  it("returns the body after the frontmatter block (no leading blank line)", () => {
    const content = `---\nexo__Asset_uid: x\nexo__Asset_label: T\n---\n## Plan\n- step`;
    expect(extractTemplateBody(content)).toBe("## Plan\n- step");
  });

  it("returns the whole content unchanged when there is no frontmatter", () => {
    expect(extractTemplateBody("## Just a body\n- x")).toBe("## Just a body\n- x");
  });

  it("handles an empty body after frontmatter", () => {
    expect(extractTemplateBody(`---\nexo__Asset_uid: x\n---\n`)).toBe("");
  });

  it("strips a CRLF frontmatter block (L1 — Windows vault) without leaking it", () => {
    const content = `---\r\nexo__Asset_label: T\r\n---\r\n## Plan\r\n- step`;
    expect(extractTemplateBody(content)).toBe("## Plan\r\n- step");
  });
});

describe("resolveTemplateForInsert — strip frontmatter + resolve tokens", () => {
  beforeEach(() => {
    clearResolvers();
    installDefaultResolvers();
  });

  it("strips frontmatter then resolves $tokens in the body", () => {
    registerResolver("nowDate", () => "2026-06-20");
    const content = `---\nexo__Asset_label: T\n---\n## Log\n- opened $nowDate`;
    expect(resolveTemplateForInsert(content)).toBe("## Log\n- opened 2026-06-20");
  });

  it("leaves unknown tokens literal (lenient body resolution)", () => {
    const content = `---\nexo__Asset_label: T\n---\nCost: $5 — $unknownToken`;
    expect(resolveTemplateForInsert(content)).toBe("Cost: $5 — $unknownToken");
  });
});
