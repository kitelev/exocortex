/**
 * Issue #3113: `rename-to-uid` must update inbound wikilinks across the vault,
 * matching Obsidian plugin parity.
 *
 * Driven through the LIVE path — `apply <rename-to-uid> <file> --yes`
 * (grounding `service_call` → `renameToUid` → `RenameToUidService.renameToUid`
 * → `FileSystemVaultAdapter.updateLinks` → `rewriteInboundWikilinks`). Until
 * 2026-09-25 it drove the `CommandExecutor` facade, which no CLI verb reached
 * any more (task 94e64b8c). Both paths call the same `rewriteInboundWikilinks`,
 * so the link-shape assertions are unchanged.
 *
 * The command/grounding fixture is a gate-free LOOKALIKE of the shipped
 * `exoas-exocmd` command (`d0a0663b` "Rename to UID", grounding `bf4772d7`):
 * same grounding type, serviceId and destructive flag, but no precondition and
 * no CommandBinding. The shipped command itself is exercised by D4-D6 in
 * command-dry-run.integration.test.ts (D6 pins the link rewrite).
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { applyCommand } = await import("../../src/commands/apply.js");

const COMMAND_UID = "31130000-0000-0000-0000-0000000000a1";
const GROUNDING_UID = "31130000-0000-0000-0000-0000000000a2";
const ASSET_UID = "b0afb5a7-52f8-4fa6-b0db-768957ba33e4";
const OTHER_UID = "8279b5e7-3fe4-42b9-bc43-928d07bb7831";

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

function targetFile(opts: { uid: string; label: string }): string {
  return [
    "---",
    `exo__Asset_uid: ${opts.uid}`,
    `exo__Asset_label: ${opts.label}`,
    `exo__Instance_class:`,
    `  - "[[ems__Task]]"`,
    "---",
    "",
    "# Body",
    "",
  ].join("\n");
}

describe("Issue #3113: rename-to-uid updates inbound wikilinks", () => {
  let vaultRoot: string;
  let processExitSpy: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-3113-"));
    fs.writeFileSync(path.join(vaultRoot, `${COMMAND_UID}.md`), COMMAND_MD, "utf-8");
    fs.writeFileSync(path.join(vaultRoot, `${GROUNDING_UID}.md`), GROUNDING_MD, "utf-8");
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__process_exit_${code ?? 0}__`);
    }) as any);
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
    } catch (e: any) {
      if (!/^__process_exit_/.test(String(e?.message))) throw e;
    }
  }

  function write(rel: string, content: string): string {
    const full = path.join(vaultRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    return full;
  }

  it("L1 @req:8dc90308-e3e8-4f46-918a-c7757dd4b675 collapses all wikilink shapes to bare [[uid]]; skips code/embeds/already-UID-form", async () => {
    const inbox = "01 Inbox/Choco.md";
    write(inbox, targetFile({ uid: ASSET_UID, label: "Choco" }));

    const bare = write(
      "03 Knowledge/bare.md",
      "Refers to [[Choco]] in body.\n",
    );
    const aliased = write(
      "03 Knowledge/aliased.md",
      "See [[Choco|Шоколад]] for details.\n",
    );
    const heading = write(
      "03 Knowledge/heading.md",
      "Check [[Choco#Ingredients]] section.\n",
    );
    const headingAliased = write(
      "03 Knowledge/heading-aliased.md",
      "Check [[Choco#Ingredients|See Ingredients]] section.\n",
    );

    // Should NOT be touched: fenced code, inline code, embed, already-UID-form, unrelated link
    const codeBlock = write(
      "03 Knowledge/code.md",
      "```\nDo not rewrite [[Choco]] here\n```\n\nAfter code [[Choco]] should rewrite.\n",
    );
    const inlineCode = write(
      "03 Knowledge/inline-code.md",
      "Inline `[[Choco]]` stays. Outside [[Choco]] rewrites.\n",
    );
    const alreadyUid = write(
      "03 Knowledge/already-uid.md",
      `Already targets uid: [[${OTHER_UID}|Choco]]. Should NOT change.\n`,
    );
    const embed = write(
      "03 Knowledge/embed.md",
      "Embed ![[Choco]] should remain untouched.\n",
    );
    const unrelated = write(
      "03 Knowledge/unrelated.md",
      "Unrelated [[Banana]] link stays.\n",
    );

    await runApply(inbox, ["--yes"]);

    // The target file is renamed
    const newTargetPath = path.join(vaultRoot, "01 Inbox", `${ASSET_UID}.md`);
    expect(fs.existsSync(newTargetPath)).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, inbox))).toBe(false);

    // Trigger files updated. Bare and aliased shapes collapse to [[uid]];
    // heading-anchored shapes preserve the `#Anchor` per RFC 1ce2a226 Phase 3c.
    expect(fs.readFileSync(bare, "utf-8")).toContain(`[[${ASSET_UID}]]`);
    expect(fs.readFileSync(aliased, "utf-8")).toContain(`[[${ASSET_UID}]]`);
    expect(fs.readFileSync(heading, "utf-8")).toContain(
      `[[${ASSET_UID}#Ingredients]]`,
    );
    expect(fs.readFileSync(headingAliased, "utf-8")).toContain(
      `[[${ASSET_UID}#Ingredients]]`,
    );

    // Code-block contents preserved verbatim
    const codeBlockContent = fs.readFileSync(codeBlock, "utf-8");
    expect(codeBlockContent).toContain("Do not rewrite [[Choco]] here");
    expect(codeBlockContent).toContain(`After code [[${ASSET_UID}]]`);

    // Inline code preserved
    const inlineContent = fs.readFileSync(inlineCode, "utf-8");
    expect(inlineContent).toContain("`[[Choco]]`");
    expect(inlineContent).toContain(`Outside [[${ASSET_UID}]]`);

    // Already-UID-form unchanged
    expect(fs.readFileSync(alreadyUid, "utf-8")).toContain(
      `[[${OTHER_UID}|Choco]]`,
    );

    // Embed unchanged
    expect(fs.readFileSync(embed, "utf-8")).toContain("![[Choco]]");

    // Unrelated link unchanged
    expect(fs.readFileSync(unrelated, "utf-8")).toContain("[[Banana]]");
  });

  it("L2 dry-run leaves inbound links and the target untouched", async () => {
    // The dead CommandExecutor path also PRINTED a link-count preview
    // ("[dry-run] Would update links in N file(s)"); `apply --dry-run` has one
    // generic preview line for every command and does not count links.
    const inbox = "01 Inbox/Choco.md";
    write(inbox, targetFile({ uid: ASSET_UID, label: "Choco" }));
    const ref = write("03 Knowledge/ref.md", "Refers to [[Choco]].\n");
    const beforeRef = fs.readFileSync(ref, "utf-8");
    const beforeStat = fs.statSync(path.join(vaultRoot, inbox));

    await runApply(inbox, ["--dry-run"]);

    // No fs writes
    expect(fs.readFileSync(ref, "utf-8")).toBe(beforeRef);
    expect(fs.existsSync(path.join(vaultRoot, inbox))).toBe(true);
    expect(fs.statSync(path.join(vaultRoot, inbox)).ino).toBe(beforeStat.ino);

    const out = consoleLogSpy.mock.calls.flat().join("\n");
    expect(out).toContain("🔍 Dry-run: would apply");
  });
});
