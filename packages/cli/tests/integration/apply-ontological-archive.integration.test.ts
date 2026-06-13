/**
 * RFC 78c2b7d0 C5 — «Archive Ontologically» end-to-end (homoiconic composition).
 *
 * This is the empirical proof that C5's archive mechanism is an *emergent
 * composition* of already-shipped primitives — no bespoke "archive subsystem":
 *
 *   composite[
 *     step-1 = property_set isDefinedBy via targetValueQuery → NamedQuery   (C4)
 *     step-2 = service_call serviceId=repairFolder                          (co-location)
 *   ]
 *
 * Step-1 re-anchors `exo__Asset_isDefinedBy` to the archive ontology computed
 * by a 1-hop NamedQuery (`$currentAsset --isDefinedBy→ srcOnto --archiveOntology→
 * archiveOnto`). Step-2 then physically relocates the file into the archive
 * ontology's folder (the co-location invariant). The two run in document order
 * inside the composite, sharing file state.
 *
 * Exercised against the REAL `apply` pipeline on a temp vault (no --dry-run; we
 * read the moved file back — `~/dotfiles/.claude/rules/dry-run-preview-not-real-output.md`).
 *
 * Idempotency: a second apply is a no-op because the command's SPARQL-ASK
 * precondition (`archived:true` AND current ontology HAS an archiveOntology)
 * fails once the asset already lives in the archive ontology (archive
 * ontologies declare no archiveOntology of their own).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

// Command-system assets
const COMMAND_UID = "c5000000-0000-0000-0000-0000000000a1";
const COMPOSITE_UID = "c5000000-0000-0000-0000-0000000000a2";
const STEP1_UID = "c5000000-0000-0000-0000-0000000000a3";
const STEP2_UID = "c5000000-0000-0000-0000-0000000000a4";
const QUERY_UID = "c5000000-0000-0000-0000-0000000000a5";
const PRECOND_UID = "c5000000-0000-0000-0000-0000000000a6";
// Domain data
const TARGET_UID = "c5000000-0000-0000-0000-0000000000b1";
const SRC_ONTO_UID = "c5000000-0000-0000-0000-0000000000b2";
const ARCHIVE_ONTO_UID = "c5000000-0000-0000-0000-0000000000b3";

// Grounding-type UIDs (GroundingTypeUIDs.ts)
const TYPE_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";
const TYPE_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const TYPE_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

const ISDEFINEDBY = "https://exocortex.my/ontology/exo#Asset_isDefinedBy";
const ARCHIVE_PRED = "https://exocortex.my/ontology/exo#Ontology_archiveOntology";

// Folders: target+srcOnto co-located in space/, archiveOnto in space-archive/.
const SPACE = "space";
const ARCHIVE_SPACE = "space-archive";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Archive Ontologically"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${COMPOSITE_UID}|grounding]]"`,
  `exocmd__Command_precondition: "[[${PRECOND_UID}|precondition]]"`,
  "---",
  "",
].join("\n");

const COMPOSITE_MD = [
  "---",
  `exo__Asset_uid: ${COMPOSITE_UID}`,
  `exo__Asset_label: "Archive Ontologically (composite)"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${TYPE_COMPOSITE}]]"`,
  `exocmd__Grounding_steps:`,
  `  - "[[${STEP1_UID}|set isDefinedBy]]"`,
  `  - "[[${STEP2_UID}|repair folder]]"`,
  "---",
  "",
].join("\n");

const STEP1_MD = [
  "---",
  `exo__Asset_uid: ${STEP1_UID}`,
  `exo__Asset_label: "Re-anchor isDefinedBy to archive ontology"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${TYPE_PROPERTY_SET}]]"`,
  `exocmd__Grounding_targetProperty: "exo__Asset_isDefinedBy"`,
  `exocmd__Grounding_targetValueQuery: "[[${QUERY_UID}|archive query]]"`,
  "---",
  "",
].join("\n");

const STEP2_MD = [
  "---",
  `exo__Asset_uid: ${STEP2_UID}`,
  `exo__Asset_label: "Relocate to archive ontology folder"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${TYPE_SERVICE_CALL}]]"`,
  // service_call overloads targetProperty as the serviceId.
  `exocmd__Grounding_targetProperty: "repairFolder"`,
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

const PRECOND_MD = [
  "---",
  `exo__Asset_uid: ${PRECOND_UID}`,
  `exo__Asset_label: "Archived and not yet ontologically archived"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Precondition]]"`,
  // Compound gate in one ASK: (1) user flagged archived:true (stage-1
  // toggle-archived → exo:Asset_archived "true"), (2) current ontology HAS an
  // archive target. Once relocated, isDefinedBy→archiveOnto which declares no
  // archiveOntology → ASK false → idempotent no-op.
  `exocmd__Precondition_sparqlAsk: |-`,
  `  PREFIX exo: <https://exocortex.my/ontology/exo#> ASK {`,
  `    $target exo:Asset_archived "true" .`,
  `    $target exo:Asset_isDefinedBy ?onto .`,
  `    ?onto exo:Ontology_archiveOntology ?archiveOnto .`,
  `  }`,
  "---",
  "",
].join("\n");

const TARGET_MD = [
  "---",
  `exo__Asset_uid: ${TARGET_UID}`,
  `exo__Asset_label: "Some domain asset"`,
  `exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}|src ontology]]"`,
  `archived: true`,
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

function buildVault(): {
  root: string;
  targetRel: string;
  archivedTargetRel: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-c5-onto-archive-"));
  const writeRoot = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");
  // Command-system assets at vault root.
  writeRoot(COMMAND_UID, COMMAND_MD);
  writeRoot(COMPOSITE_UID, COMPOSITE_MD);
  writeRoot(STEP1_UID, STEP1_MD);
  writeRoot(STEP2_UID, STEP2_MD);
  writeRoot(QUERY_UID, QUERY_MD);
  writeRoot(PRECOND_UID, PRECOND_MD);

  // Domain data: target + srcOnto co-located in space/, archiveOnto in space-archive/.
  fs.mkdirSync(path.join(root, SPACE), { recursive: true });
  fs.mkdirSync(path.join(root, ARCHIVE_SPACE), { recursive: true });
  fs.writeFileSync(path.join(root, SPACE, `${TARGET_UID}.md`), TARGET_MD, "utf-8");
  fs.writeFileSync(path.join(root, SPACE, `${SRC_ONTO_UID}.md`), SRC_ONTO_MD, "utf-8");
  fs.writeFileSync(
    path.join(root, ARCHIVE_SPACE, `${ARCHIVE_ONTO_UID}.md`),
    ARCHIVE_ONTO_MD,
    "utf-8",
  );

  return {
    root,
    targetRel: `${SPACE}/${TARGET_UID}.md`,
    archivedTargetRel: `${ARCHIVE_SPACE}/${TARGET_UID}.md`,
  };
}

describe("RFC 78c2b7d0 C5 — Archive Ontologically (homoiconic composite)", () => {
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
    // Fresh Command instance per call → re-hydrates the triple store from the
    // current on-disk vault state (so the idempotency re-run sees the moved file).
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

  it("relocates the asset into the archive ontology folder and re-anchors isDefinedBy (real mutation)", async () => {
    const vault = buildVault();
    root = vault.root;

    await runApply(root, vault.targetRel);

    const oldPath = path.join(root, vault.targetRel);
    const newPath = path.join(root, vault.archivedTargetRel);

    // Step-2 (repairFolder) physically moved the file into space-archive/.
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);

    // Step-1 re-anchored isDefinedBy to the NamedQuery-computed archive ontology.
    const written = fs.readFileSync(newPath, "utf-8");
    expect(written).toContain(`exo__Asset_isDefinedBy: "[[${ARCHIVE_ONTO_UID}]]"`);
    expect(written).not.toContain(SRC_ONTO_UID);
    // archived:true survives (we don't unset it).
    expect(written).toContain("archived: true");
  });

  it("is idempotent — re-applying to an already-archived asset is a precondition no-op", async () => {
    const vault = buildVault();
    root = vault.root;

    await runApply(root, vault.targetRel);
    const archivedPath = path.join(root, vault.archivedTargetRel);
    expect(fs.existsSync(archivedPath)).toBe(true);
    const afterFirst = fs.readFileSync(archivedPath, "utf-8");

    // Second apply on the now-archived file: precondition (current ontology has
    // an archiveOntology) fails → no-op. File stays put, content unchanged
    // (no double relocation, no double isDefinedBy rewrite).
    await runApply(root, vault.archivedTargetRel);

    expect(fs.existsSync(archivedPath)).toBe(true);
    const afterSecond = fs.readFileSync(archivedPath, "utf-8");
    expect(afterSecond).toBe(afterFirst);
    // The archive ontology has no folder named "<archive>-archive": no further move.
    expect(
      fs.existsSync(
        path.join(root, `${ARCHIVE_SPACE}-archive`, `${TARGET_UID}.md`),
      ),
    ).toBe(false);
  });
});
