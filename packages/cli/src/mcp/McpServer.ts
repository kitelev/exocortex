import type { CliRunner } from "./cliRunner.js";
import {
  MCP_TOOLS,
  buildCreateAssetArgs,
  buildCreateEffortArgs,
  type CreateAssetInput,
  type CreateEffortInput,
} from "./tools.js";

/**
 * MCP revision this server speaks. The handshake echoes it back so a client can
 * detect a mismatch.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** JSON-RPC 2.0 error codes used by this server. */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;

/** A decoded incoming JSON-RPC message (request OR notification). */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC response this server writes back. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** MCP `tools/call` result payload. */
export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpServerDeps {
  runCli: CliRunner;
  /** CLI version, reported in the `initialize` handshake. */
  version: string;
}

function textResult(text: string, isError = false): McpToolResult {
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/**
 * Parse the LAST non-empty stdout line as JSON.
 *
 * `create` and `apply --json` each emit exactly one JSON document on stdout
 * (all diagnostics go to stderr), but reading the last line keeps the parse
 * robust if a future command prefixes a banner.
 */
function parseLastJsonLine(stdout: string): unknown {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(last);
  } catch {
    return undefined;
  }
}

/**
 * Return the names of required string fields that are missing or blank.
 *
 * Checked before building the argv so the agent gets a precise, structured
 * complaint instead of the CLI failing on a literal `undefined` argument.
 */
function missingStringFields(
  args: Record<string, unknown>,
  required: readonly string[],
): string[] {
  return required.filter((field) => {
    const value = args[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/**
 * MCP server for the Exocortex asset-creation tools (project 38800c80 W6).
 *
 * Transport-agnostic: {@link handle} maps one decoded JSON-RPC message to a
 * response (or `null` for a notification), so it is driven identically by the
 * stdio loop and by tests.
 */
export class McpServer {
  constructor(private readonly deps: McpServerDeps) {}

  /**
   * Handle one decoded message.
   *
   * @returns the response to write, or `null` when the message is a
   *   notification (JSON-RPC forbids answering those).
   */
  async handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    const id = message.id;
    const isNotification = id === undefined;

    if (typeof message.method !== "string") {
      if (isNotification) {
        return null;
      }
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        error: {
          code: JSON_RPC_INVALID_REQUEST,
          message: "Invalid request: missing method",
        },
      };
    }

    if (isNotification) {
      // `notifications/initialized` and friends are acknowledged by silence.
      return null;
    }

    const responseId = id ?? null;

    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: responseId,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "exocortex", version: this.deps.version },
          },
        };

      case "ping":
        return { jsonrpc: "2.0", id: responseId, result: {} };

      case "tools/list":
        return { jsonrpc: "2.0", id: responseId, result: { tools: MCP_TOOLS } };

      case "tools/call":
        return {
          jsonrpc: "2.0",
          id: responseId,
          result: await this.callTool(message.params ?? {}),
        };

      default:
        return {
          jsonrpc: "2.0",
          id: responseId,
          error: {
            code: JSON_RPC_METHOD_NOT_FOUND,
            message: `Method not found: ${message.method}`,
          },
        };
    }
  }

  /**
   * Dispatch a `tools/call`.
   *
   * A bad tool name or a failing CLI run is reported as an MCP tool error
   * (`isError: true`) — never as a JSON-RPC protocol error and never as a
   * thrown exception, so the server survives every tool failure.
   */
  private async callTool(
    params: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const name = params.name;
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    let argv: string[];
    if (name === "create_asset") {
      const missing = missingStringFields(args, ["vault", "class", "label"]);
      if (missing.length > 0) {
        return textResult(
          `create_asset: missing required argument(s): ${missing.join(", ")}`,
          true,
        );
      }
      argv = buildCreateAssetArgs(args as unknown as CreateAssetInput);
    } else if (name === "create_effort") {
      const missing = missingStringFields(args, ["vault", "command", "target"]);
      if (missing.length > 0) {
        return textResult(
          `create_effort: missing required argument(s): ${missing.join(", ")}`,
          true,
        );
      }
      argv = buildCreateEffortArgs(args as unknown as CreateEffortInput);
    } else {
      return textResult(`Unknown tool: ${String(name)}`, true);
    }

    const run = await this.deps.runCli(argv);

    if (run.exitCode !== 0) {
      const detail =
        run.stderr.trim() || run.stdout.trim() || "(no diagnostic output)";
      return textResult(
        `exocortex-cli exited ${run.exitCode}\n${detail}`,
        true,
      );
    }

    const parsed = parseLastJsonLine(run.stdout);
    return textResult(
      parsed === undefined ? run.stdout.trim() : JSON.stringify(parsed),
    );
  }
}
