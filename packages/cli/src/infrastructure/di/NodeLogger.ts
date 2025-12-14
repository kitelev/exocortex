import { ILogger } from "exocortex";

export class NodeLogger implements ILogger {
  constructor(private appName: string = "exocortex-cli") {}

  debug(message: string, context?: Record<string, any>): void {
    console.debug(`[${this.appName}]`, message, context || "");
  }

  info(message: string, context?: Record<string, any>): void {
    console.info(`[${this.appName}]`, message, context || "");
  }

  warn(message: string, context?: Record<string, any>): void {
    console.warn(`[${this.appName}]`, message, context || "");
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    console.error(`[${this.appName}]`, message, error || "", context || "");
    if (error?.stack) {
      console.error(error.stack);
    }
  }
}
