import { Logger } from "../../src/adapters/logging/Logger";
import { LoggerFactory } from "../../src/adapters/logging/LoggerFactory";
import type { ILogger } from "../../src/adapters/logging/ILogger";
import { ErrorCodes } from "../../src/adapters/logging/ErrorCodes";

describe("Logger", () => {
  let logger: Logger;
  let consoleDebugSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on console methods
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation();
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

    // Reset development mode for each test
    Logger.setDevelopmentMode(false);

    logger = new Logger("TestContext");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with context", () => {
      const contextLogger = new Logger("MyContext");
      contextLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[MyContext] test");
    });

    it("should handle empty context", () => {
      const emptyLogger = new Logger("");
      emptyLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[] test");
    });

    it("should handle special characters in context", () => {
      const specialLogger = new Logger("Context-123:Test");
      specialLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[Context-123:Test] test");
    });
  });

  describe("debug", () => {
    it("should log debug message with context", () => {
      logger.debug("Debug message");
      expect(consoleDebugSpy).toHaveBeenCalledWith("[TestContext] Debug message");
    });

    it("should log debug message with additional arguments", () => {
      const obj = { key: "value" };
      const num = 123;
      logger.debug("Debug with args", obj, num);
      expect(consoleDebugSpy).toHaveBeenCalledWith("[TestContext] Debug with args", obj, num);
    });

    it("should handle multiple arguments", () => {
      logger.debug("Multiple", "arg1", "arg2", "arg3", 4, true, { test: 1 });
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        "[TestContext] Multiple",
        "arg1",
        "arg2",
        "arg3",
        4,
        true,
        { test: 1 }
      );
    });

    it("should handle undefined arguments", () => {
      logger.debug("With undefined", undefined);
      expect(consoleDebugSpy).toHaveBeenCalledWith("[TestContext] With undefined", undefined);
    });

    it("should handle null arguments", () => {
      logger.debug("With null", null);
      expect(consoleDebugSpy).toHaveBeenCalledWith("[TestContext] With null", null);
    });
  });

  describe("info", () => {
    it("should log info message with context", () => {
      logger.info("Info message");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Info message");
    });

    it("should log info message with additional arguments", () => {
      const array = [1, 2, 3];
      logger.info("Info with array", array);
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Info with array", array);
    });

    it("should handle empty string message", () => {
      logger.info("");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] ");
    });

    it("should handle multiline messages", () => {
      logger.info("Line 1\nLine 2\nLine 3");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Line 1\nLine 2\nLine 3");
    });
  });

  describe("warn", () => {
    it("should log warning message with context", () => {
      logger.warn("Warning message");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[TestContext] Warning message");
    });

    it("should log warning with additional arguments", () => {
      const fn = () => "function";
      logger.warn("Warning with function", fn);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[TestContext] Warning with function", fn);
    });

    it("should handle Symbol arguments", () => {
      const sym = Symbol("test");
      logger.warn("With symbol", sym);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[TestContext] With symbol", sym);
    });
  });

  describe("error", () => {
    describe("production mode (default)", () => {
      beforeEach(() => {
        Logger.setDevelopmentMode(false);
      });

      it("should log error message with context (no stack trace)", () => {
        logger.error("Error message");
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error message");
      });

      it("should log error with Error object (message only, no stack)", () => {
        const error = new Error("Test error");
        error.stack = "Error: Test error\n    at test.js:1:1";
        logger.error("Error occurred", error);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error occurred");
        expect(consoleErrorSpy).toHaveBeenCalledWith("  Details: Test error");
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Stack trace"));
      });

      it("should not log stack trace in production", () => {
        const error = new Error("Stack error");
        error.stack = "Error: Stack error\n    at test.js:1:1";
        logger.error("Error occurred", error);
        const allCalls = consoleErrorSpy.mock.calls.flat().join(" ");
        // Should not contain the actual stack trace lines
        expect(allCalls).not.toContain("at test.js:1:1");
        // Should not contain the prefix "Stack trace:" that indicates full stack logging
        expect(allCalls).not.toContain("Stack trace:");
      });

      it("should log error with error code", () => {
        const error = new Error("Query failed");
        logger.error("Query execution failed", {
          errorCode: ErrorCodes.SPARQL_QUERY_EXECUTION,
          error,
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[TestContext] [SPARQL_001] Query execution failed"
        );
      });

      it("should show user-friendly message for known error code", () => {
        logger.error("Internal error", {
          errorCode: ErrorCodes.SPARQL_QUERY_EXECUTION,
        });
        // Should use the user-friendly message from ErrorMessages
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[TestContext] [SPARQL_001] Query execution failed"
        );
      });
    });

    describe("development mode", () => {
      beforeEach(() => {
        Logger.setDevelopmentMode(true);
      });

      it("should log error message with full context", () => {
        logger.error("Error message");
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error message");
      });

      it("should log error with Error object and stack trace", () => {
        const error = new Error("Test error");
        error.stack = "Error: Test error\n    at test.js:1:1";
        logger.error("Error occurred", error);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error occurred");
        // Error message and stack trace are now combined in single call
        // to avoid orphaned expressions after esbuild minification
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("  Error: Test error")
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Stack trace")
        );
      });

      it("should log error with error code and full context", () => {
        const error = new Error("Query failed");
        error.stack = "Error: Query failed\n    at query.ts:42:10";
        logger.error("Query execution failed", {
          errorCode: ErrorCodes.SPARQL_QUERY_EXECUTION,
          error,
          context: { queryPreview: "SELECT * WHERE" },
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[TestContext] [SPARQL_001] Query execution failed"
        );
        // Error message and stack trace are now combined in single call
        // to avoid orphaned expressions after esbuild minification
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("  Error: Query failed")
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Stack trace")
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "  Context:",
          { queryPreview: "SELECT * WHERE" }
        );
      });

      it("should handle non-Error objects", () => {
        const customError = { code: "ERR_001", message: "Custom error" };
        logger.error("Custom error occurred", customError);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Custom error occurred");
        expect(consoleErrorSpy).toHaveBeenCalledWith("  Error:", customError);
      });
    });

    describe("setDevelopmentMode", () => {
      it("should toggle development mode", () => {
        Logger.setDevelopmentMode(true);
        expect(Logger.isDevelopmentMode()).toBe(true);

        Logger.setDevelopmentMode(false);
        expect(Logger.isDevelopmentMode()).toBe(false);
      });

      it("should affect logging behavior immediately", () => {
        const error = new Error("Test");
        error.stack = "Error: Test\n    at file.ts:1:1";

        Logger.setDevelopmentMode(false);
        logger.error("Msg", error);
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Stack trace"));

        consoleErrorSpy.mockClear();

        Logger.setDevelopmentMode(true);
        logger.error("Msg", error);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Stack trace"));
      });
    });

    describe("backward compatibility", () => {
      it("should handle null as error", () => {
        logger.error("Null error", null);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Null error");
      });

      it("should handle undefined as error", () => {
        logger.error("Undefined error", undefined);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Undefined error");
      });

      it("should handle error without second argument", () => {
        logger.error("Just a message");
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Just a message");
      });

      it("should handle string as error in development mode", () => {
        Logger.setDevelopmentMode(true);
        logger.error("Error message", "String error");
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error message");
        expect(consoleErrorSpy).toHaveBeenCalledWith("  Error:", "String error");
      });

      it("should handle number as error in development mode", () => {
        Logger.setDevelopmentMode(true);
        logger.error("Error code", 404);
        expect(consoleErrorSpy).toHaveBeenCalledWith("[TestContext] Error code");
        expect(consoleErrorSpy).toHaveBeenCalledWith("  Error:", 404);
      });
    });
  });

  describe("message formatting", () => {
    it("should preserve message formatting characters", () => {
      logger.info("Message with %s and %d", "string", 123);
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Message with %s and %d", "string", 123);
    });

    it("should handle messages with special characters", () => {
      logger.info("Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?");
    });

    it("should handle unicode characters", () => {
      logger.info("Unicode: 😀 🎉 ñ å ß");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[TestContext] Unicode: 😀 🎉 ñ å ß");
    });

    it("should handle very long messages", () => {
      const longMessage = "x".repeat(1000);
      logger.info(longMessage);
      expect(consoleInfoSpy).toHaveBeenCalledWith(`[TestContext] ${longMessage}`);
    });
  });

  describe("context variations", () => {
    it("should handle numeric context", () => {
      const numLogger = new Logger("123");
      numLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[123] test");
    });

    it("should handle context with spaces", () => {
      const spacedLogger = new Logger("My Context");
      spacedLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[My Context] test");
    });

    it("should handle very long context", () => {
      const longContext = "VeryLongContextName".repeat(10);
      const longLogger = new Logger(longContext);
      longLogger.info("test");
      expect(consoleInfoSpy).toHaveBeenCalledWith(`[${longContext}] test`);
    });
  });
});

