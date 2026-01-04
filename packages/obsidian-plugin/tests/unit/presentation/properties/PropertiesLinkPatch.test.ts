import { PropertiesLinkPatch } from "../../../../src/presentation/properties/PropertiesLinkPatch";
import { TFile } from "obsidian";

describe("PropertiesLinkPatch", () => {
  let patch: PropertiesLinkPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockContainer: HTMLElement;
  let mockMetadataContainer: HTMLElement;
  let mockLink: HTMLElement;

  beforeEach(() => {
    // Create mock DOM elements
    mockMetadataContainer = document.createElement("div");
    mockMetadataContainer.className = "metadata-container";

    mockLink = document.createElement("a");
    mockLink.className = "internal-link";
    mockLink.setAttribute("data-href", "test-file");
    mockLink.textContent = "test-file";
    mockMetadataContainer.appendChild(mockLink);

    mockContainer = document.createElement("div");
    mockContainer.appendChild(mockMetadataContainer);
    // Add to document body so querySelector can find elements
    document.body.appendChild(mockContainer);

    mockWorkspaceLeaf = {
      view: {
        containerEl: mockContainer,
      },
    };

    mockApp = {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([mockWorkspaceLeaf]),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
      vault: {
        getAbstractFileByPath: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: jest.fn(),
        on: jest.fn().mockReturnValue({ id: "test" }),
      },
    };

    mockPlugin = {
      app: mockApp,
      registerEvent: jest.fn(),
      settings: {
        displayNameSettings: {
          defaultTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
          classTemplates: {},
          statusEmojis: {},
        },
      },
    };

    patch = new PropertiesLinkPatch(mockPlugin);
  });

  afterEach(() => {
    patch.cleanup();
    jest.clearAllMocks();
    // Clean up DOM
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

    it("should register metadata change event on enable", () => {
      patch.enable();

      expect(mockApp.metadataCache.on).toHaveBeenCalledWith(
        "changed",
        expect.any(Function)
      );
    });

    it("should not double-enable", () => {
      patch.enable();
      patch.enable();

      // Should only register events once (3 calls: layout-change + active-leaf-change + metadata)
      expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe("disable", () => {
    it("should restore original text on disable", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Verify patch is working
      expect(mockLink.textContent).toBe("Test Label (ems__Task)");

      patch.disable();

      // After disable, should restore original text
      expect(mockLink.textContent).toBe("test-file");
    });

    it("should not error when disabling without enabling", () => {
      expect(() => patch.disable()).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("should disable patch on cleanup", () => {
      patch.enable();
      patch.cleanup();

      // Calling enable again should work (indicates cleanup was successful)
      expect(() => patch.enable()).not.toThrow();
    });
  });

  describe("link patching", () => {
    it("should replace link text with display name", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      expect(mockLink.textContent).toBe("Test Label (ems__Task)");
      expect(mockLink.getAttribute("data-original-text")).toBe("test-file");
    });

    it("should add tooltip with original filename", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      expect(mockLink.getAttribute("aria-label")).toBe(
        "Test Label (ems__Task)\n(test-file.md)"
      );
    });

    it("should preserve child elements when patching links", () => {
      // Create a link with a child element (delete button)
      const deleteButton = document.createElement("span");
      deleteButton.className = "multi-select-pill-remove-button";
      deleteButton.textContent = "×";
      mockLink.appendChild(deleteButton);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Text should be updated
      expect(mockLink.textContent).toContain("Test Label (ems__Task)");
      // Delete button should still exist
      const preservedButton = mockLink.querySelector(
        ".multi-select-pill-remove-button"
      );
      expect(preservedButton).not.toBeNull();
      expect(preservedButton?.textContent).toBe("×");
    });

    it("should preserve child elements when restoring original text", () => {
      // Create a link with a child element (delete button)
      const deleteButton = document.createElement("span");
      deleteButton.className = "multi-select-pill-remove-button";
      deleteButton.textContent = "×";
      mockLink.appendChild(deleteButton);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Disable to restore original text
      patch.disable();

      // Original text should be restored
      expect(mockLink.textContent).toContain("test-file");
      // Delete button should still exist
      const preservedButton = mockLink.querySelector(
        ".multi-select-pill-remove-button"
      );
      expect(preservedButton).not.toBeNull();
      expect(preservedButton?.textContent).toBe("×");
    });

    it("should not patch links without data-href", () => {
      // Remove data-href
      mockLink.removeAttribute("data-href");
      mockLink.textContent = "plain-link";

      patch.enable();

      // Should remain unchanged
      expect(mockLink.textContent).toBe("plain-link");
    });

    it("should not patch links when file not found", () => {
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

      patch.enable();

      // Should remain unchanged
      expect(mockLink.textContent).toBe("test-file");
    });

    it("should not patch links when file has no frontmatter", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue(null);

      patch.enable();

      // Should remain unchanged
      expect(mockLink.textContent).toBe("test-file");
    });
  });

  describe("text wrapper span handling", () => {
    it("should not duplicate text when link contains a text wrapper span (issue #1349)", () => {
      // Simulate Obsidian wrapping link text in a span (e.g., <span class="link-text">UUID</span>)
      mockLink.innerHTML = "";
      const textSpan = document.createElement("span");
      textSpan.className = "link-text";
      textSpan.textContent = "f2dccb6a-802d-48d3-8e8a-2c4264197692";
      mockLink.appendChild(textSpan);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "f2dccb6a-802d-48d3-8e8a-2c4264197692" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Заполнить таблетницу",
          exo__Instance_class: "TaskPrototype",
        },
      });

      patch.enable();

      // Bug #1349: Previously this would result in
      // "Заполнить таблетницу (TaskPrototype) f2dccb6a-802d-48d3-8e8a-2c4264197692"
      // because the span was preserved and re-appended
      expect(mockLink.textContent).toBe("Заполнить таблетницу (TaskPrototype)");

      // The text wrapper span should NOT be preserved (only interactive elements like delete buttons)
      const preservedSpan = mockLink.querySelector(".link-text");
      expect(preservedSpan).toBeNull();
    });

    it("should not preserve generic span elements as text wrappers", () => {
      // Create a link with both a text wrapper span and a delete button
      mockLink.innerHTML = "";
      const textSpan = document.createElement("span");
      textSpan.className = "some-text-wrapper";
      textSpan.textContent = "uuid-text";
      mockLink.appendChild(textSpan);

      const deleteButton = document.createElement("span");
      deleteButton.className = "multi-select-pill-remove-button";
      deleteButton.textContent = "×";
      mockLink.appendChild(deleteButton);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Text should be updated (no duplication from text wrapper)
      expect(mockLink.textContent).toBe("Test Label (ems__Task)×");

      // Text wrapper should NOT be preserved
      const preservedTextSpan = mockLink.querySelector(".some-text-wrapper");
      expect(preservedTextSpan).toBeNull();

      // Delete button SHOULD be preserved
      const preservedButton = mockLink.querySelector(".multi-select-pill-remove-button");
      expect(preservedButton).not.toBeNull();
      expect(preservedButton?.textContent).toBe("×");
    });
  });

  describe("multi-select pill handling", () => {
    it("should patch links inside multi-select-pill-content", () => {
      // Create multi-select pill structure
      const pill = document.createElement("div");
      pill.className = "multi-select-pill";

      const pillContent = document.createElement("span");
      pillContent.className = "multi-select-pill-content";

      const pillLink = document.createElement("a");
      pillLink.className = "internal-link";
      pillLink.setAttribute("data-href", "linked-file");
      pillLink.textContent = "linked-file";

      pillContent.appendChild(pillLink);
      pill.appendChild(pillContent);

      // Remove old link and add pill structure
      mockMetadataContainer.innerHTML = "";
      mockMetadataContainer.appendChild(pill);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "linked-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Linked Label",
          exo__Instance_class: "ems__Project",
        },
      });

      patch.enable();

      expect(pillLink.textContent).toBe("Linked Label (ems__Project)");
    });

    it("should preserve delete button in multi-select pill", () => {
      // Create multi-select pill structure with delete button
      const pill = document.createElement("div");
      pill.className = "multi-select-pill";

      const pillContent = document.createElement("span");
      pillContent.className = "multi-select-pill-content";

      const pillLink = document.createElement("a");
      pillLink.className = "internal-link";
      pillLink.setAttribute("data-href", "linked-file");
      pillLink.textContent = "linked-file";

      // Add delete button INSIDE the link (Obsidian's structure)
      const deleteBtn = document.createElement("span");
      deleteBtn.className = "multi-select-pill-remove-button";
      deleteBtn.setAttribute("aria-label", "Remove");
      deleteBtn.textContent = "×";
      pillLink.appendChild(deleteBtn);

      pillContent.appendChild(pillLink);
      pill.appendChild(pillContent);

      // Remove old link and add pill structure
      mockMetadataContainer.innerHTML = "";
      mockMetadataContainer.appendChild(pill);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "linked-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Linked Label",
          exo__Instance_class: "ems__Project",
        },
      });

      patch.enable();

      // Text should be updated
      expect(pillLink.textContent).toContain("Linked Label (ems__Project)");

      // Delete button should still exist and be functional
      const preservedDeleteBtn = pillLink.querySelector(
        ".multi-select-pill-remove-button"
      );
      expect(preservedDeleteBtn).not.toBeNull();
      expect(preservedDeleteBtn?.getAttribute("aria-label")).toBe("Remove");
      expect(preservedDeleteBtn?.textContent).toBe("×");
    });
  });

  describe("file resolution", () => {
    it("should resolve file with .md extension fallback", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce(null) // First call without .md
        .mockReturnValueOnce(mockFile); // Second call with .md

      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "test-file",
        ""
      );
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "test-file.md",
        ""
      );
      expect(mockLink.textContent).toBe("Test Label (ems__Task)");
    });

    it("should handle wikilink brackets in path", () => {
      mockLink.setAttribute("data-href", "[[test-file]]");

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "test-file",
        ""
      );
    });
  });

  describe("metadata change handling", () => {
    it("should update link text when metadata changes", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "path", { value: "test-file.md" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);

      // Initial label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Initial Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      expect(mockLink.textContent).toBe("Initial Label (ems__Task)");

      // Update to new label
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Updated Label",
          exo__Instance_class: "ems__Task",
        },
      });

      // Simulate metadata change by getting the callback and calling it
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      if (metadataCallback) {
        metadataCallback(mockFile);
      }

      expect(mockLink.textContent).toBe("Updated Label (ems__Task)");
    });

    it("should ignore metadata changes for non-markdown files", () => {
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "png" });
      Object.defineProperty(mockFile, "path", { value: "image.png" });

      patch.enable();

      // Simulate metadata change for non-markdown file
      const metadataCallback = mockApp.metadataCache.on.mock.calls.find(
        (call: [string, Function]) => call[0] === "changed"
      )?.[1];

      // Should not throw
      expect(() => {
        if (metadataCallback) {
          metadataCallback(mockFile);
        }
      }).not.toThrow();
    });
  });
});
