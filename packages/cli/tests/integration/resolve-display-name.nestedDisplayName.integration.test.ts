/**
 * req 0f992e88 (issue #4303) — the printed-property fallback, exercised through the CLI oracle
 * over a REAL temp vault on disk.
 *
 * ⛤ Why this file exists next to the core axes: the core suite drives the engine over an
 * in-memory port, so it proves the naming logic. THIS one proves the same behaviour reaches the
 * surface a user actually runs — `resolve-display-name`, the same command that answers "what is
 * this asset called" in CI and in the autonomous loop — through `FileSystemVaultAdapter` +
 * `FsVaultMetadataAdapter`. A regression that reached only the adapters would pass the core axes.
 *
 * The fixture is the motivating shape of #4303 verbatim: a `period__Quarter` instance created
 * WITHOUT `exo__Asset_label` (the `omitLabel` / #4294 shape) whose name is composed by its own
 * spec, referenced by a review whose spec prints it.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { resolveDisplayName } from "../../src/commands/resolve-display-name.js";

const REQ = "@req:0f992e88-e43b-4317-9707-5e1d5309d44e";

const QUARTER_CLASS = "11111111-2222-4333-8444-555555555551";
const REVIEW_CLASS = "11111111-2222-4333-8444-555555555552";
const PROP_NUMBER = "11111111-2222-4333-8444-555555555553";
const PROP_QUARTER = "11111111-2222-4333-8444-555555555554";
const QUARTER_SPEC = "11111111-2222-4333-8444-555555555555";
const REVIEW_SPEC = "11111111-2222-4333-8444-555555555556";
const QUARTER = "11111111-2222-4333-8444-555555555557";
const REVIEW = "11111111-2222-4333-8444-555555555558";

let vault: string;

function write(uid: string, frontmatter: Record<string, unknown>): void {
  const full = path.join(vault, "assetspaces", "t", `${uid}.md`);
  mkdirSync(path.dirname(full), { recursive: true });
  const lines = Object.entries({ exo__Asset_uid: uid, ...frontmatter }).map(
    ([k, v]) =>
      Array.isArray(v)
        ? `${k}:\n${v.map((x) => `  - ${JSON.stringify(x)}`).join("\n")}`
        : `${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`,
  );
  writeFileSync(full, `---\n${lines.join("\n")}\n---\n\n`, "utf8");
}

/** Everything except the quarter instance, which each axis writes with or without a label. */
function writeBaseVault(): void {
  write(QUARTER_CLASS, {
    exo__Asset_label: "period__Quarter",
    exo__Instance_class: ["[[exo__Class]]"],
  });
  write(REVIEW_CLASS, {
    exo__Asset_label: "tbank__Review",
    exo__Instance_class: ["[[exo__Class]]"],
  });
  write(PROP_NUMBER, {
    exo__Asset_label: "period__Quarter_number",
    exo__Instance_class: ["[[exo__DatatypeProperty]]"],
  });
  write(PROP_QUARTER, {
    exo__Asset_label: "tbank__Review_quarter",
    exo__Instance_class: ["[[exo__ObjectProperty]]"],
  });

  write(QUARTER_SPEC, {
    exo__Asset_label: "spec: period__Quarter",
    exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
    exo__DisplayNameSpec_appliesToClass: `[[${QUARTER_CLASS}|period__Quarter]]`,
    exo__DisplayNameSpec_priority: 100,
  });
  write("11111111-2222-4333-8444-55555555555a", {
    exo__Instance_class: ["[[exo__PrintedLiteral]]"],
    exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
    exo__DisplayNamePart_order: 1,
    exo__PrintedLiteral_literal: "Q",
  });
  write("11111111-2222-4333-8444-55555555555b", {
    exo__Instance_class: ["[[exo__PrintedProperty]]"],
    exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
    exo__DisplayNamePart_order: 2,
    exo__PrintedProperty_property: `[[${PROP_NUMBER}]]`,
  });
  write("11111111-2222-4333-8444-55555555555c", {
    exo__Instance_class: ["[[exo__PrintedLiteral]]"],
    exo__DisplayNamePart_of: `[[${QUARTER_SPEC}]]`,
    exo__DisplayNamePart_order: 3,
    exo__PrintedLiteral_literal: "-2025",
  });

  write(REVIEW_SPEC, {
    exo__Asset_label: "spec: tbank__Review",
    exo__Instance_class: ["[[exo__DisplayNameSpec]]"],
    exo__DisplayNameSpec_appliesToClass: `[[${REVIEW_CLASS}|tbank__Review]]`,
    exo__DisplayNameSpec_priority: 100,
    exo__DisplayNameSpec_separator: " ",
  });
  write("11111111-2222-4333-8444-55555555555d", {
    exo__Instance_class: ["[[exo__PrintedLiteral]]"],
    exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
    exo__DisplayNamePart_order: 1,
    exo__PrintedLiteral_literal: "ОС",
  });
  write("11111111-2222-4333-8444-55555555555e", {
    exo__Instance_class: ["[[exo__PrintedProperty]]"],
    exo__DisplayNamePart_of: `[[${REVIEW_SPEC}]]`,
    exo__DisplayNamePart_order: 2,
    exo__PrintedProperty_property: `[[${PROP_QUARTER}]]`,
  });

  write(REVIEW, {
    exo__Asset_label: "ОС a.a.aleksin",
    exo__Instance_class: `[[${REVIEW_CLASS}|tbank__Review]]`,
    tbank__Review_quarter: `[[${QUARTER}]]`,
  });
}

const target = (uid: string): string => `assetspaces/t/${uid}.md`;

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), "exo-nested-dn-"));
  writeBaseVault();
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("resolve-display-name — a printed property prints a label-less target's composed name", () => {
  it(`${REQ} W1 the oracle prints «ОС Q4-2025», not the quarter's UID`, async () => {
    write(QUARTER, {
      exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
      period__Quarter_number: 4,
    });

    // The target names itself from its own spec — the precondition of the whole requirement.
    const quarter = await resolveDisplayName(vault, target(QUARTER));
    expect(quarter.displayName).toBe("Q4-2025");
    expect(quarter.source).toBe("spec");

    const review = await resolveDisplayName(vault, target(REVIEW));
    expect(review.displayName).toBe("ОС Q4-2025");
    expect(review.displayName).not.toContain(QUARTER);
  });

  it(`${REQ} W2 CONTROL — once the quarter carries a label, the label is printed again`, async () => {
    write(QUARTER, {
      exo__Asset_label: "Q4-25",
      exo__Instance_class: `[[${QUARTER_CLASS}|period__Quarter]]`,
      period__Quarter_number: 4,
    });

    // Same vault, same spec — only the label added. This is the shape 50 884 live assets are in,
    // and it must render exactly as it did before the requirement.
    const review = await resolveDisplayName(vault, target(REVIEW));
    expect(review.displayName).toBe("ОС Q4-25");
  });
});
