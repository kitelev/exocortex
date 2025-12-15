import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Get CLI dist path relative to test file location
const CLI_DIST_PATH = path.resolve(process.cwd(), "packages/cli/dist/index.js");

// Skip in CI - file watcher events are timing-dependent and flaky in CI environments
const isCI = process.env.CI === "true";
const describeOrSkip = isCI ? describe.skip : describe;

describeOrSkip("watch command integration", () => {
  let tempDir: string;
  let cliProcess: ChildProcess | null = null;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exocortex-watch-test-"));
  });

  afterEach(() => {
    // Kill the CLI process if running
    if (cliProcess && !cliProcess.killed) {
      cliProcess.kill("SIGTERM");
      cliProcess = null;
    }

    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should start watching and emit startup message to stderr", async () => {
    const stderrOutput: string[] = [];

    // Start the watch command
    cliProcess = spawn("node", [
      "--experimental-vm-modules",
      CLI_DIST_PATH,
      "watch",
      "--vault", tempDir,
    ], {
      env: { ...process.env },
    });

    // Collect stderr output
    cliProcess.stderr?.on("data", (data) => {
      stderrOutput.push(data.toString());
    });

    // Wait for startup message
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for startup message"));
      }, 5000);

      cliProcess?.stderr?.on("data", () => {
        if (stderrOutput.join("").includes("Watching vault:")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    expect(stderrOutput.join("")).toContain("Watching vault:");
    expect(stderrOutput.join("")).toContain(tempDir);
  }, 10000);

  it("should emit NDJSON event when file is created", async () => {
    const stdoutOutput: string[] = [];
    const stderrOutput: string[] = [];

    // Start the watch command
    cliProcess = spawn("node", [
      "--experimental-vm-modules",
      CLI_DIST_PATH,
      "watch",
      "--vault", tempDir,
      "--debounce", "50", // Faster debounce for testing
    ], {
      env: { ...process.env },
    });

    cliProcess.stdout?.on("data", (data) => {
      stdoutOutput.push(data.toString());
    });

    cliProcess.stderr?.on("data", (data) => {
      stderrOutput.push(data.toString());
    });

    // Wait for startup
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for startup"));
      }, 5000);

      cliProcess?.stderr?.on("data", () => {
        if (stderrOutput.join("").includes("Watching vault:")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Create a test file
    const testFile = path.join(tempDir, "test-file.md");
    fs.writeFileSync(testFile, "# Test content");

    // Wait for the event to be emitted
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for file event"));
      }, 3000);

      cliProcess?.stdout?.on("data", () => {
        if (stdoutOutput.join("").includes("test-file.md")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Parse the NDJSON output
    const output = stdoutOutput.join("");
    const lines = output.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const event = JSON.parse(lines[lines.length - 1]);
    expect(event).toHaveProperty("type");
    expect(event).toHaveProperty("path");
    expect(event).toHaveProperty("relativePath");
    expect(event).toHaveProperty("timestamp");
    expect(event.relativePath).toBe("test-file.md");
  }, 15000);

  it("should filter by pattern", async () => {
    const stdoutOutput: string[] = [];
    const stderrOutput: string[] = [];

    // Start the watch command with a pattern filter
    cliProcess = spawn("node", [
      "--experimental-vm-modules",
      CLI_DIST_PATH,
      "watch",
      "--vault", tempDir,
      "--pattern", "*.txt",
      "--debounce", "50",
    ], {
      env: { ...process.env },
    });

    cliProcess.stdout?.on("data", (data) => {
      stdoutOutput.push(data.toString());
    });

    cliProcess.stderr?.on("data", (data) => {
      stderrOutput.push(data.toString());
    });

    // Wait for startup
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for startup"));
      }, 5000);

      cliProcess?.stderr?.on("data", () => {
        if (stderrOutput.join("").includes("Pattern filter:")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Create a .md file (should be filtered out)
    fs.writeFileSync(path.join(tempDir, "test.md"), "# Test");

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Create a .txt file (should be included)
    fs.writeFileSync(path.join(tempDir, "test.txt"), "Test content");

    // Wait for the .txt event
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for txt file event"));
      }, 3000);

      cliProcess?.stdout?.on("data", () => {
        if (stdoutOutput.join("").includes("test.txt")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const output = stdoutOutput.join("");
    expect(output).toContain("test.txt");
    expect(output).not.toContain("test.md");
  }, 15000);
});
