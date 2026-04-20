/**
 * RFC-CI-Tests Phase 1 Complement 2 — YAML contract test.
 *
 * Static-guard suite. Reads the pinned `starter-kit-fixtures` submodule and
 * asserts 8 invariants over the `exocmd__*` assets (Command, Binding,
 * Grounding, Precondition). No subprocess, no runtime — pure fs + yaml.
 *
 * Placement note (RFC §7.3 divergence — user-approved):
 * ----------------------------------------------------
 * RFC v4 §7.3 literally specifies
 *   `packages/obsidian-plugin/tests/unit/infrastructure/exocmd-contract.test.ts`
 * but the catalog helper shipped in 58b1d922 (PR #2887) lives in
 *   `packages/cli/tests/integration/starter-kit/test-helpers/command-catalog.ts`
 * and it uses ESM-only features (`import.meta.url`, `.js` extension imports).
 * Plugin jest runs in CommonJS ts-jest jsdom — it cannot import the catalog
 * helper without duplicating the loader (which would reintroduce the silent-
 * zero class of bug this contract is designed to prevent). Orchestrator
 * approved placement in CLI package as symmetric with 58b1d922 + path-drift
 * flag V4-2 resolution path. RFC v5 footnote pending.
 *
 * Baseline-lock / ratchet strategy:
 * ---------------------------------
 * Three ACs (3/4/5) have known non-zero violators in the fixtures today, each
 * scheduled for resolution by UX RFC Phase 0/P1-3/P1-4. Hard-failing them now
 * would block every Phase 1 PR. Instead:
 *   - The baseline file `./exocmd-contract.baseline.json` freezes the exact
 *     set of violator UUIDs.
 *   - New violations fail the contract (added UUIDs).
 *   - Fixes update the baseline (removed UUIDs). PR template captures this.
 *
 * Any baseline drift — extra violators, removed violators, or the same violator
 * count with different UUIDs — must show up as a diff. Never silently.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import {
  EXOCMD_COMMAND_CLASS_UUID,
  EXO_CLASS_META_UUID,
  loadCommandCatalog,
  type CommandCatalogEntry,
} from "./test-helpers/command-catalog.js";

/* ------------------------------------------------------------------------- */
/* Class UUIDs — single source of truth inside the suite.                    */
/* ------------------------------------------------------------------------- */

const EXOCMD_BINDING_CLASS_UUID = "3677039a-a5a8-4402-9a07-f8f18fe384ad";
const EXOCMD_GROUNDING_CLASS_UUID = "11579feb-2e42-491c-af59-b89b1129a539";
const EXOCMD_PRECONDITION_CLASS_UUID = "15d119b5-9636-431e-9e91-1f140107d059";

/* ------------------------------------------------------------------------- */
/* Fixture discovery — same walk pattern as command-catalog.ts               */
/* ------------------------------------------------------------------------- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "starter-kit-fixtures",
);
const SUBMODULE_HYDRATED =
  fs.existsSync(FIXTURES_ROOT) && fs.existsSync(path.join(FIXTURES_ROOT, "exocmd"));

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParsedAsset {
  path: string;
  fm: Record<string, unknown>;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function parseFm(raw: string): Record<string, unknown> | null {
  const m = FM_RE.exec(raw);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = yaml.load(m[1]);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractWikilinkUid(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(raw);
  return m ? m[1] : undefined;
}

function hasClassUuid(fm: Record<string, unknown>, targetUuid: string): boolean {
  for (const raw of toArray(fm["exo__Instance_class"])) {
    if (extractWikilinkUid(raw) === targetUuid) return true;
  }
  return false;
}

function loadAllAssets(): ParsedAsset[] {
  const out: ParsedAsset[] = [];
  if (!SUBMODULE_HYDRATED) return out;
  for (const filePath of walk(FIXTURES_ROOT).sort()) {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const fm = parseFm(raw);
    if (fm) out.push({ path: filePath, fm });
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Baseline snapshot                                                         */
/* ------------------------------------------------------------------------- */

interface BaselineBlock {
  rationale: string;
  entries: string[];
}
interface Baseline {
  AC3_duplicateCategoryLabel: BaselineBlock;
  AC4_confirmMessageOnNonDestructive: BaselineBlock;
  AC5_missingSuccessMessage: BaselineBlock;
}

function loadBaseline(): Baseline {
  const text = fs.readFileSync(
    path.join(HERE, "exocmd-contract.baseline.json"),
    "utf8",
  );
  return JSON.parse(text) as Baseline;
}

