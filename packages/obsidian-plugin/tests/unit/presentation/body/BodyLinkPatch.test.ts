import { BodyLinkPatch } from "../../../../src/presentation/body/BodyLinkPatch";
import { TFile } from "obsidian";

describe("BodyLinkPatch", () => {
  let patch: BodyLinkPatch;
  let mockPlugin: any;
  let mockApp: any;
  let mockWorkspaceLeaf: any;
  let mockContainer: HTMLElement;
  let mockPreviewView: HTMLElement;
  let mockLink: HTMLElement;

  beforeEach(() => {
    // Create mock DOM elements
    mockPreviewView = document.createElement("div");
    mockPreviewView.className = "markdown-preview-view";

    mockLink = document.createElement("a");
    mockLink.className = "internal-link";
    mockLink.setAttribute("data-href", "test-file");
    mockLink.textContent = "test-file";
    mockPreviewView.appendChild(mockLink);

    mockContainer = document.createElement("div");
    mockContainer.appendChild(mockPreviewView);
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

    patch = new BodyLinkPatch(mockPlugin);
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
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");

      patch.disable();

      // After disable, should restore original text
      expect(mockLink.textContent).toBe("test-file");
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
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
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
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

    it("should fallback to prototype label when asset has no label", () => {
      const mockFile = new TFile();
      const mockPrototypeFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "test-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });
      Object.defineProperty(mockPrototypeFile, "extension", { value: "md" });

      mockApp.metadataCache.getFirstLinkpathDest
        .mockReturnValueOnce(mockFile) // First call: resolve link path
        .mockReturnValueOnce(mockPrototypeFile); // Second call: resolve prototype

      mockApp.metadataCache.getFileCache
        .mockReturnValueOnce({
          frontmatter: {
            exo__Asset_prototype: "[[prototype-path]]",
            exo__Instance_class: "ems__Task",
          },
        })
        .mockReturnValueOnce({
          frontmatter: {
            exo__Asset_label: "Prototype Label",
          },
        });

      patch.enable();

      expect(mockLink.textContent).toBe("Prototype Label (ems__Task)");
    });

    it("should not patch links without data-href", () => {
      // Remove data-href
      mockLink.removeAttribute("data-href");
      mockLink.textContent = "plain-link";

      patch.enable();

      // Should remain unchanged
      expect(mockLink.textContent).toBe("plain-link");
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should not patch links when file not found", () => {
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

      patch.enable();

      // Should remain unchanged
      expect(mockLink.textContent).toBe("test-file");
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
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

    it("should exclude links inside metadata-container", () => {
      // Create a metadata container with a link
      const metadataContainer = document.createElement("div");
      metadataContainer.className = "metadata-container";
      const metadataLink = document.createElement("a");
      metadataLink.className = "internal-link";
      metadataLink.setAttribute("data-href", "metadata-file");
      metadataLink.textContent = "metadata-link";
      metadataContainer.appendChild(metadataLink);
      mockPreviewView.appendChild(metadataContainer);

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

      // Main link should be patched
      expect(mockLink.textContent).toBe("Test Label (ems__Task)");

      // Metadata link should NOT be patched
      expect(metadataLink.textContent).toBe("metadata-link");
      expect(metadataLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should exclude links inside exocortex components", () => {
      // Create an exocortex component with a link
      const exocortexComponent = document.createElement("div");
      exocortexComponent.className = "exocortex-auto-layout";
      const exoLink = document.createElement("a");
      exoLink.className = "internal-link";
      exoLink.setAttribute("data-href", "exo-file");
      exoLink.textContent = "exo-link";
      exocortexComponent.appendChild(exoLink);
      mockPreviewView.appendChild(exocortexComponent);

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

      // Main link should be patched
      expect(mockLink.textContent).toBe("Test Label (ems__Task)");

      // Exocortex link should NOT be patched
      expect(exoLink.textContent).toBe("exo-link");
      expect(exoLink.getAttribute("data-body-patched")).toBeNull();
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

  describe("user-defined alias preservation (issue #2097)", () => {
    it("should preserve user-defined alias when link has custom text (not matching file basename)", () => {
      // User wrote [[uuid|My Custom Name]] - Obsidian renders this with textContent="My Custom Name"
      mockLink.textContent = "My Custom Name";
      mockLink.setAttribute("data-href", "f2dccb6a-802d-48d3-8e8a-2c4264197692");

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "f2dccb6a-802d-48d3-8e8a-2c4264197692" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Auto Label from Metadata",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // User alias should be preserved - NOT overwritten with resolved label
      expect(mockLink.textContent).toBe("My Custom Name");
      // Should NOT be marked as patched since we preserved the alias
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should resolve label for bare wikilinks (text matches file basename)", () => {
      // User wrote [[uuid]] - Obsidian renders this with textContent="uuid"
      mockLink.textContent = "f2dccb6a-802d-48d3-8e8a-2c4264197692";
      mockLink.setAttribute("data-href", "f2dccb6a-802d-48d3-8e8a-2c4264197692");

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "f2dccb6a-802d-48d3-8e8a-2c4264197692" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Task Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Bare wikilink - label should be resolved
      expect(mockLink.textContent).toBe("Task Label (ems__Task)");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should preserve alias even when it differs only by whitespace from basename", () => {
      // Edge case: user alias might have trimmed whitespace
      mockLink.textContent = "Custom Alias";
      mockLink.setAttribute("data-href", "custom-alias");

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "custom-alias" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Some Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // "Custom Alias" differs from "custom-alias" basename - preserve user alias
      expect(mockLink.textContent).toBe("Custom Alias");
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
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

  describe("block reference support (Issue #2133)", () => {
    it("should handle block references in data-href and append block id to display", () => {
      // User wrote [[uuid#^blockid]] - Obsidian renders this with data-href containing block ref
      mockLink.setAttribute("data-href", "5764fb33-9cb1-43a4-a9be-43c534922798#^jgp9nz");
      mockLink.textContent = "5764fb33-9cb1-43a4-a9be-43c534922798#^jgp9nz";

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "5764fb33-9cb1-43a4-a9be-43c534922798" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Should resolve to "My Document (ems__Task) > ^jgp9nz"
      expect(mockLink.textContent).toBe("My Document (ems__Task) > ^jgp9nz");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should handle heading references in data-href and append heading to display", () => {
      // User wrote [[uuid#Header]] - Obsidian renders with data-href containing heading ref
      mockLink.setAttribute("data-href", "doc-uuid#Section Title");
      mockLink.textContent = "doc-uuid#Section Title";

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "doc-uuid" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document",
          exo__Instance_class: "lit__Article",
        },
      });

      patch.enable();

      // Should resolve to "My Document (lit__Article) > Section Title"
      expect(mockLink.textContent).toBe("My Document (lit__Article) > Section Title");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should preserve user alias for block reference links", () => {
      // User wrote [[uuid#^blockid|My Custom Link]] - alias takes priority
      mockLink.setAttribute("data-href", "doc-uuid#^abc123");
      mockLink.textContent = "My Custom Link"; // User-provided alias

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "doc-uuid" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Document Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // User alias should be preserved - NOT overwritten
      expect(mockLink.textContent).toBe("My Custom Link");
      expect(mockLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should resolve block reference file path correctly (stripping block ref)", () => {
      mockLink.setAttribute("data-href", "my-file#^block123");
      mockLink.textContent = "my-file#^block123";

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "my-file" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      // The getFirstLinkpathDest should be called with just the file path (no block ref)
      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Test Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Should have tried to resolve with just the file path
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        "my-file",
        ""
      );
    });
  });
});
