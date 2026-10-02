/**
 * req 992f0a75 (issue #4424, follow-up of #4405) — `property_set` serialises a
 * value a SUBSTITUTION produced and leaves an AUTHORED literal VERBATIM.
 *
 * The two halves are ONE subject, not "the feature plus not breaking a
 * neighbour": at the write site both are the same `string`, so the only thing
 * that separates a user's `PR #42 merged` from an author's deliberate flow
 * array `["[[ems__Task]]"]` is where the value CAME FROM. Routing the whole
 * untyped branch through `serializeYamlScalar` — the obvious fix — was
 * implemented, measured wrong and reverted, because it quotes the flow array on
 * its leading `[` (axis K13 of req 675cb0ab). So both halves are axes here, and
 * the authored half is driven in THIS file too, not only in 675cb0ab's suite,
 * so the mutant matrix of this change is self-contained.
 *
 * Production-shape: drives the REAL `GroundingExecutor.execute` over the REAL
 * `FrontmatterService` write path (only the filesystem ports are faked) and
 * reads the written frontmatter back with the REAL YAML parser — the defect IS
 * a YAML-parse disagreement, so an assertion on the raw string alone would not
 * honestly demonstrate it.
 *
 * ⛤ The substituted half is SYNTHETIC BY NECESSITY and that is stated, not
 * hidden behind a green suite — the same honest bound req 675cb0ab records for
 * its own K12. Measured on the live graph 2026-10-02 (vault-exodev, 668 322
 * triples): of the 34 `property_set` value-sources exactly NINE carry a
 * substitution into the value, and all nine resolve to a shape that needs no
 * quoting (`$nowLocal` ×5, `$today`, `$todayStart`, `$target`, plus
 * `$input.label` on the string-semantic `exo__Asset_label`). J5 drives those
 * live shapes as the byte-identity control; the user-text channel this closes
 * — `$input.<key>` free text, and any grounding authored in a user's own vault
 * — has no carrier in today's authored corpus.
 */

import "reflect-metadata";
import {
  GroundingExecutor,
  ServiceRegistry,
} from "../../src/services/GroundingExecutor";
import { GroundingType } from "../../src/domain/constants/GroundingType";
import { GroundingDefinition } from "../../src/domain/models/CommandDefinition";
import {
  IFileSystemReader,
  IFileSystemWriter,
} from "../../src/interfaces/IFileSystemAdapter";
import type { DeclaredRangesResolver } from "../../src/services/DeclaredRangesResolver";
import { parseFrontmatterAsReader } from "@kitelev/exocortex-test-utils";

// Literal @req token for requirements-trace's STATIC scanner, which cannot see
// the template-literal form the titles below use (archgate REQ-001 /
// no-template-literal-only-req-binding): @req:992f0a75-55cc-4a06-a66b-ee6bdb9e8102
const REQ = "992f0a75-55cc-4a06-a66b-ee6bdb9e8102";

const FILE_PATH = "assetspaces/kitelev/exoas-my/task.md";
const TARGET_IRI = `obsidian://vault/${FILE_PATH}`;
const ONTOLOGY_UID = "9d1d2e9d-3f9e-4c6a-9a3f-0f2a1c6b7e11";

const SEED = [
  "---",
  "exo__Asset_uid: 11111111-2222-3333-4444-555555555555",
  'exo__Asset_label: "Some task"',
  'exo__Asset_isDefinedBy: "[[00000000-0000-4000-8000-000000000000]]"',
  "exo__Asset_updatedAt: 2026-01-01T00:00:00",
  "---",
  "Body",
].join("\n");

class InMemoryFileSystem implements IFileSystemReader, IFileSystemWriter {
  private files = new Map<string, string>([[FILE_PATH, SEED]]);

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async getMarkdownFiles(): Promise<string[]> {
    return Array.from(this.files.keys());
  }
  async createFile(path: string, content: string): Promise<string> {
    this.files.set(path, content);
    return path;
  }
  async updateFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async renameFile(): Promise<void> {
    throw new Error("not used");
  }
  getContent(path = FILE_PATH): string {
    const c = this.files.get(path);
    expect(c).toBeDefined();
    return c as string;
  }
}

/** A stub port: the map a store-backed resolver would have produced. */
function rangesOf(
  entries: Record<string, readonly string[]>,
): DeclaredRangesResolver {
  const map = new Map<string, readonly string[]>(Object.entries(entries));
  return async () => map;
}

/** Pinned so `$nowLocal` / `$today` are the same bytes on every machine. */
const FROZEN = new Date("2026-10-02T19:21:33");

