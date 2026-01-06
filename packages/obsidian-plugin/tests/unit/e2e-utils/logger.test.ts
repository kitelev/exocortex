import { TestLogger, LogLevel } from "../../../tests/e2e/utils/logger";

describe("TestLogger", () => {
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let logOutput: string[];

  beforeEach(() => {
    logOutput = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;

    console.log = (...args: unknown[]) => {
      logOutput.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      logOutput.push(args.join(" "));
    };
    console.warn = (...args: unknown[]) => {
      logOutput.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe("log levels", () => {
    it("should log ERROR messages when level is ERROR", () => {
      const logger = new TestLogger("Test", LogLevel.ERROR);

      logger.error("Error message");
      logger.warn("Warn message");
      logger.info("Info message");
      logger.debug("Debug message");

      expect(logOutput.length).toBe(1);
      expect(logOutput[0]).toContain("ERROR");
      expect(logOutput[0]).toContain("Error message");
    });

    it("should log ERROR and WARN messages when level is WARN", () => {
      const logger = new TestLogger("Test", LogLevel.WARN);

      logger.error("Error message");
      logger.warn("Warn message");
      logger.info("Info message");
      logger.debug("Debug message");

      expect(logOutput.length).toBe(2);
      expect(logOutput[0]).toContain("ERROR");
      expect(logOutput[1]).toContain("WARN");
    });

    it("should log ERROR, WARN, and INFO messages when level is INFO", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.error("Error message");
      logger.warn("Warn message");
      logger.info("Info message");
      logger.debug("Debug message");

      expect(logOutput.length).toBe(3);
      expect(logOutput[0]).toContain("ERROR");
      expect(logOutput[1]).toContain("WARN");
      expect(logOutput[2]).toContain("INFO");
    });

    it("should log all messages when level is DEBUG", () => {
      const logger = new TestLogger("Test", LogLevel.DEBUG);

      logger.error("Error message");
      logger.warn("Warn message");
      logger.info("Info message");
      logger.debug("Debug message");

      expect(logOutput.length).toBe(4);
    });
  });

  describe("prefix formatting", () => {
    it("should include prefix in log messages", () => {
      const logger = new TestLogger("ObsidianLauncher", LogLevel.INFO);

      logger.info("Test message");

      expect(logOutput[0]).toContain("[ObsidianLauncher]");
    });

    it("should format ERROR messages with red color code", () => {
      const logger = new TestLogger("Test", LogLevel.ERROR);

      logger.error("Critical failure");

      expect(logOutput[0]).toContain("\x1b[31m");
      expect(logOutput[0]).toContain("\x1b[0m");
    });

    it("should format WARN messages with yellow color code", () => {
      const logger = new TestLogger("Test", LogLevel.WARN);

      logger.warn("Warning message");

      expect(logOutput[0]).toContain("\x1b[33m");
      expect(logOutput[0]).toContain("\x1b[0m");
    });

    it("should format DEBUG messages with gray color code", () => {
      const logger = new TestLogger("Test", LogLevel.DEBUG);

      logger.debug("Debug message");

      expect(logOutput[0]).toContain("\x1b[90m");
      expect(logOutput[0]).toContain("\x1b[0m");
    });
  });

  describe("environment variable configuration", () => {
    const originalEnv = process.env.E2E_LOG_LEVEL;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.E2E_LOG_LEVEL;
      } else {
        process.env.E2E_LOG_LEVEL = originalEnv;
      }
    });

    it("should respect E2E_LOG_LEVEL=0 for ERROR only", () => {
      process.env.E2E_LOG_LEVEL = "0";
      const logger = new TestLogger("Test");

      logger.error("Error");
      logger.info("Info");

      expect(logOutput.length).toBe(1);
    });

    it("should respect E2E_LOG_LEVEL=3 for DEBUG", () => {
      process.env.E2E_LOG_LEVEL = "3";
      const logger = new TestLogger("Test");

      logger.debug("Debug");

      expect(logOutput.length).toBe(1);
    });
  });

  describe("phase markers", () => {
    it("should log phase start with separator", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.phase("Setup");

      expect(logOutput[0]).toContain("─");
      expect(logOutput[0]).toContain("Setup");
    });

    it("should log phase end with separator", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.phaseEnd("Setup", true);

      expect(logOutput[0]).toContain("✓");
      expect(logOutput[0]).toContain("Setup");
    });

    it("should show failure indicator on phase end with failure", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.phaseEnd("Setup", false);

      expect(logOutput[0]).toContain("✗");
    });
  });

  describe("step markers", () => {
    it("should log step with arrow indicator", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.step("Connecting to CDP");

      expect(logOutput[0]).toContain("→");
      expect(logOutput[0]).toContain("Connecting to CDP");
    });
  });

  describe("additional arguments", () => {
    it("should include additional arguments in log output", () => {
      const logger = new TestLogger("Test", LogLevel.INFO);

      logger.info("Status:", { ready: true, count: 5 });

      expect(logOutput[0]).toContain("Status:");
      expect(logOutput[0]).toContain("ready");
    });
  });
});
