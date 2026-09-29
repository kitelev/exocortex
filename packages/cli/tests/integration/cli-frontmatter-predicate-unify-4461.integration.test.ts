/**
 * Integration axes for #4461 / #4459 / #4460 — the remaining `packages/cli`
 * surfaces decide "is a frontmatter block present?" through core's ONE
 * predicate (`matchFrontmatterBlock` / `frontmatterBlockBody`,
 * `packages/core/src/utilities/frontmatterBlock.ts`, req `1dfbd427`, #4453).
 *
 * ⛤ #4461 (`FileSystemVaultAdapter`) is a pure REFACTOR and has NO axis here —
 *    its equivalence proof is req `c05a3565`'s 17 axes B1-B17 staying green
 *    UNCHANGED (`issue-4441-crlf-bom-frontmatter.integration.test.ts`) plus the
 *    WIRING mutant in `cli-frontmatter-predicate-unify-4461.vault-adapter.spec.json`.
 *    Adding a new axis for it would only restate what those already assert.
 *
 * ⛔ The C/D/E axes below are NOT refactors: each site was still LF-only, so a
 *    CRLF-fenced or BOM-led file was invisible to it while the LOADER has seen
 *    it since #4450. Every one of them fails in the PERMISSIVE / silent
 *    direction, which is why none of them ever surfaced:
 *
 *      C  the dry-run SHACL gate waved a violating candidate through (#4459)
 *      D  `apply`'s create-instance resolvers could not find a referenced
 *         asset that `exocortex-cli query` finds fine (#4460)
 *      E  two further sites the `/^---\n` census of `packages/cli/src` turned
 *         up, with no work item of their own: the order-spec loader and the
 *         audit's body/frontmatter split
 *
 * ⛔ Axis names are `C<n>` / `D<n>` / `E<n>` FIRST TOKEN on purpose — the mutant
 *    driver extracts redness from the jest `● <suite> › <name>` line, so the
 *    name is a machine key (integration-test-revert-verify §A47 / §A104).
 */
import "reflect-metadata";
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
import fs from "fs-extra";
import os from "os";
import path from "path";
import { NoteToRDFConverter } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../src/adapters/FileSystemVaultAdapter.js";
import { NodeFsAdapter } from "../../src/adapters/NodeFsAdapter.js";
import { CachingNodeFsAdapter } from "../../src/adapters/CachingNodeFsAdapter.js";
import { TripleStoreIndexedFsAdapter } from "../../src/adapters/TripleStoreIndexedFsAdapter.js";
import { CandidateShaclValidator } from "../../src/services/CandidateShaclValidator.js";
import { bodyOf } from "../../src/services/wikilinkExtraction.js";
import { registerOrderSpecFromVault } from "../../src/services/registerOrderSpec.js";

const { applyCommand } = await import("../../src/commands/apply.js");
const { loadDefaultSpec, clearOrderSpecLoader } = await import(
  "@kitelev/exocortex-core",
);

const REQ = "@req:6ac9b517-68de-4957-b5c8-ba95d97687df";
const BOM = "﻿";

/** LF → CRLF everywhere, including inside the YAML body. */
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

function writeAll(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf-8");
  }
}

// ───────────────────────────────────────────────────────────── C: #4459 ─────
// A `sh:class` violation, modelled on the #4350 fixture: a property whose
// range is `t__Agent` pointed at something that is not one.

const C = {
  EXO_ASSET: "44590000-0000-4000-8000-000000000001",
  EXO_CLASS: "44590000-0000-4000-8000-000000000002",
  AGENT: "44590000-0000-4000-8000-000000000003",
  AREA: "44590000-0000-4000-8000-000000000004",
  OWNER_PROP: "44590000-0000-4000-8000-000000000005",
  CONTACT: "44590000-0000-4000-8000-000000000010",
  AREA_OK: "44590000-0000-4000-8000-000000000011",
  CANDIDATE: "44590000-0000-4000-8000-0000000000aa",
};
const OWNER_PATH = "https://exocortex.my/ontology/t#Area_owner";

