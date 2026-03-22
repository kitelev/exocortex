import { PropertiesUidCopyPatch } from "../../../../src/presentation/properties/PropertiesUidCopyPatch";

// Mock setIcon from obsidian
const mockSetIcon = jest.fn();
jest.mock("obsidian", () => ({
  Plugin: class {},
  Notice: jest.fn(),
  setIcon: (...args: unknown[]) => mockSetIcon(...args),
}));

describe("PropertiesUidCopyPatch", () => {
  let patch: PropertiesUidCopyPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockContainer: HTMLElement;
  let mockMetadataContainer: HTMLElement;
  let mockWorkspaceLeaf: any;

  function createUidProperty(uid: string): HTMLElement {
    const property = document.createElement("div");
    property.className = "metadata-property";
    property.setAttribute("data-property-key", "exo__Asset_uid");

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    property.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";

    const input = document.createElement("input");
    input.type = "text";
    input.value = uid;
    valueEl.appendChild(input);

    property.appendChild(valueEl);
    return property;
  }

  function createOtherProperty(key: string, value: string): HTMLElement {
    const property = document.createElement("div");
    property.className = "metadata-property";
    property.setAttribute("data-property-key", key);

    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    property.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    valueEl.appendChild(input);

    property.appendChild(valueEl);
    return property;
  }

  beforeEach(() => {
    mockSetIcon.mockClear();
    (jest.requireMock("obsidian").Notice as jest.Mock).mockClear();

    mockMetadataContainer = document.createElement("div");
    mockMetadataContainer.className = "metadata-container";

    mockContainer = document.createElement("div");
    mockContainer.appendChild(mockMetadataContainer);
    document.body.appendChild(mockContainer);

    mockWorkspaceLeaf = {
      view: { containerEl: mockContainer },
    };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockWorkspaceLeaf]),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      metadataCache: {
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
    };

    patch = new PropertiesUidCopyPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    if (mockContainer.parentNode) {
      mockContainer.parentNode.removeChild(mockContainer);
    }
  });

  describe("enable", () => {
    it("should register layout-change event on enable", () => {
      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalled();
      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "layout-change",
        expect.any(Function)
      );
    });

    it("should register active-leaf-change event on enable", () => {
      patch.enable();

      expect(mockApp.workspace.on).toHaveBeenCalledWith(
        "active-leaf-change",
        expect.any(Function)
      );
    });

    it("should not double-enable", () => {
      patch.enable();
      const callCount = mockPlugin.registerEvent.mock.calls.length;

      patch.enable();

      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(callCount);
    });
  });

  describe("disable", () => {
    it("should remove all copy buttons on disable", () => {
      const uidProp = createUidProperty("test-uid-123");
      mockMetadataContainer.appendChild(uidProp);

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();

      patch.disable();

      const buttonAfterDisable = uidProp.querySelector(".exo-uid-copy-btn");
      expect(buttonAfterDisable).toBeNull();
    });
  });

  describe("copy button injection", () => {
    it("should add copy button to exo__Asset_uid property", () => {
      const uidProp = createUidProperty("abc-123-def");
      mockMetadataContainer.appendChild(uidProp);

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
      expect(mockSetIcon).toHaveBeenCalledWith(button, "copy");
    });

    it("should NOT add copy button to other properties", () => {
      const otherProp = createOtherProperty("exo__Asset_label", "My Asset");
      mockMetadataContainer.appendChild(otherProp);

      patch.enable();

      const button = otherProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeNull();
    });

    it("should not duplicate buttons on re-patch", () => {
      const uidProp = createUidProperty("test-uid");
      mockMetadataContainer.appendChild(uidProp);

      patch.enable();

      // Simulate re-patch (layout-change)
      const layoutChangeCallback = mockApp.workspace.on.mock.calls.find(
        (call: any[]) => call[0] === "layout-change"
      )?.[1];

      if (layoutChangeCallback) {
        layoutChangeCallback();
      }

      const buttons = uidProp.querySelectorAll(".exo-uid-copy-btn");
      expect(buttons.length).toBe(1);
    });

    it("should find uid property by key text when data-property-key is absent", () => {
      const property = document.createElement("div");
      property.className = "metadata-property";

      const keyEl = document.createElement("div");
      keyEl.className = "metadata-property-key";
      const keyInput = document.createElement("input");
      keyInput.value = "exo__Asset_uid";
      keyEl.appendChild(keyInput);
      property.appendChild(keyEl);

      const valueEl = document.createElement("div");
      valueEl.className = "metadata-property-value";
      const valInput = document.createElement("input");
      valInput.type = "text";
      valInput.value = "fallback-uid-123";
      valueEl.appendChild(valInput);
      property.appendChild(valueEl);

      mockMetadataContainer.appendChild(property);

      patch.enable();

      const button = property.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
    });

    it("should find uid property by key text content (no input)", () => {
      const property = document.createElement("div");
      property.className = "metadata-property";

      const keyEl = document.createElement("div");
      keyEl.className = "metadata-property-key";
      keyEl.textContent = "exo__Asset_uid";
      property.appendChild(keyEl);

      const valueEl = document.createElement("div");
      valueEl.className = "metadata-property-value";
      valueEl.textContent = "text-uid-456";
      property.appendChild(valueEl);

      mockMetadataContainer.appendChild(property);

      patch.enable();

      const button = property.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
    });

    it("should not add button when value is empty", () => {
      const uidProp = createUidProperty("");
      mockMetadataContainer.appendChild(uidProp);

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeNull();
    });

    it("should extract uid from contenteditable element", () => {
      const property = document.createElement("div");
      property.className = "metadata-property";
      property.setAttribute("data-property-key", "exo__Asset_uid");

      const keyEl = document.createElement("div");
      keyEl.className = "metadata-property-key";
      property.appendChild(keyEl);

      const valueEl = document.createElement("div");
      valueEl.className = "metadata-property-value";

      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      editable.textContent = "uid-from-contenteditable";
      valueEl.appendChild(editable);

      property.appendChild(valueEl);
      mockMetadataContainer.appendChild(property);

      patch.enable();

      const button = property.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
    });

    it("should extract uid from plain text content", () => {
      const property = document.createElement("div");
      property.className = "metadata-property";
      property.setAttribute("data-property-key", "exo__Asset_uid");

      const keyEl = document.createElement("div");
      keyEl.className = "metadata-property-key";
      property.appendChild(keyEl);

      const valueEl = document.createElement("div");
      valueEl.className = "metadata-property-value";
      valueEl.textContent = "plain-text-uid";

      property.appendChild(valueEl);
      mockMetadataContainer.appendChild(property);

      patch.enable();

      const button = property.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
    });
  });

  describe("copy functionality", () => {
    it("should copy uid to clipboard on click", async () => {
      const testUid = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
      const uidProp = createUidProperty(testUid);
      mockMetadataContainer.appendChild(uidProp);

      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn") as HTMLElement;
      expect(button).toBeTruthy();

      button.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testUid);
    });

    it("should show success notice on copy", async () => {
      const uidProp = createUidProperty("test-uid");
      mockMetadataContainer.appendChild(uidProp);

      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn") as HTMLElement;
      button.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const { Notice } = jest.requireMock("obsidian");
      expect(Notice).toHaveBeenCalledWith("Uid copied");
    });

    it("should swap icon to check on success", async () => {
      const uidProp = createUidProperty("test-uid");
      mockMetadataContainer.appendChild(uidProp);

      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn") as HTMLElement;
      button.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSetIcon).toHaveBeenCalledWith(button, "check");
    });

    it("should show error notice on clipboard failure", async () => {
      const uidProp = createUidProperty("test-uid");
      mockMetadataContainer.appendChild(uidProp);

      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockRejectedValue(new Error("denied")),
        },
      });

      patch.enable();

      const button = uidProp.querySelector(".exo-uid-copy-btn") as HTMLElement;
      button.click();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const { Notice } = jest.requireMock("obsidian");
      expect(Notice).toHaveBeenCalledWith("Failed to copy uid");
    });
  });

  describe("cleanup", () => {
    it("should remove observer and buttons on cleanup", () => {
      const uidProp = createUidProperty("test-uid");
      mockMetadataContainer.appendChild(uidProp);

      patch.enable();
      expect(uidProp.querySelector(".exo-uid-copy-btn")).toBeTruthy();

      patch.cleanup();
      expect(uidProp.querySelector(".exo-uid-copy-btn")).toBeNull();
    });
  });

  describe("MutationObserver", () => {
    it("should add button when uid property is dynamically added", async () => {
      patch.enable();

      const uidProp = createUidProperty("dynamic-uid");
      mockMetadataContainer.appendChild(uidProp);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const button = uidProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeTruthy();
    });

    it("should not add button when non-uid property is dynamically added", async () => {
      patch.enable();

      const otherProp = createOtherProperty("exo__Asset_label", "Label");
      mockMetadataContainer.appendChild(otherProp);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const button = otherProp.querySelector(".exo-uid-copy-btn");
      expect(button).toBeNull();
    });
  });
});
