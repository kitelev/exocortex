/**
 * RFC 78c2b7d0 C4 — CLI `apply` end-to-end for the `property_set`
 * `targetValueQuery` read-side value-source (the CQRS bridge consumed by C5).
 *
 * Exercises the REAL pipeline against a temp vault (no --dry-run; we read the
 * mutated file back — `~/dotfiles/.claude/rules/dry-run-preview-not-real-output.md`):
 *
 *   apply → hydrate triple store (NoteToRDFConverter) → CommandResolver parses
 *   `exocmd__Grounding_targetValueQuery` → GroundingExecutor → NamedQueryRunner
 *   (FsQueryBodyResolver resolves the ```sparql block) → 1-hop+1-hop archive
 *   navigation with `$currentAsset` auto-injected → scalar IRI → wikilink write.
 *
 * Archive shape: target --isDefinedBy--> srcOnto --archiveOntology--> archiveOnto.
 * The grounding re-anchors the target's `exo__Asset_isDefinedBy` to the computed
 * archive ontology — exactly C5's «Archive Ontologically» step 1.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

const COMMAND_UID = "c4000000-0000-0000-0000-0000000000c1";
const GROUNDING_UID = "c4000000-0000-0000-0000-0000000000c2";
const QUERY_UID = "c4000000-0000-0000-0000-0000000000c3";
const TARGET_UID = "c4000000-0000-0000-0000-0000000000c4";
const SRC_ONTO_UID = "c4000000-0000-0000-0000-0000000000c5";
const ARCHIVE_ONTO_UID = "c4000000-0000-0000-0000-0000000000c6";

const ISDEFINEDBY = "https://exocortex.my/ontology/exo#Asset_isDefinedBy";
const ARCHIVE_PRED = "https://exocortex.my/ontology/exo#Ontology_archiveOntology";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Archive Ontologically (C4 test)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING_UID}|grounding]]"`,
  "---",
  "",
].join("\n");

const GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${GROUNDING_UID}`,
  `exo__Asset_label: "Set isDefinedBy via NamedQuery"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  // property_set grounding-type UID (GroundingTypeUIDs.ts)
  `exocmd__Grounding_type: "[[cf3bb923-f1f1-40be-b728-782844402426]]"`,
  `exocmd__Grounding_targetProperty: "exo__Asset_isDefinedBy"`,
  // value-source: read-side NamedQuery computes the archive ontology
  `exocmd__Grounding_targetValueQuery: "[[${QUERY_UID}|archive query]]"`,
  "---",
  "",
].join("\n");

const QUERY_MD = [
  "---",
  `exo__Asset_uid: ${QUERY_UID}`,
  `exo__Asset_label: "Resolve archive ontology"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[query__NamedQuery]]"`,
  "---",
  "",
  "# Resolve archive ontology",
  "",
  "```sparql",
  `SELECT ?archiveOnto WHERE { $currentAsset <${ISDEFINEDBY}> ?o . ?o <${ARCHIVE_PRED}> ?archiveOnto }`,
  "```",
  "",
].join("\n");

const TARGET_MD = [
  "---",
  `exo__Asset_uid: ${TARGET_UID}`,
  `exo__Asset_label: "Some domain asset"`,
  `exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}|src ontology]]"`,
  `exo__Instance_class:`,
  `  - "[[ims__Concept]]"`,
  "---",
  "",
].join("\n");

const SRC_ONTO_MD = [
  "---",
  `exo__Asset_uid: ${SRC_ONTO_UID}`,
  `exo__Asset_label: "Source ontology"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exo__Ontology]]"`,
  `exo__Ontology_archiveOntology: "[[${ARCHIVE_ONTO_UID}|archive ontology]]"`,
  "---",
  "",
].join("\n");

const ARCHIVE_ONTO_MD = [
  "---",
  `exo__Asset_uid: ${ARCHIVE_ONTO_UID}`,
  `exo__Asset_label: "Source ontology (archive)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exo__Ontology]]"`,
  "---",
  "",
].join("\n");

function buildVault(): { root: string; targetRel: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c4-tvq-"));
  const write = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  write(COMMAND_UID, COMMAND_MD);
  write(GROUNDING_UID, GROUNDING_MD);
  write(QUERY_UID, QUERY_MD);
  write(TARGET_UID, TARGET_MD);
  write(SRC_ONTO_UID, SRC_ONTO_MD);
  write(ARCHIVE_ONTO_UID, ARCHIVE_ONTO_MD);
  return { root, targetRel: `${TARGET_UID}.md` };
}

describe("RFC 78c2b7d0 C4 — CLI apply property_set targetValueQuery", () => {
  let root: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__process_exit_${code ?? 0}__`);
      }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  async function runApply(vaultRoot: string, targetRel: string): Promise<void> {
    const cmd = applyCommand();
    const args = [
      "node",
      "apply",
      COMMAND_UID,
      targetRel,
      "--vault",
      vaultRoot,
      "--yes",
    ];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("@req:bbaa37e1-de71-426e-9399-97dba43967e4 re-anchors isDefinedBy to the NamedQuery-computed archive ontology (real mutation)", async () => {
    const vault = buildVault();
    root = vault.root;

    await runApply(root, vault.targetRel);

    // Read the REAL mutated file back (not --dry-run).
    const written = fs.readFileSync(path.join(root, vault.targetRel), "utf-8");
    // $currentAsset was the target; the query walked isDefinedBy → archiveOntology.
    expect(written).toContain(`exo__Asset_isDefinedBy: "[[${ARCHIVE_ONTO_UID}]]"`);
    expect(written).not.toContain(SRC_ONTO_UID);
  });
});
