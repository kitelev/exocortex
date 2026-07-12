import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForOntologyUrl,
  auditOntologyUrlCommand,
  expectedCanonicalForm,
} from "../../../src/commands/audit-ontology-url.js";
import { auditCommand } from "../../../src/commands/audit.js";

const ONTOLOGY_CLASS = "829b9b3b-6fc3-4276-be6a-27d3398c012e";

/** Write an ontology asset (optional exo__Ontology_url line). */
function writeOntology(dir: string, uid: string, url?: string): void {
  mkdirSync(dir, { recursive: true });
  const urlLine = url !== undefined ? `exo__Ontology_url: ${url}\n` : "";
  writeFileSync(
    join(dir, `${uid}.md`),
    `---
exo__Asset_uid: ${uid}
exo__Asset_label: Onto ${uid}
exo__Instance_class:
  - "[[${ONTOLOGY_CLASS}|exo__Ontology]]"
${urlLine}---

Body.
`,
    "utf-8",
  );
}

describe("audit ontology-url — Commander wiring", () => {
  it("registers under 'audit' parent command", () => {
    const parent = auditCommand();
    expect(parent.name()).toBe("audit");
    const sub = parent.commands.find((c) => c.name() === "ontology-url");
    expect(sub).toBeDefined();
  });

  it("subcommand declares --vault required + --output options", () => {
    const sub = auditOntologyUrlCommand();
    expect(sub.name()).toBe("ontology-url");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--vault");
    expect(opts).toContain("--output");
  });

  it("--help references the trailing-# / exo__Ontology_url semantics", () => {
    const sub = auditOntologyUrlCommand();
    expect(sub.helpInformation()).toMatch(/exo__Ontology_url|trailing/i);
  });
});

describe("expectedCanonicalForm", () => {
  it("appends '#' to a hash-less URL", () => {
    expect(expectedCanonicalForm("https://exocortex.my/ontology/ems")).toBe(
      "https://exocortex.my/ontology/ems#",
    );
  });

  it("strips trailing slashes before appending '#'", () => {
    expect(expectedCanonicalForm("https://exocortex.my/ontology/ems/")).toBe(
      "https://exocortex.my/ontology/ems#",
    );
    expect(expectedCanonicalForm("https://exocortex.my/ontology/ems//")).toBe(
      "https://exocortex.my/ontology/ems#",
    );
  });

  it("preserves an internal hierarchical path", () => {
    expect(
      expectedCanonicalForm("https://exocortex.my/ontology/kitelev-period/quarters"),
    ).toBe("https://exocortex.my/ontology/kitelev-period/quarters#");
  });
});

describe("audit ontology-url — scanVaultForOntologyUrl", () => {
  let vault: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `onturl-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  const emsDir = () =>
    join(vault, "assetspaces", "kitelev", "exoas-public", "ems");

  it("flags an exocortex.my URL without a trailing '#'", async () => {
    writeOntology(emsDir(), "u1", "https://exocortex.my/ontology/ems");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.checked).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expected).toBe("https://exocortex.my/ontology/ems#");
  });

  it("flags an exocortex.my URL that ends with '/' (must be '#')", async () => {
    writeOntology(emsDir(), "u2", "https://exocortex.my/ontology/ems/");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expected).toBe("https://exocortex.my/ontology/ems#");
  });

  it("passes an exocortex.my URL that already ends with '#'", async () => {
    writeOntology(emsDir(), "u3", "https://exocortex.my/ontology/ems#");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.checked).toBe(1);
    expect(r.violations).toHaveLength(0);
  });

  it("passes a hierarchical-path sub-ontology with '#'", async () => {
    writeOntology(
      emsDir(),
      "u4",
      "https://exocortex.my/ontology/kitelev-period/quarters#",
    );
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(0);
  });

  it("skips a foreign vocabulary (host ≠ exocortex.my), counted as foreign-vocab", async () => {
    writeOntology(emsDir(), "u5", "https://www.w3.org/2000/01/rdf-schema#");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.checked).toBe(0);
    expect(r.violations).toHaveLength(0);
    expect(r.skips["foreign-vocab"]).toBe(1);
    expect(r.skipExamples["foreign-vocab"].length).toBe(1);
  });

  it("skips a foreign vocab that ITSELF lacks a '#' (e.g. path-style) — never a violation", async () => {
    writeOntology(emsDir(), "u5b", "http://xmlns.com/foaf/0.1");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.skips["foreign-vocab"]).toBe(1);
  });

  it("skips an unparseable exo__Ontology_url, counted as unparseable-url", async () => {
    writeOntology(emsDir(), "u6", "not-a-url");
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.checked).toBe(0);
    expect(r.skips["unparseable-url"]).toBe(1);
    expect(r.violations).toHaveLength(0);
  });

  it("ignores assets with no exo__Ontology_url (not counted)", async () => {
    writeOntology(emsDir(), "u7"); // no url
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.ontologiesFound).toBe(0);
    expect(r.checked).toBe(0);
    expect(r.violations).toHaveLength(0);
  });

  it("counts multiple violations across folders", async () => {
    writeOntology(emsDir(), "m1", "https://exocortex.my/ontology/ems");
    writeOntology(
      join(vault, "assetspaces", "kitelev", "exoas-public", "concept"),
      "m2",
      "https://exocortex.my/ontology/concept",
    );
    writeOntology(
      join(vault, "assetspaces", "kitelev", "exoas-public", "pn"),
      "ok",
      "https://exocortex.my/ontology/pn#",
    );
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.ontologiesFound).toBe(3);
    expect(r.checked).toBe(3);
    expect(r.violations).toHaveLength(2);
  });

  it("does not scan node_modules", async () => {
    writeOntology(
      join(vault, "node_modules", "pkg"),
      "nm1",
      "https://exocortex.my/ontology/ems",
    );
    const r = await scanVaultForOntologyUrl(vault);
    expect(r.ontologiesFound).toBe(0);
    expect(r.violations).toHaveLength(0);
  });
});
