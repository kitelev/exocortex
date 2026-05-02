import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import * as net from "net";
import { DaemonClient, SpawnFn } from "../../../src/services/DaemonClient.js";
import { DaemonRequest, DaemonResponse } from "../../../src/services/DaemonClient.js";
import { ShapeJSONCache } from "exocortex";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_SOCKET_DIR = path.join(os.tmpdir(), "exo-daemonclient-test");
let socketSeq = 0;

function makeSocketPath(): string {
  return path.join(TEST_SOCKET_DIR, `client-${process.pid}-${++socketSeq}.sock`);
}

async function writeMinimalShapeCache(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, `shapes-${Date.now()}.json`);
  const cache: ShapeJSONCache = { version: 1, vaultMtime: 0, shapes: {} };
  await fs.writeFile(jsonPath, JSON.stringify(cache), "utf-8");
  return jsonPath;
}

function startEchoServer(socketPath: string): net.Server {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf-8");
    let buf = "";
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        buf = buf.slice(nl + 1);
        const response: DaemonResponse = {
          report: { conforms: true, violations: [] },
        };
        socket.write(JSON.stringify(response) + "\n");
      }
    });
    socket.on("error", () => socket.destroy());
  });
  server.listen(socketPath);
  return server;
}

function noopSpawn(): SpawnFn {
  return () => ({ unref: () => {} });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let registryPath: string;

beforeAll(async () => {
  await fs.mkdir(TEST_SOCKET_DIR, { recursive: true });
  registryPath = await writeMinimalShapeCache(TEST_SOCKET_DIR);
});

afterAll(async () => {
  await fs.rm(TEST_SOCKET_DIR, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DaemonClient", () => {
  describe("direct connect (daemon already running)", () => {
    let server: net.Server;
    let socketPath: string;
    let client: DaemonClient;

    beforeAll(async () => {
      socketPath = makeSocketPath();
      server = startEchoServer(socketPath);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      client = new DaemonClient({ socketPath, spawnFn: noopSpawn() });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("returns report from daemon", async () => {
      const req: DaemonRequest = { triples: [], registryPath };
      const res = await client.validate(req);
      expect(res.error).toBeUndefined();
      expect(res.report).toBeDefined();
      expect(res.report!.conforms).toBe(true);
    });
  });

  describe("lazy-start: socket down → spawn + retry", () => {
    it("calls spawnFn and eventually connects after server starts", async () => {
      const socketPath = makeSocketPath();
      let server: net.Server | null = null;
      let spawnCalled = false;

      const lazySpawn: SpawnFn = () => {
        spawnCalled = true;
        // Start an echo server after a short delay (simulates daemon boot)
        setTimeout(() => {
          server = startEchoServer(socketPath);
        }, 50);
        return { unref: () => {} };
      };

      const client = new DaemonClient({
        socketPath,
        spawnFn: lazySpawn,
        maxRetries: 5,
        retryDelayMs: 60,
      });

      try {
        const req: DaemonRequest = { triples: [], registryPath };
        const res = await client.validate(req);
        expect(spawnCalled).toBe(true);
        expect(res.report).toBeDefined();
        expect(res.report!.conforms).toBe(true);
      } finally {
        if (server) {
          await new Promise<void>((resolve) =>
            (server as net.Server).close(() => resolve()),
          );
        }
      }
    });
  });

  describe("fallback: daemon cannot be spawned / retries exhausted", () => {
    it("falls back to in-process validation when socket never becomes available", async () => {
      const socketPath = makeSocketPath();

      const client = new DaemonClient({
        socketPath,
        spawnFn: noopSpawn(), // spawn does nothing — socket stays down
        maxRetries: 1,
        retryDelayMs: 10,
      });

      const req: DaemonRequest = { triples: [], registryPath };
      const res = await client.validate(req);
      // Fallback ran in-process — should succeed
      expect(res.report).toBeDefined();
      expect(res.report!.conforms).toBe(true);
    });
  });
});
