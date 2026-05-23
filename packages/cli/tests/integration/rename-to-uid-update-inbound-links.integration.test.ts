/**
 * Issue #3113: `command rename-to-uid` must update inbound wikilinks across
 * the vault, matching Obsidian plugin parity.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { CommandExecutor } = await import("../../src/executors/CommandExecutor.js");

const ASSET_UID = "b0afb5a7-52f8-4fa6-b0db-768957ba33e4";
const OTHER_UID = "8279b5e7-3fe4-42b9-bc43-928d07bb7831";

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

  async function runSilently(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
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

  it("collapses all wikilink shapes to bare [[uid]]; skips code/embeds/already-UID-form", async () => {
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

    const exec = new CommandExecutor(vaultRoot, /* dryRun */ false);
    await runSilently(() => exec.executeRenameToUid(inbox));

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

  it("dry-run reports planned link updates without writing", async () => {
    const inbox = "01 Inbox/Choco.md";
    write(inbox, targetFile({ uid: ASSET_UID, label: "Choco" }));
    const ref = write("03 Knowledge/ref.md", "Refers to [[Choco]].\n");
    const beforeRef = fs.readFileSync(ref, "utf-8");
    const beforeStat = fs.statSync(path.join(vaultRoot, inbox));

    const exec = new CommandExecutor(vaultRoot, /* dryRun */ true);
    await runSilently(() => exec.executeRenameToUid(inbox));

    // No fs writes
    expect(fs.readFileSync(ref, "utf-8")).toBe(beforeRef);
    expect(fs.existsSync(path.join(vaultRoot, inbox))).toBe(true);
    expect(fs.statSync(path.join(vaultRoot, inbox)).ino).toBe(beforeStat.ino);

    const out = consoleLogSpy.mock.calls.flat().join("\n");
    expect(out).toMatch(/\[dry-run\] Would update links in 1 file/);
  });
});
