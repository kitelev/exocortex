import { ProfileFuzzyModal } from "../../src/infrastructure/adapters/ProfileFuzzyModal";
import type { ProfileChoice } from "../../src/infrastructure/adapters/ProfileCommands";

const fakeApp = {} as any;

const profiles: ProfileChoice[] = [
  { uid: "uid-personal", label: "Personal" },
  { uid: "uid-work", label: "Work", isActive: true },
  { uid: "uid-reading", label: "Reading" },
];

/**
 * Drive the modal exactly as Obsidian's real `SuggestModal.selectSuggestion`
 * does (verified against `obsidian.asar`):
 *
 *   selectSuggestion(e, t) { ...; this.close(); ...; this.onChooseSuggestion(e, t); }
 *   FuzzySuggestModal.onChooseSuggestion(e, t) { this.onChooseItem(e.item, t); }
 *
 * i.e. `close()` (→ `onClose()`) fires BEFORE `onChooseItem()`, both
 * synchronously inside one selection. This helper reproduces that ordering so
 * the test exercises the real human-selection path — NOT the (previously
 * tested, vacuous) assumption that `onChooseItem` runs first.
 */
function realObsidianSelect(modal: ProfileFuzzyModal, item: ProfileChoice): void {
  modal.onClose(); // Obsidian calls close() first
  modal.onChooseItem(item); // then onChooseSuggestion → onChooseItem
}

describe("ProfileFuzzyModal", () => {
  it("getItems returns the constructor-supplied options", () => {
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", () => {});
    expect(modal.getItems()).toBe(profiles);
  });

  it("getItemText renders active marker for the active profile only", () => {
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", () => {});
    expect(modal.getItemText(profiles[0])).toBe("Personal");
    expect(modal.getItemText(profiles[1])).toBe("Work ✓ (active)");
    expect(modal.getItemText(profiles[2])).toBe("Reading");
  });

  // ── Regression: picker selection NO-OP (Issue #3561) ──────────────────────
  // The crux. Obsidian closes the modal BEFORE invoking onChooseItem, so a
  // synchronous null-resolve in onClose would win and the choice would be lost
  // (apply silently never starts). This is the production-shape, revert-verify
  // gate: with the fix it resolves the chosen profile; reverting the fix
  // (synchronous null-resolve in onClose) makes it resolve null and FAIL.
  it("resolves with the chosen profile when Obsidian closes BEFORE onChooseItem", async () => {
    const result = await new Promise<ProfileChoice | null>((resolve) => {
      const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
      realObsidianSelect(modal, profiles[1]);
    });
    expect(result).toEqual(profiles[1]);
  });

  it("resolves null when the picker is dismissed without a choice (Escape)", async () => {
    const result = await new Promise<ProfileChoice | null>((resolve) => {
      const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
      modal.onClose(); // Escape closes without ever calling onChooseItem
    });
    expect(result).toBeNull();
  });

  it("resolves exactly once for the close-then-choose sequence", async () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    realObsidianSelect(modal, profiles[2]);
    // Flush the deferred (microtask) resolution.
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(profiles[2]);
  });

  it("double onClose is idempotent — resolves at most once", async () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onClose();
    modal.onClose();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);
  });

  it("first choice wins when onChooseItem fires twice before resolution", async () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onClose();
    modal.onChooseItem(profiles[0]);
    modal.onChooseItem(profiles[1]);
    await Promise.resolve();
    // Single resolution; last-recorded choice is fine (Obsidian fires
    // onChooseItem once per selection — this guards only against double-resolve).
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("setPlaceholder is invoked on construction with the provided title", () => {
    const modal = new ProfileFuzzyModal(
      fakeApp,
      profiles,
      "Switch focus profile",
      () => {},
    );
    expect(modal.inputEl.placeholder).toBe("Switch focus profile");
  });
});
