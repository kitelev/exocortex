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

    /**
     * Issue #2139: Block references in Reading View display UUID instead of resolved label
     *
     * BUG SCENARIO: When Obsidian renders a block reference link like [[uuid#^blockid]],
     * it may render the textContent as just "uuid" (basename only) instead of "uuid#^blockid".
     * In this case, the link should still be patched to show "Asset Label > ^blockid".
     *
     * The bug was that matchesBasename would be true, causing the code to think
     * this is a bare wikilink without block reference, and thus not appending "> ^blockid".
     */
    it("should patch block reference when Obsidian renders textContent as basename only (Issue #2139)", () => {
      // Obsidian renders [[uuid#^blockid]] with textContent = "uuid" (basename only!)
      const uuid = "84e75603-0103-4594-8499-09dc404800b0";
      mockLink.setAttribute("data-href", `${uuid}#^jgp9nz`);
      mockLink.textContent = uuid; // Obsidian renders just the basename

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: uuid });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // MUST display as "My Document Label (ems__Task) > ^jgp9nz"
      // NOT as "My Document Label (ems__Task)" (missing block ref)
      // NOT as "84e75603-0103-4594-8499-09dc404800b0 > ^jgp9nz" (unresolved UUID)
      expect(mockLink.textContent).toBe("My Document Label (ems__Task) > ^jgp9nz");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should patch heading reference when Obsidian renders textContent as basename only (Issue #2139)", () => {
      // Obsidian renders [[uuid#Heading]] with textContent = "uuid" (basename only!)
      const uuid = "84e75603-0103-4594-8499-09dc404800b0";
      mockLink.setAttribute("data-href", `${uuid}#Section Title`);
      mockLink.textContent = uuid; // Obsidian renders just the basename

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: uuid });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document Label",
          exo__Instance_class: "lit__Article",
        },
      });

      patch.enable();

      // MUST display as "My Document Label (lit__Article) > Section Title"
      expect(mockLink.textContent).toBe("My Document Label (lit__Article) > Section Title");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    /**
     * Issue #2139: Additional edge case where Obsidian might render block ref without caret symbol
     * e.g., "uuid#blockid" instead of "uuid#^blockid"
     */
    it("should patch block reference when Obsidian renders without caret symbol (Issue #2139 edge case)", () => {
      // Obsidian renders [[uuid#^blockid]] with textContent = "uuid#blockid" (missing ^)
      const uuid = "84e75603-0103-4594-8499-09dc404800b0";
      mockLink.setAttribute("data-href", `${uuid}#^jgp9nz`);
      mockLink.textContent = `${uuid}#jgp9nz`; // Missing caret - potential Obsidian variation

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: uuid });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Should still resolve to label with block ref
      expect(mockLink.textContent).toBe("My Document Label (ems__Task) > ^jgp9nz");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });

    /**
     * Issue #2139: Edge case where Obsidian might render block ref as "basename > ^blockid"
     * (the already-partially-patched format but with basename instead of label)
     */
    it("should patch when Obsidian renders basename with separator format (Issue #2139 edge case)", () => {
      // Obsidian renders [[uuid#^blockid]] with textContent = "uuid > ^blockid"
      const uuid = "84e75603-0103-4594-8499-09dc404800b0";
      mockLink.setAttribute("data-href", `${uuid}#^jgp9nz`);
      mockLink.textContent = `${uuid} > ^jgp9nz`; // Obsidian auto-formats with " > "

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: uuid });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "My Document Label",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Should resolve to label with block ref (replacing basename with label)
      expect(mockLink.textContent).toBe("My Document Label (ems__Task) > ^jgp9nz");
      expect(mockLink.getAttribute("data-body-patched")).toBe("true");
    });
  });

  describe("wikilinks inside markdown tables (Issue #2153)", () => {
    it("should resolve wikilink label inside table cell", () => {
      // Create a table with a wikilink inside a cell - this is how Obsidian renders markdown tables
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      const tableLink = document.createElement("a");
      tableLink.className = "internal-link";
      tableLink.setAttribute("data-href", "7db5eeff-718a-49b0-8d2b-39b084a356e3");
      tableLink.textContent = "7db5eeff-718a-49b0-8d2b-39b084a356e3";

      td.appendChild(tableLink);
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      mockPreviewView.appendChild(table);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "7db5eeff-718a-49b0-8d2b-39b084a356e3" });
      Object.defineProperty(mockFile, "stat", {
        value: { ctime: Date.now() },
      });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "ems__Project",
          exo__Instance_class: "ems__Project",
        },
      });

      patch.enable();

      // Table link should be patched to show the label, not the UUID
      expect(tableLink.textContent).toBe("ems__Project (ems__Project)");
      expect(tableLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should resolve multiple wikilinks in different table cells", () => {
      // Create a table with multiple cells containing wikilinks
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");

      // First row: header
      const headerRow = document.createElement("tr");
      const th1 = document.createElement("th");
      th1.textContent = "Field";
      const th2 = document.createElement("th");
      th2.textContent = "Value";
      headerRow.appendChild(th1);
      headerRow.appendChild(th2);
      tbody.appendChild(headerRow);

      // Second row: Project link
      const row1 = document.createElement("tr");
      const td1_1 = document.createElement("td");
      td1_1.textContent = "Project";
      const td1_2 = document.createElement("td");
      const projectLink = document.createElement("a");
      projectLink.className = "internal-link";
      projectLink.setAttribute("data-href", "7db5eeff-718a-49b0-8d2b-39b084a356e3");
      projectLink.textContent = "7db5eeff-718a-49b0-8d2b-39b084a356e3";
      td1_2.appendChild(projectLink);
      row1.appendChild(td1_1);
      row1.appendChild(td1_2);
      tbody.appendChild(row1);

      // Third row: Status link
      const row2 = document.createElement("tr");
      const td2_1 = document.createElement("td");
      td2_1.textContent = "Status";
      const td2_2 = document.createElement("td");
      const statusLink = document.createElement("a");
      statusLink.className = "internal-link";
      statusLink.setAttribute("data-href", "027e78f4-6e16-4b36-b8fb-5510507d5745");
      statusLink.textContent = "027e78f4-6e16-4b36-b8fb-5510507d5745";
      td2_2.appendChild(statusLink);
      row2.appendChild(td2_1);
      row2.appendChild(td2_2);
      tbody.appendChild(row2);

      table.appendChild(tbody);
      mockPreviewView.appendChild(table);

      // Mock two different files with different labels
      const projectFile = new TFile();
      Object.defineProperty(projectFile, "extension", { value: "md" });
      Object.defineProperty(projectFile, "basename", { value: "7db5eeff-718a-49b0-8d2b-39b084a356e3" });
      Object.defineProperty(projectFile, "stat", { value: { ctime: Date.now() } });

      const statusFile = new TFile();
      Object.defineProperty(statusFile, "extension", { value: "md" });
      Object.defineProperty(statusFile, "basename", { value: "027e78f4-6e16-4b36-b8fb-5510507d5745" });
      Object.defineProperty(statusFile, "stat", { value: { ctime: Date.now() } });

      // Mock different file lookups for each link
      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) => {
        if (path.includes("7db5eeff")) return projectFile;
        if (path.includes("027e78f4")) return statusFile;
        return null;
      });

      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file === projectFile) {
          return {
            frontmatter: {
              exo__Asset_label: "ems__Project",
              exo__Instance_class: "ems__Project",
            },
          };
        }
        if (file === statusFile) {
          return {
            frontmatter: {
              exo__Asset_label: "ems__EffortStatusDoing",
              exo__Instance_class: "ems__EffortStatus",
            },
          };
        }
        return null;
      });

      patch.enable();

      // Both table links should be patched
      expect(projectLink.textContent).toBe("ems__Project (ems__Project)");
      expect(projectLink.getAttribute("data-body-patched")).toBe("true");

      expect(statusLink.textContent).toBe("ems__EffortStatusDoing (ems__EffortStatus)");
      expect(statusLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should handle mixed content: paragraph links and table links together", () => {
      // Create a paragraph with a link
      const paragraph = document.createElement("p");
      const paraLink = document.createElement("a");
      paraLink.className = "internal-link";
      paraLink.setAttribute("data-href", "para-file-uuid");
      paraLink.textContent = "para-file-uuid";
      paragraph.appendChild(paraLink);
      mockPreviewView.appendChild(paragraph);

      // Create a table with a link
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const tableLink = document.createElement("a");
      tableLink.className = "internal-link";
      tableLink.setAttribute("data-href", "table-file-uuid");
      tableLink.textContent = "table-file-uuid";
      td.appendChild(tableLink);
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      mockPreviewView.appendChild(table);

      // Mock files
      const paraFile = new TFile();
      Object.defineProperty(paraFile, "extension", { value: "md" });
      Object.defineProperty(paraFile, "basename", { value: "para-file-uuid" });
      Object.defineProperty(paraFile, "stat", { value: { ctime: Date.now() } });

      const tableFile = new TFile();
      Object.defineProperty(tableFile, "extension", { value: "md" });
      Object.defineProperty(tableFile, "basename", { value: "table-file-uuid" });
      Object.defineProperty(tableFile, "stat", { value: { ctime: Date.now() } });

      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((path: string) => {
        if (path.includes("para-file")) return paraFile;
        if (path.includes("table-file")) return tableFile;
        return null;
      });

      mockApp.metadataCache.getFileCache.mockImplementation((file: TFile) => {
        if (file === paraFile) {
          return {
            frontmatter: {
              exo__Asset_label: "Paragraph Label",
              exo__Instance_class: "ems__Task",
            },
          };
        }
        if (file === tableFile) {
          return {
            frontmatter: {
              exo__Asset_label: "Table Label",
              exo__Instance_class: "ems__Project",
            },
          };
        }
        return null;
      });

      patch.enable();

      // Both should be patched
      expect(paraLink.textContent).toBe("Paragraph Label (ems__Task)");
      expect(tableLink.textContent).toBe("Table Label (ems__Project)");
    });

    it("should exclude table links inside metadata-container", () => {
      // Create a metadata container with a table
      const metadataContainer = document.createElement("div");
      metadataContainer.className = "metadata-container";

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const metaTableLink = document.createElement("a");
      metaTableLink.className = "internal-link";
      metaTableLink.setAttribute("data-href", "meta-uuid");
      metaTableLink.textContent = "meta-uuid";
      td.appendChild(metaTableLink);
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      metadataContainer.appendChild(table);
      mockPreviewView.appendChild(metadataContainer);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "meta-uuid" });
      Object.defineProperty(mockFile, "stat", { value: { ctime: Date.now() } });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Should Not Appear",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Table link inside metadata-container should NOT be patched
      expect(metaTableLink.textContent).toBe("meta-uuid");
      expect(metaTableLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should exclude table links inside exocortex components", () => {
      // Create an exocortex component with a table
      const exoComponent = document.createElement("div");
      exoComponent.className = "exocortex-auto-layout";

      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const exoTableLink = document.createElement("a");
      exoTableLink.className = "internal-link";
      exoTableLink.setAttribute("data-href", "exo-uuid");
      exoTableLink.textContent = "exo-uuid";
      td.appendChild(exoTableLink);
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      exoComponent.appendChild(table);
      mockPreviewView.appendChild(exoComponent);

      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "exo-uuid" });
      Object.defineProperty(mockFile, "stat", { value: { ctime: Date.now() } });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Should Not Appear",
          exo__Instance_class: "ems__Task",
        },
      });

      patch.enable();

      // Table link inside exocortex component should NOT be patched
      expect(exoTableLink.textContent).toBe("exo-uuid");
      expect(exoTableLink.getAttribute("data-body-patched")).toBeNull();
    });

    it("should resolve dynamically added table links via MutationObserver", async () => {
      // Setup mock before enabling patch
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "dynamic-uuid" });
      Object.defineProperty(mockFile, "stat", { value: { ctime: Date.now() } });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Dynamic Label",
          exo__Instance_class: "ems__Task",
        },
      });

      // Enable patch first (MutationObserver starts listening)
      patch.enable();

      // Then dynamically add a table with wikilink - simulating Obsidian's rendering
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const dynamicLink = document.createElement("a");
      dynamicLink.className = "internal-link";
      dynamicLink.setAttribute("data-href", "dynamic-uuid");
      dynamicLink.textContent = "dynamic-uuid";

      td.appendChild(dynamicLink);
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);

      // Append to the preview view - this triggers MutationObserver
      mockPreviewView.appendChild(table);

      // Wait for MutationObserver to process
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Link should be patched by MutationObserver
      expect(dynamicLink.textContent).toBe("Dynamic Label (ems__Task)");
      expect(dynamicLink.getAttribute("data-body-patched")).toBe("true");
    });

    it("should handle table cells added in separate mutations", async () => {
      // Setup mock
      const mockFile = new TFile();
      Object.defineProperty(mockFile, "extension", { value: "md" });
      Object.defineProperty(mockFile, "basename", { value: "cell-uuid" });
      Object.defineProperty(mockFile, "stat", { value: { ctime: Date.now() } });

      mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockApp.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          exo__Asset_label: "Cell Label",
          exo__Instance_class: "ems__Project",
        },
      });

      patch.enable();

      // First, add the table structure to preview view
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      tbody.appendChild(tr);
      table.appendChild(tbody);
      mockPreviewView.appendChild(table);

      // Wait for initial mutation
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then add the cell content in a separate mutation (simulates Obsidian behavior)
      const cellLink = document.createElement("a");
      cellLink.className = "internal-link";
      cellLink.setAttribute("data-href", "cell-uuid");
      cellLink.textContent = "cell-uuid";

      td.appendChild(cellLink);
      tr.appendChild(td);

      // Wait for second mutation
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Link should still be patched
      expect(cellLink.textContent).toBe("Cell Label (ems__Project)");
      expect(cellLink.getAttribute("data-body-patched")).toBe("true");
    });
  });
});
