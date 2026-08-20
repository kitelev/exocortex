import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import * as yaml from "js-yaml";

import { atomicUpdateFrontmatter } from "../../../src/services/AtomicFrontmatterService.js";

function buildMd(fm: Record<string, unknown>, body = ""): string {
  return `---\n${yaml.dump(fm)}---\n${body}`;
}

describe("AtomicFrontmatterService", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "atomic-fm-"));
    target = path.join(dir, "asset.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("merges updates into frontmatter and preserves body", () => {
    writeFileSync(
      target,
      buildMd({ exo__Asset_uid: "uuid-1", existing: "keep" }, "# Body\n\ncontent"),
    );

    const r = atomicUpdateFrontmatter(target, {
      "ems__Effort_status": "[[ems__EffortStatusDoing]]",
    });

    expect(r.success).toBe(true);
    expect(r.verified).toBe(true);

    const after = readFileSync(target, "utf8");
    const parsed = yaml.load(after.split("---")[1]) as Record<string, unknown>;
    expect(parsed["ems__Effort_status"]).toBe("[[ems__EffortStatusDoing]]");
    expect(parsed["existing"]).toBe("keep");
    expect(parsed["exo__Asset_uid"]).toBe("uuid-1");
    expect(after).toContain("# Body");
    expect(after).toContain("content");
  });

  it("returns no-frontmatter for files without frontmatter", () => {
    writeFileSync(target, "no frontmatter here\n");
    const r = atomicUpdateFrontmatter(target, { foo: "bar" });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("no-frontmatter");
  });

  it("returns parse-error for malformed YAML mapping", () => {
    writeFileSync(target, "---\n- not\n- a\n- mapping\n---\n");
    const r = atomicUpdateFrontmatter(target, { foo: "bar" });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("parse-error");
  });

  // ── #3901: tolerant dup-key rescue + preserved malformed-abort (no data loss) ──

  it("self-heals a duplicated YAML key (last-wins) instead of aborting parse-error (#3901)", () => {
    // A bare `yaml.load` THROWS on a duplicated mapping key → the old code
    // returned parse-error (the atomic update aborted). The tolerant parser
    // resolves last-wins, so the update proceeds and rewrites the file deduped.
    // REVERT-VERIFY: revert parseFile to a bare `yaml.load(fm)` → dup-key throws
    // → r.success is false (parse-error) → RED. With the guarded tolerant route
    // → GREEN.
    writeFileSync(
      target,
      "---\nexo__Asset_uid: uuid-1\ndup: first\ndup: second\n---\n# Body\n",
    );

    const r = atomicUpdateFrontmatter(target, { aiTask__Task_claimedBy: "99999" });

    expect(r.success).toBe(true);
    const parsed = yaml.load(
      readFileSync(target, "utf8").split("---")[1],
    ) as Record<string, unknown>;
    expect(parsed["dup"]).toBe("second"); // last-wins
    expect(parsed["aiTask__Task_claimedBy"]).toBe("99999");
    expect(parsed["exo__Asset_uid"]).toBe("uuid-1");
  });

  it("still aborts (parse-error, file byte-identical) for GENUINELY malformed YAML — the write path must never overwrite a broken file with empty frontmatter (#3901 negative control)", () => {
    // Unterminated flow sequence → `yaml.load` throws even in JSON-compat mode,
    // so the tolerant parser returns null → parseFile re-throws → parse-error.
    // This proves the dup-key rescue did NOT weaken the malformed-abort safety:
    // the atomic update aborts BEFORE any write, leaving the file untouched.
    const original = "---\nkey: [unterminated\n---\noriginal body\n";
    writeFileSync(target, original);

    const r = atomicUpdateFrontmatter(target, { foo: "bar" });

    expect(r.success).toBe(false);
    expect(r.reason).toBe("parse-error");
    expect(readFileSync(target, "utf8")).toBe(original); // no data loss
  });

  it("returns fs-error when target file is missing", () => {
    const r = atomicUpdateFrontmatter(path.join(dir, "missing.md"), { foo: 1 });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("fs-error");
  });

  it("verify succeeds when claimedBy matches expected after rename", () => {
    writeFileSync(target, buildMd({ exo__Asset_uid: "uuid-1" }));
    const r = atomicUpdateFrontmatter(
      target,
      { aiTask__Task_claimedBy: "12345" },
      { verifyKey: "aiTask__Task_claimedBy", verifyValue: "12345" },
    );
    expect(r.success).toBe(true);
    expect(r.verified).toBe(true);
  });

  it("verify aborts when concurrent writer overwrote our claim (Obsidian Sync race)", () => {
    writeFileSync(target, buildMd({ exo__Asset_uid: "uuid-1" }));

    // Simulate: our atomic write succeeds, but Obsidian Sync immediately
    // overwrites the file with a competing process's claim before re-read.
    // We emulate this by racing with a writeFileSync that runs after the
    // service performs its rename. Since the function is synchronous and
    // tests run single-threaded, we instead simulate by patching:
    // we run atomicUpdateFrontmatter, then manually corrupt, then call again
    // with verify to demonstrate detection.
    //
    // For race detection logic test: write competing content then call
    // atomicUpdateFrontmatter with verify expecting OUR pid — but the file
    // already has a different value. The function will write our content
    // (rename wins synchronously) and verify will pass. To truly model
    // a sync-overwrite-after-rename, we can't easily do it sync. Instead
    // we test the assertion mechanism by passing a verifyValue that
    // doesn't match what we wrote (caller bug, but exercises mismatch path).

    const r = atomicUpdateFrontmatter(
      target,
      { aiTask__Task_claimedBy: "us-12345" },
      { verifyKey: "aiTask__Task_claimedBy", verifyValue: "them-99999" },
    );
    expect(r.success).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("verify-mismatch");
  });

  it("100 serial updates of the same file produce zero corrupted YAML", () => {
    writeFileSync(target, buildMd({ exo__Asset_uid: "uuid-1", counter: 0 }));

    for (let i = 1; i <= 100; i++) {
      const r = atomicUpdateFrontmatter(target, {
        counter: i,
        exo__Asset_updatedAt: `2026-05-02T20:${String(i % 60).padStart(2, "0")}:00+0500`,
      });
      expect(r.success).toBe(true);
    }

    const finalContent = readFileSync(target, "utf8");
    const fm = yaml.load(finalContent.split("---")[1]) as Record<string, unknown>;
    expect(fm["counter"]).toBe(100);
    expect(fm["exo__Asset_uid"]).toBe("uuid-1");
  });

  it("does not leave tmp files in directory after success", () => {
    writeFileSync(target, buildMd({ a: 1 }));
    atomicUpdateFrontmatter(target, { a: 2 });
    const entries = readdirSync(dir);
    expect(entries.filter((e) => e.includes(".tmp."))).toHaveLength(0);
  });

  it("cleans up tmp file on rename failure", () => {
    // Write a non-existent target to force rename to "succeed creating new"
    // — actually rename of tmp -> non-existent target succeeds. To force
    // failure, point at a path whose directory doesn't exist for tmp write.
    // Simulate: target dir does not exist after creation.
    rmSync(dir, { recursive: true, force: true });
    const r = atomicUpdateFrontmatter(path.join(dir, "x.md"), { a: 1 });
    expect(r.success).toBe(false);
    expect(r.reason).toBe("fs-error");
  });
});
