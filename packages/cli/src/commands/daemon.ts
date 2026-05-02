import { Command } from "commander";
import { ValidatorDaemon, DEFAULT_SOCKET_PATH, IDLE_TIMEOUT_MS } from "exocortex";

export interface DaemonStartOptions {
  socket: string;
  idleTimeout: number;
}

function daemonStartCommand(): Command {
  return new Command("start")
    .description("Start the ValidatorDaemon process (long-running, Unix socket)")
    .option("--socket <path>", "Unix socket path", DEFAULT_SOCKET_PATH)
    .option(
      "--idle-timeout <seconds>",
      "Exit after N seconds of inactivity",
      String(Math.floor(IDLE_TIMEOUT_MS / 1000)),
    )
    .action(async (options: { socket: string; idleTimeout: string }) => {
      const socketPath = options.socket;
      const idleTimeoutMs = Number(options.idleTimeout) * 1000;

      const daemon = new ValidatorDaemon(socketPath, idleTimeoutMs);
      await daemon.start();
      // Process stays alive: net.Server keeps the event loop running.
      // Exits via: SIGTERM, SIGINT, or idle-kill timer.
    });
}

export function daemonCommand(): Command {
  const cmd = new Command("daemon").description(
    "Manage the ValidatorDaemon background process",
  );
  cmd.addCommand(daemonStartCommand());
  return cmd;
}
