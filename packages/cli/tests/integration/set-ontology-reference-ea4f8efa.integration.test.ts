/**
 * req ea4f8efa — `apply set-ontology` writes exo__Asset_isDefinedBy as a
 * "[[<uid>]]" reference, so the graph gets the asset → ontology EDGE.
 *
 * Before (step 1585f1cb used `targetValueSubstitution: $input.ontology`) the
 * command wrote the bare uid, which emits as the LITERAL "<uid>": no edge, while
 * the relocation still worked and every check stayed green. The step now uses
 * `targetValueRef: $input.ontology` (the channel of req b06129dc).
 *
 * Driven against the SHIPPED command: the `exoas-exo` + `exoas-exocmd`
 * submodules are copied into a temp vault and the command is called BY SLUG.
 *
 *  O1 frontmatter holds "[[<B>]]", not the bare uid
 *  O2 the graph emits the ontology's file IRI, not a literal
 *  O3 control: the asset is relocated into B's folder (unchanged behaviour)
 *  O4 an input already wrapped as [[<B>|alias]] writes the same single reference
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { NoteToRDFConverter, DomainIRI } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";

const { applyCommand } = await import("../../src/commands/apply.js");

const ONTO_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ONTO_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ASSET = "cccccccc-0000-4000-8000-00000000000c";
const IS_DEFINED_BY = "https://exocortex.my/ontology/exo#Asset_isDefinedBy";
const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ontology = (uid: string, label: string) =>
  [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: ${label}`,
    "exo__Instance_class:",
    '  - "[[exo__Ontology]]"',
    `exo__Asset_isDefinedBy: "[[${uid}]]"`,
    "---",
    "",
  ].join("\n");

describe("req ea4f8efa — apply set-ontology writes a [[uid]] reference", () => {
  let root: string;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-set-ontology-"));
    for (const sub of ["exoas-exo", "exoas-exocmd"]) {
      const src = path.join(PACKAGES, sub);
      const entries = fs.existsSync(src) ? fs.readdirSync(src).filter((e) => e !== ".git") : [];
      if (entries.length === 0) {
        throw new Error(`submodule ${src} is empty — run \`git submodule update --init\``);
      }
      fs.cpSync(src, path.join(root, "assetspaces", "kitelev", sub), {
        recursive: true,
        filter: (p) => path.basename(p) !== ".git",
      });
    }
    fs.mkdirSync(path.join(root, "space-a"));
    fs.mkdirSync(path.join(root, "space-b"));
    fs.writeFileSync(path.join(root, "space-a", `${ONTO_A}.md`), ontology(ONTO_A, "$onto-a"));
    fs.writeFileSync(path.join(root, "space-b", `${ONTO_B}.md`), ontology(ONTO_B, "$onto-b"));
    fs.writeFileSync(
      path.join(root, "space-a", `${ASSET}.md`),
      [
        "---",
        `exo__Asset_uid: ${ASSET}`,
        "exo__Asset_label: Some asset",
        "exo__Instance_class:",
        '  - "[[ems__Task]]"',
        `exo__Asset_isDefinedBy: "[[${ONTO_A}]]"`,
        "---",
        "",
        "# Body",
        "",
      ].join("\n"),
    );
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function setOntology(input: string): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        "set-ontology",
        `space-a/${ASSET}.md`,
        "--vault",
        root,
        "--input",
        JSON.stringify({ ontology: input }),
        "--yes",
      ]);
    } catch (e) {
      if (!/^__process_exit_/.test(String((e as Error)?.message))) throw e;
    }
  }

  const movedPath = () => path.join(root, "space-b", `${ASSET}.md`);
  const originalPath = () => path.join(root, "space-a", `${ASSET}.md`);
  // Reads whichever copy exists, so a refused run (asset still in space-a)
  // fails on the VALUE, not on ENOENT. Relocation itself is O3's job.
  const isDefinedByLine = () =>
    fs
      .readFileSync(fs.existsSync(movedPath()) ? movedPath() : originalPath(), "utf-8")
      .split("\n")
      .find((l) => l.startsWith("exo__Asset_isDefinedBy:"));

  it(`O1 @req:ea4f8efa-805a-4492-ab51-15452d4b66c5 the frontmatter holds "[[<B>]]", not the bare uid`, async () => {
    await setOntology(ONTO_B);
    expect(isDefinedByLine()).toBe(`exo__Asset_isDefinedBy: "[[${ONTO_B}]]"`);
  }, 60_000);

  it(`O2 @req:ea4f8efa-805a-4492-ab51-15452d4b66c5 the graph emits the ontology's file IRI, not a literal`, async () => {
    await setOntology(ONTO_B);
    const adapter = new FileSystemVaultAdapter(root);
    const file = adapter.getAbstractFileByPath(`space-b/${ASSET}.md`);
    expect(file).not.toBeNull();
    const triples = await new NoteToRDFConverter(adapter).convertNote(file as never);
    const objects = triples.filter((t) => String(t.predicate.value) === IS_DEFINED_BY).map((t) => t.object);
    expect(objects.map((o) => o instanceof DomainIRI)).toEqual([true]);
    expect(objects.map((o) => String((o as { value: unknown }).value))).toEqual([
      `obsidian://vault/space-b/${ONTO_B}.md`,
    ]);
  }, 60_000);

  it("O3 control: the asset is relocated into the picked ontology's folder", async () => {
    await setOntology(ONTO_B);
    expect(fs.existsSync(movedPath())).toBe(true);
    expect(fs.existsSync(path.join(root, "space-a", `${ASSET}.md`))).toBe(false);
    const out = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("✅ Ontology changed; asset relocated to its folder");
  }, 60_000);

  it(`O4 @req:ea4f8efa-805a-4492-ab51-15452d4b66c5 an input already wrapped as [[<B>|alias]] writes the same single reference`, async () => {
    await setOntology(`[[${ONTO_B}|$onto-b]]`);
    expect(isDefinedByLine()).toBe(`exo__Asset_isDefinedBy: "[[${ONTO_B}]]"`);
  }, 60_000);

  // The plugin's ReferencePicker commits the quoted form. It worked before this
  // fix too (verbatim path), so this is a surface control, green under M1.
  it(`O5 @req:ea4f8efa-805a-4492-ab51-15452d4b66c5 the picker's quoted "[[<B>]]" writes the same single reference`, async () => {
    await setOntology(`"[[${ONTO_B}]]"`);
    expect(isDefinedByLine()).toBe(`exo__Asset_isDefinedBy: "[[${ONTO_B}]]"`);
  }, 60_000);

  // An unquoted [[<B>]] was refused on the verbatim path (req 29e0d1b6); on the
  // reference path it is normalised — red under M1.
  it(`O6 @req:ea4f8efa-805a-4492-ab51-15452d4b66c5 an unquoted [[<B>]] writes the same single reference`, async () => {
    await setOntology(`[[${ONTO_B}]]`);
    expect(isDefinedByLine()).toBe(`exo__Asset_isDefinedBy: "[[${ONTO_B}]]"`);
  }, 60_000);
});
