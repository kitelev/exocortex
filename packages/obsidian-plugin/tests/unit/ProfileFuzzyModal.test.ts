import { ProfileFuzzyModal } from "../../src/infrastructure/adapters/ProfileFuzzyModal";
import type { ProfileChoice } from "../../src/infrastructure/adapters/ProfileCommands";

const fakeApp = {} as any;

const profiles: ProfileChoice[] = [
  { uid: "uid-personal", label: "Personal" },
  { uid: "uid-work", label: "Work", isActive: true },
  { uid: "uid-reading", label: "Reading" },
];

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

  it("onChooseItem resolves with the chosen profile exactly once", () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onChooseItem(profiles[1]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(profiles[1]);

    // Subsequent close should NOT double-resolve.
    modal.onClose();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("onClose without a prior choice resolves with null", () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onClose();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(null);
  });

  it("double onClose is idempotent — resolves at most once", () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onClose();
    modal.onClose();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("double onChooseItem is idempotent — resolves at most once", () => {
    const resolve = jest.fn();
    const modal = new ProfileFuzzyModal(fakeApp, profiles, "Pick", resolve);
    modal.onChooseItem(profiles[0]);
    modal.onChooseItem(profiles[1]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(profiles[0]);
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
