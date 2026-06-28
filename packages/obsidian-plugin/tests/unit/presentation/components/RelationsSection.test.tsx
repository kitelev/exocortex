/**
 * RelationsSection — RFC `93a0b2ee` Phase 3 (Tasks 3.1 / 3.2 / 3.3)
 *
 * The property editor's Relations section: lists the open asset's outgoing inline
 * + reified relations (reified rows carry the `reified · <AS>` marker), a per-row
 * in-place delete affordance, a create row, the reify/de-reify toggle (3.2), and
 * the 3.3 safety/privacy hardening — de-reify strong-confirm (checkbox-gated),
 * object-side read-only, and the reify destination-AssetSpace picker.
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
import type { ReifyDestination } from "../../../../src/presentation/components/property-editor/reifyModel";
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
  direction: "outgoing",
  statementPath: "assetspaces/kitelev/exoas-class-relations/s1.md",
  assetSpace: "exoas-class-relations",
};

// RFC §C3 Task 3.3 — an INCOMING reified relation (the open asset A is the object;
// the subject "owner-asset" owns the statement). Shown read-only from A's side.
const incomingReifiedRow: RelationRow = {
  predicateKey: "https://exocortex.my/ontology/exo-ims#relatesToConcept",
  predicateLabel: "relatesToConcept",
  objectUid: "owner-asset",
  objectDisplay: "owner-asset",
  kind: "reified",
  direction: "incoming",
  readOnly: true,
  ownerDisplay: "owner-asset",
  statementPath: "assetspaces/kitelev/exoas-class-relations/s2.md",
  assetSpace: "exoas-class-relations",
};

const DESTINATIONS: ReifyDestination[] = [
  { anchorUid: "anchor-default", label: "$kitelev-class-relations (junction, эталон)", assetSpace: "exoas-shared-private" },
  { anchorUid: "anchor-private", label: "Private relations", assetSpace: "exoas-my" },
];

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

/** Render with the full Task 3.2/3.3 toggle wiring (reify+picker, de-reify). */
function renderWithToggle(
  rows: RelationRow[] = [inlineRow, reifiedRow],
  over: Partial<React.ComponentProps<typeof RelationsSection>> = {},
) {
  const onReify = jest.fn();
  const onDeReify = jest.fn();
  const resolveReifyDestinations = jest.fn(() => DESTINATIONS);
  const r = renderSection({ rows, onReify, onDeReify, resolveReifyDestinations, ...over });
  return { ...r, onReify, onDeReify, resolveReifyDestinations };
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

describe("RelationsSection — reify/de-reify toggle affordances (RFC §C3 Task 3.2)", () => {
  // @req:3b9eb8d5-da3d-45d9-9df6-082f4f22c8f1
  it("offers Reify on an inline row only, and De-reify on a reified row only", () => {
    renderWithToggle();
    const inlineEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "inline")!;
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find(
        (r) =>
          r.getAttribute("data-kind") === "reified" &&
          r.getAttribute("data-direction") === "outgoing",
      )!;

    expect(inlineEl.querySelector('[data-testid="relation-reify"]')).not.toBeNull();
    expect(inlineEl.querySelector('[data-testid="relation-dereify"]')).toBeNull();
    expect(reifiedEl.querySelector('[data-testid="relation-dereify"]')).not.toBeNull();
    expect(reifiedEl.querySelector('[data-testid="relation-reify"]')).toBeNull();
  });

  it("offers no toggle affordance when onReify/onDeReify are omitted (Task 3.1 back-compat)", () => {
    renderSection();
    expect(screen.queryAllByTestId("relation-reify")).toHaveLength(0);
    expect(screen.queryAllByTestId("relation-dereify")).toHaveLength(0);
  });

  it("offers no Reify affordance when the destination resolver is omitted (a destination cannot be chosen)", () => {
    renderSection({ rows: [inlineRow], onReify: jest.fn(), onDeReify: jest.fn() });
    expect(screen.queryAllByTestId("relation-reify")).toHaveLength(0);
  });
});

