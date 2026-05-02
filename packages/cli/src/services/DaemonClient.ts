import * as net from "net";
import { spawn, type SpawnOptions, type ChildProcess } from "child_process";
import {
  shaclValidate,
  ShaclShapeRegistry,
  ShapeLoader,
  TripleClassHierarchy,
  DEFAULT_SOCKET_PATH,
  type DaemonRequest,
  type DaemonResponse,
} from "exocortex";

export { DEFAULT_SOCKET_PATH, type DaemonRequest, type DaemonResponse };

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => Pick<ChildProcess, "unref">;

export interface DaemonClientOptions {
  socketPath?: string;
  /** argv to spawn the daemon: [node, cliEntry, 'daemon', 'start', ...] */
  spawnArgv?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  /** Injectable spawn function for testing */
  spawnFn?: SpawnFn;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 200;
const SOCKET_TIMEOUT_MS = 5000;

export class DaemonClient {
  private readonly socketPath: string;
  private readonly spawnArgv: string[];
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly spawnFn: SpawnFn;

  constructor(opts: DaemonClientOptions = {}) {
    this.socketPath = opts.socketPath ?? DEFAULT_SOCKET_PATH;
    this.spawnArgv = opts.spawnArgv ?? [
      process.execPath,
      process.argv[1],
      "daemon",
      "start",
      "--socket",
      this.socketPath,
    ];
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.spawnFn = opts.spawnFn ?? ((cmd, args, spawnOpts) => spawn(cmd, args, spawnOpts));
  }

  async validate(req: DaemonRequest): Promise<DaemonResponse> {
    try {
      return await this.sendRequest(req);
    } catch {
      // Daemon not running — spawn it and retry
      this.spawnDaemon();

      for (let i = 0; i < this.maxRetries; i++) {
        await sleep(this.retryDelayMs);
        try {
          return await this.sendRequest(req);
        } catch {
          // retry
        }
      }

      // All retries exhausted → fallback to in-process validation
      return this.fallbackValidate(req);
    }
  }

  private spawnDaemon(): void {
    const child = this.spawnFn(this.spawnArgv[0], this.spawnArgv.slice(1), {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  private sendRequest(req: DaemonRequest): Promise<DaemonResponse> {
    return new Promise<DaemonResponse>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let buf = "";

      socket.setEncoding("utf-8");
      socket.setTimeout(SOCKET_TIMEOUT_MS);

      socket.on("error", reject);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("socket timeout"));
      });

      socket.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          socket.destroy();
          try {
            resolve(JSON.parse(buf.slice(0, nl)) as DaemonResponse);
          } catch (e) {
            reject(e);
          }
        }
      });

      socket.on("connect", () => {
        socket.write(JSON.stringify(req) + "\n");
      });
    });
  }

  private async fallbackValidate(req: DaemonRequest): Promise<DaemonResponse> {
    try {
      const loaded = await ShapeLoader.loadFromShapeJSON(req.registryPath);
      const registry = new ShaclShapeRegistry(loaded.getAll());
      const hierarchy = new TripleClassHierarchy(req.subclassTriples ?? []);
      const report = shaclValidate(req.triples as never, registry, hierarchy);
      return { report };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
