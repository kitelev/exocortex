/**
 * reifyModel — RFC `93a0b2ee` Phase 3 / Task 3.2 (reify/de-reify toggle).
 *
 * Exercises the privacy-critical atomicity orchestration through injected I/O
 * ports: the create→verify→remove→verify+rollback sequence (reify) and the
 * append→verify→delete→verify sequence (de-reify), plus the predicate-mapping,
 * multi-value, and object-IRI-validate guards. The fake ports model a tiny
 * in-memory "vault" (inline targets per key + a set of statement paths) so the
 * leak (duplicate) and loss (missing edge) invariants are asserted against real
 * post-op state — not against the call sequence alone.
 *
 * Revert-verify (the req's named break): making the reify rollback a no-op
 * (skipping `deleteStatement` after a failed inline removal) turns the
 * "rollback on failed inline removal" case RED — the fake then observes a
 * DUPLICATE (statement present AND inline present); restored → GREEN.
 *
 * @req:3b9eb8d5-da3d-45d9-9df6-082f4f22c8f1
 */

import {
  reifyRelation,
  deReifyRelation,
  buildStatementAsset,
  sameTarget,
  EXO_STATEMENT_CLASS_UID,
  DEFAULT_REIFY_ANCHOR_UID,
  type ReifyPorts,
  type ReifyParams,
  type DeReifyParams,
} from "../../../../src/presentation/components/property-editor/reifyModel";
import { wikilinkTarget } from "../../../../src/presentation/components/property-editor/relationsEditorModel";

/**
 * In-memory vault fake. `inline` maps a frontmatter key → its resolved inline
 * relation target UIDs; `statements` is the set of present statement paths.
 * Failure injectors model the adversarial crash-between-steps paths.
 */
class FakePorts implements ReifyPorts {
  inline = new Map<string, string[]>();
  statements = new Set<string>();
  createdContents: string[] = [];
  deletedPaths: string[] = [];

  /** When true, the just-created statement never lands on disk (verify-on-disk fails). */
  failStatementWrite = false;
  /** When true, `removeInline` throws (the inline copy survives). */
  failRemoveInline = false;
  /** When true, `appendInline` is a no-op (de-reify cannot restore the inline copy). */
  failAppendInline = false;
  /** When true, `deleteStatement` is a no-op (de-reify cannot remove the statement). */
  failDeleteStatement = false;

  static withInline(entries: Record<string, string[]>): FakePorts {
    const p = new FakePorts();
    for (const [k, v] of Object.entries(entries)) p.inline.set(k, [...v]);
    return p;
  }

  async createStatement(content: string, uid: string): Promise<string> {
    this.createdContents.push(content);
    const path = `assetspaces/kitelev/exoas-shared-private/relations/${uid}.md`;
    if (!this.failStatementWrite) this.statements.add(path);
    return path;
  }
  async statementExists(path: string): Promise<boolean> {
    return this.statements.has(path);
  }
  async deleteStatement(path: string): Promise<void> {
    this.deletedPaths.push(path);
    if (!this.failDeleteStatement) this.statements.delete(path);
  }
  async removeInline(key: string, rawValue: string): Promise<void> {
    if (this.failRemoveInline) throw new Error("disk write failed");
    const target = wikilinkTarget(rawValue);
    const arr = this.inline.get(key) ?? [];
    this.inline.set(
      key,
      arr.filter((t) => (target ? t !== target : true)),
    );
  }
  async appendInline(key: string, targetUid: string): Promise<void> {
    if (this.failAppendInline) return;
    const arr = this.inline.get(key) ?? [];
    if (!arr.includes(targetUid)) arr.push(targetUid);
    this.inline.set(key, arr);
  }
  async readInlineTargets(key: string): Promise<string[]> {
    return [...(this.inline.get(key) ?? [])];
  }

  // Test conveniences.
  inlineHas(key: string, uid: string): boolean {
    return (this.inline.get(key) ?? []).some((t) => sameTarget(t, uid));
  }
}

