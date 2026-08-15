/**
 * req 5cd9fffe — the CLI naming oracle applies specs that match on a HOST FUNCTION.
 *
 * Sibling of `resolve-display-name.integration.test.ts` (req f17f7c57), which shipped the oracle
 * but explicitly deferred this: with no registry passed, the engine's fail-closed lookup meant a
 * spec naming `isEffortBlocked` / `isEpisodeOngoing` simply never participated. The CLI was an
 * oracle for 33 of 35 specs and said nothing about the other two.
 *
 * Everything here drives the REAL command over a REAL temp vault. The fixture mirrors the live
 * spec shape measured 2026-08-15 (`exo__DisplayNameSpec_matchHostFunction: isEffortBlocked`,
 * priority 200, `appliesToClass: "[[uid|label]]"`) rather than an invented one — a spec that
 * matched only a hand-made shape would prove nothing about production.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { resolveDisplayName } from "../../src/commands/resolve-display-name.js";

const REQ = "@req:5cd9fffe-1fa5-4fda-8e2a-bfe6d4c88379";

const EFFORT_CLASS = "a1111111-1111-4222-8333-444444444444";
const EFFORT_SPEC = "a2222222-1111-4222-8333-444444444444";
const EFFORT_PART = "a3333333-1111-4222-8333-444444444444";
const PERIOD_CLASS = "b1111111-1111-4222-8333-444444444444";
const PERIOD_SPEC = "b2222222-1111-4222-8333-444444444444";
const PERIOD_PART = "b3333333-1111-4222-8333-444444444444";
const GHOST_CLASS = "c1111111-1111-4222-8333-444444444444";
const GHOST_SPEC = "c2222222-1111-4222-8333-444444444444";
const GHOST_PART = "c3333333-1111-4222-8333-444444444444";

const TARGET = "d0000000-1111-4222-8333-444444444444";
const BLOCKER = "d0000001-1111-4222-8333-444444444444";

/** The UID the real vault uses for ems__EffortStatusDone — the bare form the CLI writes. */
const DONE_UID = "7b9b3116-7c3c-438c-9618-94fe301320a6";

let vault: string;

function write(rel: string, frontmatter: Record<string, unknown>): void {
  const full = path.join(vault, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) =>
    Array.isArray(v)
      ? `${k}:\n${v.map((x) => `  - ${JSON.stringify(x)}`).join("\n")}`
      : `${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`,
  );
  writeFileSync(full, `---\n${lines.join("\n")}\n---\n\n`, "utf8");
}

