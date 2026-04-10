import { FileLogChannel } from "../../src/adapters/logging/FileLogChannel";

describe("FileLogChannel", () => {
  let channel: FileLogChannel;
  let mockAdapter: { append: jest.Mock; write: jest.Mock };

  beforeEach(() => {
    mockAdapter = {
      append: jest.fn().mockResolvedValue(undefined),
      write: jest.fn().mockResolvedValue(undefined),
    };
    channel = new FileLogChannel(mockAdapter as any);
  });

  it("should append log lines to the log file via adapter", async () => {
    channel.append("info", "TestCtx", "Hello world");

    // Wait for microtask flush
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

  it("should fallback to write when append fails (file does not exist)", async () => {
    mockAdapter.append.mockRejectedValueOnce(new Error("ENOENT"));

    channel.append("info", "Ctx", "First write");

    await flushMicrotasks();
    // Allow error handler promise to resolve
    await flushMicrotasks();

    expect(mockAdapter.write).toHaveBeenCalledTimes(1);
    const writtenLine = mockAdapter.write.mock.calls[0][1] as string;
    expect(writtenLine).toContain("First write");
  });

  it("should silently handle write failure", async () => {
    mockAdapter.append.mockRejectedValueOnce(new Error("ENOENT"));
    mockAdapter.write.mockRejectedValueOnce(new Error("EPERM"));

    // Should not throw
    channel.append("error", "Ctx", "Fail silently");

    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockAdapter.append).toHaveBeenCalledTimes(1);
    expect(mockAdapter.write).toHaveBeenCalledTimes(1);
  });

  it("should format log lines with ISO timestamp", async () => {
    channel.append("warn", "MyService", "Something happened");

    await flushMicrotasks();

    const line = mockAdapter.append.mock.calls[0][1] as string;
    // ISO 8601 format check
    const isoMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
    expect(isoMatch).not.toBeNull();
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