const REIFY_BASE: Omit<ReifyParams, "newStatementUid"> = {
  subjectUid: "asset-a",
  predicateKey: "ems__Effort_area",
  predicateDefUid: "def-effort-area",
  objectUid: "area-1",
  inlineRawValue: "[[area-1]]",
  isDefinedByAnchorUid: DEFAULT_REIFY_ANCHOR_UID,
};

function reifyParams(over: Partial<ReifyParams> = {}): ReifyParams {
  return { ...REIFY_BASE, newStatementUid: "stmt-new", ...over };
}

describe("buildStatementAsset — canonical exo__Statement form", () => {
  it("emits the minimal эталон frontmatter with uid-form slots", () => {
    const md = buildStatementAsset({
      uid: "stmt-1",
      subjectUid: "asset-a",
      predicateDefUid: "def-effort-area",
      objectUid: "area-1",
      isDefinedByAnchorUid: DEFAULT_REIFY_ANCHOR_UID,
    });
    expect(md).toContain(`exo__Asset_isDefinedBy: "[[${DEFAULT_REIFY_ANCHOR_UID}]]"`);
    expect(md).toContain("exo__Asset_uid: stmt-1");
    expect(md).toContain(`"[[${EXO_STATEMENT_CLASS_UID}|exo__Statement]]"`);
    expect(md).toContain('exo__Statement_subject: "[[asset-a]]"');
    expect(md).toContain('exo__Statement_predicate: "[[def-effort-area]]"');
    expect(md).toContain('exo__Statement_object: "[[area-1]]"');
    expect(md.startsWith("---\n")).toBe(true);
  });
});

describe("reifyRelation — atomic inline → reified", () => {
  it("creates+verifies the statement, then removes+verifies the inline copy (no duplicate, no loss)", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    await reifyRelation(ports, reifyParams());

    expect(ports.statements.size).toBe(1); // statement present
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(false); // inline gone
    expect(ports.deletedPaths).toEqual([]); // no rollback on the happy path
    // The statement content carries the right subject/predicate/object.
    expect(ports.createdContents[0]).toContain('exo__Statement_subject: "[[asset-a]]"');
    expect(ports.createdContents[0]).toContain('exo__Statement_object: "[[area-1]]"');
  });

  it("ROLLS BACK (deletes the statement) when removing the inline copy fails — no leak", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    ports.failRemoveInline = true;

    await expect(reifyRelation(ports, reifyParams())).rejects.toThrow(/rolled back/i);

    // The statement was created then deleted (rollback); the inline copy survives.
    // => no duplicate (privacy leak) and no loss of the edge.
    expect(ports.deletedPaths).toHaveLength(1);
    expect(ports.statements.size).toBe(0);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true);
  });

  it("ROLLS BACK when the inline copy is still present after removal (verify catches a duplicate)", async () => {
    // removeInline silently does nothing (inline survives) — the post-write verify
    // must catch it and roll the statement back.
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    ports.removeInline = async () => {
      /* no-op: the write did not take effect */
    };
    await expect(reifyRelation(ports, reifyParams())).rejects.toThrow(/rolled back/i);
    expect(ports.statements.size).toBe(0);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true);
  });

  it("aborts cleanly when the statement is not written to disk (nothing changed)", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    ports.failStatementWrite = true;
    await expect(reifyRelation(ports, reifyParams())).rejects.toThrow(/not written/i);
    expect(ports.statements.size).toBe(0);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true); // inline untouched
  });

  it("REJECTS (predicate-mapping) when there is no predicate-definition asset — no statement created", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    await expect(
      reifyRelation(ports, reifyParams({ predicateDefUid: "" })),
    ).rejects.toThrow(/no predicate-definition/i);
    expect(ports.createdContents).toHaveLength(0);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true);
  });

  it("REJECTS (object-IRI-validate) when the object is a Literal — no statement created", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });
    await expect(
      reifyRelation(ports, reifyParams({ objectUid: null })),
    ).rejects.toThrow(/not an IRI/i);
    expect(ports.createdContents).toHaveLength(0);
  });

  it("multi-value: reifies ONE element, leaving the sibling inline values intact", async () => {
    const ports = FakePorts.withInline({
      ems__Effort_area: ["area-1", "area-2", "area-3"],
    });
    await reifyRelation(
      ports,
      reifyParams({ objectUid: "area-2", inlineRawValue: "[[area-2]]" }),
    );
    const remaining = await ports.readInlineTargets("ems__Effort_area");
    expect(remaining).toEqual(["area-1", "area-3"]); // only area-2 removed
    expect(ports.statements.size).toBe(1); // exactly one statement created
  });
});

