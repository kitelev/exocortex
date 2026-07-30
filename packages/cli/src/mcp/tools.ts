/**
 * MCP tool definitions and their argv builders (project 38800c80 W6,
 * req 264ccef6).
 *
 * The builders are pure and exported so tests can assert the EXACT argument
 * vector — the vector is the contract that makes shell metacharacters
 * un-interpretable.
 */

/** A tool as advertised by `tools/list`. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Input accepted by the `create_asset` tool. */
export interface CreateAssetInput {
  vault: string;
  class: string;
  label: string;
  properties?: Record<string, string | string[]>;
  aliases?: string[];
  body?: string;
  /** `false` → `--no-status`; a string → `--status <name>`; omitted → CLI default. */
  status?: string | false;
  /** Defaults to TRUE on the MCP surface (req 264ccef6, design point 5). */
  validate?: boolean;
  dryRun?: boolean;
}

/** Input accepted by the `create_effort` tool. */
export interface CreateEffortInput {
  vault: string;
  command: string;
  target: string;
  /** `userInput` for the grounding, serialised into `--input <json>`. */
  input?: Record<string, unknown>;
  dryRun?: boolean;
}

/**
 * Build the argv for `create_asset` → the generic `create` verb.
 *
 * Every caller-supplied value becomes its OWN argv element, so no character in
 * a label, body or property value is ever interpreted.
 */
export function buildCreateAssetArgs(input: CreateAssetInput): string[] {
  const args: string[] = [
    "create",
    "--vault",
    input.vault,
    "--class",
    input.class,
    "--label",
    input.label,
  ];

  if (input.aliases && input.aliases.length > 0) {
    // `--aliases <names...>` is variadic; Commander stops collecting at the next
    // `--flag`, and every following token we emit is one.
    args.push("--aliases", ...input.aliases);
  }

  for (const [key, value] of Object.entries(input.properties ?? {})) {
    // A repeated key accumulates into a YAML array downstream (#3759), so a
    // multi-value property is emitted as one `--property` per element.
    const values = Array.isArray(value) ? value : [value];
    for (const single of values) {
      args.push("--property", `${key}=${single}`);
    }
  }

  if (input.body !== undefined) {
    args.push("--body", input.body);
  }

  if (input.status === false) {
    args.push("--no-status");
  } else if (typeof input.status === "string") {
    args.push("--status", input.status);
  }

  // Inline-SHACL is ON unless the caller explicitly opts out: the MCP surface is
  // the agent surface, where landing a non-conformant asset is the expensive
  // outcome (the CLI keeps `--validate` opt-in for interactive use).
  if (input.validate !== false) {
    args.push("--validate");
  }

  if (input.dryRun) {
    args.push("--dry-run");
  }

  return args;
}

/**
 * Build the argv for `create_effort` → the HOMOICONIC `apply` path.
 *
 * Effort creation is already homoiconic (RFC 7c7859d1 alternative E: the
 * `Create Task` / `Create Project` exocmd commands), so this tool drives
 * `apply <cmd> <target> --json --yes` rather than the generic `create`.
 */
export function buildCreateEffortArgs(input: CreateEffortInput): string[] {
  const args: string[] = [
    "apply",
    input.command,
    input.target,
    "--vault",
    input.vault,
    "--json",
    "--yes",
  ];

  if (input.input !== undefined) {
    args.push("--input", JSON.stringify(input.input));
  }

  if (input.dryRun) {
    args.push("--dry-run");
  }

  return args;
}

const PROPERTY_VALUE_SCHEMA = {
  oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
} as const;

/** The two MVP tools advertised by `tools/list`. */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "create_asset",
    description:
      "Create a vault asset through the Exocortex creation pipeline (co-location by exo__Asset_isDefinedBy, dangling-wikilink rejection, unknown-property-name rejection and — by default — SHACL-lite conformance validation before the file is written). Values are passed as an argument vector, so labels, bodies and property values containing $, backticks, quotes, parentheses or newlines are preserved byte-identically.",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Path to the Obsidian vault." },
        class: {
          type: "string",
          description: "Class UUID or short name (e.g. ems__Task).",
        },
        label: {
          type: "string",
          description: "exo__Asset_label for the new asset.",
        },
        properties: {
          type: "object",
          description:
            "Frontmatter properties. A string sets one value; an array of strings sets a multi-value (YAML array) property.",
          additionalProperties: PROPERTY_VALUE_SCHEMA,
        },
        aliases: {
          type: "array",
          items: { type: "string" },
          description: "Additional aliases.",
        },
        body: { type: "string", description: "Markdown body of the asset." },
        status: {
          type: ["string", "boolean"],
          description:
            "ems__Effort_status name for a status-bearing class (e.g. Backlog, Doing). Pass false to create a status-less asset. Omit for the CLI default.",
        },
        validate: {
          type: "boolean",
          default: true,
          description:
            "Run the pre-write SHACL-lite conformance gate. Defaults to true; pass false to skip it.",
        },
        dryRun: {
          type: "boolean",
          description: "Preview without writing the file.",
        },
      },
      required: ["vault", "class", "label"],
      additionalProperties: false,
    },
  },
  {
    name: "create_effort",
    description:
      "Create an effort (Task / Project / Area / …) by applying a homoiconic Exocortex command to a target asset — the canonical effort-creation path. Returns the {command,target,created:[{uuid,path,label}]} envelope.",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Path to the Obsidian vault." },
        command: {
          type: "string",
          description:
            "Command cliName slug (e.g. create-task) or command UUID.",
        },
        target: {
          type: "string",
          description:
            "Vault-relative path to the target asset the command is applied to.",
        },
        input: {
          type: "object",
          description:
            'userInput for the command\'s grounding (serialised as JSON), e.g. {"value":"New label"}.',
        },
        dryRun: {
          type: "boolean",
          description: "Preview without writing.",
        },
      },
      required: ["vault", "command", "target"],
      additionalProperties: false,
    },
  },
];
