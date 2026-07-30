import { Command } from "commander";
import { createInterface } from "readline";
import {
  McpServer,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INTERNAL_ERROR,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from "../mcp/McpServer.js";
import { createSelfCliRunner } from "../mcp/cliRunner.js";

interface McpCommandOptions {
  entry?: string;
}

/**
 * Drive an {@link McpServer} over newline-delimited JSON on stdio.
 *
 * Exported for testing: the caller supplies the streams, so the loop can be
 * exercised without spawning a process.
 */
export async function runStdioServer(
  server: McpServer,
  input: NodeJS.ReadableStream,
  write: (line: string) => void,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      const parseError: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: JSON_RPC_PARSE_ERROR,
          message: "Parse error: invalid JSON",
        },
      };
      write(JSON.stringify(parseError) + "\n");
      continue;
    }

    // The server is long-lived: no single message may terminate it. Any
    // unexpected throw (a hostile payload shape, a runner that rejects) becomes
    // an internal-error response instead of escaping the loop.
    let response: JsonRpcResponse | null;
    try {
      response = await server.handle(message);
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id:
          typeof message?.id === "string" || typeof message?.id === "number"
            ? message.id
            : null,
        error: {
          code: JSON_RPC_INTERNAL_ERROR,
          message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    if (response !== null) {
      write(JSON.stringify(response) + "\n");
    }
  }
}

/**
 * `exocortex mcp` — MCP (Model Context Protocol) stdio server exposing the
 * Exocortex asset-creation tools (project 38800c80 W6, req 264ccef6).
 *
 * This is a TRANSPORT entry-point, not a domain verb: it adds no new creation
 * semantics. Each tool re-invokes this same CLI with an explicit argument
 * vector (no shell), so every guarantee of the creation path is inherited and
 * no caller-supplied value can be reinterpreted by a shell.
 */
export function mcpCommand(version?: string): Command {
  return new Command("mcp")
    .description(
      "Run an MCP (Model Context Protocol) stdio server exposing create_asset / create_effort tools backed by this CLI",
    )
    .option(
      "--entry <path>",
      "Path to the CLI entry script the tools invoke (defaults to this process's script)",
    )
    .action(async (options: McpCommandOptions) => {
      const entryPath = options.entry ?? process.argv[1];
      const server = new McpServer({
        runCli: createSelfCliRunner(entryPath),
        version: version ?? "unknown",
      });
      await runStdioServer(server, process.stdin, (line) =>
        process.stdout.write(line),
      );
    });
}
