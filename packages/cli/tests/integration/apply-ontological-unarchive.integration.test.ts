/**
 * req 85a27b3d — «Un-archive Ontologically» end-to-end (homoiconic composition).
 *
 * The ontological INVERSE of «Archive Ontologically» (command 3de74a87). Same
 * emergent composition of already-shipped primitives — no bespoke un-archive
 * subsystem:
 *
 *   composite[
 *     step-1 = property_set isDefinedBy via targetValueQuery → REVERSE NamedQuery (C4)
 *     step-2 = service_call serviceId=repairFolder                              (co-location)
 *   ]
 *
 * Step-1 re-anchors `exo__Asset_isDefinedBy` back to the SOURCE ontology computed
 * by a reverse 1-hop NamedQuery (`?src --Ontology_archiveOntology→ $currentAsset.isDefinedBy`
 * — the symmetric inverse of the forward `$currentAsset --isDefinedBy→ srcOnto
 * --archiveOntology→ archiveOnto`). Step-2 then physically relocates the file into
 * the source ontology's folder (the co-location invariant). The two run in
 * document order inside the composite, sharing file state.
 *
 * Exercised against the REAL `apply` pipeline on a temp vault (no --dry-run; we
 * read the moved file back — dry-run-preview-not-real-output.md) for BEHAVIOR +
 * idempotency + round-trip, and against the REAL `resolveButtons` oracle
 * (NoteToRDFConverter.convertVault → CommandResolver.resolveForAssetMulti →
 * PreconditionEvaluator.evaluate) for VISIBILITY. Production-shape: full-UID
 * fixture files, real store via convertVault (test-fixture-realism).
 *
 * Correct under the documented 1:1 archive-pairing (concept e15d22ae) — the
 * reverse yields exactly one `?src`.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");
const { resolveButtons } = await import("../../src/commands/resolve-buttons.js");

// Reverse («Un-archive Ontologically») command-system assets.
const R_COMMAND_UID = "85a00000-0000-0000-0000-0000000000a1";
const R_COMPOSITE_UID = "85a00000-0000-0000-0000-0000000000a2";
const R_STEP1_UID = "85a00000-0000-0000-0000-0000000000a3";
const R_STEP2_UID = "85a00000-0000-0000-0000-0000000000a4";
const R_QUERY_UID = "85a00000-0000-0000-0000-0000000000a5";
const R_PRECOND_UID = "85a00000-0000-0000-0000-0000000000a6";
const R_BINDING_UID = "85a00000-0000-0000-0000-0000000000a7";

// Forward («Archive Ontologically») command-system assets (for round-trip only).
const F_COMMAND_UID = "85a00000-0000-0000-0000-0000000000f1";
const F_COMPOSITE_UID = "85a00000-0000-0000-0000-0000000000f2";
const F_STEP1_UID = "85a00000-0000-0000-0000-0000000000f3";
const F_STEP2_UID = "85a00000-0000-0000-0000-0000000000f4";
const F_QUERY_UID = "85a00000-0000-0000-0000-0000000000f5";
const F_PRECOND_UID = "85a00000-0000-0000-0000-0000000000f6";

// Domain data.
const ARCHIVED_UID = "85a00000-0000-0000-0000-0000000000b1"; // X — starts ontologically archived
const NORMAL_UID = "85a00000-0000-0000-0000-0000000000b2"; // Y — source-anchored, never archived
const ROUNDTRIP_UID = "85a00000-0000-0000-0000-0000000000b3"; // Z — active, for archive→un-archive
const SRC_ONTO_UID = "85a00000-0000-0000-0000-0000000000b4";
const ARCHIVE_ONTO_UID = "85a00000-0000-0000-0000-0000000000b5";

// Grounding-type UIDs (GroundingTypeUIDs.ts).
const TYPE_COMPOSITE = "8f9a57db-3865-4886-92fb-c5ab7f3c3fa3";
const TYPE_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";
const TYPE_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

const ISDEFINEDBY = "https://exocortex.my/ontology/exo#Asset_isDefinedBy";
const ARCHIVE_PRED = "https://exocortex.my/ontology/exo#Ontology_archiveOntology";

// Folders: srcOnto + a source-anchored asset co-located in space/; archiveOnto +
// the ontologically-archived asset in space-archive/.
const SPACE = "space";
const ARCHIVE_SPACE = "space-archive";

// ---- Byte-faithful SPARQL bodies (mirror the shipped vault assets) ------------

// REVERSE NamedQuery — resolve the SOURCE ontology by reversing archiveOntology.
// EDITABLE for the behavior revert-verify axis.
const REVERSE_QUERY_SPARQL = `SELECT ?src WHERE { $currentAsset <${ISDEFINEDBY}> ?arch . ?src <${ARCHIVE_PRED}> ?arch }`;

// REVERSE precondition — visible ONLY when isDefinedBy is somebody's archive target.
// EDITABLE for the visibility revert-verify axis.
const REVERSE_PRECOND_ASK = [
  `PREFIX exo: <https://exocortex.my/ontology/exo#> ASK {`,
  `    $target exo:Asset_isDefinedBy ?arch .`,
  `    ?src exo:Ontology_archiveOntology ?arch .`,
  `  }`,
].join("\n");

const FORWARD_QUERY_SPARQL = `SELECT ?archiveOnto WHERE { $currentAsset <${ISDEFINEDBY}> ?o . ?o <${ARCHIVE_PRED}> ?archiveOnto }`;
const FORWARD_PRECOND_ASK = [
  `PREFIX exo: <https://exocortex.my/ontology/exo#> ASK {`,
  `    $target exo:Asset_archived "true" .`,
  `    $target exo:Asset_isDefinedBy ?onto .`,
  `    ?onto exo:Ontology_archiveOntology ?archiveOnto .`,
  `  }`,
].join("\n");

// ---- Fixture builders ---------------------------------------------------------

function commandMd(
  uid: string,
  label: string,
  cliName: string,
  compositeUid: string,
  precondUid: string,
): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Command]]"`,
    `exocmd__Command_cliName: ${cliName}`,
    `exocmd__Command_grounding: "[[${compositeUid}|grounding]]"`,
    `exocmd__Command_precondition: "[[${precondUid}|precondition]]"`,
    "---",
    "",
  ].join("\n");
}

function compositeMd(uid: string, label: string, step1: string, step2: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_COMPOSITE}]]"`,
    `exocmd__Grounding_steps:`,
    `  - "[[${step1}|set isDefinedBy]]"`,
    `  - "[[${step2}|repair folder]]"`,
    "---",
    "",
  ].join("\n");
}

function propertySetStepMd(uid: string, label: string, queryUid: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_PROPERTY_SET}]]"`,
    `exocmd__Grounding_targetProperty: "exo__Asset_isDefinedBy"`,
    `exocmd__Grounding_targetValueQuery: "[[${queryUid}|resolve ontology]]"`,
    "---",
    "",
  ].join("\n");
}

function repairFolderStepMd(uid: string, label: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Grounding]]"`,
    `exocmd__Grounding_type: "[[${TYPE_SERVICE_CALL}]]"`,
    // service_call overloads targetProperty as the serviceId.
    `exocmd__Grounding_targetProperty: "repairFolder"`,
    "---",
    "",
  ].join("\n");
}

function namedQueryMd(uid: string, label: string, sparql: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[query__NamedQuery]]"`,
    "---",
    "",
    `# ${label}`,
    "",
    "```sparql",
    sparql,
    "```",
    "",
  ].join("\n");
}

function precondMd(uid: string, label: string, ask: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__Precondition]]"`,
    `exocmd__Precondition_sparqlAsk: |-`,
    ...ask.split("\n").map((l) => `  ${l}`),
    "---",
    "",
  ].join("\n");
}

function bindingMd(uid: string, commandUid: string): string {
  return [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "binding ${uid}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exocmd__CommandBinding]]"`,
    `exocmd__CommandBinding_command: "[[${commandUid}]]"`,
    `exocmd__CommandBinding_targetClass: exo__Asset`,
    `exocmd__CommandBinding_position: inline`,
    `exocmd__CommandBinding_order: 911`,
    "---",
    "",
  ].join("\n");
}

function assetMd(uid: string, label: string, ontoUid: string, archived: boolean): string {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[${ontoUid}|onto]]"`,
  ];
  if (archived) lines.push(`archived: true`);
  lines.push(`exo__Instance_class:`, `  - "[[ims__Concept]]"`, "---", "");
  return lines.join("\n");
}

function ontologyMd(uid: string, label: string, archiveOntoUid?: string): string {
  const lines = [
    "---",
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class:`,
    `  - "[[exo__Ontology]]"`,
  ];
  if (archiveOntoUid) {
    lines.push(`exo__Ontology_archiveOntology: "[[${archiveOntoUid}|archive ontology]]"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

interface Vault {
  root: string;
  archivedRel: string; // X in space-archive/
  restoredRel: string; // X after un-archive → space/
  normalRel: string; // Y in space/
  roundtripRel: string; // Z in space/
  roundtripArchivedRel: string; // Z after archive → space-archive/
}

function buildVault(opts?: {
  reverseQuery?: string;
  reversePrecond?: string;
}): Vault {
  const reverseQuery = opts?.reverseQuery ?? REVERSE_QUERY_SPARQL;
  const reversePrecond = opts?.reversePrecond ?? REVERSE_PRECOND_ASK;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-onto-unarchive-"));
  const writeRoot = (uid: string, md: string) =>
    fs.writeFileSync(path.join(root, `${uid}.md`), md, "utf-8");

  // Reverse command-system assets at vault root.
  writeRoot(
    R_COMMAND_UID,
    commandMd(
      R_COMMAND_UID,
      "Un-archive Ontologically",
      "un-archive-ontologically",
      R_COMPOSITE_UID,
      R_PRECOND_UID,
    ),
  );
  writeRoot(
    R_COMPOSITE_UID,
    compositeMd(R_COMPOSITE_UID, "Un-archive Ontologically (composite)", R_STEP1_UID, R_STEP2_UID),
  );
  writeRoot(
    R_STEP1_UID,
    propertySetStepMd(R_STEP1_UID, "Re-anchor isDefinedBy to source ontology", R_QUERY_UID),
  );
  writeRoot(R_STEP2_UID, repairFolderStepMd(R_STEP2_UID, "Relocate to source ontology folder"));
  writeRoot(R_QUERY_UID, namedQueryMd(R_QUERY_UID, "Resolve source ontology", reverseQuery));
  writeRoot(R_PRECOND_UID, precondMd(R_PRECOND_UID, "Is ontologically archived", reversePrecond));
  writeRoot(R_BINDING_UID, bindingMd(R_BINDING_UID, R_COMMAND_UID));

  // Forward command-system assets (round-trip only).
  writeRoot(
    F_COMMAND_UID,
    commandMd(
      F_COMMAND_UID,
      "Archive Ontologically",
      "archive-ontologically",
      F_COMPOSITE_UID,
      F_PRECOND_UID,
    ),
  );
  writeRoot(
    F_COMPOSITE_UID,
    compositeMd(F_COMPOSITE_UID, "Archive Ontologically (composite)", F_STEP1_UID, F_STEP2_UID),
  );
  writeRoot(
    F_STEP1_UID,
    propertySetStepMd(F_STEP1_UID, "Re-anchor isDefinedBy to archive ontology", F_QUERY_UID),
  );
  writeRoot(F_STEP2_UID, repairFolderStepMd(F_STEP2_UID, "Relocate to archive ontology folder"));
  writeRoot(F_QUERY_UID, namedQueryMd(F_QUERY_UID, "Resolve archive ontology", FORWARD_QUERY_SPARQL));
  writeRoot(
    F_PRECOND_UID,
    precondMd(F_PRECOND_UID, "Archived and not yet ontologically archived", FORWARD_PRECOND_ASK),
  );

  // Domain data.
  fs.mkdirSync(path.join(root, SPACE), { recursive: true });
  fs.mkdirSync(path.join(root, ARCHIVE_SPACE), { recursive: true });

  // srcOnto (space/) declares archiveOntology → archiveOnto (space-archive/).
  fs.writeFileSync(
    path.join(root, SPACE, `${SRC_ONTO_UID}.md`),
    ontologyMd(SRC_ONTO_UID, "Source ontology", ARCHIVE_ONTO_UID),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, ARCHIVE_SPACE, `${ARCHIVE_ONTO_UID}.md`),
    ontologyMd(ARCHIVE_ONTO_UID, "Source ontology (archive)"),
    "utf-8",
  );

  // X — ontologically archived: isDefinedBy = archiveOnto, file in space-archive/.
  fs.writeFileSync(
    path.join(root, ARCHIVE_SPACE, `${ARCHIVED_UID}.md`),
    assetMd(ARCHIVED_UID, "Archived domain asset", ARCHIVE_ONTO_UID, false),
    "utf-8",
  );
  // Y — source-anchored (never archived): isDefinedBy = srcOnto, file in space/.
  fs.writeFileSync(
    path.join(root, SPACE, `${NORMAL_UID}.md`),
    assetMd(NORMAL_UID, "Normal source-anchored asset", SRC_ONTO_UID, false),
    "utf-8",
  );
  // Z — active, archived:true (so the forward command's precondition passes),
  // isDefinedBy = srcOnto, file in space/. For the round-trip.
  fs.writeFileSync(
    path.join(root, SPACE, `${ROUNDTRIP_UID}.md`),
    assetMd(ROUNDTRIP_UID, "Round-trip asset", SRC_ONTO_UID, true),
    "utf-8",
  );

  return {
    root,
    archivedRel: `${ARCHIVE_SPACE}/${ARCHIVED_UID}.md`,
    restoredRel: `${SPACE}/${ARCHIVED_UID}.md`,
    normalRel: `${SPACE}/${NORMAL_UID}.md`,
    roundtripRel: `${SPACE}/${ROUNDTRIP_UID}.md`,
    roundtripArchivedRel: `${ARCHIVE_SPACE}/${ROUNDTRIP_UID}.md`,
  };
}

describe("req 85a27b3d — Un-archive Ontologically (homoiconic composite, inverse of 3de74a87)", () => {
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

  async function runApply(vaultRoot: string, commandUid: string, targetRel: string): Promise<void> {
    // Fresh Command instance per call → re-hydrates the triple store from the
    // current on-disk vault state (so a second apply sees the moved file).
    const cmd = applyCommand();
    const args = ["node", "apply", commandUid, targetRel, "--vault", vaultRoot, "--yes"];
    try {
      await cmd.parseAsync(args);
    } catch (err) {
      if (!/^__process_exit_/.test(String((err as Error)?.message))) throw err;
    }
  }

  it("restores an ontologically-archived asset to its source ontology and folder (real mutation) @req:85a27b3d-1368-46d7-8cc0-c52e55c19f8d", async () => {
    const vault = buildVault();
    root = vault.root;

    await runApply(root, R_COMMAND_UID, vault.archivedRel);

    const oldPath = path.join(root, vault.archivedRel);
    const newPath = path.join(root, vault.restoredRel);

    // Step-2 (repairFolder) physically moved the file OUT of space-archive/ into space/.
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);

    // Step-1 re-anchored isDefinedBy back to the reverse-NamedQuery-computed SOURCE ontology.
    const written = fs.readFileSync(newPath, "utf-8");
    expect(written).toContain(`exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}]]"`);
    expect(written).not.toContain(ARCHIVE_ONTO_UID);
  });

  it("is visible ONLY on an ontologically-archived asset — hidden (precondition-false) on a source-anchored asset @req:85a27b3d-1368-46d7-8cc0-c52e55c19f8d", async () => {
    const vault = buildVault();
    root = vault.root;

    // X (ontologically archived) → the command IS offered.
    const onArchived = await resolveButtons(root, vault.archivedRel);
    expect(onArchived.visible.map((e) => e.label)).toContain("Un-archive Ontologically");

    // Y (source-anchored, never archived) → bound (exo__Asset) but precondition
    // fails → HIDDEN with reason "precondition-false", NOT offered.
    const onNormal = await resolveButtons(root, vault.normalRel);
    expect(onNormal.visible.map((e) => e.label)).not.toContain("Un-archive Ontologically");
    const hidden = onNormal.hidden.find((e) => e.label === "Un-archive Ontologically");
    expect(hidden?.reason).toBe("precondition-false");
  });

  it("is idempotent — re-applying to a restored asset is a precondition no-op @req:85a27b3d-1368-46d7-8cc0-c52e55c19f8d", async () => {
    const vault = buildVault();
    root = vault.root;

    await runApply(root, R_COMMAND_UID, vault.archivedRel);
    const restoredPath = path.join(root, vault.restoredRel);
    expect(fs.existsSync(restoredPath)).toBe(true);
    const afterFirst = fs.readFileSync(restoredPath, "utf-8");

    // Second apply on the now-restored file: precondition (isDefinedBy is
    // somebody's archiveOntology) fails → no-op. File stays put, content unchanged.
    await runApply(root, R_COMMAND_UID, vault.restoredRel);

    expect(fs.existsSync(restoredPath)).toBe(true);
    expect(fs.readFileSync(restoredPath, "utf-8")).toBe(afterFirst);
  });

  it("round-trip: Archive Ontologically then Un-archive Ontologically is identity on (isDefinedBy, folder) @req:85a27b3d-1368-46d7-8cc0-c52e55c19f8d", async () => {
    const vault = buildVault();
    root = vault.root;

    const sourcePath = path.join(root, vault.roundtripRel);
    const archivedPath = path.join(root, vault.roundtripArchivedRel);

    const before = fs.readFileSync(sourcePath, "utf-8");
    expect(before).toContain(`exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}|onto]]"`);

    // Forward: archive Z → isDefinedBy=archiveOnto, moved to space-archive/.
    await runApply(root, F_COMMAND_UID, vault.roundtripRel);
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(fs.readFileSync(archivedPath, "utf-8")).toContain(
      `exo__Asset_isDefinedBy: "[[${ARCHIVE_ONTO_UID}]]"`,
    );

    // Reverse: un-archive Z → back to source ontology + space/.
    await runApply(root, R_COMMAND_UID, vault.roundtripArchivedRel);
    expect(fs.existsSync(archivedPath)).toBe(false);
    expect(fs.existsSync(sourcePath)).toBe(true);

    // Identity on (isDefinedBy, folder): back in space/ anchored at the source ontology.
    const after = fs.readFileSync(sourcePath, "utf-8");
    expect(after).toContain(`exo__Asset_isDefinedBy: "[[${SRC_ONTO_UID}]]"`);
    expect(after).not.toContain(ARCHIVE_ONTO_UID);
  });
});
