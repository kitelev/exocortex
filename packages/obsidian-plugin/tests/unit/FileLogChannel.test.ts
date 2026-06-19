import { FileLogChannel } from "../../src/adapters/logging/FileLogChannel";

// Tests pass an explicit plugin dir so the channel does not assume a fixed
// config-dir name (users can customise `.obsidian` to e.g. `.obsidian-mobile`).
const PLUGIN_DIR = ".obsidian/plugins/exocortex";
const LOG_FILE = `${PLUGIN_DIR}/exocortex-logs.txt`;
const ROTATED_FILE = `${LOG_FILE}.1`;

interface MockAdapter {
  append: jest.Mock;
  write: jest.Mock;
  exists: jest.Mock;
  mkdir: jest.Mock;
  stat: jest.Mock;
  rename: jest.Mock;
  remove: jest.Mock;
  read: jest.Mock;
}

describe("FileLogChannel", () => {
  let channel: FileLogChannel;
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    mockAdapter = {
      append: jest.fn().mockResolvedValue(undefined),
      write: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      mkdir: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockResolvedValue({ size: 0, type: "file", ctime: 0, mtime: 0 }),
      rename: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue(""),
    };
    channel = new FileLogChannel(mockAdapter as any, PLUGIN_DIR);
  });

  describe("ensureFileExists", () => {
    it("creates the plugin log directory when it does not exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenCalledWith(PLUGIN_DIR);
      expect(mockAdapter.mkdir).toHaveBeenCalledWith(PLUGIN_DIR);
    });

    it("skips mkdir when the plugin log directory already exists", async () => {
      // First exists() call (for dir) → true; second (for file) → true
      mockAdapter.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenNthCalledWith(1, PLUGIN_DIR);
      expect(mockAdapter.mkdir).not.toHaveBeenCalled();
    });

    it("creates the log file when it does not exist (inside plugin data dir)", async () => {
      // dir does not exist → mkdir; file does not exist → write
      mockAdapter.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenCalledWith(LOG_FILE);
      expect(mockAdapter.write).toHaveBeenCalledWith(LOG_FILE, "");
    });

    it("does not overwrite the log file when it already exists", async () => {
      // dir exists, file exists
      mockAdapter.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenCalledWith(LOG_FILE);
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it("does not throw when exists check fails", async () => {
      mockAdapter.exists.mockRejectedValue(new Error("EPERM"));

      await expect(channel.ensureFileExists()).resolves.toBeUndefined();
    });

    it("does not throw when mkdir fails", async () => {
      mockAdapter.exists.mockResolvedValue(false);
      mockAdapter.mkdir.mockRejectedValue(new Error("EPERM"));

      await expect(channel.ensureFileExists()).resolves.toBeUndefined();
    });
  });

  describe("flush after ensureFileExists", () => {
    beforeEach(async () => {
      // dir exists, file exists → no setup writes
      mockAdapter.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      await channel.ensureFileExists();
      mockAdapter.write.mockClear();
      mockAdapter.exists.mockReset();
      mockAdapter.exists.mockResolvedValue(false);
    });

    it("appends log lines to the plugin-data log path via adapter.append", async () => {
      channel.append("info", "TestCtx", "Hello world");

      await flushMicrotasks();
      await flushMicrotasks(); // flush is async — await rotation+append chain

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      const [path, line] = mockAdapter.append.mock.calls[0];
      expect(path).toBe(LOG_FILE);
      expect(line).toContain("[INFO]");
      expect(line).toContain("[TestCtx]");
      expect(line).toContain("Hello world");
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
      expect(line).toEndWith("\n");
    });

    it("batches multiple appends in the same tick", async () => {
      channel.append("debug", "A", "Line 1");
      channel.append("warn", "B", "Line 2");
      channel.append("error", "C", "Line 3");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      const combined = mockAdapter.append.mock.calls[0][1] as string;
      expect(combined).toContain("[DEBUG]");
      expect(combined).toContain("[WARN]");
      expect(combined).toContain("[ERROR]");
      expect(combined.split("\n").filter(Boolean)).toHaveLength(3);
    });

    it("formats log lines with ISO timestamp", async () => {
      channel.append("warn", "MyService", "Something happened");

      await flushMicrotasks();
      await flushMicrotasks();

      const line = mockAdapter.append.mock.calls[0][1] as string;
      const isoMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      expect(isoMatch).not.toBeNull();
    });
  });

  describe("flush without ensureFileExists (fallback path)", () => {
    it("uses write to create the file on first flush", async () => {
      channel.append("info", "Ctx", "First write");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.write).toHaveBeenCalledTimes(1);
      const [path, line] = mockAdapter.write.mock.calls[0];
      expect(path).toBe(LOG_FILE);
      expect(line).toContain("First write");
    });

    it("switches to append after successful write", async () => {
      channel.append("info", "Ctx", "First");
      await flushMicrotasks();
      await flushMicrotasks();

      mockAdapter.write.mockClear();
      channel.append("info", "Ctx", "Second");
      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it("silently handles write failure", async () => {
      mockAdapter.write.mockRejectedValueOnce(new Error("EPERM"));

      channel.append("error", "Ctx", "Fail silently");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.write).toHaveBeenCalledTimes(1);
    });
  });

  describe("rotation", () => {
    beforeEach(async () => {
      mockAdapter.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      await channel.ensureFileExists();
      mockAdapter.write.mockClear();
      mockAdapter.exists.mockReset();
    });

    it("does not rotate when file is under the size threshold", async () => {
      mockAdapter.stat.mockResolvedValue({ size: 500_000, type: "file", ctime: 0, mtime: 0 });

      channel.append("info", "Ctx", "Below threshold");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.rename).not.toHaveBeenCalled();
      expect(mockAdapter.remove).not.toHaveBeenCalled();
      expect(mockAdapter.append).toHaveBeenCalledWith(LOG_FILE, expect.stringContaining("Below threshold"));
    });

    it("rotates the file when it exceeds 1 MB", async () => {
      mockAdapter.stat.mockResolvedValue({ size: 1_500_000, type: "file", ctime: 0, mtime: 0 });
      mockAdapter.exists.mockResolvedValue(false); // .1 does not exist yet

      channel.append("info", "Ctx", "After rotation");

      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.rename).toHaveBeenCalledWith(LOG_FILE, ROTATED_FILE);
      // After rotation, fileReady is reset → fresh write() recreates active file
      expect(mockAdapter.write).toHaveBeenCalledWith(LOG_FILE, expect.stringContaining("After rotation"));
    });

    it("removes previous .1 before renaming when it already exists", async () => {
      mockAdapter.stat.mockResolvedValue({ size: 1_500_000, type: "file", ctime: 0, mtime: 0 });
      mockAdapter.exists.mockResolvedValue(true); // .1 already exists

      channel.append("info", "Ctx", "Rotate again");

      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.remove).toHaveBeenCalledWith(ROTATED_FILE);
      expect(mockAdapter.rename).toHaveBeenCalledWith(LOG_FILE, ROTATED_FILE);
    });

    it("falls through to append when stat fails (best-effort rotation)", async () => {
      mockAdapter.stat.mockRejectedValue(new Error("ENOENT"));

      channel.append("info", "Ctx", "Stat failed");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.rename).not.toHaveBeenCalled();
      expect(mockAdapter.append).toHaveBeenCalledWith(LOG_FILE, expect.stringContaining("Stat failed"));
    });

    it("skips rotation when file is not yet ready (first write path)", async () => {
      // Fresh channel without ensureFileExists → fileReady=false
      const freshChannel = new FileLogChannel(mockAdapter as any, PLUGIN_DIR);

      freshChannel.append("info", "Ctx", "First line ever");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.stat).not.toHaveBeenCalled();
      expect(mockAdapter.rename).not.toHaveBeenCalled();
      expect(mockAdapter.write).toHaveBeenCalledWith(LOG_FILE, expect.stringContaining("First line ever"));
    });
  });

  // RFC 0002 §3.8 P12 (#3588) — surface API used by the «Open logs» command.
  describe("getLogFilePath + read (Open logs source)", () => {
    it("exposes the log path inside the plugin data folder, not the vault root", () => {
      expect(channel.getLogFilePath()).toBe(LOG_FILE);
      expect(channel.getLogFilePath()).toContain(".obsidian/plugins/exocortex");
      expect(channel.getLogFilePath()).not.toBe("exocortex-logs.txt");
    });

    it("reads the current log file content via the adapter", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue("[ERROR] boom\n");

      const content = await channel.read();

      expect(mockAdapter.exists).toHaveBeenCalledWith(LOG_FILE);
      expect(mockAdapter.read).toHaveBeenCalledWith(LOG_FILE);
      expect(content).toBe("[ERROR] boom\n");
    });

    it("returns empty string when the log file does not exist yet", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const content = await channel.read();

      expect(content).toBe("");
      expect(mockAdapter.read).not.toHaveBeenCalled();
    });

    it("returns empty string (best-effort) when the adapter read throws", async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockRejectedValue(new Error("EPERM"));

      await expect(channel.read()).resolves.toBe("");
    });
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => {
    queueMicrotask(resolve);
  });
}

// Custom matcher
expect.extend({
  toEndWith(received: string, suffix: string) {
    const pass = received.endsWith(suffix);
    return {
      message: () => `expected "${received}" to end with "${suffix}"`,
      pass,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toEndWith(suffix: string): R;
    }
  }
}
