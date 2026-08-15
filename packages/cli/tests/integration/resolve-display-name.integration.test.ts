/**
 * req f17f7c57 — `exocortex resolve-display-name <target>` is the naming oracle outside Obsidian.
 *
 * Drives the REAL command over a REAL temp vault on disk: the same engine the plugin runs (moved
 * to packages/core by this requirement), the same `exo__DisplayNameSpec` scan, differing only in
 * the VaultMetadataPort implementation. Nothing here is stubbed — a divergence between what this
 * prints and what Obsidian renders would be an adapter bug, not a second naming implementation.
 *
 * The fixture reproduces the motivating shape: an asset with NO `exo__Asset_label` whose name is
 * composed per-render by a vault spec (the `omitLabel` case shipped in v16.219.0). Before this
 * command that name was checkable only by eye in Obsidian or through the plugin's jest harness.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { resolveDisplayName } from "../../src/commands/resolve-display-name.js";

const REQ = "@req:f17f7c57-d3b6-42d3-916e-8d59bc8447c5";

// UID-canon filenames, as the real vault uses — the basename IS the uid, which is precisely why
// a label-less asset with no spec shows a bare UID (the `basename` source below).
const CLASS_UID = "aaaaaaaa-1111-4222-8333-444444444444";
const SPEC_UID = "bbbbbbbb-1111-4222-8333-444444444444";
const PART_UID = "cccccccc-1111-4222-8333-444444444444";
const LABELLESS_UID = "dddddddd-1111-4222-8333-444444444444";
const LABELLED_UID = "eeeeeeee-1111-4222-8333-444444444444";
const UNCOVERED_UID = "ffffffff-1111-4222-8333-444444444444";

let vault: string;

function write(rel: string, frontmatter: Record<string, unknown>, body = ""): void {
  const full = path.join(vault, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) =>
    Array.isArray(v)
      ? `${k}:\n${v.map((x) => `  - ${JSON.stringify(x)}`).join("\n")}`
      : `${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`,
  );
  writeFileSync(full, `---\n${lines.join("\n")}\n---\n\n${body}\n`, "utf8");
}

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), "exo-rdn-"));

  // The class every fixture instance belongs to. Its label is the `prefix__Local` form the spec
  // keys on — the dual-keying the engine relies upon.
  write(`assetspaces/t/${CLASS_UID}.md`, {
    exo__Asset_uid: CLASS_UID,
    exo__Asset_label: "t__Widget",
    exo__Instance_class: ["[[exo__Class]]"],
  });

  // A spec for that class: a "⚙ " prefix part plus the instance's own serial number.
  write(`assetspaces/t/${SPEC_UID}.md`, {
    exo__Asset_uid: SPEC_UID,
    exo__Asset_label: "spec: t__Widget",
    exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
    exo__DisplayNameSpec_appliesToClass: `[[${CLASS_UID}|t__Widget]]`,
    exo__DisplayNameSpec_priority: 100,
  });
  write(`assetspaces/t/${PART_UID}.md`, {
    exo__Asset_uid: PART_UID,
    exo__Asset_label: "part: serial",
    exo__Instance_class: ["[[exo__PrintedProperty]]"],
    exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
    exo__DisplayNamePart_order: 1,
    exo__PrintedProperty_property: "t__Widget_serial",
  });
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("resolve-display-name — the naming oracle outside Obsidian", () => {
  it(`${REQ} composes the display name of a LABEL-LESS asset from its vault spec (Scenario 1)`, async () => {
    write(`assetspaces/t/${LABELLESS_UID}.md`, {
      exo__Asset_uid: LABELLESS_UID,
      exo__Instance_class: [`[[${CLASS_UID}]]`],
      t__Widget_serial: "SN-4417",
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${LABELLESS_UID}.md`);

    // The whole point: the file carries no exo__Asset_label, yet a name comes out.
    expect(r.displayName).toContain("SN-4417");
    expect(r.displayName).not.toBe(r.basename);
    expect(r.uid).toBe(LABELLESS_UID);
    expect(r.source).toBe("spec");
  });

  it(`${REQ} reports source=label when no spec covers the class (Scenario 3)`, async () => {
    write(`assetspaces/t/${LABELLED_UID}.md`, {
      exo__Asset_uid: LABELLED_UID,
      exo__Asset_label: "Plain Widget",
      // deliberately NOT the spec'd class — nothing participates
      exo__Instance_class: ["[[99999999-1111-4222-8333-444444444444]]"],
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${LABELLED_UID}.md`);

    expect(r.displayName).toBe("Plain Widget");
    expect(r.source).toBe("label");
  });

  it(`${REQ} reports source=basename — a label-less asset NO spec covers shows a bare UID (Scenario 3)`, async () => {
    // This is the failure mode the oracle exists to make visible: omitLabel without a spec.
    write(`assetspaces/t/${UNCOVERED_UID}.md`, {
      exo__Asset_uid: UNCOVERED_UID,
      exo__Instance_class: ["[[99999999-1111-4222-8333-444444444444]]"],
    });

    const r = await resolveDisplayName(vault, `assetspaces/t/${UNCOVERED_UID}.md`);

    expect(r.displayName).toBe(UNCOVERED_UID);
    expect(r.source).toBe("basename");
  });

  it(`${REQ} a spec edit changes the output with no code change — one engine, vault-driven (Scenario 2)`, async () => {
    write(`assetspaces/t/${LABELLESS_UID}.md`, {
      exo__Asset_uid: LABELLESS_UID,
      exo__Instance_class: [`[[${CLASS_UID}]]`],
      t__Widget_serial: "SN-4417",
      t__Widget_batch: "B-9",
    });

    const before = await resolveDisplayName(vault, `assetspaces/t/${LABELLESS_UID}.md`);
    expect(before.displayName).toContain("SN-4417");
    expect(before.displayName).not.toContain("B-9");

    // Re-point the SAME part at a different property — data only, nothing recompiled.
    write(`assetspaces/t/${PART_UID}.md`, {
      exo__Asset_uid: PART_UID,
      exo__Asset_label: "part: serial",
      exo__Instance_class: ["[[exo__PrintedProperty]]"],
      exo__DisplayNamePart_of: `[[${SPEC_UID}]]`,
      exo__DisplayNamePart_order: 1,
      exo__PrintedProperty_property: "t__Widget_batch",
    });

    const after = await resolveDisplayName(vault, `assetspaces/t/${LABELLESS_UID}.md`);
    expect(after.displayName).toContain("B-9");
    expect(after.displayName).not.toContain("SN-4417");
  });

  it(`${REQ} fails loudly on a target that does not exist, writing nothing (Scenario 5)`, async () => {
    await expect(
      resolveDisplayName(vault, "assetspaces/t/does-not-exist.md"),
    ).rejects.toThrow(/Target file not found/);
  });

  it(`${REQ} refuses a target that EXISTS but sits outside the vault (Scenario 5)`, async () => {
    // The containment guard runs AFTER the existence check (mirroring resolve-buttons), so a
    // merely-absent escaping path reports "not found". To exercise containment the file has to
    // exist — otherwise this axis would pass for the wrong reason.
    const outside = path.join(path.dirname(vault), `escape-${path.basename(vault)}.md`);
    writeFileSync(outside, "---\nexo__Asset_label: \"Outside\"\n---\n", "utf8");
    try {
      await expect(
        resolveDisplayName(vault, path.join("..", path.basename(outside))),
      ).rejects.toThrow(/outside the vault/);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
