import {
  ChangelogModal,
  shouldShowChangelog,
} from "../../../../src/presentation/modals/ChangelogModal";

jest.mock("obsidian", () => ({
  Modal: class MockModal {
    app: unknown;
    contentEl: {
      empty: jest.Mock;
      addClass: jest.Mock;
      createEl: jest.Mock;
      createDiv: jest.Mock;
    };

    constructor(app: unknown) {
      this.app = app;
      const el = {
        empty: jest.fn(),
        addClass: jest.fn(),
        createEl: jest.fn().mockReturnValue({
          addEventListener: jest.fn(),
          createEl: jest.fn(),
          createDiv: jest.fn(),
          createSpan: jest.fn(),
          addClass: jest.fn(),
          setAttribute: jest.fn(),
          appendChild: jest.fn(),
        }),
        createDiv: jest.fn().mockReturnValue({
          addEventListener: jest.fn(),
          createEl: jest.fn().mockReturnValue({
            addEventListener: jest.fn(),
            createEl: jest.fn(),
          }),
        }),
      };
      this.contentEl = el;
    }

    open = jest.fn();
    close = jest.fn();
  },
  App: jest.fn(),
}));

describe("shouldShowChangelog (RFC-024 Phase 0)", () => {
  it("returns true when lastShownChangelogVersion is undefined (fresh install)", () => {
    expect(shouldShowChangelog(undefined, "15.99.0")).toBe(true);
  });

  it("returns true when lastShownChangelogVersion differs from current", () => {
    expect(shouldShowChangelog("15.98.5", "15.99.0")).toBe(true);
  });

  it("returns false when lastShownChangelogVersion equals current", () => {
    expect(shouldShowChangelog("15.99.0", "15.99.0")).toBe(false);
  });

  it("returns true when lastShown is older patch", () => {
    expect(shouldShowChangelog("15.99.0", "15.99.1")).toBe(true);
  });

  it("returns true on empty-string lastShown", () => {
    expect(shouldShowChangelog("", "15.99.0")).toBe(true);
  });
});

describe("ChangelogModal (RFC-024 Phase 0)", () => {
  const mockApp = {} as any;

  it("constructs with app, version, and dismiss callback", () => {
    const onDismiss = jest.fn();
    const modal = new ChangelogModal(mockApp, "15.99.0", onDismiss);
    expect(modal).toBeDefined();
  });

  it("renders header, body, and dismiss button on open", () => {
    const onDismiss = jest.fn();
    const modal = new ChangelogModal(mockApp, "15.99.0", onDismiss);
    modal.onOpen();
    expect(modal.contentEl.empty).toHaveBeenCalled();
    expect(modal.contentEl.addClass).toHaveBeenCalledWith(
      "exocortex-changelog-modal",
    );
    expect(modal.contentEl.createEl).toHaveBeenCalledWith(
      "h2",
      expect.objectContaining({ text: expect.any(String) }),
    );
  });

  it("invokes onDismiss callback and closes when user dismisses", () => {
    const onDismiss = jest.fn();
    const modal = new ChangelogModal(mockApp, "15.99.0", onDismiss);
    modal.dismiss();
    expect(onDismiss).toHaveBeenCalledWith("15.99.0");
    expect(modal.close).toHaveBeenCalled();
  });

  it("empties content on close", () => {
    const modal = new ChangelogModal(mockApp, "15.99.0", jest.fn());
    modal.onClose();
    expect(modal.contentEl.empty).toHaveBeenCalled();
  });
});