/* ------------------------------------------------------------------------- */
/* AC4 destructive policy                                                    */
/*                                                                           */
/* Per UX RFC P1-3: destructive operations are Archive, Convert-class,       */
/* Remove/Delete, Rename-to-UID. Policy check uses an explicit predicate     */
/* (category + label prefix) so it survives category renames (criticality    */
/* → zone, UX RFC P0-2). Baseline covers Phase 1 entry state; any command    */
/* added with a new destructive-shaped label and *no* confirmMessage is a    */
/* policy violation the maintainer resolves by either adding the message or  */
/* adjusting the predicate.                                                  */
/* ------------------------------------------------------------------------- */
function isDestructive(category: string | undefined, label: string): boolean {
  if (!category) return false;
  if (category === "maintenance" || category === "maintenance-complex") {
    // Maintenance is broadly destructive; the confirm requirement is the
    // default here. Per-label exceptions live in the baseline.
    return true;
  }
  if (category === "creation" && /^Convert /i.test(label)) {
    // Convert to Task / Convert to Project re-classify the asset — destructive
    // by effect, even though the category is creation.
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- */
/* Suite                                                                     */
/* ------------------------------------------------------------------------- */

const describeOrSkip = SUBMODULE_HYDRATED ? describe : describe.skip;

describeOrSkip("exocmd contract (YAML static guard, RFC Phase 1 Complement 2)", () => {
  const allAssets = loadAllAssets();
  const commandCatalog: CommandCatalogEntry[] = loadCommandCatalog();

  const bindings = allAssets.filter(({ fm }) =>
    hasClassUuid(fm, EXOCMD_BINDING_CLASS_UUID),
  );
  const groundings = allAssets.filter(({ fm }) =>
    hasClassUuid(fm, EXOCMD_GROUNDING_CLASS_UUID),
  );
  const preconditions = allAssets.filter(({ fm }) =>
    hasClassUuid(fm, EXOCMD_PRECONDITION_CLASS_UUID),
  );
  const classDefs = allAssets.filter(({ fm }) =>
    hasClassUuid(fm, EXO_CLASS_META_UUID),
  );

  const commandByUid = new Map<string, CommandCatalogEntry>();
  for (const c of commandCatalog) commandByUid.set(c.uid, c);

  const groundingUids = new Set<string>();
  for (const { fm } of groundings) {
    const uid = asString(fm["exo__Asset_uid"]);
    if (uid) groundingUids.add(uid);
  }

  const classUids = new Set<string>();
  for (const { fm } of classDefs) {
    const uid = asString(fm["exo__Asset_uid"]);
    if (uid) classUids.add(uid);
  }

  const baseline = loadBaseline();

  /* Silent-zero guard for the suite itself — if discovery is broken, every
   * describe below would vacuously pass. This mirrors the command-catalog
   * self-test spirit for the other classes too. */
  it("discovery finds a non-trivial number of each asset kind", () => {
    expect(commandCatalog.length).toBeGreaterThanOrEqual(40);
    expect(bindings.length).toBeGreaterThanOrEqual(40);
    expect(groundings.length).toBeGreaterThanOrEqual(40);
    expect(preconditions.length).toBeGreaterThanOrEqual(20);
    expect(classDefs.length).toBeGreaterThanOrEqual(20);
  });

  describe("AC1: every Command has ≥ 1 Binding", () => {
    it("no orphan commands", () => {
      const bindingsByCmd = new Map<string, string[]>();
      for (const { fm, path: bp } of bindings) {
        const cmdUid = extractWikilinkUid(fm["exocmd__CommandBinding_command"]);
        if (!cmdUid) continue;
        const list = bindingsByCmd.get(cmdUid) ?? [];
        list.push(bp);
        bindingsByCmd.set(cmdUid, list);
      }
      const orphans = commandCatalog
        .filter((c) => !bindingsByCmd.has(c.uid))
        .map((c) => `${c.uid} "${c.label}"`);
      expect(orphans).toEqual([]);
    });
  });

  describe("AC2: every Binding → existing Command, and that Command has a resolvable Grounding", () => {
    it("no dangling binding references and every bound command has a grounding present in the fixtures", () => {
      const violations: string[] = [];
      for (const { fm, path: bp } of bindings) {
        const cmdRef = fm["exocmd__CommandBinding_command"];
        const cmdUid = extractWikilinkUid(cmdRef);
        const rel = path.relative(FIXTURES_ROOT, bp);
        if (!cmdUid) {
          violations.push(`binding ${rel}: malformed command ref ${JSON.stringify(cmdRef)}`);
          continue;
        }
        const cmd = commandByUid.get(cmdUid);
        if (!cmd) {
          violations.push(`binding ${rel}: command [[${cmdUid}]] not in catalog`);
          continue;
        }
        const groundingRef = cmd.raw["exocmd__Command_grounding"];
        if (!groundingRef) {
          violations.push(
            `binding ${rel} → command "${cmd.label}" (${cmd.uid}): missing exocmd__Command_grounding`,
          );
          continue;
        }
        const groundingUid = extractWikilinkUid(groundingRef);
        if (!groundingUid) {
          violations.push(
            `binding ${rel} → command "${cmd.label}" (${cmd.uid}): malformed grounding ref ${JSON.stringify(groundingRef)}`,
          );
          continue;
        }
        if (!groundingUids.has(groundingUid)) {
          violations.push(
            `binding ${rel} → command "${cmd.label}" (${cmd.uid}): grounding [[${groundingUid}]] not found in fixtures`,
          );
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("AC3: no duplicate (category, label) tuples across Commands", () => {
    it("known dup baseline — locked until RFC §7.4 P0-1 removes the dup", () => {
      /* Return *every* UID that participates in a `(category, label)` collision
       * (not just "second" per scan order). Consequence: when RFC §7.4 P0-1
       * deletes one of the two `Remove Start Timestamp` fixtures, the group
       * size drops to 1 and the array collapses to `[]` — the baseline then
       * just needs its entries cleared. If the test instead flagged "second",
       * deleting the canonical one would leave the other in the baseline
       * forever as a phantom violation. */
      const byKey = new Map<string, CommandCatalogEntry[]>();
      for (const c of commandCatalog) {
        const key = `${c.category ?? "(none)"}|${c.label}`;
        const list = byKey.get(key) ?? [];
        list.push(c);
        byKey.set(key, list);
      }
      const dupUids: string[] = [];
      for (const group of byKey.values()) {
        if (group.length > 1) {
          for (const c of group) dupUids.push(c.uid);
        }
      }
      dupUids.sort();
      const expected = [...baseline.AC3_duplicateCategoryLabel.entries].sort();
      expect(dupUids).toEqual(expected);
    });
  });

  describe("AC4: confirmMessage only on destructive categories (UX RFC P1-3)", () => {
    it("violator set matches baseline exactly", () => {
      const violators: string[] = [];
      for (const c of commandCatalog) {
        const confirm = c.raw["exocmd__Command_confirmMessage"];
        if (confirm === undefined || confirm === null || confirm === "") continue;
        if (!isDestructive(c.category, c.label)) {
          violators.push(c.uid);
        }
      }
      violators.sort();
      const expected = [...baseline.AC4_confirmMessageOnNonDestructive.entries].sort();
      expect(violators).toEqual(expected);
    });
  });

  describe("AC5: successMessage required on every Command (UX RFC P1-4)", () => {
    it("missing set matches baseline exactly", () => {
      const missing: string[] = [];
      for (const c of commandCatalog) {
        const msg = c.raw["exocmd__Command_successMessage"];
        if (msg === undefined || msg === null || msg === "") missing.push(c.uid);
      }
      missing.sort();
      const expected = [...baseline.AC5_missingSuccessMessage.entries].sort();
      expect(missing).toEqual(expected);
    });
  });

  describe("AC6: every Command's exo__Asset_uid is a valid UUID-v4", () => {
    it("no non-UUID or non-v4 command uids", () => {
      const bad: Array<{ uid: string; why: string }> = [];
      for (const c of commandCatalog) {
        if (!UUID_ANY_RE.test(c.uid)) {
          bad.push({ uid: c.uid, why: "not UUID-shaped" });
          continue;
        }
        if (!UUID_V4_RE.test(c.uid)) {
          bad.push({ uid: c.uid, why: "not v4 (version digit ≠ 4 or variant ≠ 8-b)" });
        }
      }
      expect(bad).toEqual([]);
    });
  });

  describe("AC7: every referenced class UUID resolves to an ontology class definition", () => {
    it("no dangling exo__Instance_class wikilinks across Commands / Bindings / Groundings / Preconditions", () => {
      const violations: string[] = [];
      const check = (asset: ParsedAsset, kind: string): void => {
        for (const raw of toArray(asset.fm["exo__Instance_class"])) {
          const uid = extractWikilinkUid(raw);
          if (!uid) continue;
          if (!classUids.has(uid)) {
            violations.push(
              `${kind} ${path.relative(FIXTURES_ROOT, asset.path)}: class [[${uid}]] not found`,
            );
          }
        }
      };
      for (const c of commandCatalog) {
        check({ path: c.path, fm: c.raw }, "Command");
      }
      for (const b of bindings) check(b, "Binding");
      for (const g of groundings) check(g, "Grounding");
      for (const p of preconditions) check(p, "Precondition");
      expect(violations).toEqual([]);
    });
  });

  describe("AC8: class-UUID self-guard (every Command declares exo__Instance_class as [[790e5b16-…]])", () => {
    const canonicalWikilink = `[[${EXOCMD_COMMAND_CLASS_UUID}]]`;

    it("frontmatter literal includes the canonical UUID wikilink", () => {
      const missing: Array<{ uid: string; classField: unknown }> = [];
      for (const c of commandCatalog) {
        const classField = c.raw["exo__Instance_class"];
        const found = toArray(classField).some((v) => v === canonicalWikilink);
        if (!found) missing.push({ uid: c.uid, classField });
      }
      expect(missing).toEqual([]);
    });

    it("fixture file byte-level contains the canonical UUID wikilink", () => {
      const missing: string[] = [];
      for (const c of commandCatalog) {
        const raw = fs.readFileSync(c.path, "utf8");
        if (!raw.includes(canonicalWikilink)) missing.push(c.uid);
      }
      expect(missing).toEqual([]);
    });
  });
});
