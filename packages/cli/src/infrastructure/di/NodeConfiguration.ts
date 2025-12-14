import { IConfiguration } from "exocortex";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export class NodeConfiguration implements IConfiguration {
  private config: Record<string, any> = {};
  private configPath: string;

  constructor(configFileName: string = ".exocortexrc") {
    this.configPath = path.join(os.homedir(), configFileName);
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, "utf-8");
      this.config = JSON.parse(data);
    } catch (error) {
      this.config = {};
    }
  }

  get<T = any>(key: string): T | undefined {
    const keys = key.split(".");
    let value: any = this.config;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value as T;
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    const keys = key.split(".");
    const lastKey = keys.pop()!;
    let current: any = this.config;

    for (const k of keys) {
      if (!current[k] || typeof current[k] !== "object") {
        current[k] = {};
      }
      current = current[k];
    }

    current[lastKey] = value;

    await this.save();
  }

  getAll(): Record<string, any> {
    return { ...this.config };
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }
}
