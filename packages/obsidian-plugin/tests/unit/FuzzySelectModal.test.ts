import {
  FuzzySelectModal,
  fuzzySelect,
  type FuzzySelectRow,
} from "../../src/infrastructure/adapters/FuzzySelectModal";
import type { FuzzyMatch } from "obsidian";

const fakeApp = {} as any;

interface Item {
  id: string;
  label: string;
  note: string;
}

const items: Item[] = [
  { id: "a", label: "Alpha", note: "first" },
  { id: "b", label: "Bravo", note: "second" },
  { id: "c", label: "Charlie", note: "third" },
];

const toRow = (i: Item): FuzzySelectRow => ({ title: i.label, description: i.note });

/**
 * Drive the modal as Obsidian's real `SuggestModal.selectSuggestion` does
 * (Issue #3561): `close()`/`onClose()` BEFORE `onChooseItem()`, both synchronous.
 */
function realObsidianSelect(modal: FuzzySelectModal<Item>, item: Item): void {
  modal.onClose();
  modal.onChooseItem(item);
}

describe("FuzzySelectModal", () => {
  it("getItems returns the constructor-supplied options", () => {
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", () => {});
    expect(modal.getItems()).toEqual(items);
  });

  it("getItemText renders title then description (both searchable)", () => {
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", () => {});
    expect(modal.getItemText(items[0])).toBe("Alpha — first");
  });

  it("getItemText omits the dash when no description is supplied", () => {
    const modal = new FuzzySelectModal<Item>(
      fakeApp,
      items,
      (i) => ({ title: i.label }),
      "Pick",
      () => {},
    );
    expect(modal.getItemText(items[0])).toBe("Alpha");
  });

  it("setPlaceholder is invoked with the provided title", () => {
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Insert template", () => {});
    expect(modal.inputEl.placeholder).toBe("Insert template");
  });

  function fuzzy(item: Item): FuzzyMatch<Item> {
    return { item, match: { score: 0, matches: [] } };
  }

  it("renderSuggestion renders a title and a description line", () => {
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", () => {});
    const el = document.createElement("div");
    modal.renderSuggestion(fuzzy(items[1]), el);
    expect(el.classList.contains("exocortex-token-suggestion")).toBe(true);
    expect(
      el.querySelector(".exocortex-token-suggestion__title")?.textContent,
    ).toBe("Bravo");
    expect(
      el.querySelector(".exocortex-token-suggestion__desc")?.textContent,
    ).toBe("second");
  });

  it("renderSuggestion omits the desc line when no description", () => {
    const modal = new FuzzySelectModal<Item>(
      fakeApp,
      items,
      (i) => ({ title: i.label }),
      "Pick",
      () => {},
    );
    const el = document.createElement("div");
    modal.renderSuggestion(fuzzy(items[0]), el);
    expect(el.querySelector(".exocortex-token-suggestion__desc")).toBeNull();
  });

  // ── Regression: Issue #3561 close-before-choose lifecycle ─────────────────
  it("resolves with the chosen item when Obsidian closes BEFORE onChooseItem", async () => {
    const result = await new Promise<Item | null>((resolve) => {
      const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", resolve);
      realObsidianSelect(modal, items[2]);
    });
    expect(result).toEqual(items[2]);
  });

  it("resolves null when dismissed without a choice (Escape)", async () => {
    const result = await new Promise<Item | null>((resolve) => {
      const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", resolve);
      modal.onClose();
    });
    expect(result).toBeNull();
  });

  it("resolves exactly once for the close-then-choose sequence", async () => {
    const resolve = jest.fn();
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", resolve);
    realObsidianSelect(modal, items[0]);
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(items[0]);
  });

  it("double onClose is idempotent — resolves at most once with null", async () => {
    const resolve = jest.fn();
    const modal = new FuzzySelectModal(fakeApp, items, toRow, "Pick", resolve);
    modal.onClose();
    modal.onClose();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);
  });

  describe("fuzzySelect wrapper", () => {
    it("opens the modal and resolves with the chosen item", async () => {
      const openSpy = jest
        .spyOn(FuzzySelectModal.prototype, "open")
        .mockImplementation(function (this: FuzzySelectModal<Item>) {
          realObsidianSelect(this, items[1]);
        });
      const chosen = await fuzzySelect(fakeApp, items, toRow, "Pick");
      expect(chosen).toEqual(items[1]);
      expect(openSpy).toHaveBeenCalledTimes(1);
      openSpy.mockRestore();
    });

    it("resolves null when opened and dismissed", async () => {
      const openSpy = jest
        .spyOn(FuzzySelectModal.prototype, "open")
        .mockImplementation(function (this: FuzzySelectModal<Item>) {
          this.onClose();
        });
      const chosen = await fuzzySelect(fakeApp, items, toRow, "Pick");
      expect(chosen).toBeNull();
      openSpy.mockRestore();
    });
  });
});
