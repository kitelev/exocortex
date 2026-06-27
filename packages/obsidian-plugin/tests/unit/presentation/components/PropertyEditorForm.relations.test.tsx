/**
 * PropertyEditorForm — RFC `93a0b2ee` Phase 3 / Task 3.1 (relations integration)
 *
 * Locks the data-integrity contract found in code review: when the Relations
 * section is active, relations are written LIVE (create/delete) and the bulk
 * "Save" must NOT write relation/wikilink keys back from the stale `formData`
 * snapshot (which would resurrect a deleted relation / drop a created one). Save
 * persists ONLY the scalar editable fields.
 *
 * @req:e084627c-38b7-4498-be0a-a3e07e790943
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PropertyEditorForm } from "../../../../src/presentation/components/property-editor/PropertyEditorForm";
import type { RelationsFormDeps } from "../../../../src/presentation/components/property-editor/PropertyEditorForm";

const relationsDeps = (): RelationsFormDeps => ({
  initialRows: [
    {
      predicateKey: "ems__Effort_parent",
      predicateLabel: "Effort_parent",
      objectUid: "p",
      objectDisplay: "Parent",
      kind: "inline",
      inlineRawValue: "[[p|Parent]]",
    },
  ],
  predicateOptions: [],
  resolveCandidates: () => [],
  createInline: jest.fn().mockResolvedValue([]),
  deleteRelation: jest.fn().mockResolvedValue([]),
});

describe("PropertyEditorForm — Save does not clobber live-managed relations [REVERT-VERIFY]", () => {
  it("excludes relation/wikilink keys from the Save payload when the Relations section is active", async () => {
    const onSave = jest.fn();
    const frontmatter = {
      exo__Asset_label: "My asset",
      exo__Asset_uid: "uid-1",
      exo__Asset_createdAt: "2026-06-28T00:00:00",
      exo__Asset_updatedAt: "2026-06-28T00:00:00",
      // A relation key that lives in formData but is managed live by the section.
      ems__Effort_parent: "[[p|Parent]]",
    };

    render(
      <PropertyEditorForm
        instanceClass="ems__Task"
        frontmatter={frontmatter}
        onSave={onSave}
        onCancel={() => {}}
        relations={relationsDeps()}
      />,
    );

    fireEvent.click(await screen.findByText("Save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>;
    // The relation key must NOT be in the bulk-save payload (it would resurrect a
    // deleted relation / drop a created one). Reverting handleSave to
    // onSave(formData) makes this RED.
    expect(payload).not.toHaveProperty("ems__Effort_parent");
    // The scalar editable field IS saved.
    expect(payload).toHaveProperty("exo__Asset_label", "My asset");
  });
});
