/**
 * Issue #4469 / req `2d072437-c19d-49a4-ae89-f20b6185571f` — the ATOMIC write
 * channel (`claim`, `spawn`) recognises a frontmatter block through core's
 * SHARED `matchFrontmatterBlock`.
 *
 * Its own `^---\s*\r?\n…` was LF/CRLF-only and defeated by a leading BOM, so on
 * a lone-CR or BOM-prefixed asset it returned `no-frontmatter` — fail-CLOSED
 * rather than the data loss the text path had, but still a channel that
 * disagreed with the read path about what a frontmatter block IS.
 *
 * Two narrowings come with the shared predicate and are asserted here as
 * DELIBERATE (CH24/CH25), because a silent narrowing is indistinguishable from
 * an oversight.
 *
 * Revert-verify — `AtomicFrontmatterService.write-channels-4469.spec.json`.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { atomicUpdateFrontmatter } from "../../../src/services/AtomicFrontmatterService.js";

const REQ = "@req:2d072437-c19d-49a4-ae89-f20b6185571f";
const BOM = "﻿";

describe("AtomicFrontmatterService write channel (#4469)", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "atomic-4469-"));
    target = path.join(dir, "asset.md");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (content: string): void =>
    writeFileSync(target, content, "utf8");
  const read = (): string => readFileSync(target, "utf8");

  it(`CH20 ${REQ} a lone-CR asset is recognised — not "no-frontmatter" — and the update lands`, () => {
    write("---\rexo__Asset_uid: u-1\rkeep__me: original\r---\rbody\r");

    const result = atomicUpdateFrontmatter(target, { claimedBy: "worker-1" });

    expect(result).toEqual({ success: true, verified: true });
    const after = read();
    expect(after).toContain("claimedBy: worker-1");
    expect(after).toContain("keep__me: original");
    expect(after).toContain("exo__Asset_uid: u-1");
  });

  it(`CH21 ${REQ} a RUN of leading BOMs is recognised and rewritten as exactly ONE`, () => {
    write(
      BOM +
        BOM +
        BOM +
        "---\nexo__Asset_uid: u-2\nkeep__me: original\n---\nbody\n",
    );

    const result = atomicUpdateFrontmatter(target, { claimedBy: "worker-2" });

    expect(result).toEqual({ success: true, verified: true });
    const after = read();
    expect(after.length - after.replace(/^﻿+/, "").length).toBe(1);
    expect(after).toContain("claimedBy: worker-2");
    expect(after).toContain("keep__me: original");
  });

  it(`CH22 ${REQ} the verify handshake works on a lone-CR asset too (the claim protocol's own gate)`, () => {
    write("---\rexo__Asset_uid: u-3\r---\rbody\r");

    expect(
      atomicUpdateFrontmatter(
        target,
        { claimedBy: "worker-3" },
        { verifyKey: "claimedBy", verifyValue: "worker-3" },
      ),
    ).toEqual({ success: true, verified: true });
  });

  it(`CH23 ${REQ} CONTROL — LF and CRLF assets keep working exactly as before`, () => {
    write("---\nexo__Asset_uid: u-4\n---\nbody\n");
    expect(atomicUpdateFrontmatter(target, { a: 1 }).success).toBe(true);
    expect(read()).toContain("a: 1");

    write("---\r\nexo__Asset_uid: u-5\r\n---\r\nbody\r\n");
    expect(atomicUpdateFrontmatter(target, { b: 2 }).success).toBe(true);
    expect(read()).toContain("b: 2");
  });

  it(`CH24 ${REQ} DELIBERATE NARROWING — trailing whitespace on the OPENING fence is no longer a block`, () => {
    // The old regex began `^---\s*\r?\n`; the shared predicate requires the
    // terminator immediately. 0 carriers measured across the three canonical
    // vaults (54 818 assets), and the READ path already rejects the shape — so
    // accepting it here only let a write reach an asset nothing else could see.
    write("--- \nexo__Asset_uid: u-6\n---\nbody\n");

    expect(atomicUpdateFrontmatter(target, { a: 1 })).toEqual({
      success: false,
      verified: false,
      reason: "no-frontmatter",
    });
    expect(read()).toBe("--- \nexo__Asset_uid: u-6\n---\nbody\n");
  });

  it(`CH25 ${REQ} blank lines between the closing fence and the body SURVIVE the rewrite`, () => {
    // The old regex's greedy `---\s*` swallowed them, so they vanished from the
    // rewritten file. Nothing depended on that loss.
    write("---\nexo__Asset_uid: u-7\n---\n\n\nbody\n");

    expect(atomicUpdateFrontmatter(target, { a: 1 }).success).toBe(true);
    expect(read()).toContain("---\n\n\nbody\n");
  });

  it(`CH26 ${REQ} CONTROL — a file with no fence is still "no-frontmatter" and is not written`, () => {
    write("just a body\n");

    expect(atomicUpdateFrontmatter(target, { a: 1 })).toEqual({
      success: false,
      verified: false,
      reason: "no-frontmatter",
    });
    expect(read()).toBe("just a body\n");
  });
});
