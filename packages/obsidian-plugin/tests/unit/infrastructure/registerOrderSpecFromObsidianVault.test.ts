/**
 * Tests for `registerOrderSpecFromObsidianVault` — plugin-side loader
 * that scans the live Obsidian vault via metadataCache for an
 * `exo__FrontmatterOrderSpec` asset marked with `_default: true`.
 *
 * Fakes mirror real Obsidian API contract per
 * ~/.claude/rules/test-fixture-realism.md — getFileCache returns null
 * for files without frontmatter, frontmatter object is a plain Record.
 *
 * RFC 27a7a877.
 */
import {
  registerOrderSpecFromObsidianVault,
  loadSpecFromVault,
} from "../../../src/infrastructure/registerOrderSpecFromObsidianVault";
import {
  loadDefaultSpec,
  clearOrderSpecLoader,
} from "exocortex";

interface FakeFile {
  path: string;
  basename: string;
}

interface FakeApp {
  vault: {
    getMarkdownFiles: () => FakeFile[];
  };
  metadataCache: {
    getFileCache: (f: FakeFile) => { frontmatter?: Record<string, unknown> } | null;
  };
}

function makeApp(
  filesWithFm: Array<{ path: string; frontmatter: Record<string, unknown> | null }>,
): FakeApp {
  const files: FakeFile[] = filesWithFm.map((f) => ({
    path: f.path,
    basename: f.path.split("/").pop()!.replace(/\.md$/, ""),
  }));
  const fmMap = new Map(filesWithFm.map((f) => [f.path, f.frontmatter]));
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: {
      getFileCache: (f: FakeFile) => {
        const fm = fmMap.get(f.path);
        if (fm === null || fm === undefined) return null;
        return { frontmatter: fm };
      },
    },
  };
}

const SAMPLE_HEAD = ["exo__Asset_isDefinedBy", "exo__Asset_uid"];
const SAMPLE_TAIL = ["exo__Asset_label", "aliases"];

describe("registerOrderSpecFromObsidianVault", () => {
  beforeEach(() => clearOrderSpecLoader());
  afterAll(() => clearOrderSpecLoader());

  describe("loadSpecFromVault (pure)", () => {
    it("returns the spec from the default-marked asset", () => {
      const app = makeApp([
        {
          path: "assetspaces/exo/spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_middleStrategy: "alphabetical",
            exo__FrontmatterOrderSpec_head: SAMPLE_HEAD,
            exo__FrontmatterOrderSpec_tail: SAMPLE_TAIL,
          },
        },
      ]);
      const spec = loadSpecFromVault(app as never);
      expect(spec).not.toBeNull();
      expect(spec!.head).toEqual(SAMPLE_HEAD);
      expect(spec!.tail).toEqual(SAMPLE_TAIL);
      expect(spec!.middleStrategy).toBe("alphabetical");
    });

    it("returns null when no asset is marked default", () => {
      const app = makeApp([
        {
          path: "assetspaces/exo/non-default.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: false,
            exo__FrontmatterOrderSpec_head: SAMPLE_HEAD,
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)).toBeNull();
    });

    it("returns null when vault has no markdown files", () => {
      const app = makeApp([]);
      expect(loadSpecFromVault(app as never)).toBeNull();
    });

    it("skips files without frontmatter (real Obsidian returns null)", () => {
      const app = makeApp([
        { path: "notes/random.md", frontmatter: null },
        {
          path: "assetspaces/exo/spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_head: SAMPLE_HEAD,
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)!.head).toEqual(SAMPLE_HEAD);
    });

    it("defaults middleStrategy to 'alphabetical' when missing", () => {
      const app = makeApp([
        {
          path: "spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)!.middleStrategy).toBe("alphabetical");
    });

    it("returns empty arrays when head/tail keys are absent", () => {
      const app = makeApp([
        {
          path: "spec.md",
          frontmatter: { exo__FrontmatterOrderSpec_default: true },
        },
      ]);
      const spec = loadSpecFromVault(app as never)!;
      expect(spec.head).toEqual([]);
      expect(spec.tail).toEqual([]);
    });

    it("filters non-string entries in head/tail (defensive)", () => {
      const app = makeApp([
        {
          path: "spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_head: ["valid", 42, null, "also-valid"],
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)!.head).toEqual(["valid", "also-valid"]);
    });

    it("does not match `_default: 'true'` string as truthy", () => {
      const app = makeApp([
        {
          path: "spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: "true",
            exo__FrontmatterOrderSpec_head: SAMPLE_HEAD,
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)).toBeNull();
    });

    it("returns the first default-marked file encountered", () => {
      const app = makeApp([
        {
          path: "a.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_head: ["first"],
          },
        },
        {
          path: "b.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_head: ["second"],
          },
        },
      ]);
      expect(loadSpecFromVault(app as never)!.head).toEqual(["first"]);
    });
  });

  describe("registerOrderSpecFromObsidianVault (integration)", () => {
    it("registers a loader that returns the spec via loadDefaultSpec()", () => {
      const app = makeApp([
        {
          path: "spec.md",
          frontmatter: {
            exo__FrontmatterOrderSpec_default: true,
            exo__FrontmatterOrderSpec_head: SAMPLE_HEAD,
            exo__FrontmatterOrderSpec_tail: SAMPLE_TAIL,
          },
        },
      ]);
      registerOrderSpecFromObsidianVault(app as never);
      const spec = loadDefaultSpec();
      expect(spec).not.toBeNull();
      expect(spec!.head).toEqual(SAMPLE_HEAD);
      expect(spec!.tail).toEqual(SAMPLE_TAIL);
    });

    it("loader returns null when no default asset exists", () => {
      const app = makeApp([
        {
          path: "non-default.md",
          frontmatter: { exo__FrontmatterOrderSpec_default: false },
        },
      ]);
      registerOrderSpecFromObsidianVault(app as never);
      expect(loadDefaultSpec()).toBeNull();
    });
  });
});