const cls = (uid: string, label: string, superUid?: string): string =>
  [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: ${label}`,
    "exo__Instance_class:",
    '  - "[[exo__Class]]"',
    ...(superUid ? ["exo__Class_superClass:", `  - "[[${superUid}]]"`] : []),
    "---",
    "",
  ].join("\n");

/** An `t__Area` whose owner is `ownerUid`. LF form; the axes re-encode it. */
const areaAsset = (uid: string, ownerUid: string): string =>
  [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "Area ${uid.slice(-4)}"`,
    "exo__Instance_class:",
    `  - "[[${C.AREA}]]"`,
    `t__Area_owner: "[[${ownerUid}]]"`,
    "---",
    "",
  ].join("\n");

function seedShaclVault(root: string): void {
  writeAll(root, {
    [`tbox/${C.EXO_ASSET}.md`]: cls(C.EXO_ASSET, "exo__Asset"),
    [`tbox/${C.EXO_CLASS}.md`]: cls(C.EXO_CLASS, "exo__Class", C.EXO_ASSET),
    [`tbox/${C.AGENT}.md`]: cls(C.AGENT, "t__Agent", C.EXO_ASSET),
    [`tbox/${C.AREA}.md`]: cls(C.AREA, "t__Area", C.EXO_ASSET),
    [`tbox/${C.OWNER_PROP}.md`]: [
      "---",
      `exo__Asset_uid: ${C.OWNER_PROP}`,
      "exo__Asset_label: t__Area_owner",
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
      "exo__Property_domain:",
      `  - "[[${C.AREA}]]"`,
      "exo__Property_range:",
      `  - "[[${C.AGENT}]]"`,
      "---",
      "",
    ].join("\n"),
    [`abox/${C.CONTACT}.md`]: [
      "---",
      `exo__Asset_uid: ${C.CONTACT}`,
      'exo__Asset_label: "An agent"',
      "exo__Instance_class:",
      `  - "[[${C.AGENT}]]"`,
      "---",
      "",
    ].join("\n"),
    [`abox/${C.AREA_OK}.md`]: areaAsset(C.AREA_OK, C.CONTACT),
  });
}

// ───────────────────────────────────────────────────────────── D: #4460 ─────

const D = {
  CLASS: "44600000-0000-4000-8000-000000000001",
  EXO_CLASS: "44600000-0000-4000-8000-000000000002",
  COMMAND: "44600000-0000-4000-8000-000000000003",
  GROUNDING: "44600000-0000-4000-8000-000000000004",
  TARGET: "44600000-0000-4000-8000-000000000005",
  PLAIN: "44600000-0000-4000-8000-000000000006",
  BOMMED: "44600000-0000-4000-8000-000000000007",
  ONTO: "44600000-0000-4000-8000-000000000008",
  PROP_ISDEFINEDBY: "44600000-0000-4000-8000-000000000009",
  RULE_ISDEFINEDBY: "44600000-0000-4000-8000-00000000000a",
};
const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
const SEED = "99999999-8888-7777-6666-555555555555";
const FROZEN_CLOCK = "2026-01-01T00:00:00Z";

const fm = (...lines: string[]) => ["---", ...lines, "---", ""].join("\n");

/**
 * ⛤ D3's discriminator is the ONTOLOGY asset, and choosing it took a
 * measurement rather than a guess. The obvious candidate — a CRLF-fenced CLASS
 * asset resolved by `classLabelToUid` — turned out NOT to discriminate: run
 * against the LF-only mutant it stayed GREEN, because a class-shaped literal
 * (`t__Thing`) is substituted to the class IRI by the converter and `apply`
 * never has to ask the filesystem. `$isDefinedByFolder` does:
 * `createVaultFrontmatterRefToFolderResolver` →
 * `findFilesByMetadata({ exo__Asset_uid })` → index candidate → confirmation
 * read through `NodeFsAdapter.extractFrontmatter`. So the CRLF-fenced asset
 * that matters is the ONTOLOGY the target points at, and the observable is
 * WHERE the instance lands.
 */