/** A `YYYY-MM-DD` key offset from today, in the LOCAL basis the predicate itself uses. */
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** class + host-function spec + one printed-property part, mirroring the live shape. */
function writeSpecTriple(
  classUid: string,
  classLabel: string,
  specUid: string,
  partUid: string,
  hostFunction: string,
  property: string,
): void {
  write(`assetspaces/t/${classUid}.md`, {
    exo__Asset_uid: classUid,
    exo__Asset_label: classLabel,
    exo__Instance_class: ["[[exo__Class]]"],
  });
  write(`assetspaces/t/${specUid}.md`, {
    exo__Asset_uid: specUid,
    exo__Asset_label: `spec: ${classLabel} (${hostFunction})`,
    exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
    exo__DisplayNameSpec_appliesToClass: `[[${classUid}|${classLabel}]]`,
    exo__DisplayNameSpec_priority: 200,
    exo__DisplayNameSpec_matchHostFunction: hostFunction,
  });
  write(`assetspaces/t/${partUid}.md`, {
    exo__Asset_uid: partUid,
    exo__Asset_label: `part: ${property}`,
    exo__Instance_class: ["[[exo__PrintedProperty]]"],
    exo__DisplayNamePart_of: `[[${specUid}]]`,
    exo__DisplayNamePart_order: 1,
    exo__PrintedProperty_property: property,
  });
}

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), "exo-rdn-hf-"));
  writeSpecTriple(EFFORT_CLASS, "t__Effort", EFFORT_SPEC, EFFORT_PART, "isEffortBlocked", "t__Effort_serial");
  writeSpecTriple(PERIOD_CLASS, "t__Period", PERIOD_SPEC, PERIOD_PART, "isEpisodeOngoing", "t__Period_serial");
  // Names an function that is registered NOWHERE — the fail-closed control.
  writeSpecTriple(GHOST_CLASS, "t__Ghost", GHOST_SPEC, GHOST_PART, "thisFunctionDoesNotExist", "t__Ghost_serial");
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("resolve-display-name — host-function specs (req 5cd9fffe)", () => {
  it(`${REQ} applies an isEffortBlocked spec when the blocker is still active (Scenario 1)`, async () => {
    write(`assetspaces/t/${BLOCKER}.md`, {
      exo__Asset_uid: BLOCKER,
      exo__Asset_label: "the blocker",
      ems__Effort_status: "[[ems__EffortStatusBacklog]]",
    });
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${EFFORT_CLASS}]]`],
      ems__Effort_blocker: `[[${BLOCKER}]]`,
      t__Effort_serial: "EF-9001",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    // Reaching the serial at all means the predicate ran, returned true, AND resolved a SECOND
    // asset through the port — the whole capability this requirement adds to the CLI.
    expect(r.displayName).toContain("EF-9001");
    expect(r.source).toBe("spec");
  });

  it(`${REQ} does NOT apply it when the blocker is finished (negative control)`, async () => {
    write(`assetspaces/t/${BLOCKER}.md`, {
      exo__Asset_uid: BLOCKER,
      exo__Asset_label: "the blocker",
      // SYMBOLIC form — the one the predicate compares against.
      ems__Effort_status: "[[ems__EffortStatusDone]]",
    });
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${EFFORT_CLASS}]]`],
      ems__Effort_blocker: `[[${BLOCKER}]]`,
      t__Effort_serial: "EF-9001",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    // Without this control the suite would pass with a predicate hardwired to true.
    expect(r.displayName).not.toContain("EF-9001");
    expect(r.source).not.toBe("spec");
  });

  it(`${REQ} CHARACTERISES the inherited dual-IRI defect: a bare-UID Done blocker still reads as blocking`, async () => {
    write(`assetspaces/t/${BLOCKER}.md`, {
      exo__Asset_uid: BLOCKER,
      exo__Asset_label: "the blocker",
      // ⛔ The form `exocortex-cli` actually writes. Stripping the brackets leaves a UID, which
      // matches neither EffortStatus.DONE nor TRASHED, so a FINISHED blocker reads as active.
      // Measured 2026-08-15 on live data: 49 of 58 single-valued blockers store this form and 8
      // efforts carry a 🚩 they should not. Moved VERBATIM so both surfaces stay identical —
      // parity is this requirement's point, and the fix (match both forms) gets its own req.
      // ⛤ When that fix lands, THIS test is its revert-verify: it must flip.
      ems__Effort_status: `[[${DONE_UID}]]`,
    });
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${EFFORT_CLASS}]]`],
      ems__Effort_blocker: `[[${BLOCKER}]]`,
      t__Effort_serial: "EF-9001",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    expect(r.displayName).toContain("EF-9001"); // ⛔ wrong in the domain, right as parity
    expect(r.source).toBe("spec");
  });

  it(`${REQ} applies an isEpisodeOngoing spec without touching the vault port (Scenario 5)`, async () => {
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${PERIOD_CLASS}]]`],
      life__Episode_start: localDay(-1),
      life__Episode_end: localDay(1),
      t__Period_serial: "PD-7707",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    expect(r.displayName).toContain("PD-7707");
    expect(r.source).toBe("spec");
  });

  it(`${REQ} does NOT apply it to a period that already ended (negative control)`, async () => {
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${PERIOD_CLASS}]]`],
      life__Episode_start: localDay(-9),
      life__Episode_end: localDay(-2),
      t__Period_serial: "PD-7707",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    expect(r.displayName).not.toContain("PD-7707");
    expect(r.source).not.toBe("spec");
  });

  it(`${REQ} stays fail-closed for a host function nobody registered (Scenario 4)`, async () => {
    write(`assetspaces/t/${TARGET}.md`, {
      exo__Asset_uid: TARGET,
      exo__Instance_class: [`[[${GHOST_CLASS}]]`],
      t__Ghost_serial: "GH-0001",
    });

    // Must not throw: an unknown name degrades to "this spec does not participate", never to an
    // error — otherwise one stale spec would break naming for every asset of its class.
    const r = await resolveDisplayName(vault, `assetspaces/t/${TARGET}.md`);

    expect(r.displayName).not.toContain("GH-0001");
    expect(r.uid).toBe(TARGET);
  });
});
