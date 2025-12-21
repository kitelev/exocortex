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
    // Note: The default isDevelopment is false (production mode).
    // In production mode, stack traces are hidden and details are included in message.
    // In development mode, stack is included in the message with full error object.

    it("should log error messages without Error object in production mode", () => {
      LoggingService.error("error message");
      // No error details when no error provided
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message");
    });

    it("should log error messages with Error object in production mode", () => {
      const error = new Error("test error");
      LoggingService.error("error message", error);
      // In production mode, error details are included in message (no stack)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Exocortex ERROR] error message\n  Details: test error"
      );
    });

    it("should log error stack when in development mode", () => {
      LoggingService.setDevelopmentMode(true);
      const error = new Error("test error");
      LoggingService.error("error message", error);
      // In dev mode, stack is included in single console.error call
      // to avoid orphaned expressions after esbuild minification
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Exocortex ERROR] error message"),
        error
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Stack trace"),
        error
      );
      LoggingService.setDevelopmentMode(false);
    });

    it("should handle undefined error", () => {
      LoggingService.error("error message", undefined);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[Exocortex ERROR] error message");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle error without stack in development mode", () => {
      LoggingService.setDevelopmentMode(true);
      const errorWithoutStack = { message: "error" } as Error;
      // Error without stack - stack info part will be empty
      LoggingService.error("error message", errorWithoutStack);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Exocortex ERROR] error message",
        errorWithoutStack
      );
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      LoggingService.setDevelopmentMode(false);
    });

    it("should handle error without stack in production mode", () => {
      const errorWithoutStack = { message: "error" } as Error;
      LoggingService.error("error message", errorWithoutStack);
      // In production, error.message is included
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Exocortex ERROR] error message\n  Details: error"
      );
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
