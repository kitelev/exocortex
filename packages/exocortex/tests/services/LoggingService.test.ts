import { LoggingService } from "../../src/services/LoggingService";

describe("LoggingService", () => {
  let consoleDebugSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    LoggingService.setVerbose(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("setVerbose", () => {
    it("should enable verbose mode", () => {
      LoggingService.setVerbose(true);
      LoggingService.debug("test message");
      expect(consoleDebugSpy).toHaveBeenCalledWith("[Exocortex] test message", "");
    });

    it("should disable verbose mode", () => {
      LoggingService.setVerbose(false);
      LoggingService.debug("test message");
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });
  });

  describe("debug", () => {
    it("should not log when verbose is false", () => {
      LoggingService.setVerbose(false);
      LoggingService.debug("debug message");
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it("should log when verbose is true", () => {
      LoggingService.setVerbose(true);
      LoggingService.debug("debug message");
      expect(consoleDebugSpy).toHaveBeenCalledWith("[Exocortex] debug message", "");
    });

    it("should log with context when provided", () => {
      LoggingService.setVerbose(true);
      const context = { key: "value" };
      LoggingService.debug("debug message", context);
      expect(consoleDebugSpy).toHaveBeenCalledWith("[Exocortex] debug message", context);
    });

    it("should handle undefined context", () => {
      LoggingService.setVerbose(true);
      LoggingService.debug("debug message", undefined);
      expect(consoleDebugSpy).toHaveBeenCalledWith("[Exocortex] debug message", "");
    });
  });

  describe("info", () => {
    it("should always log info messages", () => {
      LoggingService.info("info message");
      expect(consoleLogSpy).toHaveBeenCalledWith("[Exocortex] info message", "");
    });

    it("should log with context when provided", () => {
      const context = { data: "value" };
      LoggingService.info("info message", context);
      expect(consoleLogSpy).toHaveBeenCalledWith("[Exocortex] info message", context);
    });

    it("should handle undefined context", () => {
      LoggingService.info("info message", undefined);
      expect(consoleLogSpy).toHaveBeenCalledWith("[Exocortex] info message", "");
    });
  });

  describe("warn", () => {
    it("should log warning messages", () => {
      LoggingService.warn("warning message");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[Exocortex] warning message", "");
    });

    it("should log with context when provided", () => {
      const context = { warning: "details" };
      LoggingService.warn("warning message", context);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[Exocortex] warning message", context);
    });

    it("should handle undefined context", () => {
      LoggingService.warn("warning message", undefined);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[Exocortex] warning message", "");
    });
  });

  describe("error", () => {
    it("should log error messages without Error object", () => {
      LoggingService.error("error message");
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message", "");
    });

    it("should log error messages with Error object", () => {
      const error = new Error("test error");
      LoggingService.error("error message", error);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message", error);
    });

    it("should log error stack when available", () => {
      const error = new Error("test error");
      LoggingService.error("error message", error);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, "[Exocortex ERROR] error message", error);
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, error.stack);
    });

    it("should handle undefined error", () => {
      LoggingService.error("error message", undefined);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message", "");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle error without stack", () => {
      const errorWithoutStack = { message: "error" } as Error;
      LoggingService.error("error message", errorWithoutStack);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message", errorWithoutStack);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
