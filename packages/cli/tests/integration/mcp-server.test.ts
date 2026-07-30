import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";

import {
  McpServer,
  MCP_PROTOCOL_VERSION,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  type JsonRpcResponse,
  type McpToolResult,
} from "../../src/mcp/McpServer.js";
import {
  createSelfCliRunner,
  type CliRunResult,
} from "../../src/mcp/cliRunner.js";
import { runStdioServer } from "../../src/commands/mcp.js";

/**
 * Requirement 264ccef6 (project 38800c80 W6) — `exocortex-cli mcp` MCP-MVP
 * stdio server exposing create_asset / create_effort with inline-SHACL.
 *
 * The wrapped CLI is a PROCESS boundary, so the fake runner replaces the
 * process (not any feature logic): argv construction, protocol handling and
 * result mapping — the whole feature — run for real.
 */

interface RecordedCall {
  args: readonly string[];
}

function makeServer(result: Partial<CliRunResult> = {}) {
  const calls: RecordedCall[] = [];
  const runCli = async (args: readonly string[]): Promise<CliRunResult> => {
    calls.push({ args });
    return {
      stdout: result.stdout ?? "{}",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  };
  const server = new McpServer({ runCli, version: "1.2.3" });
  return { server, calls, runCli };
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const response = (await server.handle({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name, arguments: args },
  })) as JsonRpcResponse;
  return response.result as McpToolResult;
}

