/**
 * #4264 fixture — a temp vault with the real UID-canon vocabulary, the three
 * bot-chain commands (create-task-instance → move-to-backlog → start-effort,
 * mirroring the shipped preconditions 8815fdc8 / 575404fc), a TBox-form-labelled
 * task (rebuild-class change), a prototype-bearing task + a command gated on an
 * INHERITED property (inferred-layer divergence), and three ems__Task bindings.
 *
 * Shared by the jest suite
 * (`use-cache-apply-write-through-4264.integration.test.ts`, in-process
 * "fresh CacheManager per step") and the local multi-PROCESS harness
 * (`use-cache-4264-proc-chain.harness.ts`, spawns the built `dist/index.js`
 * three times) so both drive the same vault.
 *
 * Requirement: @req:cb707868-356f-495d-825a-182e66ba8bcd
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Real UID-canon vocabulary so the converter resolves the status wikilinks to
// the SAME symbolic IRIs the preconditions reference (`ems__<Local>` labels →
// `ems#<Local>`), and the `CONTAINS(STR(?s), "<uid8>")` halves match too.
export const TASK_CLASS = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task
export const STATUS_DRAFT = "c42245d0-01de-4c35-bfcf-d910445ea28e"; // ems__EffortStatusDraft
export const STATUS_BACKLOG = "753a44d5-846c-4b82-9196-4fd9a4d48777"; // ems__EffortStatusBacklog
export const STATUS_DOING = "027e78f4-6e16-4b36-b8fb-5510507d5745"; // ems__EffortStatusDoing
export const PROP_STATUS = "44c6e9e3-955f-4afc-9ca5-b4bd70667051"; // ems__Effort_status (property def)

// GroundingType catalog (packages/core/src/domain/constants/GroundingTypeUIDs.ts)
export const GT_CREATE_INSTANCE = "4367e2d6-6c92-450a-becb-abce1fb07682";
export const GT_PROPERTY_SET = "cf3bb923-f1f1-40be-b728-782844402426";

// Fixture UIDs (local to this test).
export const PROTO = "42640000-0000-4000-8000-0000000000a1";
export const PROTO_CLASS = "42640000-0000-4000-8000-0000000000a2"; // ems__TaskPrototype
export const CMD_CREATE = "42640000-0000-4000-8000-0000000000b1";
export const GND_CREATE = "42640000-0000-4000-8000-0000000000b2";
export const PD_DRAFT = "42640000-0000-4000-8000-0000000000b3";
export const CMD_BACKLOG = "42640000-0000-4000-8000-0000000000c1";
export const PRE_BACKLOG = "42640000-0000-4000-8000-0000000000c2";
export const GND_BACKLOG = "42640000-0000-4000-8000-0000000000c3";
export const CMD_START = "42640000-0000-4000-8000-0000000000d1";
export const PRE_START = "42640000-0000-4000-8000-0000000000d2";
export const GND_START = "42640000-0000-4000-8000-0000000000d3";
// #4277 — A6 needs a mutation that is rebuild-class under the projection-aware
// classification: a LABEL change on the TBox-form task (a status flip on it is
// an ordinary delta since #4277). The new label is a HUMAN one on purpose: a
// `prefix__Name` literal in a grounding is itself expanded to a symbolic IRI
// by the converter, so "rename to another TBox form" cannot be expressed as a
// targetValueLiteral — losing the TBox form is the rebuild-class change here.
export const CMD_RENAME = "42640000-0000-4000-8000-0000000000d4";
export const GND_RENAME = "42640000-0000-4000-8000-0000000000d5";
export const TBOX_TASK_LABEL = "zz__TboxTask4264";
export const TBOX_TASK_RENAMED = "TBox task renamed (4264)";
export const TBOX_TASK = "42640000-0000-4000-8000-0000000000e1"; // a Draft task whose LABEL is TBox-form
export const BIND_START = "42640000-0000-4000-8000-0000000000f1";
export const BIND_BACKLOG = "42640000-0000-4000-8000-0000000000f2";
export const DRAFT_TASK = "42640000-0000-4000-8000-0000000000aa"; // a ready-made Draft task
export const OTHER_TASK = "42640000-0000-4000-8000-0000000000ab"; // the "file G" of A7
export const PROTO_INSTANCE = "42640000-0000-4000-8000-0000000000ac"; // Draft task WITH exo__Asset_prototype → PROTO
export const CMD_INHERITED = "42640000-0000-4000-8000-0000000000e2";
export const PRE_INHERITED = "42640000-0000-4000-8000-0000000000e3";
export const GND_INHERITED = "42640000-0000-4000-8000-0000000000e4";
export const BIND_INHERITED = "42640000-0000-4000-8000-0000000000f3";
export const GT_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

export const SEED = "42645eed-0000-4000-8000-000000000000";
export const FROZEN = "2026-09-18T10:00:00.000Z";
export const CHAIN_LABEL = "Chain task 4264";

export const fm = (lines: string[]): string => ["---", ...lines, "---", ""].join("\n");

// Mirrors the shipped preconditions 8815fdc8 / 575404fc: not a prototype, and
// the current status ∈ the allowed set (symbolic IRI OR uid8 substring).
export function statusAsk(allowedLocal: string, allowedUid: string): string {
  return (
    "PREFIX exo: <https://exocortex.my/ontology/exo#> " +
    "PREFIX ems: <https://exocortex.my/ontology/ems#> " +
    'ASK { FILTER NOT EXISTS { $target exo:Instance_class ?p . FILTER(STRENDS(STR(?p), "Prototype")) } ' +
    "$target ems:Effort_status ?s . " +
    `FILTER(?s IN (<https://exocortex.my/ontology/ems#${allowedLocal}>) || CONTAINS(STR(?s), "${allowedUid.slice(0, 8)}")) }`
  );
}

export function command(
  uid: string,
  label: string,
  cliName: string,
  groundingUid: string,
  preconditionUid?: string,
): string {
  const lines = [
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
    `exo__Instance_class: ["[[exocmd__Command]]"]`,
    `exocmd__Command_cliName: ${cliName}`,
    `exocmd__Command_category: status`,
    `exocmd__Command_grounding: "[[${groundingUid}|g]]"`,
    `exocmd__Command_successMessage: "${label} done"`,
  ];
  if (preconditionUid) {
    lines.push(`exocmd__Command_precondition: "[[${preconditionUid}|p]]"`);
  }
  return fm(lines);
}

export function precondition(uid: string, label: string, ask: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class: ["[[exocmd__Precondition]]"]`,
    `exocmd__Precondition_sparqlAsk: '${ask}'`,
  ]);
}

export function propertySet(uid: string, label: string, valueRef: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
    `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
    `exocmd__Grounding_targetProperty: "ems__Effort_status"`,
    // targetValueRef wraps the constant UID as "[[<uid>]]" in the executor.
    `exocmd__Grounding_targetValueRef: "${valueRef}"`,
  ]);
}

export function binding(
  uid: string,
  commandUid: string,
  targetClass: string,
  order: number,
): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "binding ${uid}"`,
    `exo__Instance_class: ["[[exocmd__CommandBinding]]"]`,
    `exocmd__CommandBinding_command: "[[${commandUid}]]"`,
    `exocmd__CommandBinding_targetClass: ${targetClass}`,
    `exocmd__CommandBinding_position: inline`,
    `exocmd__CommandBinding_order: ${order}`,
  ]);
}

export function taskMd(uid: string, label: string, statusUid: string): string {
  return fm([
    `exo__Asset_uid: ${uid}`,
    `exo__Asset_label: "${label}"`,
    `exo__Instance_class: ["[[${TASK_CLASS}]]"]`,
    `ems__Effort_status: "[[${statusUid}]]"`,
  ]);
}

/** Vault-relative paths of the fixture (nested like a real vault). */
export const REL = {
  taskClass: `assetspaces/x/tbox/${TASK_CLASS}.md`,
  protoClass: `assetspaces/x/tbox/${PROTO_CLASS}.md`,
  draft: `assetspaces/x/tbox/${STATUS_DRAFT}.md`,
  backlog: `assetspaces/x/tbox/${STATUS_BACKLOG}.md`,
  doing: `assetspaces/x/tbox/${STATUS_DOING}.md`,
  propStatus: `assetspaces/x/tbox/${PROP_STATUS}.md`,
  proto: `assetspaces/x/efforts/${PROTO}.md`,
  draftTask: `assetspaces/x/efforts/${DRAFT_TASK}.md`,
  otherTask: `assetspaces/x/efforts/${OTHER_TASK}.md`,
  tboxTask: `assetspaces/x/efforts/${TBOX_TASK}.md`,
  protoInstance: `assetspaces/x/efforts/${PROTO_INSTANCE}.md`,
  cache: path.join(".exocortex", "cache", "triples.json"),
};