function executorWith(
  fs: InMemoryFileSystem,
  declaredRanges?: DeclaredRangesResolver,
): GroundingExecutor {
  return new GroundingExecutor(fs, fs, new ServiceRegistry(), undefined, {
    declaredRanges,
    clock: { now: () => FROZEN },
  });
}

function substitutionGrounding(
  targetProperty: string,
  template: string,
): GroundingDefinition {
  return {
    id: "gnd-origin-4424-sub",
    label: "Set a property from a substitution",
    type: GroundingType.PROPERTY_SET,
    targetProperty,
    targetValueSubstitution: template,
  } as GroundingDefinition;
}

function literalGrounding(
  targetProperty: string,
  literal: string,
): GroundingDefinition {
  return {
    id: "gnd-origin-4424-lit",
    label: "Set a property from an authored literal",
    type: GroundingType.PROPERTY_SET,
    targetProperty,
    targetValueLiteral: literal,
  } as GroundingDefinition;
}

/** The raw frontmatter line for a key — what landed on disk, byte for byte. */
function lineOf(content: string, key: string): string | undefined {
  return content
    .split("\n")
    .find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key} :`));
}

describe("req 992f0a75 — property_set: substituted value serialised, authored literal verbatim", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // The SUBSTITUTED half — the defect #4405 named.
  // ──────────────────────────────────────────────────────────────────────────

  it(`J1 a substituted value carrying ' #' round-trips through js-yaml byte for byte @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);
    // The issue's own example. Written bare, every YAML reader keeps `PR` and
    // treats ` #42 merged` as a comment — silent truncation at rc 0.
    const note = "PR #42 merged";

    const result = await exec.execute(
      substitutionGrounding("ems__Effort_result", "$input.note"),
      TARGET_IRI,
      FILE_PATH,
      { note },
    );

    expect(result.success).toBe(true);
    const written = fs.getContent();
    expect(lineOf(written, "ems__Effort_result")).toBe(
      'ems__Effort_result: "PR #42 merged"',
    );
    // The load-bearing half: what a reader hands back, not how it looks.
    const fm = parseFrontmatterAsReader(written);
    expect(fm.ems__Effort_result).toBe(note);
  });

  it(`J2 a substituted value carrying ': ' round-trips through js-yaml byte for byte @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);
    // The #3748 shape: bare, YAML reads a nested mapping and the whole
    // frontmatter stops parsing.
    const note = "Blocked: waiting on infra";

    const result = await exec.execute(
      substitutionGrounding("ems__Effort_result", "$input.note"),
      TARGET_IRI,
      FILE_PATH,
      { note },
    );

    expect(result.success).toBe(true);
    const fm = parseFrontmatterAsReader(fs.getContent());
    expect(fm.ems__Effort_result).toBe(note);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The AUTHORED half — req 675cb0ab's last scenario, driven here too.
  // ──────────────────────────────────────────────────────────────────────────

  it(`J3 an AUTHORED flow array stays verbatim and a reader still sees a LIST @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);
    // The multi-class convert value (the K13 shape). Serialised, it is quoted
    // on its leading `[` and the convert path reads one string instead of a
    // list — which is why the discriminator exists at all.
    const result = await exec.execute(
      literalGrounding("exo__Instance_class", '["[[ems__Task]]"]'),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    const written = fs.getContent();
    expect(lineOf(written, "exo__Instance_class")).toBe(
      'exo__Instance_class: ["[[ems__Task]]"]',
    );
    expect(parseFrontmatterAsReader(written).exo__Instance_class).toEqual([
      "[[ems__Task]]",
    ]);
  });

  it(`J4 an AUTHORED pre-quoted wikilink stays verbatim and a reader sees a STRING @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);

    const result = await exec.execute(
      literalGrounding("ems__Effort_parent", `"[[${ONTOLOGY_UID}]]"`),
      TARGET_IRI,
      FILE_PATH,
    );

    expect(result.success).toBe(true);
    const written = fs.getContent();
    expect(lineOf(written, "ems__Effort_parent")).toBe(
      `ems__Effort_parent: "[[${ONTOLOGY_UID}]]"`,
    );
    expect(typeof parseFrontmatterAsReader(written).ems__Effort_parent).toBe(
      "string",
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // J5 — the LIVE-SHAPE control: the nine carriers measured on the real graph.
  // ──────────────────────────────────────────────────────────────────────────

  it(`J5 the live substituted shapes ($nowLocal / $today / $target) stay BARE — byte-identity for the whole authored corpus @req:${REQ}`, async () => {
    // Measured 2026-10-02 (vault-exodev): the 8 `targetValueSubstitution`
    // groundings reference a SubstitutionToken asset that `CommandResolver`
    // dereferences to its label, so the executor receives exactly these
    // templates. None of them needs quoting — their colons are followed by a
    // digit or `/`, never whitespace — so the corpus changes by zero bytes.
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["exo__Asset_updatedAt", "$nowLocal", "2026-10-02T19:21:33"],
      ["ems__Effort_plannedStartTimestamp", "$todayStart", "2026-10-02T00:00:00"],
      ["flow__Stage_date", "$today", "2026-10-02"],
      // ⛤ `$target` substitutes to the `obsidian://` IRI, and the landed form
      // is `"[[task]]"` — measured, not predicted: `updateProperty`
      // IRI-normalises a reference into a quoted wikilink DOWNSTREAM of this
      // change (req 27fbe40b / 869561bf territory). Pinned here because it is
      // one of the nine live carriers, and because the normalised form is a
      // complete double-quoted scalar, which `needsYamlQuoting` passes through
      // — so this carrier is byte-identical on both sides of the gate.
      ["flow__Stage_source", "$target", '"[[task]]"'],
    ];

    for (const [property, template, expected] of cases) {
      const fs = new InMemoryFileSystem();
      const exec = executorWith(fs);
      const result = await exec.execute(
        substitutionGrounding(property, template),
        TARGET_IRI,
        FILE_PATH,
      );
      expect(result.success).toBe(true);
      expect(lineOf(fs.getContent(), property)).toBe(
        `${property}: ${expected}`,
      );
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // J6 — the ORDER against req 29e0d1b6. This is a requirement, not a taste.
  // ──────────────────────────────────────────────────────────────────────────

  it(`J6 a substituted BARE wikilink is still REFUSED, not serialised into a successful write @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);
    const before = fs.getContent();

    const result = await exec.execute(
      substitutionGrounding("exo__Asset_isDefinedBy", "$input.ontology"),
      TARGET_IRI,
      FILE_PATH,
      { ontology: `[[${ONTOLOGY_UID}]]` },
    );

    // `serializeYamlScalar` quotes a bare `[[uid]]` on its leading `[`, so
    // serialising BEFORE the guard would make `isUnquotedWikilink` blind and
    // turn req 29e0d1b6's loud refusal into a successful write — the silent
    // literal that req exists to prevent.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/UNQUOTED wikilink/);
    expect(fs.getContent()).toBe(before);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // J7 / J8 — the other two conjuncts of the gate.
  // ──────────────────────────────────────────────────────────────────────────

  it(`J7 a substituted canonical NEGATIVE integer under an xsd:integer range stays BARE — the typing branch keeps its value @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs, rangesOf({ flow__Stage_chatId: ["xsd:integer"] }));

    const result = await exec.execute(
      substitutionGrounding("flow__Stage_chatId", "$input.chatId"),
      TARGET_IRI,
      FILE_PATH,
      { chatId: "-1003912427125" },
    );

    expect(result.success).toBe(true);
    // The typed branch already serialised this value WITH the range, which
    // emits the canonical integer bare. A second, range-less pass would quote
    // it on its leading `-` and re-introduce the `sh:datatype` violation
    // ticket 534a7a46 removed — so the typing conjunct of the gate is what
    // this axis pins.
    expect(lineOf(fs.getContent(), "flow__Stage_chatId")).toBe(
      "flow__Stage_chatId: -1003912427125",
    );
    expect(parseFrontmatterAsReader(fs.getContent()).flow__Stage_chatId).toBe(
      -1003912427125,
    );
  });

  it(`J8 a substituted scalar-shaped value on exo__Asset_label keeps the STRING-SEMANTIC quoting @req:${REQ}`, async () => {
    const fs = new InMemoryFileSystem();
    const exec = executorWith(fs);

    const result = await exec.execute(
      substitutionGrounding("exo__Asset_label", "$input.label"),
      TARGET_IRI,
      FILE_PATH,
      { label: "42" },
    );

    expect(result.success).toBe(true);
    // `quoteAmbiguousScalars` is strictly stronger than the plain call this
    // change adds: it quotes a scalar-LOOKING string so the label survives as
    // a string. The one live substituted carrier of the authored corpus
    // (`f79e2d7d`, `$input.label`) takes exactly this path.
    expect(lineOf(fs.getContent(), "exo__Asset_label")).toBe(
      'exo__Asset_label: "42"',
    );
    expect(parseFrontmatterAsReader(fs.getContent()).exo__Asset_label).toBe(
      "42",
    );
  });
});
