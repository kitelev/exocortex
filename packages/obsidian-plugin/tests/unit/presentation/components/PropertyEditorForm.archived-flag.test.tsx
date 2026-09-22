/**
 * PropertyEditorForm — the "Archived" checkbox reflects the archive flag the
 * way every other reader does (`MetadataHelpers.isAssetArchived`), and Save
 * emits ONLY the canonical `exo__Asset_archived` key (req `de7131ae`, Scenarios
 * H-K; ticket `24d7edcc`).
 *
 * Renders the production form with the fallback schema (which offers the
 * `exo__Asset_archived` boolean field); the Save payload is observed through
 * `onSave` — the modal's `handleSave` then writes every payload key through
 * `FrontmatterService.updateProperty` (the chokepoint, req 960d7a3f), which is
 * what clears a legacy `archived:` from disk. Each axis is revert-verified by a
 * mutant that removes ONE guarantee (table in the PR body).
 *
 * @req:de7131ae-f9e5-4498-bf06-41ccbaadc7de
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  PropertyEditorForm,
  seedArchivedFlag,
} from "../../../../src/presentation/components/property-editor/PropertyEditorForm";

const REQ = "@req:de7131ae-f9e5-4498-bf06-41ccbaadc7de";

const base = {
  exo__Asset_label: "My asset",
  exo__Asset_uid: "uid-1",
  exo__Asset_createdAt: "2026-06-28T00:00:00",
  exo__Asset_updatedAt: "2026-06-28T00:00:00",
};

async function renderAndSave(
  frontmatter: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; checkbox: HTMLInputElement }> {
  const onSave = jest.fn();
  render(
    <PropertyEditorForm
      instanceClass="ems__Task"
      frontmatter={frontmatter}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  const checkbox = (await screen.findByLabelText(/Archived/)) as HTMLInputElement;
  // `as unknown as Element` — the repo's check-test-types ratchet compiles tests
  // under a stricter DOM lib than ts-jest; HTMLElement from RTL is not assignable
  // to fireEvent's Element there (TS2345).
  fireEvent.click((await screen.findByText("Save")) as unknown as Element);
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return { payload: onSave.mock.calls[0][0] as Record<string, unknown>, checkbox };
}

describe("PropertyEditorForm — Archived checkbox ↔ archive-flag chokepoint (req de7131ae) [REVERT-VERIFY]", () => {
  it(`A9 (Scenario H) a legacy \`archived: true\` carrier renders the Archived checkbox CHECKED ${REQ}`, async () => {
    const onSave = jest.fn();
    render(
      <PropertyEditorForm
        instanceClass="ems__Task"
        frontmatter={{ ...base, archived: true }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    const checkbox = (await screen.findByLabelText(/Archived/)) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it(`A10 (Scenario I) saving the untouched form writes exo__Asset_archived: true and NO bare \`archived\` key ${REQ}`, async () => {
    const { payload } = await renderAndSave({ ...base, archived: true });
    expect(payload).toHaveProperty("exo__Asset_archived", true);
    expect(payload).not.toHaveProperty("archived");
    // The other scalar fields still travel with the payload.
    expect(payload).toHaveProperty("exo__Asset_label", "My asset");
  });

  it(`A11 (Scenario J, negative control) an asset with NO archive-flag key gets none invented on Save ${REQ}`, async () => {
    const { payload, checkbox } = await renderAndSave({ ...base });
    expect(checkbox.checked).toBe(false);
    expect(payload).not.toHaveProperty("exo__Asset_archived");
    expect(payload).not.toHaveProperty("archived");
  });

  it(`A12 (Scenario K) a dual carrier renders by the readers' priority — canonical false wins over legacy true ${REQ}`, async () => {
    const { payload, checkbox } = await renderAndSave({
      ...base,
      archived: true,
      exo__Asset_archived: false,
    });
    expect(checkbox.checked).toBe(false);
    expect(payload).toHaveProperty("exo__Asset_archived", false);
    // PR #4241 review MEDIUM: the legacy key must NOT travel with the payload —
    // handleSave writes keys in FILE order, and a re-emitted `archived: true`
    // canonicalises into an exo__Asset_archived write that would overwrite the
    // canonical `false` whenever it sits above the legacy key in the file.
    expect(payload).not.toHaveProperty("archived");
  });

  it(`A16 (Scenario H, empty canonical) \`exo__Asset_archived:\` with no value + legacy \`archived: true\` reads as archived, like every other reader ${REQ}`, async () => {
    const { payload, checkbox } = await renderAndSave({
      ...base,
      exo__Asset_archived: null,
      archived: true,
    });
    expect(checkbox.checked).toBe(true);
    expect(payload).toHaveProperty("exo__Asset_archived", true);
    expect(payload).not.toHaveProperty("archived");
  });

  it(`A15 the compat alias exo__Asset_isArchived seeds the canonical key the same way (read-only alias, never re-emitted) ${REQ}`, async () => {
    const { payload, checkbox } = await renderAndSave({ ...base, exo__Asset_isArchived: "yes" });
    expect(checkbox.checked).toBe(true);
    expect(payload).toHaveProperty("exo__Asset_archived", true);
    expect(payload).not.toHaveProperty("exo__Asset_isArchived");
  });

  describe("seedArchivedFlag (pure)", () => {
    it(`does not mutate its input and is idempotent ${REQ}`, () => {
      const input = { ...base, archived: true };
      const once = seedArchivedFlag(input);
      expect(input).toHaveProperty("archived", true);
      expect(once).toEqual({ ...base, exo__Asset_archived: true });
      expect(seedArchivedFlag(once)).toBe(once);
    });
  });
});
