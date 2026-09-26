/**
 * req f6690c74 (ticket eb603ba7) — `apply set-label-keep-alias`: an OPT-IN
 * relabel that keeps the previous exo__Asset_label in `aliases`, while the
 * default `set-label` keeps replacing the mirror (req f7790000-…0002).
 *
 * Production data, not hand-authored copies: the temp vault is built from the
 * REAL `packages/exoas-exocmd` and `packages/exoas-exo` submodule trees, so the
 * command, its composite grounding and every reused step are exactly what ships
 * (test-fixture-realism). The real `apply` pipeline runs over it and the target
 * file is read back — no --dry-run.
 *
 * The composite is [append $target.exo__Asset_label → set label → append
 * $input.label → bump updatedAt]; order matters: after the label is set,
 * `$target.exo__Asset_label` would read the NEW label.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";

const { applyCommand } = await import("../../src/commands/apply.js");

const PACKAGES = path.resolve(import.meta.dirname, "../../..");
const SUBMODULES = ["exoas-exocmd", "exoas-exo"] as const;
const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task

function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".github") continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

const submodulesPresent = SUBMODULES.every((m) =>
  fs.existsSync(path.join(PACKAGES, m, "exocmd")) || fs.existsSync(path.join(PACKAGES, m, "exo")),
);

(submodulesPresent ? describe : describe.skip)(
  "req f6690c74 — apply set-label-keep-alias over the real exoas-exocmd data",
  () => {
    let root: string;
    let n = 0;
    let exitSpy: jest.SpiedFunction<typeof process.exit>;
    let logSpy: jest.SpiedFunction<typeof console.log>;
    let errSpy: jest.SpiedFunction<typeof console.error>;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-keep-alias-"));
      for (const m of SUBMODULES) {
        copyTree(path.join(PACKAGES, m), path.join(root, "assetspaces", "kitelev", m));
      }
      fs.mkdirSync(path.join(root, "work"), { recursive: true });
    });

    afterAll(() => {
      if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    beforeEach(() => {
      exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
      logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    });

    function writeTarget(label: string, aliases: string[]): string {
      n += 1;
      const uid = `0000000${n.toString(16)}-6690-4c74-8000-000000000000`;
      const lines = [
        "---",
        `exo__Asset_uid: ${uid}`,
        `exo__Instance_class:`,
        `  - "[[${TASK_CLASS}]]"`,
        `exo__Asset_label: ${JSON.stringify(label)}`,
        `aliases:`,
        ...aliases.map((a) => `  - ${JSON.stringify(a)}`),
        `exo__Asset_updatedAt: 2020-01-01T00:00:00`,
        "---",
        "",
        "body",
        "",
      ];
      const rel = `work/${uid}.md`;
      fs.writeFileSync(path.join(root, rel), lines.join("\n"), "utf-8");
      return rel;
    }

    async function runApply(slug: string, rel: string, label: string): Promise<void> {
      const args = ["node", "apply", slug, rel, "--vault", root, "--yes", "--input", JSON.stringify({ label })];
      try {
        await applyCommand().parseAsync(args);
      } catch (err) {
        if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
      }
    }

    function frontmatter(rel: string): Record<string, unknown> {
      const text = fs.readFileSync(path.join(root, rel), "utf-8");
      const m = /^---\n([\s\S]*?)\n---/.exec(text);
      if (!m) throw new Error(`no frontmatter in ${rel}`);
      return yaml.load(m[1]) as Record<string, unknown>;
    }

    it("K1 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac keeps the previous label as an alias, then mirrors the new one, and bumps updatedAt", async () => {
      const rel = writeTarget("Old Label", ["Old Label"]);
      await runApply("set-label-keep-alias", rel, "New Label");
      const fm = frontmatter(rel);
      expect(fm["exo__Asset_label"]).toBe("New Label");
      expect(fm["aliases"]).toEqual(["Old Label", "New Label"]);
      expect(String(fm["exo__Asset_updatedAt"])).not.toContain("2020-01-01");
    }, 60_000);

    it("K2 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac preserves the other aliases already on the asset", async () => {
      const rel = writeTarget("Old Label", ["Old Label", "Some Synonym"]);
      await runApply("set-label-keep-alias", rel, "New Label");
      expect(frontmatter(rel)["aliases"]).toEqual(["Old Label", "Some Synonym", "New Label"]);
    }, 60_000);

    it("K3 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac adds the previous label even when it was not mirrored yet", async () => {
      const rel = writeTarget("Old Label", ["Some Synonym"]);
      await runApply("set-label-keep-alias", rel, "New Label");
      expect(frontmatter(rel)["aliases"]).toEqual(["Some Synonym", "Old Label", "New Label"]);
    }, 60_000);

    it("K4 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac relabelling to the same label duplicates nothing", async () => {
      const rel = writeTarget("Same", ["Same"]);
      await runApply("set-label-keep-alias", rel, "Same");
      const fm = frontmatter(rel);
      expect(fm["exo__Asset_label"]).toBe("Same");
      expect(fm["aliases"]).toEqual(["Same"]);
    }, 60_000);

    it("K5 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac a label that needs YAML quoting keeps the file parseable", async () => {
      const label = 'Meeting: Q3 "review"';
      const rel = writeTarget("Old Label", ["Old Label"]);
      await runApply("set-label-keep-alias", rel, label);
      const fm = frontmatter(rel);
      expect(fm["exo__Asset_label"]).toBe(label);
      expect(fm["aliases"]).toEqual(["Old Label", label]);
    }, 60_000);

    it("K6 @req:f6690c74-ec13-4918-9f8f-6e59a2e0b5ac the default set-label on the same data still replaces the mirror", async () => {
      const rel = writeTarget("Old Label", ["Old Label", "Some Synonym"]);
      await runApply("set-label", rel, "New Label");
      expect(frontmatter(rel)["aliases"]).toEqual(["New Label"]);
    }, 60_000);
  },
);
