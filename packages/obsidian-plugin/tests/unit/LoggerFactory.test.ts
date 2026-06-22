import { LoggerFactory } from "../../src/adapters/logging/LoggerFactory";
import { Logger } from "../../src/adapters/logging/Logger";
import type { ILogger } from "../../src/adapters/logging/ILogger";

describe("LoggerFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to production mode (default)
    Logger.setDevelopmentMode(false);
  });

  describe("create", () => {
    it("should create a Logger instance", () => {
      const logger = LoggerFactory.create("TestContext");

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should create logger with correct context", () => {
      const logger = LoggerFactory.create("MyService");

      // Test that the logger has the expected interface
      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it("should create multiple independent loggers", () => {
      const logger1 = LoggerFactory.create("Service1");
      const logger2 = LoggerFactory.create("Service2");
      const logger3 = LoggerFactory.create("Service3");

      expect(logger1).not.toBe(logger2);
      expect(logger2).not.toBe(logger3);
      expect(logger1).not.toBe(logger3);
    });

    it("should create new instance each time", () => {
      const context = "SameContext";
      const logger1 = LoggerFactory.create(context);
      const logger2 = LoggerFactory.create(context);

      // Even with same context, should be different instances
      expect(logger1).not.toBe(logger2);
    });

    it("should handle empty context", () => {
      const logger = LoggerFactory.create("");

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should handle special characters in context", () => {
      const specialContexts = [
        "Context:With:Colons",
        "Context[With]Brackets",
        "Context.With.Dots",
        "Context/With/Slashes",
        "Context\\With\\Backslashes",
        "Context@With#Special$Chars%^&*()",
        "Context With Spaces",
        "Context\nWith\nNewlines",
        "Context\tWith\tTabs",
      ];

      specialContexts.forEach(context => {
        const logger = LoggerFactory.create(context);
        expect(logger).toBeDefined();
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should handle very long context names", () => {
      const longContext = "Context".repeat(1000);
      const logger = LoggerFactory.create(longContext);

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should handle unicode in context", () => {
      const unicodeContexts = [
        "日本語コンテキスト",
        "Русский контекст",
        "العربية السياق",
        "中文上下文",
        "🚀 Emoji Context 🎯",
        "Ñoño Çontext",
        "Κοντέξτ Ελληνικά",
        "हिंदी संदर्भ",
      ];

      unicodeContexts.forEach(context => {
        const logger = LoggerFactory.create(context);
        expect(logger).toBeDefined();
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should handle numeric-like contexts", () => {
      const numericContexts = [
        "123",
        "0",
        "-1",
        "3.14159",
        "1e10",
        "0x1234",
        "NaN",
        "Infinity",
      ];

      numericContexts.forEach(context => {
        const logger = LoggerFactory.create(context);
        expect(logger).toBeDefined();
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should work with logger functionality", () => {
      // Mock console to verify logger works
      const originalConsole = {
        debug: console.debug,
        info: console.info,
        warn: console.warn,
        error: console.error,
      };

      console.debug = jest.fn();
      console.info = jest.fn();
      console.warn = jest.fn();
      console.error = jest.fn();

      const logger = LoggerFactory.create("FunctionalTest");

      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warning message");
      logger.error("Error message", new Error("Test error"));

      expect(console.debug).toHaveBeenCalledWith("[FunctionalTest] Debug message");
      expect(console.info).toHaveBeenCalledWith("[FunctionalTest] Info message");
      expect(console.warn).toHaveBeenCalledWith("[FunctionalTest] Warning message");
      // In production mode (default), error logs message first, then details
      expect(console.error).toHaveBeenCalledWith("[FunctionalTest] Error message");
      expect(console.error).toHaveBeenCalledWith("  Details: Test error");

      // Restore console
      Object.assign(console, originalConsole);
    });

    it("should be usable in different contexts", () => {
      // Service context
      const serviceLogger = LoggerFactory.create("UserService");
      expect(serviceLogger).toBeInstanceOf(Logger);

      // Component context
      const componentLogger = LoggerFactory.create("ButtonComponent");
      expect(componentLogger).toBeInstanceOf(Logger);

      // Repository context
      const repoLogger = LoggerFactory.create("UserRepository");
      expect(repoLogger).toBeInstanceOf(Logger);

      // Controller context
      const controllerLogger = LoggerFactory.create("AuthController");
      expect(controllerLogger).toBeInstanceOf(Logger);
    });

    it("should support hierarchical contexts", () => {
      const appLogger = LoggerFactory.create("App");
      const moduleLogger = LoggerFactory.create("App:Module");
      const componentLogger = LoggerFactory.create("App:Module:Component");
      const serviceLogger = LoggerFactory.create("App:Module:Component:Service");

      expect(appLogger).toBeInstanceOf(Logger);
      expect(moduleLogger).toBeInstanceOf(Logger);
      expect(componentLogger).toBeInstanceOf(Logger);
      expect(serviceLogger).toBeInstanceOf(Logger);

      // All should be different instances
      expect(appLogger).not.toBe(moduleLogger);
      expect(moduleLogger).not.toBe(componentLogger);
      expect(componentLogger).not.toBe(serviceLogger);
    });

    it("should handle context with format specifiers", () => {
      const contexts = [
        "%s %d %i",
        "%c styled",
        "%%percent%%",
        "%o object %O",
      ];

      contexts.forEach(context => {
        const logger = LoggerFactory.create(context);
        expect(logger).toBeDefined();
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should create logger for different environments", () => {
      const environments = [
        "development",
        "test",
        "staging",
        "production",
        "local",
        "ci",
      ];

      environments.forEach(env => {
        const logger = LoggerFactory.create(env);
        expect(logger).toBeDefined();
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should be thread-safe for concurrent creation", async () => {
      const promises: Promise<ILogger>[] = [];

      // Simulate concurrent logger creation
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise(resolve => {
            resolve(LoggerFactory.create(`Concurrent${i}`));
          })
        );
      }

      const loggers = await Promise.all(promises);
      expect(loggers).toHaveLength(100);
      loggers.forEach(logger => {
        expect(logger).toBeInstanceOf(Logger);
      });

      // Verify all are different instances
      for (let i = 0; i < loggers.length; i++) {
        for (let j = i + 1; j < loggers.length; j++) {
          expect(loggers[i]).not.toBe(loggers[j]);
        }
      }
    });

    it("should handle rapid successive creations", () => {
      const loggers: ILogger[] = [];

      for (let i = 0; i < 1000; i++) {
        loggers.push(LoggerFactory.create(`Rapid${i}`));
      }

      expect(loggers).toHaveLength(1000);
      loggers.forEach(logger => {
        expect(logger).toBeInstanceOf(Logger);
      });
    });

    it("should handle context with null bytes", () => {
      const contextWithNullBytes = "Context\0With\0Null\0Bytes";
      const logger = LoggerFactory.create(contextWithNullBytes);

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should support dependency injection pattern", () => {
      class Service {
        private logger: ILogger;

        constructor(context: string) {
          this.logger = LoggerFactory.create(context);
        }

        getLogger(): ILogger {
          return this.logger;
        }
      }

      const service = new Service("MyService");
      const logger = service.getLogger();

      expect(logger).toBeInstanceOf(Logger);
    });

    it("should be usable with different logging strategies", () => {
      // Console strategy (default)
      const consoleLogger = LoggerFactory.create("Console");
      expect(consoleLogger).toBeInstanceOf(Logger);

      // Could be extended for file, remote, etc.
      const fileLogger = LoggerFactory.create("File");
      expect(fileLogger).toBeInstanceOf(Logger);

      const remoteLogger = LoggerFactory.create("Remote");
      expect(remoteLogger).toBeInstanceOf(Logger);
    });
  });

  describe("static method", () => {
    it("should be a static method", () => {
      // `create` must be static (on the constructor, not the prototype).
      expect(LoggerFactory.prototype.create).toBeUndefined();
    });

    it("should not require instantiation", () => {
      // Should work without new LoggerFactory()
      const logger = LoggerFactory.create("StaticTest");
      expect(logger).toBeInstanceOf(Logger);
    });

    it("should not have instance methods", () => {
      const factory = new LoggerFactory();
      expect((factory as any).create).toBeUndefined();
    });
  });

  describe("type safety", () => {
    it("should return ILogger type", () => {
      const logger: ILogger = LoggerFactory.create("TypeTest");

      // TypeScript should compile this without errors
      logger.debug("test");
      logger.info("test");
      logger.warn("test");
      logger.error("test");
    });

    it("should work with strict type checking", () => {
      interface LoggerConsumer {
        logger: ILogger;
      }

      const consumer: LoggerConsumer = {
        logger: LoggerFactory.create("StrictType"),
      };

      expect(consumer.logger).toBeInstanceOf(Logger);
    });
  });
});