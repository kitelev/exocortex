/**
 * RelationsSection — RFC `93a0b2ee` Phase 3 / Task 3.1
 *
 * The property editor's Relations section: lists the open asset's outgoing
 * inline + reified relations (reified rows carry the `reified · <AS>` marker,
 * inline rows none), a per-row in-place delete affordance, and a create row
 * (predicate selector + range-scoped ReferencePicker) that emits an inline
 * relation. Scope: list + create + delete — NO reify/de-reify toggle.
 *
 * @req:e084627c-38b7-4498-be0a-a3e07e790943
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  RelationsSection,
  type PredicateOption,
} from "../../../../src/presentation/components/property-editor/RelationsSection";
import type { RelationRow } from "../../../../src/presentation/components/property-editor/relationsEditorModel";
import type { AssetRefCandidate } from "../../../../src/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

const inlineRow: RelationRow = {
  predicateKey: "ems__Effort_parent",
  predicateLabel: "Effort_parent",
  objectUid: "parent-uid",
  objectDisplay: "Parent project",
  kind: "inline",
  inlineRawValue: "[[parent-uid|Parent project]]",
};

const reifiedRow: RelationRow = {
  predicateKey: "https://exocortex.my/ontology/exo-ims#relatesToConcept",
  predicateLabel: "relatesToConcept",
  objectUid: "concept-uid",
  objectDisplay: "concept-uid",
  kind: "reified",
  statementPath: "assetspaces/kitelev/exoas-class-relations/s1.md",
  assetSpace: "exoas-class-relations",
};

const PREDICATES: PredicateOption[] = [
  { key: "ems__Effort_parent", label: "Effort_parent", rangeClassUid: "proj-class" },
  { key: "exo__Asset_relates", label: "Asset_relates", rangeClassUid: "concept-class" },
];

const CANDIDATES_BY_RANGE: Record<string, AssetRefCandidate[]> = {
  "proj-class": [{ uid: "proj-1", label: "Project One" }],
  "concept-class": [
    { uid: "concept-1", label: "Concept One" },
    { uid: "concept-2", label: "Concept Two" },
  ],
};

function renderSection(over: Partial<React.ComponentProps<typeof RelationsSection>> = {}) {
  const onCreate = jest.fn();
  const onDelete = jest.fn();
  const resolveCandidates = jest.fn(
    (rangeUid: string | undefined) =>
      (rangeUid ? CANDIDATES_BY_RANGE[rangeUid] : []) ?? [],
  );
  render(
    <RelationsSection
      rows={[inlineRow, reifiedRow]}
      predicateOptions={PREDICATES}
      resolveCandidates={resolveCandidates}
      onCreate={onCreate}
      onDelete={onDelete}
      {...over}
    />,
  );
  return { onCreate, onDelete, resolveCandidates };
}

describe("RelationsSection — list", () => {
  it("renders inline and reified relations, with the reified marker only on the reified row", () => {
    renderSection();
    const rows = screen.getAllByTestId("relation-row");
    expect(rows).toHaveLength(2);

    const inlineEl = rows.find((r) => r.getAttribute("data-kind") === "inline")!;
    const reifiedEl = rows.find((r) => r.getAttribute("data-kind") === "reified")!;

    expect(inlineEl).toHaveTextContent("Effort_parent");
    expect(inlineEl).toHaveTextContent("Parent project");
    expect(inlineEl.querySelector(".exocortex-reified-marker")).toBeNull();

    expect(reifiedEl).toHaveTextContent("relatesToConcept");
    expect(reifiedEl.querySelector(".exocortex-reified-marker")).toHaveTextContent(
      "reified · exoas-class-relations",
    );
  });

  it("renders an empty state when there are no relations", () => {
    renderSection({ rows: [] });
    expect(screen.getByTestId("relations-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("relation-row")).toHaveLength(0);
  });
});

describe("RelationsSection — delete in place", () => {
  it("invokes onDelete with the row when its delete affordance is clicked", () => {
    const { onDelete } = renderSection();
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "reified")!;
    fireEvent.click(reifiedEl.querySelector('[data-testid="relation-delete"]')!);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(reifiedRow);
  });
});

describe("RelationsSection — reify/de-reify toggle (RFC §C3 Task 3.2)", () => {
  // @req:3b9eb8d5-da3d-45d9-9df6-082f4f22c8f1
  it("offers Reify on an inline row only, and invokes onReify with that row", () => {
    const onReify = jest.fn();
    const onDeReify = jest.fn();
    renderSection({ onReify, onDeReify });
    const inlineEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "inline")!;
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "reified")!;

    const reifyBtn = inlineEl.querySelector('[data-testid="relation-reify"]');
    expect(reifyBtn).not.toBeNull();
    // The inline row must NOT offer de-reify; the reified row must NOT offer reify.
    expect(inlineEl.querySelector('[data-testid="relation-dereify"]')).toBeNull();
    expect(reifiedEl.querySelector('[data-testid="relation-reify"]')).toBeNull();

    fireEvent.click(reifyBtn!);
    expect(onReify).toHaveBeenCalledTimes(1);
    expect(onReify).toHaveBeenCalledWith(inlineRow);
    expect(onDeReify).not.toHaveBeenCalled();
  });

  it("offers De-reify on a reified row only, and invokes onDeReify with that row", () => {
    const onReify = jest.fn();
    const onDeReify = jest.fn();
    renderSection({ onReify, onDeReify });
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "reified")!;
    const dereifyBtn = reifiedEl.querySelector('[data-testid="relation-dereify"]');
    expect(dereifyBtn).not.toBeNull();
    fireEvent.click(dereifyBtn!);
    expect(onDeReify).toHaveBeenCalledTimes(1);
    expect(onDeReify).toHaveBeenCalledWith(reifiedRow);
    expect(onReify).not.toHaveBeenCalled();
  });

  it("offers no toggle affordance when onReify/onDeReify are omitted (Task 3.1 back-compat)", () => {
    renderSection();
    expect(screen.queryAllByTestId("relation-reify")).toHaveLength(0);
    expect(screen.queryAllByTestId("relation-dereify")).toHaveLength(0);
  });
});

describe("RelationsSection — create (range-scoped picker)", () => {
  it("scopes the picker candidates to the selected predicate's range", () => {
    const { resolveCandidates } = renderSection();
    // Default predicate = first option (ems__Effort_parent, range proj-class).
    expect(resolveCandidates).toHaveBeenCalledWith("proj-class");
  });

  it("emits an inline relation (predicateKey + targetUid) on Add", () => {
    const { onCreate } = renderSection();
    // Switch predicate to Asset_relates (range concept-class).
    fireEvent.change(screen.getByTestId("relation-predicate-select"), {
      target: { value: "exo__Asset_relates" },
    });
    // Pick a candidate in the range-scoped picker.
    const input = screen.getByTestId("field-relation-target");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Concept Two" } });
    fireEvent.mouseDown(screen.getByTestId("option-relation-target-concept-2"));
    // Add.
    fireEvent.click(screen.getByTestId("relation-add"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("exo__Asset_relates", "concept-2");
  });

  it("disables Add until a target is selected", () => {
    renderSection();
    expect(screen.getByTestId("relation-add")).toBeDisabled();
  });
});