describe("exocortex-cli mcp — MCP stdio server", () => {
  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d initialize advertises protocol version, tools capability and serverInfo", async () => {
    const { server } = makeServer();

    const response = (await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    })) as JsonRpcResponse;

    expect(response.id).toBe(1);
    expect(response.result).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "exocortex", version: "1.2.3" },
    });
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d tools/list advertises exactly create_asset and create_effort with input schemas", async () => {
    const { server } = makeServer();

    const response = (await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })) as JsonRpcResponse;

    const tools = (
      response.result as {
        tools: { name: string; inputSchema: Record<string, unknown> }[];
      }
    ).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_asset",
      "create_effort",
    ]);

    const createAsset = tools.find((t) => t.name === "create_asset");
    expect(createAsset?.inputSchema.required).toEqual([
      "vault",
      "class",
      "label",
    ]);
    const createEffort = tools.find((t) => t.name === "create_effort");
    expect(createEffort?.inputSchema.required).toEqual([
      "vault",
      "command",
      "target",
    ]);
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d create_asset invokes the create verb with each value as its own argv element and returns the {uuid,path,label} JSON", async () => {
    const created = { uuid: "u-1", path: "space/u-1.md", label: "My Asset" };
    const { server, calls } = makeServer({
      stdout: JSON.stringify(created) + "\n",
    });

    const result = await callTool(server, "create_asset", {
      vault: "/v",
      class: "ems__Task",
      label: "My Asset",
      properties: { exo__Asset_relates: ["[[a]]", "[[b]]"], custom__key: "v" },
      aliases: ["Alias One"],
      body: "line one",
      validate: false,
    });

    const args = calls[0].args;
    expect(args.slice(0, 7)).toEqual([
      "create",
      "--vault",
      "/v",
      "--class",
      "ems__Task",
      "--label",
      "My Asset",
    ]);
    // A multi-value property emits one --property per element (#3759).
    expect(args).toContain("exo__Asset_relates=[[a]]");
    expect(args).toContain("exo__Asset_relates=[[b]]");
    expect(args).toContain("custom__key=v");
    expect(args).toContain("--aliases");
    expect(args).toContain("Alias One");
    expect(args).toContain("--body");
    expect(args).toContain("line one");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(created);
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d create_asset preserves shell metacharacters byte-identically in argv", async () => {
    const { server, calls } = makeServer();
    const nastyLabel = 'Cost $100 `id` $(whoami) $& (x) "q" \\n';
    const nastyBody = "para one\n\n$HOME `pwd` ${x} 100% *";

    await callTool(server, "create_asset", {
      vault: "/v",
      class: "ems__Task",
      label: nastyLabel,
      body: nastyBody,
      properties: { p__x: "value with $ and ` and (parens)" },
    });

    const args = calls[0].args;
    // Each hostile value is exactly ONE argv element, unchanged.
    expect(args[args.indexOf("--label") + 1]).toBe(nastyLabel);
    expect(args[args.indexOf("--body") + 1]).toBe(nastyBody);
    expect(args).toContain("p__x=value with $ and ` and (parens)");
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d create_asset enables inline-SHACL by default and omits it only when validate is false", async () => {
    const withDefault = makeServer();
    await callTool(withDefault.server, "create_asset", {
      vault: "/v",
      class: "ems__Task",
      label: "L",
    });
    expect(withDefault.calls[0].args).toContain("--validate");

    const optedOut = makeServer();
    await callTool(optedOut.server, "create_asset", {
      vault: "/v",
      class: "ems__Task",
      label: "L",
      validate: false,
    });
    expect(optedOut.calls[0].args).not.toContain("--validate");
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d create_effort applies the homoiconic command and returns the created envelope", async () => {
    const envelope = {
      command: "create-task",
      target: "areas/a.md",
      created: [{ uuid: "u-2", path: "efforts/u-2.md", label: "New Task" }],
    };
    const { server, calls } = makeServer({
      stdout: JSON.stringify(envelope) + "\n",
    });

    const result = await callTool(server, "create_effort", {
      vault: "/v",
      command: "create-task",
      target: "areas/a.md",
      input: { value: "New Task" },
    });

    expect(calls[0].args).toEqual([
      "apply",
      "create-task",
      "areas/a.md",
      "--vault",
      "/v",
      "--json",
      "--yes",
      "--input",
      '{"value":"New Task"}',
    ]);
    expect(JSON.parse(result.content[0].text)).toEqual(envelope);
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d a non-zero CLI exit becomes a tool error carrying the diagnostic and exit code", async () => {
    const { server } = makeServer({
      exitCode: 2,
      stderr:
        "❌ Unknown property 'ems__Effort_parentEffort'. Did you mean 'ems__Effort_parent'?",
    });

    const result = await callTool(server, "create_asset", {
      vault: "/v",
      class: "ems__Task",
      label: "L",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exited 2");
    expect(result.content[0].text).toContain("ems__Effort_parent");
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d missing required arguments and unknown tools are tool errors, not protocol errors", async () => {
    const { server, calls } = makeServer();

    const missing = await callTool(server, "create_asset", { vault: "/v" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("class");
    expect(missing.content[0].text).toContain("label");

    const unknown = await callTool(server, "nope", {});
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("Unknown tool: nope");

    // Neither reached the CLI.
    expect(calls).toHaveLength(0);
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d an unsupported method returns JSON-RPC method-not-found and a notification returns no response", async () => {
    const { server } = makeServer();

    const unsupported = (await server.handle({
      jsonrpc: "2.0",
      id: 9,
      method: "resources/list",
    })) as JsonRpcResponse;
    expect(unsupported.error?.code).toBe(JSON_RPC_METHOD_NOT_FOUND);

    // A notification has no `id` — JSON-RPC forbids answering it.
    const notification = await server.handle({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notification).toBeNull();
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d the stdio loop answers requests, stays silent for notifications and reports malformed JSON", async () => {
    const { server } = makeServer();
    const written: string[] = [];

    await runStdioServer(
      server,
      Readable.from([
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) + "\n",
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
        "{ not json\n",
      ]),
      (line) => written.push(line),
    );

    // 2 writes: the initialize reply and the parse error — the notification is silent.
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[0]).result.protocolVersion).toBe(
      MCP_PROTOCOL_VERSION,
    );
    expect(JSON.parse(written[1]).error.code).toBe(JSON_RPC_PARSE_ERROR);
  });
});

describe("createSelfCliRunner — real execFile round-trip (no shell)", () => {
  let dir: string;
  let script: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-argv-"));
    script = join(dir, "echo-argv.cjs");
    // Prints the argument vector it actually received.
    writeFileSync(
      script,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d passes hostile values to the CLI verbatim, with no shell interpolation or word splitting", async () => {
    const runner = createSelfCliRunner(script);
    const hostile = [
      "$(whoami) `id` $HOME",
      "two  spaces",
      "semi; ls",
      "glob *.md",
      "$&",
    ];

    const result = await runner(["create", "--label", ...hostile]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      "create",
      "--label",
      ...hostile,
    ]);
  });

  it("@req:264ccef6-4737-4076-95d8-053326c9ee1d surfaces a non-zero child exit as data instead of rejecting", async () => {
    const failing = join(dir, "fail.cjs");
    writeFileSync(failing, "process.stderr.write('boom'); process.exit(3);\n");

    const result = await createSelfCliRunner(failing)([]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");
  });
});
