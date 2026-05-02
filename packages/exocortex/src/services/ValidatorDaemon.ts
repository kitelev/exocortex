import type { Triple } from '../infrastructure/sparql/algebra/AlgebraOperation';
import type { ValidationReport } from './ShaclLiteValidator';
import { validate, ShapeRegistry as ValidatorShapeRegistry } from './ShaclLiteValidator';
import { ShapeLoader } from './ShapeLoader';
import { ClassHierarchy } from './ClassHierarchy';

export interface DaemonRequest {
  triples: Triple[];
  registryPath: string;
  subclassTriples?: Triple[];
}

export interface DaemonResponse {
  report?: ValidationReport;
  error?: string;
}

export const DEFAULT_SOCKET_PATH = (() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
  const path = require('path') as typeof import('path');
  return path.join(os.homedir(), '.cache', 'exocortex', 'validator.sock');
})();

export class ValidatorDaemon {
  private readonly socketPath: string;
  private readonly registryCache = new Map<string, ValidatorShapeRegistry>();
   
  private server: import('net').Server | null = null;

  constructor(socketPath: string = DEFAULT_SOCKET_PATH) {
    this.socketPath = socketPath;
  }

  async start(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const net = require('net') as typeof import('net');
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const fs = require('fs/promises') as typeof import('fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
    const path = require('path') as typeof import('path');

    await fs.mkdir(path.dirname(this.socketPath), { recursive: true });

    try {
      await fs.unlink(this.socketPath);
    } catch {
      // Stale socket may not exist — that's fine
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(this.socketPath, resolve);
    });

    const handleSignal = (): void => { void this.stop(); };
    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }

  private handleConnection(socket: import('net').Socket): void {
    let buffer = '';

    socket.setEncoding('utf-8');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          void this.handleRequest(trimmed, socket);
        }
      }
    });

    socket.on('error', () => { socket.destroy(); });
  }

  private async handleRequest(raw: string, socket: import('net').Socket): Promise<void> {
    let response: DaemonResponse;
    try {
      const req = JSON.parse(raw) as DaemonRequest;
      const registry = await this.getRegistry(req.registryPath);
      const hierarchy = new ClassHierarchy(req.subclassTriples ?? []);
      const report = validate(req.triples, registry, hierarchy);
      response = { report };
    } catch (err) {
      response = { error: err instanceof Error ? err.message : String(err) };
    }

    if (!socket.destroyed) {
      socket.write(JSON.stringify(response) + '\n');
    }
  }

  private async getRegistry(registryPath: string): Promise<ValidatorShapeRegistry> {
    const cached = this.registryCache.get(registryPath);
    if (cached) return cached;

    const loaded = await ShapeLoader.loadFromShapeJSON(registryPath);
    // Convert ShapeRegistry (ShapeRegistry.ts) → ShapeRegistry (ShaclLiteValidator.ts)
    const registry = new ValidatorShapeRegistry(loaded.getAll());
    this.registryCache.set(registryPath, registry);
    return registry;
  }
}
