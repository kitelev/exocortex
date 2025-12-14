import { INotificationService } from "exocortex";
import * as readline from "readline";

export class NodeNotificationService implements INotificationService {
  info(message: string, _duration?: number): void {
    console.log(`ℹ ${message}`);
  }

  success(message: string, _duration?: number): void {
    console.log(`✓ ${message}`);
  }

  error(message: string, _duration?: number): void {
    console.error(`✗ ${message}`);
  }

  warn(message: string, _duration?: number): void {
    console.warn(`⚠ ${message}`);
  }

  async confirm(title: string, message: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${title}\n${message}\nContinue? (y/n): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
      });
    });
  }
}