describe("RelationsSection — de-reify strong-confirm (RFC §C3 Task 3.3)", () => {
  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("opens a strong-confirm dialog (it does NOT de-reify directly) when De-reify is clicked", () => {
    const { onDeReify } = renderWithToggle();
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find(
        (r) =>
          r.getAttribute("data-kind") === "reified" &&
          r.getAttribute("data-direction") === "outgoing",
      )!;
    fireEvent.click(reifiedEl.querySelector('[data-testid="relation-dereify"]')!);
    // A confirm dialog appears; nothing has been de-reified yet.
    expect(screen.getByTestId("dereify-confirm-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("dereify-warning")).toHaveTextContent(
      "будет удалён",
    );
    expect(onDeReify).not.toHaveBeenCalled();
  });

  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  // REVERT-VERIFY anchor: the confirm button is DISABLED until the acknowledgement
  // checkbox is checked — an accidental single click can never de-reify. Breaking
  // the gate (`disabled={!deReifyAck}` → `disabled={false}`) turns this RED.
  it("gates the confirm button behind the acknowledgement checkbox (accidental click cannot de-reify)", () => {
    const { onDeReify } = renderWithToggle();
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find(
        (r) =>
          r.getAttribute("data-kind") === "reified" &&
          r.getAttribute("data-direction") === "outgoing",
      )!;
    fireEvent.click(reifiedEl.querySelector('[data-testid="relation-dereify"]')!);

    const confirmBtn = screen.getByTestId("dereify-confirm");
    // Unchecked → the destructive confirm is DISABLED (cannot be clicked).
    expect(confirmBtn).toBeDisabled();

    // Acknowledge → the confirm becomes available and runs the de-reify.
    fireEvent.click(screen.getByTestId("dereify-ack-checkbox"));
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    expect(onDeReify).toHaveBeenCalledTimes(1);
    expect(onDeReify).toHaveBeenCalledWith(reifiedRow);
    // The dialog closes after a confirmed de-reify.
    expect(screen.queryByTestId("dereify-confirm-dialog")).toBeNull();
  });

  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("does not de-reify when the confirm dialog is cancelled", () => {
    const { onDeReify } = renderWithToggle();
    const reifiedEl = screen
      .getAllByTestId("relation-row")
      .find(
        (r) =>
          r.getAttribute("data-kind") === "reified" &&
          r.getAttribute("data-direction") === "outgoing",
      )!;
    fireEvent.click(reifiedEl.querySelector('[data-testid="relation-dereify"]')!);
    // Even after acknowledging, cancel must abort.
    fireEvent.click(screen.getByTestId("dereify-ack-checkbox"));
    fireEvent.click(screen.getByTestId("dereify-cancel"));
    expect(onDeReify).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dereify-confirm-dialog")).toBeNull();
  });
});

describe("RelationsSection — object-side read-only (RFC §C3 Task 3.3)", () => {
  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("shows an incoming reified relation read-only — marker visible, toggle disabled and labelled «изменит <subject>», no delete", () => {
    const { onDeReify } = renderWithToggle([incomingReifiedRow]);
    const row = screen.getByTestId("relation-row");
    expect(row.getAttribute("data-direction")).toBe("incoming");
    expect(row.getAttribute("data-readonly")).toBe("true");
    // The marker is still shown (the user SEES it is reified).
    expect(row.querySelector(".exocortex-reified-marker")).toHaveTextContent(
      "reified · exoas-class-relations",
    );
    // The toggle is read-only: a disabled affordance labelled «изменит <subject>».
    const ro = screen.getByTestId("relation-toggle-readonly");
    expect(ro).toHaveTextContent("изменит owner-asset");
    expect(ro).toHaveAttribute("aria-disabled", "true");
    // No actionable de-reify / reify / delete from the object's side.
    expect(row.querySelector('[data-testid="relation-dereify"]')).toBeNull();
    expect(row.querySelector('[data-testid="relation-reify"]')).toBeNull();
    expect(row.querySelector('[data-testid="relation-delete"]')).toBeNull();
    expect(onDeReify).not.toHaveBeenCalled();
  });

  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("keeps the OUTGOING (subject-side) reified relation actionable (only the owner can toggle)", () => {
    renderWithToggle([reifiedRow, incomingReifiedRow]);
    const outgoing = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-direction") === "outgoing")!;
    const incoming = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-direction") === "incoming")!;
    expect(outgoing.querySelector('[data-testid="relation-dereify"]')).not.toBeNull();
    expect(incoming.querySelector('[data-testid="relation-dereify"]')).toBeNull();
  });
});

describe("RelationsSection — reify destination-AssetSpace picker (RFC §C3 Task 3.3)", () => {
  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("opens a destination picker on Reify (it does NOT reify directly), default selected first", () => {
    const { onReify, resolveReifyDestinations } = renderWithToggle();
    const inlineEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "inline")!;
    fireEvent.click(inlineEl.querySelector('[data-testid="relation-reify"]')!);
    // The picker opens lazily (destinations resolved on open); no reify yet.
    expect(resolveReifyDestinations).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reify-destination-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reify-destination-list").children).toHaveLength(2);
    // The default (first) destination is pre-selected.
    expect(screen.getByTestId("reify-destination-anchor-default")).toBeChecked();
    expect(onReify).not.toHaveBeenCalled();
  });

  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("reifies into the CHOSEN destination AssetSpace on confirm", () => {
    const { onReify } = renderWithToggle();
    const inlineEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "inline")!;
    fireEvent.click(inlineEl.querySelector('[data-testid="relation-reify"]')!);
    // Choose the non-default (private) AssetSpace, then confirm.
    fireEvent.click(screen.getByTestId("reify-destination-anchor-private"));
    fireEvent.click(screen.getByTestId("reify-confirm"));
    expect(onReify).toHaveBeenCalledTimes(1);
    expect(onReify).toHaveBeenCalledWith(inlineRow, "anchor-private");
    expect(screen.queryByTestId("reify-destination-dialog")).toBeNull();
  });

  // @req:8d3ec42f-3334-4d96-8087-6128220a534d
  it("does not reify when the destination picker is cancelled", () => {
    const { onReify } = renderWithToggle();
    const inlineEl = screen
      .getAllByTestId("relation-row")
      .find((r) => r.getAttribute("data-kind") === "inline")!;
    fireEvent.click(inlineEl.querySelector('[data-testid="relation-reify"]')!);
    fireEvent.click(screen.getByTestId("reify-cancel"));
    expect(onReify).not.toHaveBeenCalled();
    expect(screen.queryByTestId("reify-destination-dialog")).toBeNull();
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
