import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

jest.unstable_mockModule("exocortex", () => ({
  ILogger: class {},
}));

const { NodeLogger } = await import("../../../src/infrastructure/di/NodeLogger.js");

describe("NodeLogger", () => {
  let logger: InstanceType<typeof NodeLogger>;
  let consoleDebugSpy: jest.SpiedFunction<typeof console.debug>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    logger = new NodeLogger();

    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should use default app name", () => {
      const defaultLogger = new NodeLogger();
      defaultLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[exocortex-cli]", "test", "");
    });

    it("should accept custom app name", () => {
      const customLogger = new NodeLogger("my-app");
      customLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[my-app]", "test", "");
    });
  });

  describe("debug()", () => {
    it("should log debug message", () => {
      logger.debug("debug message");
      expect(consoleDebugSpy).toHaveBeenCalledWith("[exocortex-cli]", "debug message", "");
    });

    it("should log debug message with context", () => {
      logger.debug("debug message", { key: "value" });
      expect(consoleDebugSpy).toHaveBeenCalledWith("[exocortex-cli]", "debug message", { key: "value" });
    });
  });

  describe("info()", () => {
    it("should log info message", () => {
      logger.info("info message");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[exocortex-cli]", "info message", "");
    });

    it("should log info message with context", () => {
      logger.info("info message", { data: 123 });
      expect(consoleInfoSpy).toHaveBeenCalledWith("[exocortex-cli]", "info message", { data: 123 });
    });
  });

  describe("warn()", () => {
    it("should log warn message", () => {
      logger.warn("warning message");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[exocortex-cli]", "warning message", "");
    });

    it("should log warn message with context", () => {
      logger.warn("warning message", { level: "high" });
      expect(consoleWarnSpy).toHaveBeenCalledWith("[exocortex-cli]", "warning message", { level: "high" });
    });
  });

  describe("error()", () => {
    it("should log error message", () => {
      logger.error("error message");
      expect(consoleErrorSpy).toHaveBeenCalledWith("[exocortex-cli]", "error message", "", "");
    });

    it("should log error message with error object", () => {
      const error = new Error("test error");
      logger.error("error message", error);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[exocortex-cli]", "error message", error, "");
    });

    it("should log error message with context", () => {
      logger.error("error message", undefined, { detail: "info" });
      expect(consoleErrorSpy).toHaveBeenCalledWith("[exocortex-cli]", "error message", "", { detail: "info" });
    });

    it("should log error message with error and context", () => {
      const error = new Error("test error");
      logger.error("error message", error, { detail: "info" });
      expect(consoleErrorSpy).toHaveBeenCalledWith("[exocortex-cli]", "error message", error, { detail: "info" });
    });

    it("should log stack trace when error has stack", () => {
      const error = new Error("test error");
      error.stack = "Error: test error\n    at Test.run (test.js:1:1)";
      logger.error("error message", error);
      expect(consoleErrorSpy).toHaveBeenCalledWith(error.stack);
    });
  });
});