function seedApplyVault(root: string): void {
  writeAll(root, {
    [`tbox/${D.EXO_CLASS}.md`]: fm(
      `exo__Asset_uid: ${D.EXO_CLASS}`,
      "exo__Asset_label: exo__Class",
    ),
    [`tbox/${D.CLASS}.md`]: crlf(
      fm(
        `exo__Asset_uid: ${D.CLASS}`,
        "exo__Asset_label: t__Thing",
        "aliases:",
        "  - t__Thing",
        "exo__Instance_class:",
        '  - "[[exo__Class]]"',
      ),
    ),
    [`tbox/${D.BOMMED}.md`]:
      BOM +
      fm(
        `exo__Asset_uid: ${D.BOMMED}`,
        "exo__Asset_label: t__BomLed",
        "exo__Instance_class:",
        '  - "[[exo__Class]]"',
      ),
    // CRLF-fenced ONTOLOGY anchor — `$isDefinedByFolder` must resolve to `onto`.
    [`onto/${D.ONTO}.md`]: crlf(
      fm(
        `exo__Asset_uid: ${D.ONTO}`,
        'exo__Asset_label: "The ontology"',
        "exo__Instance_class:",
        '  - "[[exo__Ontology]]"',
      ),
    ),
    [`abox/${D.PLAIN}.md`]: fm(
      `exo__Asset_uid: ${D.PLAIN}`,
      'exo__Asset_label: "Plain LF asset"',
    ),
    [`tbox/${D.PROP_ISDEFINEDBY}.md`]: fm(
      `exo__Asset_uid: ${D.PROP_ISDEFINEDBY}`,
      "exo__Asset_label: exo__Asset_isDefinedBy",
      "exo__Instance_class:",
      '  - "[[exo__Property]]"',
    ),
    // Copies `exo__Asset_isDefinedBy` from the target onto the new instance —
    // the value `$isDefinedByFolder` then resolves to a folder. Mirrors the
    // #4272 fixture's rule 1.
    [`cmd/${D.RULE_ISDEFINEDBY}.md`]: fm(
      `exo__Asset_uid: ${D.RULE_ISDEFINEDBY}`,
      'exo__Asset_label: "Inherit isDefinedBy from the target"',
      "exo__Instance_class:",
      '  - "[[exocmd__InheritanceRule]]"',
      `exocmd__InheritanceRule_sourceProperty: "[[${D.PROP_ISDEFINEDBY}]]"`,
      `exocmd__InheritanceRule_targetProperty: "[[${D.PROP_ISDEFINEDBY}]]"`,
      "exocmd__InheritanceRule_priority: 50",
    ),
    [`cmd/${D.GROUNDING}.md`]: fm(
      `exo__Asset_uid: ${D.GROUNDING}`,
      'exo__Asset_label: "Create t__Thing instance (4460)"',
      "exo__Instance_class:",
      '  - "[[exocmd__Grounding]]"',
      `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
      'exocmd__Grounding_targetClass: "t__Thing"',
      'exocmd__Grounding_targetFolder: "$isDefinedByFolder"',
      "exocmd__Grounding_inheritanceRule:",
      `  - "[[${D.RULE_ISDEFINEDBY}]]"`,
    ),
    [`cmd/${D.COMMAND}.md`]: fm(
      `exo__Asset_uid: ${D.COMMAND}`,
      'exo__Asset_label: "Create t__Thing instance (4460)"',
      "exo__Instance_class:",
      '  - "[[exocmd__Command]]"',
      `exocmd__Command_grounding: "[[${D.GROUNDING}]]"`,
      'exocmd__Command_successMessage: "Created"',
    ),
    [`abox/${D.TARGET}.md`]: fm(
      `exo__Asset_uid: ${D.TARGET}`,
      'exo__Asset_label: "The target"',
      `exo__Asset_isDefinedBy: "[[${D.ONTO}]]"`,
      "exo__Instance_class:",
      `  - "[[${D.CLASS}]]"`,
    ),
  });
}

/** The index source `apply` builds: the loader's explicit triples + zero-triple paths. */
async function indexSource(root: string) {
  const converter = new NoteToRDFConverter(new FileSystemVaultAdapter(root));
  const result = await converter.convertVaultWithValidation({ strict: false });
  return {
    explicitTriples: result.triples,
    zeroTriplePaths: result.skippedFiles.map((s) => s.path),
  };
}

// ════════════════════════════════════════════════════════════════════════════

describe("#4459 the dry-run SHACL gate sees a CRLF/BOM-fenced candidate", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4459-"));
    seedShaclVault(root);
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  const ownerViolations = (
    result: Awaited<ReturnType<CandidateShaclValidator["validateCandidate"]>>,
  ) => result.violations.filter((v) => v.propertyIri === OWNER_PATH);

  it(`C1 a CRLF-fenced candidate that violates a shape is REPORTED, not waved through ${REQ}`, async () => {
    // The owner is another AREA, not an agent ⇒ one sh:class violation.
    const content = crlf(areaAsset(C.CANDIDATE, C.AREA_OK));
    expect(content).toContain("---\r\n"); // the fixture really is CRLF-fenced

    const result = await new CandidateShaclValidator(root).validateCandidate(
      `abox/${C.CANDIDATE}.md`,
      content,
    );

    expect(ownerViolations(result)).toHaveLength(1);
  }, 60_000);

  it(`C2 a BOM-prefixed candidate that violates a shape is REPORTED, not waved through ${REQ}`, async () => {
    const content = BOM + areaAsset(C.CANDIDATE, C.AREA_OK);

    const result = await new CandidateShaclValidator(root).validateCandidate(
      `abox/${C.CANDIDATE}.md`,
      content,
    );

    expect(ownerViolations(result)).toHaveLength(1);
  }, 60_000);

  it(`C3 control — a VALID CRLF-fenced candidate still passes (no false positive) ${REQ}`, async () => {
    const result = await new CandidateShaclValidator(root).validateCandidate(
      `abox/${C.CANDIDATE}.md`,
      crlf(areaAsset(C.CANDIDATE, C.CONTACT)),
    );

    expect(ownerViolations(result)).toEqual([]);
  }, 60_000);

  it(`C4 control — a candidate with NO block at all is still "nothing to validate" ${REQ}`, async () => {
    const result = await new CandidateShaclValidator(root).validateCandidate(
      `abox/${C.CANDIDATE}.md`,
      "no frontmatter here, just prose\n",
    );

    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
  }, 60_000);
});

describe("#4460 apply's create-instance resolvers see a CRLF/BOM-fenced asset", () => {
  let root: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4460-"));
    seedApplyVault(root);
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it(`D1 findFilesByMetadata finds a CRLF-fenced asset by its label ${REQ}`, async () => {
    const adapter = new TripleStoreIndexedFsAdapter(
      root,
      await indexSource(root),
    );

    await expect(
      adapter.findFilesByMetadata({ exo__Asset_label: "t__Thing" }),
    ).resolves.toEqual([`tbox/${D.CLASS}.md`]);
  }, 60_000);

  it(`D2 findFilesByMetadata finds a BOM-prefixed asset by its label ${REQ}`, async () => {
    const adapter = new TripleStoreIndexedFsAdapter(
      root,
      await indexSource(root),
    );

    await expect(
      adapter.findFilesByMetadata({ exo__Asset_label: "t__BomLed" }),
    ).resolves.toEqual([`tbox/${D.BOMMED}.md`]);
  }, 60_000);

  it(`D3 a REAL apply create-instance co-locates into the folder of a CRLF-fenced ontology asset ${REQ}`, async () => {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        D.COMMAND,
        `abox/${D.TARGET}.md`,
        "--vault",
        root,
        "--input",
        JSON.stringify({ label: "An instance" }),
        "--seed",
        SEED,
        "--frozen-clock",
        FROZEN_CLOCK,
      ]);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }

    // \u26d4 The verdict is WHERE the asset landed. Before the fix
    //    `$isDefinedByFolder` could not confirm the CRLF-fenced ontology
    //    candidate, so the resolver answered `null` and the instance was
    //    written somewhere else entirely \u2014 the user-visible consequence the
    //    issue names, and one no `getFileMetadata`-only axis would show.
    const inOnto = fs
      .readdirSync(path.join(root, "onto"))
      .filter((f) => f.endsWith(".md") && !f.startsWith(D.ONTO));
    expect(inOnto).toHaveLength(1);

    const content = fs.readFileSync(path.join(root, "onto", inOnto[0]!), "utf-8");
    expect(content).toContain("An instance");
  }, 90_000);

  it(`D4 control — a file with NO block still yields {} (this adapter's contract, NOT null) ${REQ}`, async () => {
    writeAll(root, { "abox/no-block.md": "just prose, no fences\n" });
    const adapter = new NodeFsAdapter(root);

    await expect(adapter.getFileMetadata("abox/no-block.md")).resolves.toEqual(
      {},
    );
  }, 60_000);

  it(`D5 CachingNodeFsAdapter parses through the SAME implementation — the invariant the protected modifier exists for ${REQ}`, async () => {
    const plain = new NodeFsAdapter(root);
    const caching = new CachingNodeFsAdapter(root);

    for (const rel of [
      `tbox/${D.CLASS}.md`, // CRLF
      `tbox/${D.BOMMED}.md`, // BOM
      `abox/${D.PLAIN}.md`, // LF
    ]) {
      await expect(caching.getFileMetadata(rel)).resolves.toEqual(
        await plain.getFileMetadata(rel),
      );
    }
    // Not vacuous: the CRLF file must have real keys on BOTH paths.
    await expect(caching.getFileMetadata(`tbox/${D.CLASS}.md`)).resolves.toEqual(
      expect.objectContaining({ exo__Asset_label: "t__Thing" }),
    );
  }, 60_000);
});

describe("#4461 ratchet — the two further LF-only sites the census turned up", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4461-ratchet-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it(`E1 bodyOf on a CRLF-fenced file returns the BODY, not the whole file ${REQ}`, () => {
    const content = crlf(
      ['---', 'exo__Asset_relates: "[[in-frontmatter]]"', "---", "", "[[in-body]]", ""].join("\n"),
    );

    const body = bodyOf(content);

    // ⛔ Before the fix the match failed and the WHOLE content came back, so the
    //    frontmatter wikilink was ALSO counted as a body link — the double-count
    //    #4441 fixed for the converter's BOM case.
    expect(body).not.toContain("in-frontmatter");
    expect(body).toContain("in-body");
  });

  it(`E1b bodyOf on a BOM-prefixed file returns the BODY, and the slice is exact ${REQ}`, () => {
    const content =
      BOM + ['---', 'exo__Asset_relates: "[[in-frontmatter]]"', "---", "", "[[in-body]]", ""].join("\n");

    const body = bodyOf(content);

    expect(body).not.toContain("in-frontmatter");
    expect(body).not.toContain("---");
    expect(body).toContain("[[in-body]]");
  });

  it(`E2 registerOrderSpec picks up a CRLF-fenced default order-spec asset ${REQ}`, () => {
    writeAll(root, {
      "assetspaces/exo/spec.md": crlf(
        [
          "---",
          "exo__Asset_uid: 44610000-0000-4000-8000-000000000001",
          "exo__FrontmatterOrderSpec_default: true",
          "exo__FrontmatterOrderSpec_head:",
          "  - exo__Asset_uid",
          "exo__FrontmatterOrderSpec_tail:",
          "  - exo__Asset_label",
          "---",
          "",
        ].join("\n"),
      ),
    });

    clearOrderSpecLoader();
    registerOrderSpecFromVault(root);

    expect(loadDefaultSpec()).toEqual(
      expect.objectContaining({
        head: ["exo__Asset_uid"],
        tail: ["exo__Asset_label"],
      }),
    );
    clearOrderSpecLoader();
  });

  it(`E3 ratchet — no LF-only frontmatter-block literal is left in packages/cli/src ${REQ}`, () => {
    const LF_ONLY = /\/\^---\\n/; // the literal `/^---\n` as written in source
    const srcRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../src",
    );

    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          scanned++;
          if (LF_ONLY.test(fs.readFileSync(full, "utf-8"))) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);

    // ⛔ TWO CANARIES FIRST — a zero a broken measurement also produces is not a
    //    measurement (self-satisfying-metric-weak-verifier §A7, §A9):
    //    (1) the predicate really matches the form it is hunting, and
    //    (2) the walk really had an input (size of the corpus, printed beside
    //        the finding count).
    expect(LF_ONLY.test("const x = /^---\\n([\\s\\S]*?)\\n---/;")).toBe(true);
    expect(scanned).toBeGreaterThan(100);
    expect({ scanned, offenders }).toEqual({ scanned, offenders: [] });
  });
});
