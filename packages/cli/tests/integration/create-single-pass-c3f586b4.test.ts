/**
 * c3f586b4 (issue #4291) — one `cli create` reads each vault file ONCE.
 *
 * Before this: five full passes over the corpus for a single `create`
 * (measured 2026-09-25 on a 16 923-file vault: 84 653 reads, histogram
 * `5x:16927 6x:3`, 24-29 s wall). The cause was not one slow lookup but the
 * NUMBER of independent walks: `planCreate`'s collaborators each traverse the
 * vault on their own, and the base `NodeFsAdapter` memoises nothing, so the
 * same file was read once per collaborator.
 *
 * Two of them walk the vault THEMSELVES rather than through the adapter
 * (`ShapeLoader.loadFromVaultFS`, `PropertyNameValidator.collect`), so
 * pointing `create` at the memoising adapter is necessary but not sufficient —
 * they also have to share its reader. Hence the axes come in two groups:
 * which adapter `create` builds (S1/S2), and who gets the shared reader
 * (S3/S4/S5). S6 is the one that measures the PRODUCT of both.
 *
 *   S1  a single `create` builds the memoising adapter by default
 *   S2  an injected adapter still wins — `create-batch`'s contract is intact
 *   S3  `ShapeLoader` is handed the shared reader
 *   S4  `PropertyNameValidator` is handed the shared reader
 *   S5  with a NON-memoising adapter no reader is passed — the collaborators
 *       fall back to `fs/promises`, i.e. exactly the prior behaviour, which is
 *       what keeps this an optimisation rather than a dependency
 *   S6  the product: across the two self-walking collaborators AND the
 *       adapter, no vault file is read twice
 *
 * S6 counts through `NodeFsAdapter.prototype.readFile` — the inherited
 * implementation every path ultimately reaches. The memoising override is a
 * SUBCLASS method, so a memo hit never reaches the spy: what the spy counts is
 * reads that actually touched the disk, not calls.
 *
 * Revert-verify: `create-single-pass-c3f586b4.spec.json` beside this file.
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

const { CreateContext } = await import("../../src/commands/create.js");
const { NodeFsAdapter } = await import("../../src/adapters/NodeFsAdapter.js");
const { PlanningFsAdapter } = await import(
  "../../src/adapters/PlanningFsAdapter.js"
);
const { ShapeLoader } = await import("@kitelev/exocortex-core");

/** Enough files that a second pass is unmistakable in the read counts. */
const FILE_COUNT = 40;

