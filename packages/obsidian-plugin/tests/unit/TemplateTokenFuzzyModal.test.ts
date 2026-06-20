import {
  TemplateTokenFuzzyModal,
  pickTemplateToken,
} from "../../src/infrastructure/adapters/TemplateTokenFuzzyModal";
import { TEMPLATE_TOKEN_CHOICES } from "../../src/infrastructure/adapters/TemplateTokenInserter";
import type { TemplateTokenChoice } from "../../src/infrastructure/adapters/TemplateTokenInserter";
import type { FuzzyMatch } from "obsidian";

const fakeApp = {} as any;

const tokens: TemplateTokenChoice[] = [...TEMPLATE_TOKEN_CHOICES];

/**
 * Drive the modal exactly as Obsidian's real `SuggestModal.selectSuggestion`
 * does (verified against `obsidian.asar`): `close()` (→ `onClose()`) fires
 * BEFORE `onChooseItem()`, both synchronously in one selection. This is the
 * production-shape ordering — NOT the vacuous "onChooseItem first" assumption.
 * See ProfileFuzzyModal Issue #3561.
 */
function realObsidianSelect(
  modal: TemplateTokenFuzzyModal,
  item: TemplateTokenChoice,
): void {
  modal.onClose(); // Obsidian calls close() first
  modal.onChooseItem(item); // then onChooseSuggestion → onChooseItem
}

describe("TemplateTokenFuzzyModal", () => {
  it("getItems returns the constructor-supplied options", () => {
    const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", () => {});
    expect(modal.getItems()).toEqual(tokens);
  });

  it("getItemText renders label first then description (both searchable)", () => {
    const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", () => {});
    expect(modal.getItemText(tokens[0])).toBe(
      "Random UUID — A random UUID v4 (lowercase, crypto.randomUUID())",
    );
  });

  it("setPlaceholder is invoked on construction with the provided title", () => {
    const modal = new TemplateTokenFuzzyModal(
      fakeApp,
      tokens,
      "Insert template token",
      () => {},
    );
    expect(modal.inputEl.placeholder).toBe("Insert template token");
  });

  // ── renderSuggestion structured a11y DOM ──────────────────────────────────
  function fuzzy(item: TemplateTokenChoice): FuzzyMatch<TemplateTokenChoice> {
    return { item, match: { score: 0, matches: [] } };
  }

  it("renderSuggestion renders a title (label) line and a description line", () => {
    const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", () => {});
    const el = document.createElement("div");
    modal.renderSuggestion(fuzzy(tokens[1]), el);

    expect(el.classList.contains("exocortex-token-suggestion")).toBe(true);
    expect(
      el.querySelector(".exocortex-token-suggestion__title")?.textContent,
    ).toBe("Current Timestamp");
    expect(
      el.querySelector(".exocortex-token-suggestion__desc")?.textContent,
    ).toBe("Local date-time, no timezone (YYYY-MM-DDTHH:MM:SS)");
  });

  // ── Regression: picker selection NO-OP (Issue #3561 pattern) ──────────────
  // Obsidian closes the modal BEFORE invoking onChooseItem, so a synchronous
  // null-resolve in onClose would win and the choice would be lost (insert
  // silently never runs). Production-shape revert-verify gate: with the deferred
  // microtask resolution it resolves the chosen token; reverting to a synchronous
  // null-resolve in onClose makes it resolve null and FAIL.
  it("resolves with the chosen token when Obsidian closes BEFORE onChooseItem", async () => {
    const result = await new Promise<TemplateTokenChoice | null>((resolve) => {
      const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", resolve);
      realObsidianSelect(modal, tokens[2]);
    });
    expect(result).toEqual(tokens[2]);
  });

  it("resolves null when dismissed without a choice (Escape)", async () => {
    const result = await new Promise<TemplateTokenChoice | null>((resolve) => {
      const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", resolve);
      modal.onClose(); // Escape closes without ever calling onChooseItem
    });
    expect(result).toBeNull();
  });

  it("resolves exactly once for the close-then-choose sequence", async () => {
    const resolve = jest.fn();
    const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", resolve);
    realObsidianSelect(modal, tokens[0]);
    await Promise.resolve(); // flush the deferred (microtask) resolution
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(tokens[0]);
  });

  it("double onClose is idempotent — resolves at most once with null", async () => {
    const resolve = jest.fn();
    const modal = new TemplateTokenFuzzyModal(fakeApp, tokens, "Pick", resolve);
    modal.onClose();
    modal.onClose();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);
  });

  describe("pickTemplateToken wrapper", () => {
    it("opens the modal and resolves with the chosen token", async () => {
      // Spy on FuzzySuggestModal.prototype.open (mock no-ops) to drive a
      // selection synchronously once the modal is constructed+opened.
      const openSpy = jest
        .spyOn(TemplateTokenFuzzyModal.prototype, "open")
        .mockImplementation(function (this: TemplateTokenFuzzyModal) {
          realObsidianSelect(this, tokens[1]);
        });

      const chosen = await pickTemplateToken(fakeApp, tokens, "Insert template token");
      expect(chosen).toEqual(tokens[1]);
      expect(openSpy).toHaveBeenCalledTimes(1);
      openSpy.mockRestore();
    });

    it("resolves null when the picker is opened and dismissed", async () => {
      const openSpy = jest
        .spyOn(TemplateTokenFuzzyModal.prototype, "open")
        .mockImplementation(function (this: TemplateTokenFuzzyModal) {
          this.onClose(); // Escape
        });

      const chosen = await pickTemplateToken(fakeApp, tokens, "Insert template token");
      expect(chosen).toBeNull();
      openSpy.mockRestore();
    });
  });
});
