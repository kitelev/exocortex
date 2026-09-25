/**
 * Issue #3111: `rename-to-uid --dry-run` must not mutate the filesystem.
 *
 * Driven through the LIVE path — `apply <rename-to-uid> <file> --dry-run`
 * (`packages/cli/src/commands/apply.ts`, grounding `service_call` →
 * `renameToUid` → `RenameToUidService`). Until 2026-09-25 this suite drove the
 * `CommandExecutor` facade, which no CLI verb reached any more (task 94e64b8c);
 * its other describes covered the dead executors only and were removed with
 * them. `apply --dry-run` is ONE early return shared by every command, so the
 * generic contract for the other commands lives in
 * `apply-dryrun-input-4298.integration.test.ts`.
 *
 * Two fixtures, two questions:
 * - D1-D3 use a gate-free LOOKALIKE of the real command (same grounding type,
 *   serviceId `renameToUid`, `destructive: true`, cliName; NO precondition, NO
 *   CommandBinding) — they pin the engine path deterministically;
 * - D4-D6 load the SHIPPED assets from the `exoas-exo` + `exoas-exocmd`
 *   submodules (`d0a0663b` "Rename to UID", its precondition `7885cb68`, its
 *   binding `b4a2be38`) and call the command by slug, so a regression in the
 *   command ASSET (a broken precondition, an unbound grounding) is caught too.
 * Real filesystem (temp dir), no mocks.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const { applyCommand } = await import("../../src/commands/apply.js");

const COMMAND_UID = "31110000-0000-0000-0000-0000000000a1";
const GROUNDING_UID = "31110000-0000-0000-0000-0000000000a2";
const ASSET_UID = "af48544e-c264-44f6-bb12-46cef2ad1acb";

/** service_call grounding-type UID (GroundingTypeUIDs.ts) */
const TYPE_SERVICE_CALL = "9bf9fc99-ac37-4e51-b9f5-bd920099947c";

const COMMAND_MD = [
  "---",
  `exo__Asset_uid: ${COMMAND_UID}`,
  `exo__Asset_label: "Rename to UID"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Command]]"`,
  `exocmd__Command_grounding: "[[${GROUNDING_UID}|grounding]]"`,
  `exocmd__Command_successMessage: File renamed to UID`,
  `exocmd__Command_cliName: rename-to-uid`,
  `exocmd__Command_destructive: true`,
  "---",
  "",
].join("\n");

const GROUNDING_MD = [
  "---",
  `exo__Asset_uid: ${GROUNDING_UID}`,
  `exo__Asset_label: "Rename to UID via service"`,
  `exo__Asset_isDefinedBy: "[[!kitelev]]"`,
  `exo__Instance_class:`,
  `  - "[[exocmd__Grounding]]"`,
  `exocmd__Grounding_type: "[[${TYPE_SERVICE_CALL}]]"`,
  `exocmd__Grounding_serviceId: "renameToUid"`,
  "---",
  "",
].join("\n");

function buildTaskMd(opts: { uid: string; label: string }): string {
  return [
    "---",
    `exo__Asset_uid: ${opts.uid}`,
    `exo__Asset_label: ${opts.label}`,
    `exo__Instance_class:`,
    `  - "[[ems__Task]]"`,
    "---",
    "",
    "# Body",
  ].join("\n");
}

