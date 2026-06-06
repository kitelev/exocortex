import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { NodeFsAdapter } from "../../../src/adapters/NodeFsAdapter.js";
import { CachingNodeFsAdapter } from "../../../src/adapters/CachingNodeFsAdapter.js";

/**
 * The audit MUST resolve UIDs identically to migration, which uses the base
 * NodeFsAdapter. These tests lock the cache's findFileByUID to base parity
 * across the frontmatter UID forms that could diverge (quoted, array, numeric).
 */
describe("CachingNodeFsAdapter — findFileByUID parity with base NodeFsAdapter", () => {
  let vault: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `caching-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  function write(name: string, frontmatter: string): void {
    writeFileSync(
      join(vault, name),
      `---\n${frontmatter}\n---\nBody.\n`,
      "utf-8",
    );
  }

  async function assertParity(uid: string): Promise<void> {
    const base = new NodeFsAdapter(vault);
    const cached = new CachingNodeFsAdapter(vault);
    expect(await cached.findFileByUID(uid)).toBe(await base.findFileByUID(uid));
  }

  it("bare UUID", async () => {
    write("a.md", "exo__Asset_uid: 11111111-1111-1111-1111-111111111111");
    expect(
      await new CachingNodeFsAdapter(vault).findFileByUID(
        "11111111-1111-1111-1111-111111111111",
      ),
    ).toBe("a.md");
    await assertParity("11111111-1111-1111-1111-111111111111");
  });

  it("quoted UID resolves same as base", async () => {
    write("b.md", 'exo__Asset_uid: "22222222-2222-2222-2222-222222222222"');
    await assertParity("22222222-2222-2222-2222-222222222222");
    expect(
      await new CachingNodeFsAdapter(vault).findFileByUID(
        "22222222-2222-2222-2222-222222222222",
      ),
    ).toBe("b.md");
  });

  it("array-valued exo__Asset_uid — member resolves same as base", async () => {
    write("c.md", "exo__Asset_uid:\n  - 33333333-3333-3333-3333-333333333333");
    await assertParity("33333333-3333-3333-3333-333333333333");
  });

  it("missing UID → both return null", async () => {
    write("d.md", "exo__Asset_label: no uid");
    await assertParity("99999999-9999-9999-9999-999999999999");
  });
});
