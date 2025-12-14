import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

jest.unstable_mockModule("exocortex", () => ({
  INotificationService: class {},
}));

const { NodeNotificationService } = await import("../../../src/infrastructure/di/NodeNotificationService.js");

describe("NodeNotificationService", () => {
  let service: InstanceType<typeof NodeNotificationService>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    service = new NodeNotificationService();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("info()", () => {
    it("should log info message with icon", () => {
      service.info("Information message");
      expect(consoleLogSpy).toHaveBeenCalledWith("ℹ Information message");
    });

    it("should ignore duration parameter", () => {
      service.info("Message", 5000);
      expect(consoleLogSpy).toHaveBeenCalledWith("ℹ Message");
    });
  });

  describe("success()", () => {
    it("should log success message with icon", () => {
      service.success("Operation successful");
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Operation successful");
    });

    it("should ignore duration parameter", () => {
      service.success("Message", 3000);
      expect(consoleLogSpy).toHaveBeenCalledWith("✓ Message");
    });
  });

  describe("error()", () => {
    it("should log error message with icon", () => {
      service.error("Something went wrong");
      expect(consoleErrorSpy).toHaveBeenCalledWith("✗ Something went wrong");
    });

    it("should ignore duration parameter", () => {
      service.error("Message", 10000);
      expect(consoleErrorSpy).toHaveBeenCalledWith("✗ Message");
    });
  });

  describe("warn()", () => {
    it("should log warning message with icon", () => {
      service.warn("Warning: something may be wrong");
      expect(consoleWarnSpy).toHaveBeenCalledWith("⚠ Warning: something may be wrong");
    });

    it("should ignore duration parameter", () => {
      service.warn("Message", 2000);
      expect(consoleWarnSpy).toHaveBeenCalledWith("⚠ Message");
    });
  });

  // Note: confirm() requires readline interface which is harder to test
  // and would require more complex mocking
});
