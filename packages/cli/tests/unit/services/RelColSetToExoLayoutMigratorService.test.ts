import { describe, it, expect } from "@jest/globals";
import yaml from "js-yaml";
import {
  RelColSetToExoLayoutMigratorService,
  extractRelColSetConfig,
  isRelColSetFrontmatter,
  type RelColSetConfig,
} from "../../../src/services/RelColSetToExoLayoutMigratorService.js";

function stubUidFor(
  seed: string,
  suffix: "layout" | "block",
): string {
  // Deterministic for test assertions — mirrors v4 UUID shape.
  return `00000000-${suffix === "layout" ? "1111" : "2222"}-4444-8888-${seed.slice(0, 12).padEnd(12, "0")}`;
}

describe("RelColSetToExoLayoutMigratorService", () => {
  describe("isRelColSetFrontmatter", () => {
    it("accepts bare label `ui__RelationColumnSet`", () => {
      expect(
        isRelColSetFrontmatter({
          exo__Instance_class: ["[[ui__RelationColumnSet]]"],
        }),
      ).toBe(true);
    });

    it("accepts canonical UID class", () => {
      expect(
        isRelColSetFrontmatter({
          exo__Instance_class: [
            "[[97fc9862-c886-4d86-9a60-e0cf9d778575]]",
          ],
        }),
      ).toBe(true);
    });

    it("accepts pipe-aliased wikilink", () => {
      expect(
        isRelColSetFrontmatter({
          exo__Instance_class: [
            "[[97fc9862-c886-4d86-9a60-e0cf9d778575|ui__RelationColumnSet]]",
          ],
        }),
      ).toBe(true);
    });

    it("rejects unrelated class", () => {
      expect(
        isRelColSetFrontmatter({
          exo__Instance_class: ["[[ems__Task]]"],
        }),
      ).toBe(false);
    });

    it("handles missing frontmatter field", () => {
      expect(isRelColSetFrontmatter({})).toBe(false);
    });
  });

  describe("extractRelColSetConfig", () => {
    it("extracts all fields from a well-formed RelColSet", () => {
      const cfg = extractRelColSetConfig("vault/rc-1.md", {
        exo__Asset_uid: "abc12345-1111-1111-1111-aaaaaaaaaaaa",
        exo__Asset_label: "Tasks on Projects",
        exo__Instance_class: ["[[ui__RelationColumnSet]]"],
        ui__RelationColumnSet_targetClass: "[[ems__Task]]",
        ui__RelationColumnSet_referencingProperty: "[[ems__Task_parent]]",
        ui__RelationColumnSet_columns: [
          "[[ems__Effort_status]]",
          "[[exo__Asset_label]]",
        ],
        ui__RelationColumnSet_priority: 10,
      });

      expect(cfg).not.toBeNull();
      expect(cfg!.uid).toBe("abc12345-1111-1111-1111-aaaaaaaaaaaa");
      expect(cfg!.path).toBe("vault/rc-1.md");
      expect(cfg!.label).toBe("Tasks on Projects");
      expect(cfg!.targetClass).toBe("ems__Task");
      expect(cfg!.referencingProperty).toBe("ems__Task_parent");
      expect(cfg!.columns).toEqual([
        "[[ems__Effort_status]]",
        "[[exo__Asset_label]]",
      ]);
      expect(cfg!.priority).toBe(10);
    });

    it("returns null when uid is missing", () => {
      expect(
        extractRelColSetConfig("x.md", {
          exo__Asset_label: "stub",
        }),
      ).toBeNull();
    });

    it("tolerates missing optional fields", () => {
      const cfg = extractRelColSetConfig("v/rc.md", {
        exo__Asset_uid: "def12345-1111-1111-1111-bbbbbbbbbbbb",
        exo__Instance_class: ["[[ui__RelationColumnSet]]"],
      });
      expect(cfg).not.toBeNull();
      expect(cfg!.targetClass).toBeNull();
      expect(cfg!.referencingProperty).toBeNull();
      expect(cfg!.columns).toEqual([]);
      expect(cfg!.priority).toBeNull();
      expect(cfg!.label).toBeNull();
    });

    it("reads targetClass from the first entry when array-valued", () => {
      const cfg = extractRelColSetConfig("v/rc.md", {
        exo__Asset_uid: "aaa12345-1111-1111-1111-cccccccccccc",
        exo__Instance_class: ["[[ui__RelationColumnSet]]"],
        ui__RelationColumnSet_targetClass: [
          "[[ems__Task]]",
          "[[ems__Project]]",
        ],
      });
      expect(cfg!.targetClass).toBe("ems__Task");
    });

    it("parses stringified priority", () => {
      const cfg = extractRelColSetConfig("v/rc.md", {
        exo__Asset_uid: "bbb12345-1111-1111-1111-dddddddddddd",
        exo__Instance_class: ["[[ui__RelationColumnSet]]"],
        ui__RelationColumnSet_priority: "7",
      });
      expect(cfg!.priority).toBe(7);
    });
  });

  describe("migrate()", () => {
    const service = new RelColSetToExoLayoutMigratorService({
      uidFor: stubUidFor,
    });

    const baseCfg: RelColSetConfig = {
      uid: "abc12345-1111-1111-1111-aaaaaaaaaaaa",
      path: "03 Knowledge/ui/rc.md",
      label: "Tasks on Projects",
      targetClass: "ems__Task",
      referencingProperty: "ems__Task_parent",
      columns: ["[[ems__Effort_status]]", "[[exo__Asset_label]]"],
      priority: 10,
    };

    it("returns empty pairs for empty input", () => {
      const out = service.migrate([]);
      expect(out.pairs).toHaveLength(0);
      expect(out.skipped).toHaveLength(0);
    });

    it("produces one Layout + one Block pair per RelColSet", () => {
      const out = service.migrate([baseCfg]);
      expect(out.pairs).toHaveLength(1);
      const pair = out.pairs[0];
      expect(pair.layout.uid).toBe(stubUidFor(baseCfg.uid, "layout"));
      expect(pair.block.uid).toBe(stubUidFor(baseCfg.uid, "block"));
      expect(pair.layout.filename).toBe(`${pair.layout.uid}.md`);
      expect(pair.block.filename).toBe(`${pair.block.uid}.md`);
    });

    it("generated Layout YAML parses and carries targetClass + block ref", () => {
      const out = service.migrate([baseCfg]);
      const pair = out.pairs[0];
      const fm = extractFrontmatter(pair.layout.content);
      expect(fm["exo__Asset_uid"]).toBe(pair.layout.uid);
      expect(fm["exo__Instance_class"]).toEqual(["[[exo__Layout]]"]);
      expect(fm["exo__Layout_targetClass"]).toBe("[[ems__Task]]");
      expect(fm["exo__Layout_blocks"]).toEqual([`[[${pair.block.uid}]]`]);
      expect(fm["exo__Layout_priority"]).toBe(10);
      expect(fm["exo__Layout_coexistsWithDefault"]).toBe(true);
    });

    it("generated Block YAML parses and carries rowClass/referencingProperty/columns", () => {
      const out = service.migrate([baseCfg]);
      const pair = out.pairs[0];
      const fm = extractFrontmatter(pair.block.content);
      expect(fm["exo__Asset_uid"]).toBe(pair.block.uid);
      expect(fm["exo__Instance_class"]).toEqual([
        "[[exo__BacklinksTableBlock]]",
      ]);
      expect(fm["exo__BacklinksTableBlock_rowClass"]).toBe("[[ems__Task]]");
      expect(fm["exo__BacklinksTableBlock_referencingProperty"]).toBe(
        "[[ems__Task_parent]]",
      );
      expect(fm["exo__BacklinksTableBlock_columns"]).toEqual([
        "[[ems__Effort_status]]",
        "[[exo__Asset_label]]",
      ]);
    });

    it("omits priority line when source has no priority", () => {
      const out = service.migrate([{ ...baseCfg, priority: null }]);
      const fm = extractFrontmatter(out.pairs[0].layout.content);
      expect("exo__Layout_priority" in fm).toBe(false);
    });

    it("emits empty array for missing columns", () => {
      const out = service.migrate([{ ...baseCfg, columns: [] }]);
      const fm = extractFrontmatter(out.pairs[0].block.content);
      expect(fm["exo__BacklinksTableBlock_columns"]).toEqual([]);
    });

    it("flags warning when targetClass is missing and produces empty wikilink", () => {
      const out = service.migrate([
        { ...baseCfg, targetClass: null },
      ]);
      const pair = out.pairs[0];
      expect(pair.warnings.some((w) => /targetClass/.test(w))).toBe(true);
      const fm = extractFrontmatter(pair.layout.content);
      expect(fm["exo__Layout_targetClass"]).toBe("");
    });

    it("flags warning when referencingProperty is missing", () => {
      const out = service.migrate([
        { ...baseCfg, referencingProperty: null },
      ]);
      const pair = out.pairs[0];
      expect(
        pair.warnings.some((w) => /referencingProperty/.test(w)),
      ).toBe(true);
    });

    it("always emits additive-vs-replacing warning", () => {
      const out = service.migrate([baseCfg]);
      const pair = out.pairs[0];
      expect(
        pair.warnings.some((w) => /additive/.test(w)),
      ).toBe(true);
    });

    it("skips RelColSet with no targetClass AND no referencingProperty", () => {
      const out = service.migrate([
        {
          ...baseCfg,
          targetClass: null,
          referencingProperty: null,
        },
      ]);
      expect(out.pairs).toHaveLength(0);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0].sourcePath).toBe(baseCfg.path);
    });

    it("handles multiple RelColSets independently", () => {
      const cfgA: RelColSetConfig = { ...baseCfg };
      const cfgB: RelColSetConfig = {
        uid: "fff12345-1111-1111-1111-eeeeeeeeeeee",
        path: "03 Knowledge/ui/rc-2.md",
        label: "Notes on Projects",
        targetClass: "ztlk__Note",
        referencingProperty: "ztlk__Note_project",
        columns: ["[[ztlk__Note_priority]]"],
        priority: null,
      };
      const out = service.migrate([cfgA, cfgB]);
      expect(out.pairs).toHaveLength(2);
      expect(out.pairs[0].sourceUid).toBe(cfgA.uid);
      expect(out.pairs[1].sourceUid).toBe(cfgB.uid);
      expect(out.pairs[0].layout.uid).not.toBe(out.pairs[1].layout.uid);
    });

    it("default UID generator is deterministic across independent runs (idempotent --apply)", () => {
      // Regression guard: v15.121.0 defect post-mortem lesson applied to the
      // CLI migration path. Running `migrate-relcolset-to-exolayout --apply`
      // twice must produce the SAME UIDs, so the second apply is a no-op at
      // the filesystem level (file exists → write skipped by the user's
      // choice) rather than duplicating Layout+Block pairs.
      const serviceA = new RelColSetToExoLayoutMigratorService();
      const serviceB = new RelColSetToExoLayoutMigratorService();
      const runA = serviceA.migrate([baseCfg]);
      const runB = serviceB.migrate([baseCfg]);
      expect(runA.pairs[0].layout.uid).toBe(runB.pairs[0].layout.uid);
      expect(runA.pairs[0].block.uid).toBe(runB.pairs[0].block.uid);
      expect(runA.pairs[0].layout.content).toBe(runB.pairs[0].layout.content);
      expect(runA.pairs[0].block.content).toBe(runB.pairs[0].block.content);
    });

    it("default UID generator emits UUID-shaped v4 strings", () => {
      const service = new RelColSetToExoLayoutMigratorService();
      const out = service.migrate([baseCfg]);
      const uuidV4 =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(out.pairs[0].layout.uid).toMatch(uuidV4);
      expect(out.pairs[0].block.uid).toMatch(uuidV4);
      // Layout and block UIDs must differ (different suffix feeds hash).
      expect(out.pairs[0].layout.uid).not.toBe(out.pairs[0].block.uid);
    });

    it("default UID generator: different source UIDs produce different outputs", () => {
      const service = new RelColSetToExoLayoutMigratorService();
      const cfgA: RelColSetConfig = { ...baseCfg };
      const cfgB: RelColSetConfig = {
        ...baseCfg,
        uid: "xyz99999-1111-1111-1111-gggggggggggg",
      };
      const out = service.migrate([cfgA, cfgB]);
      expect(out.pairs[0].layout.uid).not.toBe(out.pairs[1].layout.uid);
    });

    it("round-trip: parse generated Layout+Block back through extractor preserves essentials", () => {
      const out = service.migrate([baseCfg]);
      const pair = out.pairs[0];
      const blockFm = extractFrontmatter(pair.block.content);
      // Semantic column equivalence — the 2 configured columns survive.
      expect(blockFm["exo__BacklinksTableBlock_columns"]).toEqual(
        baseCfg.columns,
      );
      expect(blockFm["exo__BacklinksTableBlock_rowClass"]).toBe(
        `[[${baseCfg.targetClass}]]`,
      );
      expect(blockFm["exo__BacklinksTableBlock_referencingProperty"]).toBe(
        `[[${baseCfg.referencingProperty}]]`,
      );
    });
  });
});

function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("frontmatter missing");
  return yaml.load(match[1]) as Record<string, unknown>;
}
