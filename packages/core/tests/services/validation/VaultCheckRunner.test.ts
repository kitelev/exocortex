import {
  VaultCheckRunner,
  createDefaultCheckRegistry,
  CheckRegistry,
  uidUniquenessCheck,
  coLocationCheck,
  shaclCheck,
  CHECK_ID_UID_UNIQUENESS,
  CHECK_ID_CO_LOCATION,
  CHECK_ID_SHACL,
  CHECK_ID_DAG_ONTOLOGY_IMPORTS,
  type CheckContext,
  type IVaultCheckReader,
  type VaultAssetRecord,
} from "../../../src/services/validation";

/** Production-shape asset record: path + already-parsed frontmatter (warm). */
function asset(
  path: string,
  fm: Record<string, unknown>,
): VaultAssetRecord {
  return { path, frontmatter: fm };
}

/** A reader that hands the engine a fixed context and counts read() calls (one-pass contract). */
class FakeReader implements IVaultCheckReader {
  reads = 0;
  constructor(private readonly ctx: CheckContext) {}
  async read(): Promise<CheckContext> {
    this.reads++;
    return this.ctx;
  }
}

const PN_DAILY_NOTE = "b04e7a3e-6b49-4984-9f8d-b74e9f36818b";

describe("uid-uniqueness check (RFC f402002b M1.4)", () => {
  it("@req:4b45aaca-0857-4e16-922d-40ecd7b237ac flags a duplicate exo__Asset_uid across two paths and leaves unique uids clean", () => {
    const assets = [
      asset("a/x.md", { exo__Asset_uid: "11111111-1111-1111-1111-111111111111" }),
      asset("b/y.md", { exo__Asset_uid: "11111111-1111-1111-1111-111111111111" }),
      asset("c/z.md", { exo__Asset_uid: "22222222-2222-2222-2222-222222222222" }),
    ];
    const findings = uidUniquenessCheck({ assets });
    // Both members of the duplicate group are reported; the unique one is not.
    expect(findings.map((f) => f.path).sort()).toEqual(["a/x.md", "b/y.md"]);
    expect(findings.every((f) => f.message.includes("11111111"))).toBe(true);
  });

  it("@req:4b45aaca-0857-4e16-922d-40ecd7b237ac exempts whitelisted filename-classes (pn__DailyNote) from the uid-uniqueness check", () => {
    // Two daily notes that (defensively) share a uid must NOT be flagged — their
    // identity is the filename, not the uid. revert-verify: dropping the
    // `classes.some(c => WHITELIST.has(c))` guard in uidUniquenessCheck makes
    // this go RED (the pair would be reported as a duplicate).
    const assets = [
      asset("daily/2026-06-27.md", {
        exo__Asset_uid: "33333333-3333-3333-3333-333333333333",
        exo__Instance_class: [`[[${PN_DAILY_NOTE}]]`],
      }),
      asset("daily/2026-06-28.md", {
        exo__Asset_uid: "33333333-3333-3333-3333-333333333333",
        exo__Instance_class: [`[[${PN_DAILY_NOTE}]]`],
      }),
    ];
    expect(uidUniquenessCheck({ assets })).toEqual([]);
  });

  it("@req:4b45aaca-0857-4e16-922d-40ecd7b237ac ignores assets without a uid (path identity, D18)", () => {
    const assets = [asset("a.md", {}), asset("b.md", { exo__Asset_uid: "" })];
    expect(uidUniquenessCheck({ assets })).toEqual([]);
  });
});