describe("deReifyRelation — atomic reified → inline", () => {
  const deReifyBase: DeReifyParams = {
    predicateKey: "ems__Effort_area",
    targetUid: "area-1",
    statementPath: "assetspaces/kitelev/exoas-shared-private/relations/stmt-1.md",
  };

  function withStatement(): FakePorts {
    const ports = new FakePorts();
    ports.statements.add(deReifyBase.statementPath);
    return ports;
  }

  it("restores+verifies the inline copy BEFORE deleting the statement", async () => {
    const ports = withStatement();
    await deReifyRelation(ports, deReifyBase);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true); // inline restored
    expect(ports.statements.size).toBe(0); // statement deleted
    expect(ports.deletedPaths).toEqual([deReifyBase.statementPath]);
  });

  it("multi-value: appends ONE element to an existing key", async () => {
    const ports = withStatement();
    ports.inline.set("ems__Effort_area", ["area-9"]);
    await deReifyRelation(ports, deReifyBase);
    expect(await ports.readInlineTargets("ems__Effort_area")).toEqual([
      "area-9",
      "area-1",
    ]);
  });

  it("does NOT delete the statement when the inline copy is not restored (edge preserved)", async () => {
    const ports = withStatement();
    ports.failAppendInline = true; // the restore silently does nothing
    await expect(deReifyRelation(ports, deReifyBase)).rejects.toThrow(/aborted/i);
    expect(ports.statements.size).toBe(1); // statement untouched — no loss
    expect(ports.deletedPaths).toEqual([]);
  });

  it("reports a transient duplicate (no loss) when the statement delete cannot be confirmed", async () => {
    const ports = withStatement();
    ports.failDeleteStatement = true; // delete is a no-op → statement lingers
    await expect(deReifyRelation(ports, deReifyBase)).rejects.toThrow(/transient duplicate/i);
    // The inline copy IS restored (never a loss); the statement still lingers.
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true);
    expect(ports.statements.size).toBe(1);
  });

  it("REJECTS when the predicate could not be mapped back to a frontmatter key", async () => {
    const ports = withStatement();
    await expect(
      deReifyRelation(ports, { ...deReifyBase, predicateKey: "" }),
    ).rejects.toThrow(/could not be mapped/i);
    expect(ports.statements.size).toBe(1);
  });

  it("REJECTS when the reified object is not an IRI", async () => {
    const ports = withStatement();
    await expect(
      deReifyRelation(ports, { ...deReifyBase, targetUid: null }),
    ).rejects.toThrow(/not an IRI/i);
  });
});

describe("round-trip — inline → reify → de-reify → inline preserves edge identity", () => {
  it("returns the same uid-form target after a full round trip", async () => {
    const ports = FakePorts.withInline({ ems__Effort_area: ["area-1"] });

    // Reify: capture the created statement path (deterministic uid).
    await reifyRelation(ports, reifyParams({ newStatementUid: "stmt-rt" }));
    const statementPath =
      "assetspaces/kitelev/exoas-shared-private/relations/stmt-rt.md";
    expect(ports.statements.has(statementPath)).toBe(true);
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(false);

    // De-reify the same edge back.
    await deReifyRelation(ports, {
      predicateKey: "ems__Effort_area",
      targetUid: "area-1",
      statementPath,
    });

    // Edge identity preserved: same target UID inline, statement gone.
    expect(ports.inlineHas("ems__Effort_area", "area-1")).toBe(true);
    expect(ports.statements.size).toBe(0);
  });
});

describe("sameTarget — uid comparison ignores a .md suffix", () => {
  it("treats `<uid>` and `<uid>.md` as the same target", () => {
    expect(sameTarget("area-1", "area-1.md")).toBe(true);
    expect(sameTarget("area-1", "area-2")).toBe(false);
    expect(sameTarget("", "")).toBe(false);
  });
});