describe("Issue #3111: `apply rename-to-uid --dry-run` filesystem contract", () => {
  let vaultRoot: string;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-dryrun-"));
    fs.writeFileSync(
      path.join(vaultRoot, `${COMMAND_UID}.md`),
      COMMAND_MD,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(vaultRoot, `${GROUNDING_UID}.md`),
      GROUNDING_MD,
      "utf-8",
    );
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as never);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // The shipped TBox (D4-D6) makes the loader warn about unrelated assets; not asserted.
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  async function runApply(targetRel: string, extra: string[]): Promise<void> {
    const cmd = applyCommand();
    try {
      await cmd.parseAsync([
        "node",
        "apply",
        COMMAND_UID,
        targetRel,
        "--vault",
        vaultRoot,
        ...extra,
      ]);
    } catch (e) {
      if (!/^__process_exit_/.test(String((e as Error)?.message))) throw e;
    }
  }

  const stdout = (): string =>
    consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");

  function snapshot(file: string): { content: string; ino: number } {
    return {
      content: fs.readFileSync(file, "utf-8"),
      ino: fs.statSync(file).ino,
    };
  }

  describe("rename-to-uid --dry-run (Issue #3111 primary)", () => {
    it("D1 @req:cd33eff0-4414-4fc3-8fa5-461bb92093fc does not rename file or mutate frontmatter", async () => {
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(
        filePath,
        buildTaskMd({ uid: ASSET_UID, label: "Note" }),
        "utf-8",
      );
      const refPath = path.join(vaultRoot, "ref.md");
      fs.writeFileSync(refPath, "Refers to [[Note]].\n", "utf-8");
      const before = snapshot(filePath);
      const refBefore = fs.readFileSync(refPath, "utf-8");

      await runApply("Note.md", ["--dry-run"]);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(path.join(vaultRoot, `${ASSET_UID}.md`))).toBe(
        false,
      );
      const after = snapshot(filePath);
      expect(after.content).toBe(before.content);
      expect(after.ino).toBe(before.ino);
      // No inbound wikilink is rewritten under dry-run either.
      expect(fs.readFileSync(refPath, "utf-8")).toBe(refBefore);

      // The preview line proves the command loaded and its gates passed — i.e.
      // the no-mutation outcome above is the dry-run's doing, not a load failure.
      const out = stdout();
      expect(out).toContain(
        `🔍 Dry-run: would apply "Rename to UID" to "Note.md"`,
      );
      expect(out).not.toMatch(/^✅ /m);
    });

    it("D2 does not write missing label under dry-run", async () => {
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(
        filePath,
        buildTaskMd({ uid: ASSET_UID, label: "" }),
        "utf-8",
      );
      const before = snapshot(filePath);

      await runApply("Note.md", ["--dry-run"]);

      expect(stdout()).toContain("🔍 Dry-run: would apply");
      expect(snapshot(filePath).content).toBe(before.content);
    });

    it("D3 control: the same fixture WITHOUT --dry-run does rename (the preview is not vacuous)", async () => {
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(
        filePath,
        buildTaskMd({ uid: ASSET_UID, label: "Note" }),
        "utf-8",
      );

      await runApply("Note.md", ["--yes"]);

      expect(fs.existsSync(filePath)).toBe(false);
      expect(fs.existsSync(path.join(vaultRoot, `${ASSET_UID}.md`))).toBe(true);
      expect(stdout()).toContain("✅ File renamed to UID");
    });
  });

  describe("the SHIPPED rename-to-uid command (exoas-exocmd submodule, called by slug)", () => {
    const PACKAGES = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );

    function mountShippedTbox(): void {
      for (const sub of ["exoas-exo", "exoas-exocmd"]) {
        const src = path.join(PACKAGES, sub);
        // An uninitialised submodule is an empty dir: fail loudly, never pass vacuously.
        const entries = fs.existsSync(src)
          ? fs.readdirSync(src).filter((e) => e !== ".git")
          : [];
        if (entries.length === 0) {
          throw new Error(
            `submodule ${src} is empty — run \`git submodule update --init\``,
          );
        }
        const dst = path.join(vaultRoot, "assetspaces", "kitelev", sub);
        fs.cpSync(src, dst, {
          recursive: true,
          filter: (p) => path.basename(p) !== ".git",
        });
      }
      // The lookalike from beforeEach is removed so only the shipped command answers the slug.
      fs.rmSync(path.join(vaultRoot, `${COMMAND_UID}.md`));
      fs.rmSync(path.join(vaultRoot, `${GROUNDING_UID}.md`));
    }

    async function runSlug(targetRel: string, extra: string[]): Promise<void> {
      const cmd = applyCommand();
      try {
        await cmd.parseAsync([
          "node",
          "apply",
          "rename-to-uid",
          targetRel,
          "--vault",
          vaultRoot,
          ...extra,
        ]);
      } catch (e) {
        if (!/^__process_exit_/.test(String((e as Error)?.message))) throw e;
      }
    }

    it("D4 @req:cd33eff0-4414-4fc3-8fa5-461bb92093fc the shipped command under --dry-run renames nothing and rewrites no link", async () => {
      mountShippedTbox();
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(
        filePath,
        buildTaskMd({ uid: ASSET_UID, label: "Note" }),
        "utf-8",
      );
      const refPath = path.join(vaultRoot, "ref.md");
      fs.writeFileSync(refPath, "Refers to [[Note]].\n", "utf-8");
      const before = snapshot(filePath);
      const refBefore = fs.readFileSync(refPath, "utf-8");

      await runSlug("Note.md", ["--dry-run"]);

      expect(stdout()).toContain(
        `🔍 Dry-run: would apply "Rename to UID" to "Note.md" (precondition passed).`,
      );
      expect(fs.existsSync(path.join(vaultRoot, `${ASSET_UID}.md`))).toBe(
        false,
      );
      const after = snapshot(filePath);
      expect(after.content).toBe(before.content);
      expect(after.ino).toBe(before.ino);
      expect(fs.readFileSync(refPath, "utf-8")).toBe(refBefore);
    }, 60_000);

    it("D5 the shipped precondition is in play: an already-UID-named target is refused", async () => {
      // Discriminator for D4: the lookalike has no precondition, so this outcome
      // is only reachable when the shipped command (and its gates) was loaded.
      mountShippedTbox();
      const uidNamed = path.join(vaultRoot, `${ASSET_UID}.md`);
      fs.writeFileSync(
        uidNamed,
        buildTaskMd({ uid: ASSET_UID, label: "Note" }),
        "utf-8",
      );

      await runSlug(`${ASSET_UID}.md`, ["--dry-run"]);

      const err = consoleErrorSpy.mock.calls
        .map((c) => String(c[0]))
        .join("\n");
      expect(err).toContain(`Precondition not satisfied for "Rename to UID"`);
      expect(stdout()).not.toContain("🔍 Dry-run");
    }, 60_000);

    it("D6 @req:8dc90308-e3e8-4f46-918a-c7757dd4b675 control: the shipped command without --dry-run renames and rewrites the inbound link", async () => {
      mountShippedTbox();
      const filePath = path.join(vaultRoot, "Note.md");
      fs.writeFileSync(
        filePath,
        buildTaskMd({ uid: ASSET_UID, label: "Note" }),
        "utf-8",
      );
      const refPath = path.join(vaultRoot, "ref.md");
      fs.writeFileSync(refPath, "Refers to [[Note]].\n", "utf-8");

      await runSlug("Note.md", ["--yes"]);

      expect(stdout()).toContain("✅ File renamed to UID");
      expect(fs.existsSync(filePath)).toBe(false);
      expect(fs.existsSync(path.join(vaultRoot, `${ASSET_UID}.md`))).toBe(true);
      expect(fs.readFileSync(refPath, "utf-8")).toBe(
        `Refers to [[${ASSET_UID}]].\n`,
      );
    }, 60_000);
  });
});