describe("LoggerFactory", () => {
  let consoleInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("create", () => {
    it("should create a Logger instance", () => {
      const logger = LoggerFactory.create("TestFactory");
      expect(logger).toBeDefined();
      expect(logger).toHaveProperty("debug");
      expect(logger).toHaveProperty("info");
      expect(logger).toHaveProperty("warn");
      expect(logger).toHaveProperty("error");
    });

    it("should create Logger with correct context", () => {
      const logger = LoggerFactory.create("FactoryContext");
      logger.info("Factory test");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[FactoryContext] Factory test");
    });

    it("should implement ILogger interface", () => {
      const logger: ILogger = LoggerFactory.create("Interface");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });

    it("should create multiple independent loggers", () => {
      const logger1 = LoggerFactory.create("Context1");
      const logger2 = LoggerFactory.create("Context2");

      logger1.info("Message 1");
      logger2.info("Message 2");

      expect(consoleInfoSpy).toHaveBeenCalledWith("[Context1] Message 1");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[Context2] Message 2");
    });

    it("should handle empty context", () => {
      const logger = LoggerFactory.create("");
      logger.info("Empty context");
      expect(consoleInfoSpy).toHaveBeenCalledWith("[] Empty context");
    });

    it("should create new instance each time", () => {
      const logger1 = LoggerFactory.create("Same");
      const logger2 = LoggerFactory.create("Same");
      expect(logger1).not.toBe(logger2);
    });
  });
});