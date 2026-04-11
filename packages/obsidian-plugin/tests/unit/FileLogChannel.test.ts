import { FileLogChannel } from "../../src/adapters/logging/FileLogChannel";

describe("FileLogChannel", () => {
  let channel: FileLogChannel;
  let mockAdapter: { append: jest.Mock; write: jest.Mock; exists: jest.Mock };

  beforeEach(() => {
    mockAdapter = {
      append: jest.fn().mockResolvedValue(undefined),
      write: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
    };
    channel = new FileLogChannel(mockAdapter as any);
  });

  describe("ensureFileExists", () => {
    it("should create the log file when it does not exist", async () => {
      mockAdapter.exists.mockResolvedValue(false);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenCalledWith("exocortex-logs.txt");
      expect(mockAdapter.write).toHaveBeenCalledWith("exocortex-logs.txt", "");
    });

    it("should not overwrite the log file when it already exists", async () => {
      mockAdapter.exists.mockResolvedValue(true);

      await channel.ensureFileExists();

      expect(mockAdapter.exists).toHaveBeenCalledWith("exocortex-logs.txt");
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it("should not throw when exists check fails", async () => {
      mockAdapter.exists.mockRejectedValue(new Error("EPERM"));

      await expect(channel.ensureFileExists()).resolves.toBeUndefined();
    });
  });

  describe("flush after ensureFileExists", () => {
    beforeEach(async () => {
      mockAdapter.exists.mockResolvedValue(false);
      await channel.ensureFileExists();
      mockAdapter.write.mockClear();
    });

    it("should append log lines via adapter.append", async () => {
      channel.append("info", "TestCtx", "Hello world");

      await flushMicrotasks();

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      const writtenLine = mockAdapter.append.mock.calls[0][1] as string;
      expect(writtenLine).toContain("[INFO]");
      expect(writtenLine).toContain("[TestCtx]");
      expect(writtenLine).toContain("Hello world");
      expect(writtenLine).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
      expect(writtenLine).toEndWith("\n");
      expect(mockAdapter.append.mock.calls[0][0]).toBe("exocortex-logs.txt");
    });

    it("should batch multiple appends in the same tick", async () => {
      channel.append("debug", "A", "Line 1");
      channel.append("warn", "B", "Line 2");
      channel.append("error", "C", "Line 3");

      await flushMicrotasks();

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      const combined = mockAdapter.append.mock.calls[0][1] as string;
      expect(combined).toContain("[DEBUG]");
      expect(combined).toContain("[WARN]");
      expect(combined).toContain("[ERROR]");
      expect(combined.split("\n").filter(Boolean)).toHaveLength(3);
    });

    it("should format log lines with ISO timestamp", async () => {
      channel.append("warn", "MyService", "Something happened");

      await flushMicrotasks();

      const line = mockAdapter.append.mock.calls[0][1] as string;
      const isoMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      expect(isoMatch).not.toBeNull();
    });
  });

  describe("flush without ensureFileExists (fallback path)", () => {
    it("should use write to create the file on first flush", async () => {
      channel.append("info", "Ctx", "First write");

      await flushMicrotasks();

      expect(mockAdapter.write).toHaveBeenCalledTimes(1);
      const writtenLine = mockAdapter.write.mock.calls[0][1] as string;
      expect(writtenLine).toContain("First write");
    });

    it("should switch to append after successful write", async () => {
      channel.append("info", "Ctx", "First");
      await flushMicrotasks();
      // Let the write promise resolve and set fileReady
      await flushMicrotasks();

      mockAdapter.write.mockClear();
      channel.append("info", "Ctx", "Second");
      await flushMicrotasks();

      expect(mockAdapter.append).toHaveBeenCalledTimes(1);
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it("should silently handle write failure", async () => {
      mockAdapter.write.mockRejectedValueOnce(new Error("EPERM"));

      channel.append("error", "Ctx", "Fail silently");

      await flushMicrotasks();
      await flushMicrotasks();

      expect(mockAdapter.write).toHaveBeenCalledTimes(1);
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
