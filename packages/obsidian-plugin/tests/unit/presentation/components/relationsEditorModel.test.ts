/**
 * relationsEditorModel — RFC `93a0b2ee` Phase 3 / Task 3.1
 *
 * Pure model for the property editor's Relations section: inline + reified
 * extraction, dual-IRI-aware dedup (a relation present BOTH inline and reified
 * is shown ONCE as inline — inline wins), and the create/delete frontmatter
 * write-value helpers (multi-value safe).
 *
 * @req:e084627c-38b7-4498-be0a-a3e07e790943
 */

import type { ReifiedRelation } from "../../../../src/presentation/renderers/layout/getReifiedRelations";
import {
  extractInlineRelations,
  reifiedToRows,
  incomingReifiedToRows,
  dedupeRelations,
  buildRelationRows,
  appendInlineRelationValue,
  removeInlineRelationValue,
  quoteRelationValueForYaml,
  predicateLocalName,
} from "../../../../src/presentation/components/property-editor/relationsEditorModel";

const reified = (over: Partial<ReifiedRelation>): ReifiedRelation => ({
  statementIri: "obsidian://vault/assetspaces/kitelev/exoas-class-relations/s1.md",
  subject: "obsidian://vault/assetspaces/kitelev/exoas-my/A.md",
  predicate: "https://exocortex.my/ontology/exo-ims#relatesToConcept",
  object: "obsidian://vault/assetspaces/kitelev/exoas-shared-private/B.md",
  objectIsLiteral: false,
  direction: "outgoing",
  statementPath: "assetspaces/kitelev/exoas-class-relations/s1.md",
  assetSpace: "exoas-class-relations",
  ...over,
});

describe("relationsEditorModel — inline extraction", () => {
  it("extracts wikilink-valued frontmatter entries as inline relations, skipping housekeeping + literals", () => {
    const fm = {
      exo__Instance_class: "[[7db5eeff-...|ems__Project]]", // housekeeping → skip
      exo__Asset_label: "My asset", // literal + housekeeping → skip
      exo__Asset_isDefinedBy: "[[anchor]]", // housekeeping → skip
      ems__Effort_parent: "[[parent-uid|Parent]]", // relation
      ems__Effort_priority: "high", // literal → not a relation
      exo__Asset_relates: ["[[c1|Concept 1]]", "[[c2]]", "not a link"], // 2 relations
    };
    const rows = extractInlineRelations(fm);
    const keys = rows.map((r) => `${r.predicateKey}:${r.objectUid}`);
    expect(keys).toEqual([
      "ems__Effort_parent:parent-uid",
      "exo__Asset_relates:c1",
      "exo__Asset_relates:c2",
    ]);
    expect(rows.every((r) => r.kind === "inline")).toBe(true);
    expect(rows[1].objectDisplay).toBe("Concept 1");
    expect(rows[2].objectDisplay).toBe("c2");
  });

  it("excludes schema-declared NON-object (enum/scalar) keys even when wikilink-valued [data-integrity]", () => {
    // ems__Effort_status / ems__Effort_size are wikilink-valued ENUMS
    // (status-select / size-select) — they must NOT be mis-listed as deletable
    // relations (deleting one would strip the property). buildPredicateOptions /
    // the modal pass these as nonRelationKeys.
    const fm = {
      ems__Effort_status: "[[027e78f4-...|Doing]]",
      ems__Effort_size: "[[ems__TaskSize_M]]",
      ems__Effort_parent: "[[parent|Parent]]",
    };
    const nonRelationKeys = new Set(["ems__Effort_status", "ems__Effort_size"]);
    const rows = extractInlineRelations(fm, nonRelationKeys);
    expect(rows.map((r) => r.predicateKey)).toEqual(["ems__Effort_parent"]);
  });
});

