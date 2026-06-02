import { UncommittedChangesGuard } from "../../../../src/infrastructure/adapters/UncommittedChangesGuard";

class FakeGitOps {
  porcelain = new Map<string, string>();
  async statusPorcelain(path: string): Promise<string> {
    return this.porcelain.get(path) ?? "";
  }
}

describe("UncommittedChangesGuard", () => {
  it("returns clean when all to-destroy AS have empty porcelain output", async () => {
    const ops = new FakeGitOps();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const guard = new UncommittedChangesGuard({ gitOps: ops as any });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const result = await guard.check([
      { asUid: "ems-uid", submodulePath: "assetspaces/ems" },
    ]);
    expect(result.clean).toBe(true);
    expect(result.affectedFiles).toEqual([]);
  });

  it("returns dirty with file list when porcelain has entries", async () => {
    const ops = new FakeGitOps();
    ops.porcelain.set(
      "assetspaces/ems",
      " M assetspaces/ems/a.md\n M assetspaces/ems/b.md\n",
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const guard = new UncommittedChangesGuard({ gitOps: ops as any });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const result = await guard.check([
      { asUid: "ems-uid", submodulePath: "assetspaces/ems" },
    ]);
    expect(result.clean).toBe(false);
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.affectedFiles[0].files).toEqual([
      "assetspaces/ems/a.md",
      "assetspaces/ems/b.md",
    ]);
  });

  it("handles rename porcelain (R XX old -> new) by taking new path", async () => {
    const ops = new FakeGitOps();
    ops.porcelain.set(
      "assetspaces/ems",
      "R  assetspaces/ems/old.md -> assetspaces/ems/new.md\n",
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const guard = new UncommittedChangesGuard({ gitOps: ops as any });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const result = await guard.check([
      { asUid: "ems-uid", submodulePath: "assetspaces/ems" },
    ]);
    expect(result.affectedFiles[0].files).toEqual(["assetspaces/ems/new.md"]);
  });

  it("only checks AS in the to-destroy list (scope = no false positives)", async () => {
    const ops = new FakeGitOps();
    ops.porcelain.set(
      "assetspaces/ems",
      " M assetspaces/ems/a.md\n",
    );
    ops.porcelain.set(
      "assetspaces/kpc",
      " M assetspaces/kpc/x.md\n", // dirty but NOT in to-destroy
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const guard = new UncommittedChangesGuard({ gitOps: ops as any });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const result = await guard.check([
      { asUid: "ems-uid", submodulePath: "assetspaces/ems" },
    ]);
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.affectedFiles[0].asUid).toBe("ems-uid");
  });
});
