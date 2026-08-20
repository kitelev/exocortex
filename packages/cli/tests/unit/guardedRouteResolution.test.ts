/**
 * @req:72419d3c-b425-4a0e-ad42-346853efc9cf — the guard names only commands that
 * resolve in the live vault.
 *
 * The sibling file (`guardedRoutes.test.ts`) locks that the SENTENCE cannot name
 * anything the machine-readable array does not list, and says in its own header
 * that existence "needs the live vault — that is a separate follow-up". This is
 * that follow-up.
 *
 * ⛔ Measured 2026-08-20 before writing a line: all 25 listed cliNames resolve
 * today (76 `exocmd__Command_cliName` across vault-my ∪ vault-exodev), and a
 * mutant adding `phantom-command-that-does-not-exist` to the table left
 * `guardedRoutes.test.ts` **12/12 green**. So the property is TRUE and UNLOCKED —
 * these axes are its spec, not a repair of a visible break.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  GUARDED_ROUTES,
  guardedRouteFor,
  renderGuardedRoute,
  renderGuardedRouteResolved,
} from "../../src/commands/propertyMutationShared";
import { CommandNameRegistry } from "../../src/services/CommandNameRegistry";

const ROUTE = { commands: ["mark-done", "phantom-cmd", "start-effort"] };

describe("@req:72419d3c-b425-4a0e-ad42-346853efc9cf guarded route resolution", () => {
  describe("renderGuardedRouteResolved", () => {
    it("names only the commands present in the registry", () => {
      const out = renderGuardedRouteResolved(
        ROUTE,
        new Set(["mark-done", "start-effort", "unrelated"]),
      );
      expect(out).toContain("mark-done");
      expect(out).toContain("start-effort");
      expect(out).not.toContain("phantom-cmd");
    });

    it("⛔ fails OPEN on an EMPTY registry — byte-identical to today", () => {
      // A degenerate / partial mount must never turn a correct refusal into a
      // false one, nor strip the route to nothing. This is the control that
      // keeps every minimal fixture working.
      expect(renderGuardedRouteResolved(ROUTE, new Set())).toBe(
        renderGuardedRoute(ROUTE),
      );
    });

    it("says so when NONE of a route's commands resolve, instead of instructing", () => {
      const out = renderGuardedRouteResolved(
        ROUTE,
        new Set(["something-else"]),
      );
      // The names are still shown — the user may need them to diagnose the mount —
      // but the sentence no longer presents them as a path that works.
      expect(out).toContain("none of these resolve in this vault");
    });

    it("does not collide with the exit-code classifier for ANY real route", () => {
      // Same guarantee the sibling axis makes for the unfiltered sentence: the
      // classifier picks the process exit code by SUBSTRING, so a word chosen for
      // readability can silently change what a scripted consumer branches on.
      const triggers = [
        "transaction",
        "concurrent",
        "modified",
        "not found",
        "Invalid",
      ];
      for (const route of Object.values(GUARDED_ROUTES)) {
        for (const known of [new Set<string>(), new Set(["nothing-matches"])]) {
          const out = renderGuardedRouteResolved(route, known);
          for (const t of triggers) expect(out).not.toContain(t);
        }
      }
    });
  });

  describe("guardedRouteFor", () => {
    it("returns the route for a guarded property", () => {
      expect(guardedRouteFor("ems__Effort_status")?.commands).toContain(
        "mark-done",
      );
    });

    it("does not match an inherited Object.prototype key", () => {
      // Same own-key guard as `guardedReason` (#3795 review M2): a user-supplied
      // property name like `toString` must not resolve to a route.
      expect(guardedRouteFor("toString")).toBeUndefined();
      expect(guardedRouteFor("constructor")).toBeUndefined();
    });
  });

  describe("CommandNameRegistry", () => {
    let vault: string;

    beforeEach(() => {
      vault = mkdtempSync(join(tmpdir(), "cmdreg-"));
    });
    afterEach(() => rmSync(vault, { recursive: true, force: true }));

    const write = (rel: string, body: string): void => {
      const full = join(vault, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body, "utf-8");
    };

    it("collects cliNames, quoted or bare, across nested assetspaces", async () => {
      write(
        "assetspaces/a/exocmd/one.md",
        "---\nexocmd__Command_cliName: mark-done\n---\n",
      );
      write(
        "assetspaces/b/deeper/two.md",
        '---\nexocmd__Command_cliName: "start-effort"\n---\n',
      );
      const names = await new CommandNameRegistry(vault).collect();
      expect([...names].sort()).toEqual(["mark-done", "start-effort"]);
    });

    it("returns an EMPTY set for a vault with no commands — the fail-open input", async () => {
      write("assetspaces/a/plain.md", "---\nexo__Asset_label: nothing\n---\n");
      expect((await new CommandNameRegistry(vault).collect()).size).toBe(0);
    });

    it("end-to-end: a phantom in the route is dropped once the vault is read", async () => {
      write(
        "assetspaces/a/one.md",
        "---\nexocmd__Command_cliName: mark-done\n---\n",
      );
      const known = await new CommandNameRegistry(vault).collect();
      const out = renderGuardedRouteResolved(ROUTE, known);
      expect(out).toContain("mark-done");
      expect(out).not.toContain("phantom-cmd");
      expect(out).not.toContain("start-effort");
    });
  });
});