describe("VaultCheckRunner engine (RFC f402002b M1.4)", () => {
  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 runs exactly the enabled checks and passes when none find anything", async () => {
    const reader = new FakeReader({
      assets: [
        asset("a/x.md", { exo__Asset_uid: "aaaaaaaa-0000-0000-0000-000000000000" }),
      ],
    });
    const report = await new VaultCheckRunner(createDefaultCheckRegistry()).run(
      reader,
      [CHECK_ID_UID_UNIQUENESS],
    );
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe("pass");
    expect(report.ok).toBe(true);
    expect(report.totalAssets).toBe(1);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 reads the warm context ONCE even with multiple enabled checks (one-pass / warm-cache contract)", async () => {
    const reader = new FakeReader({ assets: [] });
    await new VaultCheckRunner(createDefaultCheckRegistry()).run(reader, [
      CHECK_ID_UID_UNIQUENESS,
      CHECK_ID_CO_LOCATION,
    ]);
    // The engine MUST build the context once and share it — never per-check or
    // per-file re-read (the "iPhone reindex 10 minutes" anti-pattern).
    expect(reader.reads).toBe(1);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 fails LOUD (error result) on an enabled check-id with no registered runner — never a silent skip", async () => {
    const reader = new FakeReader({ assets: [] });
    const report = await new VaultCheckRunner(createDefaultCheckRegistry()).run(
      reader,
      ["00000000-dead-beef-0000-000000000000"],
    );
    expect(report.results[0].status).toBe("error");
    expect(report.results[0].errorMessage).toMatch(/fail-loud.*no registered runner/);
    expect(report.ok).toBe(false);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 fails LOUD when an enabled check throws (SHACL with no triple-store wired) instead of skipping it", async () => {
    const reader = new FakeReader({ assets: [] }); // no runShacl provided
    const report = await new VaultCheckRunner(createDefaultCheckRegistry()).run(
      reader,
      [CHECK_ID_SHACL],
    );
    expect(report.results[0].status).toBe("error");
    expect(report.results[0].errorMessage).toMatch(/fail-loud.*runShacl/);
    expect(report.ok).toBe(false);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 marks ok=false when any enabled check fails", async () => {
    const reader = new FakeReader({
      assets: [
        asset("a/x.md", { exo__Asset_uid: "dup-0000-0000-0000-000000000000" }),
        asset("b/y.md", { exo__Asset_uid: "dup-0000-0000-0000-000000000000" }),
      ],
    });
    const report = await new VaultCheckRunner(createDefaultCheckRegistry()).run(
      reader,
      [CHECK_ID_UID_UNIQUENESS],
    );
    expect(report.results[0].status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 an empty registry fails loud for every enabled check (no silent pass)", async () => {
    const reader = new FakeReader({ assets: [] });
    const report = await new VaultCheckRunner(new CheckRegistry()).run(reader, [
      CHECK_ID_UID_UNIQUENESS,
    ]);
    expect(report.results[0].status).toBe("error");
  });
});

describe("co-location check (RFC f402002b M1.4)", () => {
  const ONTO = "ca97bb2f-99bd-4ceb-b51e-c386b9231ae3";
  function ctxWith(assetPath: string): CheckContext {
    return {
      assets: [
        asset(`onto/${ONTO}.md`, {
          exo__Asset_uid: ONTO,
          exo__Asset_isDefinedBy: `[[${ONTO}]]`,
        }),
        asset(assetPath, {
          exo__Asset_uid: "cccccccc-0000-0000-0000-000000000000",
          exo__Asset_isDefinedBy: `[[${ONTO}]]`,
        }),
      ],
    };
  }

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 flags an asset whose folder differs from its isDefinedBy ontology folder", () => {
    const findings = coLocationCheck(ctxWith("wrong/c.md"));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("wrong/c.md");
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 passes when the asset is co-located with its ontology", () => {
    expect(coLocationCheck(ctxWith(`onto/c.md`))).toEqual([]);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 fail-opens (skips, never violates) on empty / bang-prefix / unresolvable isDefinedBy", () => {
    const ctx: CheckContext = {
      assets: [
        asset("a/empty.md", { exo__Asset_uid: "e1" }),
        asset("a/bang.md", {
          exo__Asset_uid: "e2",
          exo__Asset_isDefinedBy: "[[!kitelev]]",
        }),
        asset("a/missing.md", {
          exo__Asset_uid: "e3",
          exo__Asset_isDefinedBy: "[[ffffffff-0000-0000-0000-000000000000]]",
        }),
      ],
    };
    expect(coLocationCheck(ctx)).toEqual([]);
  });
});

describe("SHACL/DAG thunk delegation (RFC f402002b M1.4)", () => {
  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 SHACL check maps reader-provided violations to findings", async () => {
    const ctx: CheckContext = {
      assets: [],
      runShacl: async () => [
        { focusNode: "obsidian://vault/x.md", message: "minCount 1 violated" },
      ],
    };
    const findings = await shaclCheck(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("obsidian://vault/x.md");
    expect(findings[0].message).toMatch(/SHACL: minCount/);
  });

  it("@req:2214573f-4278-4bcd-bf19-8c459a5abd05 DAG check delegates to the reader-provided runDag and surfaces its findings via the runner", async () => {
    const reader = new FakeReader({
      assets: [],
      runDag: async () => [{ path: "a.md", message: "cross-ontology link not in imports closure" }],
    });
    const report = await new VaultCheckRunner(createDefaultCheckRegistry()).run(
      reader,
      [CHECK_ID_DAG_ONTOLOGY_IMPORTS],
    );
    expect(report.results[0].status).toBe("fail");
    expect(report.results[0].findings[0].message).toMatch(/cross-ontology/);
  });
});
