/**
 * Inline integration guard for `loadCommandCatalog()` — fires the instant the
 * loader regresses into a silent-zero state (substring filter, wrong fixture
 * path, yaml library change, etc.). Without this guard, jest would report
 * "0 tests passed" when the parametrized grounding suite below it finds
 * nothing to iterate — identical failure shape to issue #2863.
 *
 * Filename ends `.self.test.ts` (not `.self-test.ts`) so jest's `testMatch`
 * (`<rootDir>/tests/**\/*.test.ts`) actually runs it. If the loader ever
 * returns `[]` for any reason, these assertions fail loudly.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  loadCommandCatalog,
  EXOCMD_COMMAND_CLASS_UUID,
} from "./command-catalog.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "..",
  "starter-kit-fixtures",
);

const SUBMODULE_HYDRATED =
  fs.existsSync(FIXTURES_ROOT) &&
  fs.existsSync(path.join(FIXTURES_ROOT, "exocmd"));

const describeOrSkip = SUBMODULE_HYDRATED ? describe : describe.skip;

describeOrSkip("command-catalog loader (self-test)", () => {
  const catalog = loadCommandCatalog();

  // RFC v4 §4.0 authoritative count is 44. We assert >= 40 to absorb
  // ±planned UX-RFC churn (duplicate-removal P0-1 brings it to 43; adding
  // the 9th stub never reaches the catalog since filter is class-UUID).
  it("discovers >= 40 Command instances from the starter-kit submodule", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(40);
  });

  it("every entry resolves to the Command class UUID", () => {
    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry.classUuid).toBe(EXOCMD_COMMAND_CLASS_UUID);
    }
  });

  it("every entry has a UUID-shaped `uid` and a non-empty label", () => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const entry of catalog) {
      expect(entry.uid).toMatch(uuidRe);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("every entry's fixture file exists and contains the class UUID wikilink", () => {
    const wikilink = `[[${EXOCMD_COMMAND_CLASS_UUID}]]`;
    for (const entry of catalog) {
      expect(fs.existsSync(entry.path)).toBe(true);
      const content = fs.readFileSync(entry.path, "utf8");
      expect(content).toContain(wikilink);
    }
  });

  it("no duplicate UIDs in the catalog", () => {
    const uids = catalog.map((c) => c.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});