function buildVault(vault: string): void {
  const dir = path.join(vault, "assetspaces/kitelev/exoas-test/test");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < FILE_COUNT; i += 1) {
    const uid = `aaaa0000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
    fs.writeFileSync(
      path.join(dir, `${uid}.md`),
      `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "fixture ${i}"\n---\n\nbody ${i}\n`,
    );
  }
}

describe("c3f586b4: one `create` reads each vault file once", () => {
  let vault: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "cli-single-pass-"));
    buildVault(vault);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("S1: a single `create` builds the memoising adapter by default", () => {
    const ctx = new CreateContext(vault);
    expect(ctx.fsAdapter).toBeInstanceOf(PlanningFsAdapter);
  });

  it("S2: an injected adapter still wins over the default", () => {
    const injected = new NodeFsAdapter(vault);
    const ctx = new CreateContext(vault, { fsAdapter: injected });
    expect(ctx.fsAdapter).toBe(injected);
  });

  it("S3: `ShapeLoader` is handed the shared reader", async () => {
    const spy = jest.spyOn(ShapeLoader, "loadFromVaultFS");
    const ctx = new CreateContext(vault);
    await ctx.shapeRegistry();

    expect(spy).toHaveBeenCalledTimes(1);
    const io = spy.mock.calls[0]?.[1];
    expect(io?.readFile).toBeDefined();

    // …and it is the ADAPTER's reader, not some other function: reading
    // through it must register on the adapter's own memo, so the SECOND read
    // of the same file never reaches the disk.
    //
    // The file is created AFTER the load on purpose: every fixture file has
    // already been read (and memoised) by the walk above, so reading one of
    // those would take zero disk reads and the axis could not tell a shared
    // reader from a bare one.
    const fresh = path.join(
      vault,
      "assetspaces/kitelev/exoas-test/test/bbbb0000-0000-4000-8000-000000000001.md",
    );
    fs.writeFileSync(fresh, "---\nexo__Asset_uid: bbbb\n---\n\nfresh\n");
    const disk = jest.spyOn(NodeFsAdapter.prototype, "readFile");
    await io!.readFile!(fresh, "utf-8");
    await io!.readFile!(fresh, "utf-8");
    expect(disk).toHaveBeenCalledTimes(1);
  });

  it("S4: `PropertyNameValidator` is handed the shared reader", async () => {
    const ctx = new CreateContext(vault);
    const disk = jest.spyOn(NodeFsAdapter.prototype, "readFile");

    await ctx.propertyNameValidator.collect();

    // The validator walks the whole vault. Every one of its reads went
    // through the adapter — so they are visible on the adapter's inherited
    // readFile. Without the shared reader it would read `fs/promises`
    // directly and this count would be zero.
    expect(disk.mock.calls.length).toBeGreaterThanOrEqual(FILE_COUNT);
  });

  it("S5: with a non-memoising adapter no reader is passed — prior behaviour", async () => {
    const spy = jest.spyOn(ShapeLoader, "loadFromVaultFS");
    const ctx = new CreateContext(vault, {
      fsAdapter: new NodeFsAdapter(vault),
    });
    await ctx.shapeRegistry();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]?.readFile).toBeUndefined();
  });

  it("S7: a write through the adapter drops the content memo", async () => {
    // The PR's safety claim — "nothing memoised can go stale, because the adapter drops every
    // memo on a mutation" — rests on ONE line in `forget()`. Review found that removing
    // `this.contents.clear()` left create-single-pass, create-batch and the create unit suite
    // ALL green: today nothing writes through this adapter (planning never writes; the write half
    // uses a separate FileSystemVaultAdapter), so the invariant is the CALLERS', not the class's.
    // This axis pins it on the class itself, where a future refactor of `forget()` would break it.
    const adapter = new PlanningFsAdapter(vault);
    const rel = "assetspaces/kitelev/exoas-test/test/aaaa0000-0000-4000-8000-000000000002.md";

    const before = await adapter.readFile(rel);
    expect(before).toContain("fixture 2");

    await adapter.updateFile(rel, "---\nexo__Asset_uid: rewritten\n---\n\nrewritten body\n");

    const after = await adapter.readFile(rel);
    expect(after).toContain("rewritten");
    expect(after).not.toContain("fixture 2");
  });

  it("S6: no vault file is read twice across the collaborators", async () => {
    const ctx = new CreateContext(vault);
    const disk = jest.spyOn(NodeFsAdapter.prototype, "readFile");

    // The two collaborators that walk the vault themselves, plus a lookup
    // through the adapter — the three sources that used to read the corpus
    // independently.
    await ctx.shapeRegistry();
    await ctx.propertyNameValidator.collect();
    await ctx.fsAdapter.getFileMetadata(
      "assetspaces/kitelev/exoas-test/test/aaaa0000-0000-4000-8000-000000000001.md",
    );

    const perPath = new Map<string, number>();
    for (const [filePath] of disk.mock.calls) {
      const key = path.resolve(vault, filePath as string);
      perPath.set(key, (perPath.get(key) ?? 0) + 1);
    }

    // Canary: a zero here would make the assertion below vacuously true —
    // "no file read twice" is satisfied by reading nothing at all.
    expect(perPath.size).toBeGreaterThanOrEqual(FILE_COUNT);

    const repeated = [...perPath.entries()]
      .filter(([, n]) => n > 1)
      .map(([p, n]) => `${path.basename(p)}×${n}`);
    expect(repeated).toEqual([]);
  });
});
