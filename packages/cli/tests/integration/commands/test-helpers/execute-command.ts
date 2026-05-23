/**
 * Integration harness wrapper — dispatches a grounding against a fixture file
 * through the real `GroundingExecutor` (RFC v4 §7.1 primary approach).
 *
 * Wires the three Phase 1 helpers together:
 *
 *   fixture-factory → creates the tmp `.md` host asset
 *   user-input-factory → synthesises `--input` JSON when the grounding schema
 *                        declares one
 *   execute-command (this file) → instantiates `GroundingExecutor` with node-fs
 *                                 adapters and calls `.execute(...)`
 *
 * Mirrors the CLI dispatch path: `@kitelev/exocortex-cli command <uid>
 * <file> --input ...` delegates to the same `GroundingExecutor`, so the test
 * covers what a user sees when clicking an inline button in Obsidian.
 *
 * No CLI subprocess is spawned here (per Phase 0 note on `dd3bdaaa` — subprocess
 * harness is deferred tech debt, ticket #2883). Real async fs, no mocks.
 */
import * as fs from "fs";
import * as fsp from "fs/promises";
import { GroundingExecutor, GroundingType, ServiceRegistry } from "exocortex";
import type {
  GroundingDefinition,
  IFileSystemReader,
  IFileSystemWriter,
} from "exocortex";
import type { GroundingData } from "./extract-target-class.js";

// ---------------------------------------------------------------------------
// Minimal node-fs adapters — only the methods GroundingExecutor exercises.
// ---------------------------------------------------------------------------

export class NodeFileSystemReader implements IFileSystemReader {
  async readFile(filePath: string): Promise<string> {
    return fsp.readFile(filePath, "utf8");
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getMarkdownFiles(rootPath?: string): Promise<string[]> {
    const root = rootPath ?? ".";
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
      }
    };
    await walk(root);
    return out;
  }
}

export class NodeFileSystemWriter implements IFileSystemWriter {
  async createFile(filePath: string, content: string): Promise<string> {
    await fsp.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return filePath;
  }
  async updateFile(filePath: string, content: string): Promise<void> {
    await fsp.writeFile(filePath, content, "utf8");
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    await fsp.writeFile(filePath, content, "utf8");
  }
  async deleteFile(filePath: string): Promise<void> {
    await fsp.unlink(filePath);
  }
  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await fsp.rename(oldPath, newPath);
  }
}

// ---------------------------------------------------------------------------
// GroundingData → GroundingDefinition
// ---------------------------------------------------------------------------

const TYPE_LOOKUP: ReadonlyMap<string, GroundingType> = new Map([
  ["property_set", GroundingType.PROPERTY_SET],
  ["property_delete", GroundingType.PROPERTY_DELETE],
  ["composite", GroundingType.COMPOSITE],
  ["service_call", GroundingType.SERVICE_CALL],
  ["create_instance", GroundingType.CREATE_INSTANCE],
  ["sparql_update", GroundingType.SPARQL_UPDATE],
]);

/**
 * Convert a parsed `GroundingData` (produced by `loadStarterKitContext`) into
 * the `GroundingDefinition` shape the real `GroundingExecutor` expects.
 *
 * The executor's service_call dispatcher reads `targetProperty` as the
 * `serviceId` (executor:331). Starter-kit fixtures split the two fields
 * (`exocmd__Grounding_serviceId` + `exocmd__Grounding_targetProperty`);
 * vault groundings collapse them (`exocmd__Grounding_targetProperty` holds
 * the serviceId directly). To dispatch starter-kit fixtures correctly, we
 * mirror `CommandResolver.loadGrounding` (CommandResolver:463-470): for
 * `service_call`, `serviceId` wins over `targetProperty` when both are set.
 * When only `targetProperty` is set we fall back to it (vault shape). When
 * only `serviceId` is set we use it (starter-kit-with-no-targetProperty shape).
 */
export function toGroundingDefinition(
  data: GroundingData,
): GroundingDefinition {
  const type = TYPE_LOOKUP.get(data.type ?? "") ?? GroundingType.PROPERTY_SET;
  const targetProperty =
    type === GroundingType.SERVICE_CALL
      ? data.serviceId ?? data.targetProperty
      : data.targetProperty;
  const steps = data.steps?.map(toGroundingDefinition);
  return {
    id: data.uid,
    label: data.label,
    type,
    targetProperty,
    targetValue: data.targetValue,
    targetValueRef: data.targetValueRef,
    targetValueLiteral: data.targetValueLiteral,
    targetValueSubstitution: data.targetValueSubstitution,
    targetClass: data.targetClass,
    steps,
  };
}

// ---------------------------------------------------------------------------
// executeCommandHarness — end-to-end dispatch
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  readonly grounding: GroundingData;
  readonly filePath: string;
  readonly targetIRI: string;
  readonly userInput?: Record<string, unknown>;
  readonly serviceRegistry?: ServiceRegistry;
}

export interface ExecuteHarnessResult {
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Dispatch a grounding via the real `GroundingExecutor` and return the raw
 * `ExecutionResult`. Caller reads the file afterwards to diff `before` vs
 * `after` frontmatter.
 */
export async function executeCommandHarness(
  opts: ExecuteOptions,
): Promise<ExecuteHarnessResult> {
  const executor = new GroundingExecutor(
    new NodeFileSystemReader(),
    new NodeFileSystemWriter(),
    opts.serviceRegistry ?? new ServiceRegistry(),
  );
  const definition = toGroundingDefinition(opts.grounding);
  return executor.execute(
    definition,
    opts.targetIRI,
    opts.filePath,
    opts.userInput,
  );
}
