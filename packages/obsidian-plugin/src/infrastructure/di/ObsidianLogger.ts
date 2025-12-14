 
import type { ILogger } from "exocortex";
import { Plugin } from "obsidian";

export class ObsidianLogger implements ILogger {
  constructor(private plugin: Plugin) {}

  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(`[${this.plugin.manifest.id}]`, message, context || "");
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.debug(`[${this.plugin.manifest.id}] [INFO]`, message, context || "");
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[${this.plugin.manifest.id}]`, message, context || "");
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    console.error(`[${this.plugin.manifest.id}]`, message, error || "", context || "");
  }
}
