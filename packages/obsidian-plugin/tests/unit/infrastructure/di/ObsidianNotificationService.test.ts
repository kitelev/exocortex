import {
  ObsidianNotificationService,
  setDefaultNotificationActivityRecorder,
  type NotificationActivityRecorder,
} from "../../../../src/infrastructure/di/ObsidianNotificationService";
import { Notice } from "obsidian";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

describe("ObsidianNotificationService", () => {
  let service: ObsidianNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "debug").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    // Reset the module-level default recorder so its presence/absence is
    // controlled per-test, never leaked across tests.
    setDefaultNotificationActivityRecorder(undefined);
    service = new ObsidianNotificationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setDefaultNotificationActivityRecorder(undefined);
  });

  describe("info", () => {
    it("should create Notice with message", () => {
      service.info("Information message");

      expect(Notice).toHaveBeenCalledWith("Information message", 4000);
    });

    it("should log to console", () => {
      service.info("Information message");

      expect(console.debug).toHaveBeenCalledWith("[Exocortex] info:", "Information message");
    });

    it("should use custom duration when provided", () => {
      service.info("Information message", 6000);

      expect(Notice).toHaveBeenCalledWith("Information message", 6000);
    });

    it("should use default duration when duration is undefined", () => {
      service.info("Information message", undefined);

      expect(Notice).toHaveBeenCalledWith("Information message", 4000);
    });
  });

  describe("success", () => {
    it("should create Notice with checkmark prefix", () => {
      service.success("Operation completed");

      expect(Notice).toHaveBeenCalledWith("✓ Operation completed", 4000);
    });

    it("should log to console", () => {
      service.success("Operation completed");

      expect(console.debug).toHaveBeenCalledWith("[Exocortex] success:", "Operation completed");
    });

    it("should use custom duration when provided", () => {
      service.success("Operation completed", 3000);

      expect(Notice).toHaveBeenCalledWith("✓ Operation completed", 3000);
    });
  });

  describe("error", () => {
    it("should create Notice with X prefix", () => {
      service.error("An error occurred");

      expect(Notice).toHaveBeenCalledWith("✗ An error occurred", 4000);
    });

    it("should log to console.error", () => {
      service.error("An error occurred");

      expect(console.error).toHaveBeenCalledWith("[Exocortex] error:", "An error occurred");
    });

    it("should use custom duration when provided", () => {
      service.error("An error occurred", 8000);

      expect(Notice).toHaveBeenCalledWith("✗ An error occurred", 8000);
    });
  });

  describe("warn", () => {
    it("should create Notice with warning prefix", () => {
      service.warn("Warning message");

      expect(Notice).toHaveBeenCalledWith("⚠ Warning message", 4000);
    });

    it("should log to console.warn", () => {
      service.warn("Warning message");

      expect(console.warn).toHaveBeenCalledWith("[Exocortex] warn:", "Warning message");
    });

    it("should use custom duration when provided", () => {
      service.warn("Warning message", 5000);

      expect(Notice).toHaveBeenCalledWith("⚠ Warning message", 5000);
    });
  });

  // #3540 follow-up — every toast must fan into the activity log so the
  // «Open activity log» modal is complete (Bug 1: not all Notices were logged).
  describe("activity-log recording", () => {
    it("records info as level 'info' with the plain message (no toast prefix)", () => {
      const records: Array<{ level: string; message: string }> = [];
      const recorder: NotificationActivityRecorder = (r) => records.push(r);
      const svc = new ObsidianNotificationService({ recordActivity: recorder });

      svc.info("hello");

      expect(records).toEqual([{ level: "info", message: "hello" }]);
      // The toast still shows — recording is additive.
      expect(Notice).toHaveBeenCalledWith("hello", 4000);
    });

    it("records success as level 'info' with the plain message (✓ stays toast-only)", () => {
      const records: Array<{ level: string; message: string }> = [];
      const svc = new ObsidianNotificationService({
        recordActivity: (r) => records.push(r),
      });

      svc.success("done");

      expect(records).toEqual([{ level: "info", message: "done" }]);
      expect(Notice).toHaveBeenCalledWith("✓ done", 4000);
    });

    it("records warn as level 'warn' with the plain message (⚠ stays toast-only)", () => {
      const records: Array<{ level: string; message: string }> = [];
      const svc = new ObsidianNotificationService({
        recordActivity: (r) => records.push(r),
      });

      svc.warn("careful");

      expect(records).toEqual([{ level: "warn", message: "careful" }]);
      expect(Notice).toHaveBeenCalledWith("⚠ careful", 4000);
    });

    it("records error as level 'error' with the plain message (✗ stays toast-only)", () => {
      const records: Array<{ level: string; message: string }> = [];
      const svc = new ObsidianNotificationService({
        recordActivity: (r) => records.push(r),
      });

      svc.error("boom");

      expect(records).toEqual([{ level: "error", message: "boom" }]);
      expect(Notice).toHaveBeenCalledWith("✗ boom", 4000);
    });

    it("falls back to the module-level default recorder when none is injected", () => {
      const records: Array<{ level: string; message: string }> = [];
      setDefaultNotificationActivityRecorder((r) => records.push(r));
      // No explicit recorder → must use the default (covers command-flow
      // instances built without the plugin's activityLog).
      const svc = new ObsidianNotificationService();

      svc.info("from default");

      expect(records).toEqual([{ level: "info", message: "from default" }]);
    });

    it("prefers the explicit recorder over the module default", () => {
      const explicit: Array<{ message: string }> = [];
      const fallback: Array<{ message: string }> = [];
      setDefaultNotificationActivityRecorder((r) => fallback.push(r));
      const svc = new ObsidianNotificationService({
        recordActivity: (r) => explicit.push(r),
      });

      svc.info("routed");

      expect(explicit).toEqual([{ level: "info", message: "routed" }]);
      expect(fallback).toEqual([]);
    });

    it("records nothing when neither explicit nor default recorder is set", () => {
      const svc = new ObsidianNotificationService();
      // Must not throw, must still toast.
      expect(() => svc.info("silent log")).not.toThrow();
      expect(Notice).toHaveBeenCalledWith("silent log", 4000);
    });

    it("still shows the Notice when the recorder throws (recording is isolated)", () => {
      const svc = new ObsidianNotificationService({
        recordActivity: () => {
          throw new Error("sink exploded");
        },
      });

      expect(() => svc.error("must still toast")).not.toThrow();
      expect(Notice).toHaveBeenCalledWith("✗ must still toast", 4000);
    });
  });

  describe("confirm", () => {
    let originalCreateElement: typeof document.createElement;
    let mockModal: HTMLDivElement;
    let mockModalContent: HTMLDivElement;
    let mockTitleEl: HTMLDivElement;
    let mockMessageEl: HTMLDivElement;
    let mockButtonContainer: HTMLDivElement;
    let mockConfirmButton: HTMLButtonElement;
    let mockCancelButton: HTMLButtonElement;
    let appendedElements: HTMLElement[];

    beforeEach(() => {
      appendedElements = [];
      originalCreateElement = document.createElement;

      mockConfirmButton = document.createElement("button");
      mockCancelButton = document.createElement("button");
      mockButtonContainer = document.createElement("div");
      mockTitleEl = document.createElement("div");
      mockMessageEl = document.createElement("div");
      mockModalContent = document.createElement("div");
      mockModal = document.createElement("div");

      // Track appendChild calls
      jest.spyOn(document.body, "appendChild").mockImplementation((el) => {
        appendedElements.push(el as HTMLElement);
        return el;
      });

      // Mock remove method
      mockModal.remove = jest.fn();

      let createIndex = 0;
      const elementsInOrder = [
        mockModal,
        mockModalContent,
        mockTitleEl,
        mockMessageEl,
        mockButtonContainer,
        mockConfirmButton,
        mockCancelButton,
      ];

      jest.spyOn(document, "createElement").mockImplementation((tag) => {
        const element = elementsInOrder[createIndex++] || document.createElement(tag);
        return element;
      });
    });

    afterEach(() => {
      (document.body.appendChild as jest.Mock).mockRestore();
      (document.createElement as jest.Mock).mockRestore();
    });

    it("should create modal with correct structure", async () => {
      // Start the confirm but don't await immediately
      const confirmPromise = service.confirm("Confirm Action", "Are you sure?");

      // Simulate clicking confirm
      mockConfirmButton.onclick?.(new MouseEvent("click"));

      await confirmPromise;

      expect(mockModal.className).toBe("modal-container mod-confirmation");
      expect(mockModalContent.className).toBe("modal");
      expect(mockTitleEl.className).toBe("modal-title");
      expect(mockMessageEl.className).toBe("modal-content");
      expect(mockButtonContainer.className).toBe("modal-button-container");
      expect(mockConfirmButton.className).toBe("mod-cta");
      expect(mockConfirmButton.textContent).toBe("Confirm");
      expect(mockCancelButton.textContent).toBe("Cancel");
    });

    it("should resolve true when confirm button is clicked", async () => {
      const confirmPromise = service.confirm("Title", "Message");

      // Simulate clicking confirm
      mockConfirmButton.onclick?.(new MouseEvent("click"));

      const result = await confirmPromise;

      expect(result).toBe(true);
      expect(mockModal.remove).toHaveBeenCalled();
    });

    it("should resolve false when cancel button is clicked", async () => {
      const confirmPromise = service.confirm("Title", "Message");

      // Simulate clicking cancel
      mockCancelButton.onclick?.(new MouseEvent("click"));

      const result = await confirmPromise;

      expect(result).toBe(false);
      expect(mockModal.remove).toHaveBeenCalled();
    });

    it("should set title and message content correctly", async () => {
      const confirmPromise = service.confirm("My Title", "My Message");

      mockConfirmButton.onclick?.(new MouseEvent("click"));
      await confirmPromise;

      expect(mockTitleEl.textContent).toBe("My Title");
      expect(mockMessageEl.textContent).toBe("My Message");
    });

    it("should append modal to document body", async () => {
      const confirmPromise = service.confirm("Title", "Message");

      mockConfirmButton.onclick?.(new MouseEvent("click"));
      await confirmPromise;

      expect(document.body.appendChild).toHaveBeenCalled();
    });
  });
});
