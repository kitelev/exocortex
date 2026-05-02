import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as net from 'net';
import { ValidatorDaemon } from '../../src/services/ValidatorDaemon';
import type { DaemonRequest, DaemonResponse } from '../../src/services/ValidatorDaemon';
import type { ShapeJSONCache } from '../../src/services/ShapeLoader';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_SOCKET_DIR = path.join(os.tmpdir(), 'exo-daemon-test');
let socketSeq = 0;

function makeSocketPath(): string {
  return path.join(TEST_SOCKET_DIR, `validator-${process.pid}-${++socketSeq}.sock`);
}

async function writeMinimalShapeCache(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, 'shapes.json');
  const cache: ShapeJSONCache = { version: 1, vaultMtime: 0, shapes: {} };
  await fs.writeFile(jsonPath, JSON.stringify(cache), 'utf-8');
  return jsonPath;
}

function sendRequest(socketPath: string, req: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buf = '';

    socket.setEncoding('utf-8');
    socket.on('error', reject);

    socket.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        socket.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as DaemonResponse);
        } catch (e) {
          reject(e);
        }
      }
    });

    socket.on('connect', () => {
      socket.write(JSON.stringify(req) + '\n');
    });
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
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

describe('ValidatorDaemon', () => {
  describe('socket pool — basic request/response', () => {
    let daemon: ValidatorDaemon;
    let socketPath: string;

    beforeAll(async () => {
      socketPath = makeSocketPath();
      daemon = new ValidatorDaemon(socketPath);
      await daemon.start();
    });

    afterAll(async () => {
      await daemon.stop();
    });

    it('returns a valid report for empty triples', async () => {
      const req: DaemonRequest = { triples: [], registryPath };
      const res = await sendRequest(socketPath, req);
      expect(res.error).toBeUndefined();
      expect(res.report).toBeDefined();
      expect(res.report!.conforms).toBe(true);
      expect(res.report!.violations).toHaveLength(0);
    });

    it('returns error response for malformed JSON', async () => {
      const response = await new Promise<DaemonResponse>((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        let buf = '';
        socket.setEncoding('utf-8');
        socket.on('error', reject);
        socket.on('data', (chunk: string) => {
          buf += chunk;
          if (buf.includes('\n')) {
            socket.destroy();
            resolve(JSON.parse(buf.split('\n')[0]) as DaemonResponse);
          }
        });
        socket.on('connect', () => socket.write('not-json\n'));
      });

      expect(response.error).toBeDefined();
      expect(response.report).toBeUndefined();
    });

    it('caches registry across multiple requests', async () => {
      const req: DaemonRequest = { triples: [], registryPath };
      const [r1, r2] = await Promise.all([
        sendRequest(socketPath, req),
        sendRequest(socketPath, req),
      ]);
      expect(r1.report).toBeDefined();
      expect(r2.report).toBeDefined();
    });
  });

  describe('concurrent clients', () => {
    let daemon: ValidatorDaemon;
    let socketPath: string;

    beforeAll(async () => {
      socketPath = makeSocketPath();
      daemon = new ValidatorDaemon(socketPath);
      await daemon.start();
    });

    afterAll(async () => {
      await daemon.stop();
    });

    it('handles 10 parallel connections without errors', async () => {
      const req: DaemonRequest = { triples: [], registryPath };
      const results = await Promise.all(
        Array.from({ length: 10 }, () => sendRequest(socketPath, req)),
      );
      for (const res of results) {
        expect(res.error).toBeUndefined();
        expect(res.report!.conforms).toBe(true);
      }
    });
  });

  describe('latency — socket roundtrip p95 < 30ms', () => {
    let daemon: ValidatorDaemon;
    let socketPath: string;

    beforeAll(async () => {
      socketPath = makeSocketPath();
      daemon = new ValidatorDaemon(socketPath);
      await daemon.start();
      // Warm up: ensure registry is cached before measuring
      await sendRequest(socketPath, { triples: [], registryPath });
    });

    afterAll(async () => {
      await daemon.stop();
    });

    it('p95 roundtrip < 30ms over 100 sequential requests', async () => {
      const SAMPLES = 100;
      const latencies: number[] = [];
      const req: DaemonRequest = { triples: [], registryPath };

      for (let i = 0; i < SAMPLES; i++) {
        const t0 = performance.now();
        await sendRequest(socketPath, req);
        latencies.push(performance.now() - t0);
      }

      latencies.sort((a, b) => a - b);
      const p95 = percentile(latencies, 95);
      const p50 = percentile(latencies, 50);

      // Log for visibility in CI output
      console.log(
        `[ValidatorDaemon latency] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
      );

      expect(p95).toBeLessThan(30);
    }, 15_000);
  });
});