export function buildVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exo-4264-"));
  const write = (rel: string, md: string): void => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, md, "utf-8");
  };
  // TBox / enums (UID-canon, labels in TBox form → symbolic emission).
  write(REL.taskClass, fm([`exo__Asset_uid: ${TASK_CLASS}`, `exo__Asset_label: ems__Task`]));
  write(
    REL.protoClass,
    fm([
      `exo__Asset_uid: ${PROTO_CLASS}`,
      `exo__Asset_label: ems__TaskPrototype`,
      `exo__Class_superClass: "[[${TASK_CLASS}]]"`,
    ]),
  );
  write(REL.draft, fm([`exo__Asset_uid: ${STATUS_DRAFT}`, `exo__Asset_label: ems__EffortStatusDraft`]));
  write(REL.backlog, fm([`exo__Asset_uid: ${STATUS_BACKLOG}`, `exo__Asset_label: ems__EffortStatusBacklog`]));
  write(REL.doing, fm([`exo__Asset_uid: ${STATUS_DOING}`, `exo__Asset_label: ems__EffortStatusDoing`]));
  write(REL.propStatus, fm([`exo__Asset_uid: ${PROP_STATUS}`, `exo__Asset_label: ems__Effort_status`]));

  // create-task-instance: create_instance of ems__Task in Inbox/, status
  // defaulted to Draft through a PropertyDefault (the shipped command does the
  // same through `exocmd__Grounding_propertyDefault`).
  write(`cmd/${CMD_CREATE}.md`, command(CMD_CREATE, "Create task instance (4264)", "create-task-instance-4264", GND_CREATE));
  write(
    `cmd/${GND_CREATE}.md`,
    fm([
      `exo__Asset_uid: ${GND_CREATE}`,
      `exo__Asset_label: "Create task instance grounding (4264)"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_CREATE_INSTANCE}]]"`,
      `exocmd__Grounding_targetClass: "ems__Task"`,
      `exocmd__Grounding_targetFolder: "Inbox"`,
      `exocmd__Grounding_propertyDefault: "[[${PD_DRAFT}]]"`,
    ]),
  );
  write(
    `cmd/${PD_DRAFT}.md`,
    fm([
      `exo__Asset_uid: ${PD_DRAFT}`,
      `exo__Asset_label: "Default status Draft (4264)"`,
      `exo__Instance_class: ["[[exocmd__PropertyDefault]]"]`,
      `exocmd__PropertyDefault_property: "[[${PROP_STATUS}]]"`,
      `exocmd__PropertyDefault_value: "[[${STATUS_DRAFT}]]"`,
    ]),
  );

  // move-to-backlog: Draft → Backlog; start-effort: Backlog → Doing.
  write(`cmd/${CMD_BACKLOG}.md`, command(CMD_BACKLOG, "Move to Backlog (4264)", "move-to-backlog-4264", GND_BACKLOG, PRE_BACKLOG));
  write(`cmd/${PRE_BACKLOG}.md`, precondition(PRE_BACKLOG, "Allow Backlog from Draft (4264)", statusAsk("EffortStatusDraft", STATUS_DRAFT)));
  write(`cmd/${GND_BACKLOG}.md`, propertySet(GND_BACKLOG, "Set status Backlog (4264)", STATUS_BACKLOG));
  write(`cmd/${CMD_START}.md`, command(CMD_START, "Start Effort (4264)", "start-effort-4264", GND_START, PRE_START));
  write(`cmd/${PRE_START}.md`, precondition(PRE_START, "Allow Doing from Backlog (4264)", statusAsk("EffortStatusBacklog", STATUS_BACKLOG)));
  write(`cmd/${GND_START}.md`, propertySet(GND_START, "Set status Doing (4264)", STATUS_DOING));
  // rename-tbox-label: property_set of exo__Asset_label to a human value —
  // the A6 rebuild-class mutation (#4277): the task LOSES its TBox-form label.
  write(`cmd/${CMD_RENAME}.md`, command(CMD_RENAME, "Rename TBox label (4264)", "rename-tbox-label-4264", GND_RENAME));
  write(
    `cmd/${GND_RENAME}.md`,
    fm([
      `exo__Asset_uid: ${GND_RENAME}`,
      `exo__Asset_label: "Set label ${TBOX_TASK_RENAMED} (4264)"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_PROPERTY_SET}]]"`,
      `exocmd__Grounding_targetProperty: "exo__Asset_label"`,
      `exocmd__Grounding_targetValueLiteral: "${TBOX_TASK_RENAMED}"`,
    ]),
  );

  // Bindings so `resolve-buttons` has a Layer-A button-set on a task.
  write(`cmd/${BIND_START}.md`, binding(BIND_START, CMD_START, "ems__Task", 10));
  write(`cmd/${BIND_BACKLOG}.md`, binding(BIND_BACKLOG, CMD_BACKLOG, "ems__Task", 20));

  // Prototype (apply target of create-task-instance) + ready-made tasks. The
  // prototype carries a property that only the prototype-chain INFERENCE
  // (what `index` materializes) copies onto its instances — A2b keys on it.
  write(
    REL.proto,
    fm([
      `exo__Asset_uid: ${PROTO}`,
      `exo__Asset_label: "Task prototype (4264)"`,
      `exo__Instance_class: ["[[${PROTO_CLASS}]]"]`,
      `test__Owner: "Alice"`,
    ]),
  );
  write(
    REL.protoInstance,
    fm([
      `exo__Asset_uid: ${PROTO_INSTANCE}`,
      `exo__Asset_label: "Prototype-bearing task (4264)"`,
      `exo__Instance_class: ["[[${TASK_CLASS}]]"]`,
      `exo__Asset_prototype: "[[${PROTO}]]"`,
      `ems__Effort_status: "[[${STATUS_DRAFT}]]"`,
    ]),
  );
  // A command whose precondition is satisfied ONLY through the inherited
  // property (no `exo:Asset_prototype` walk in the ASK) — visible iff the
  // store carries the inferred layer.
  write(`cmd/${CMD_INHERITED}.md`, command(CMD_INHERITED, "Needs inherited owner (4264)", "needs-owner-4264", GND_INHERITED, PRE_INHERITED));
  write(
    `cmd/${PRE_INHERITED}.md`,
    precondition(
      PRE_INHERITED,
      "Has an owner (own or inherited) (4264)",
      "ASK { $target <https://exocortex.my/ontology/test#Owner> ?o }",
    ),
  );
  write(
    `cmd/${GND_INHERITED}.md`,
    fm([
      `exo__Asset_uid: ${GND_INHERITED}`,
      `exo__Asset_label: "noop (4264)"`,
      `exo__Instance_class: ["[[exocmd__Grounding]]"]`,
      `exocmd__Grounding_type: "[[${GT_SERVICE_CALL}]]"`,
      `exocmd__Grounding_serviceId: "noop"`,
    ]),
  );
  write(`cmd/${BIND_INHERITED}.md`, binding(BIND_INHERITED, CMD_INHERITED, "ems__Task", 30));
  write(REL.draftTask, taskMd(DRAFT_TASK, "Draft task (4264)", STATUS_DRAFT));
  write(REL.otherTask, taskMd(OTHER_TASK, "Other task (4264)", STATUS_BACKLOG));
  // A6: a Draft task whose label has the TBox form `prefix__Name` — its
  // referrers emit SYMBOLIC IRIs derived from that label, so a change to the
  // label itself (rename-tbox-label-4264 → a human label) is a mutation the
  // delta cannot express. (#4263 classified ANY change to such a file as
  // rebuild-only; since #4277 a status flip on it is an ordinary delta — the
  // label change is what stays rebuild-class under both classifications.)
  write(REL.tboxTask, taskMd(TBOX_TASK, TBOX_TASK_LABEL, STATUS_DRAFT));
  fs.mkdirSync(path.join(root, "Inbox"), { recursive: true });
  return root;
}
