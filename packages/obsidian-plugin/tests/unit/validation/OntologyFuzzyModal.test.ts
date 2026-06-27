/**
 * OntologyFuzzyModal tests (RFC f402002b, M1.5). Verifies the deferred-microtask
 * resolution contract (picker-no-op bug #3561): on a real selection Obsidian
 * fires onClose() BEFORE onChooseItem(), so onChooseItem must only RECORD and
 * onClose must defer the single resolution. A selection resolves the item; a
 * dismissal (onClose with no choice) resolves null.
 */
import { App } from "obsidian";
import { OntologyFuzzyModal } from "../../../src/infrastructure/adapters/OntologyFuzzyModal";
import type { OntologyChoice } from "../../../src/infrastructure/adapters/PluginVaultCheckReader";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const OPTS: OntologyChoice[] = [
  { uid: "a", label: "$exo", folder: "assetspaces/exo/exo" },
  { uid: "b", label: "$ems", folder: "assetspaces/ems/ems" },
];

describe("OntologyFuzzyModal", () => {
  it("resolves with the chosen ontology — real Obsidian order: onClose() then onChooseItem()", async () => {
    let resolved: OntologyChoice | null | undefined;
    const modal = new OntologyFuzzyModal(
      new App(),
      OPTS,
      "Choose ontology",
      (v) => {
        resolved = v;
      },
    );
    // Mirror SuggestModal.selectSuggestion: close() (→ onClose) BEFORE onChooseItem.
    modal.onClose();
    modal.onChooseItem(OPTS[1]);
    await flush();
    expect(resolved).toEqual(OPTS[1]);
  });

  it("resolves null when dismissed without a choice", async () => {
    let resolved: OntologyChoice | null | undefined;
    const modal = new OntologyFuzzyModal(new App(), OPTS, "Choose ontology", (v) => {
      resolved = v;
    });
    modal.onClose();
    await flush();
    expect(resolved).toBeNull();
  });

  it("getItemText shows the human label (never the UID) + folder for disambiguation", () => {
    const modal = new OntologyFuzzyModal(new App(), OPTS, "t", () => {});
    expect(modal.getItemText(OPTS[0])).toBe("$exo — assetspaces/exo/exo");
    expect(modal.getItemText(OPTS[0])).not.toContain("uid");
  });
});