describe("relationsEditorModel — reified rows", () => {
  it("keeps outgoing IRI-object relations and drops incoming + literal-object", () => {
    const rows = reifiedToRows([
      reified({ predicate: "https://exocortex.my/ontology/exo-ims#relatesToConcept" }),
      reified({ direction: "incoming" }), // incoming → drop (object-side is read-only, Task 3.x)
      reified({ objectIsLiteral: true, object: "some literal" }), // literal → property, not a relation
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("reified");
    expect(rows[0].predicateLabel).toBe("relatesToConcept");
    expect(rows[0].assetSpace).toBe("exoas-class-relations");
    expect(rows[0].statementPath).toBe(
      "assetspaces/kitelev/exoas-class-relations/s1.md",
    );
  });
});

describe("relationsEditorModel — incoming reified rows (object-side read-only, Task 3.3)", () => {
  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("keeps INCOMING IRI-object relations read-only (with the owner display) and drops outgoing + literal-object", () => {
    const rows = incomingReifiedToRows([
      reified({ direction: "outgoing" }), // outgoing → not an object-side row
      reified({ direction: "incoming" }), // incoming → read-only object-side row
      reified({ direction: "incoming", objectIsLiteral: true, object: "literal" }), // literal → drop
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("reified");
    expect(row.direction).toBe("incoming");
    expect(row.readOnly).toBe(true);
    // A is the object; the displayed "other end" / owner is the subject (A.md → "A").
    expect(row.objectDisplay).toBe("A");
    expect(row.ownerDisplay).toBe("A");
    expect(row.assetSpace).toBe("exoas-class-relations");
    expect(row.statementPath).toBe(
      "assetspaces/kitelev/exoas-class-relations/s1.md",
    );
  });
});

describe("relationsEditorModel — dedup (inline wins) [REVERT-VERIFY]", () => {
  it("shows a relation present BOTH inline and reified ONCE, as inline", () => {
    // Same edge: predicate localName `relatesToConcept`, object uid `B`.
    const inline = extractInlineRelations({
      "exo-ims__relatesToConcept": "[[B|Concept B]]",
    });
    const reifiedRows = reifiedToRows([
      reified({
        predicate: "https://exocortex.my/ontology/exo-ims#relatesToConcept",
        object: "obsidian://vault/assetspaces/kitelev/exoas-shared-private/B.md",
      }),
    ]);

    const merged = dedupeRelations(inline, reifiedRows);

    // The duplicate collapses to a SINGLE row, and that row is the inline one
    // (inline wins — it is what travels on share). This is the revert-verify
    // anchor: breaking dedupeRelations (emitting inline ∪ reified verbatim) makes
    // the duplicate appear twice and turns this RED.
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("inline");
    expect(predicateLocalName(merged[0].predicateKey)).toBe("relatesToConcept");
  });

  it("keeps a reified relation that has no inline duplicate", () => {
    const inline = extractInlineRelations({
      ems__Effort_parent: "[[parent]]",
    });
    const reifiedRows = reifiedToRows([reified({ object: "obsidian://vault/x/C.md" })]);
    const merged = dedupeRelations(inline, reifiedRows);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.kind)).toEqual(["inline", "reified"]);
  });
});

describe("relationsEditorModel — buildRelationRows", () => {
  it("unifies frontmatter inline + helper reified, deduplicated", () => {
    const rows = buildRelationRows({
      frontmatter: { ems__Effort_parent: "[[P|Parent]]" },
      reified: [reified({ object: "obsidian://vault/x/Q.md" })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["inline", "reified"]);
  });
});

describe("relationsEditorModel — create write-value (multi-value safe)", () => {
  it("appends to an absent key as a scalar", () => {
    expect(appendInlineRelationValue(undefined, "X")).toBe("[[X]]");
  });
  it("appends to a scalar, producing a 2-element array (keeping the existing value)", () => {
    expect(appendInlineRelationValue("[[A|Alias]]", "X")).toEqual([
      "[[A|Alias]]",
      "[[X]]",
    ]);
  });
  it("appends to an array without dropping siblings", () => {
    expect(appendInlineRelationValue(["[[A]]", "[[B]]"], "X")).toEqual([
      "[[A]]",
      "[[B]]",
      "[[X]]",
    ]);
  });
  it("does not append an exact duplicate target", () => {
    expect(appendInlineRelationValue(["[[A|Alias]]"], "A")).toEqual("[[A|Alias]]");
  });
});

describe("relationsEditorModel — delete write-value (keeps siblings)", () => {
  it("removes one value from a multi-value key, keeping the rest (scalar when one remains)", () => {
    expect(removeInlineRelationValue(["[[A]]", "[[B]]"], "[[A]]")).toBe("[[B]]");
  });
  it("returns undefined when the last value is removed (caller drops the key)", () => {
    expect(removeInlineRelationValue("[[A]]", "[[A]]")).toBeUndefined();
  });
  it("keeps all three when two remain", () => {
    expect(
      removeInlineRelationValue(["[[A]]", "[[B]]", "[[C]]"], "[[B]]"),
    ).toEqual(["[[A]]", "[[C]]"]);
  });
});

describe("relationsEditorModel — YAML quoting", () => {
  it("quotes unquoted wikilinks and leaves already-quoted ones", () => {
    expect(quoteRelationValueForYaml("[[A]]")).toBe('"[[A]]"');
    expect(quoteRelationValueForYaml('"[[A]]"')).toBe('"[[A]]"');
    expect(quoteRelationValueForYaml(["[[A]]", '"[[B]]"'])).toEqual([
      '"[[A]]"',
      '"[[B]]"',
    ]);
  });
});
