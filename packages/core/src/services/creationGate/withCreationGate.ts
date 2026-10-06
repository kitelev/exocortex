import { frontmatterBlockBody } from "../../utilities/frontmatterBlock";
import { parseYamlFrontmatterTolerant } from "../../utilities/parseYamlFrontmatter";
import type { FrontmatterByRef, CreationGatePolicy } from "./CreationGatePolicy";
import { CreationGateRefusedError } from "./CreationGateRefusedError";
import {
  evaluateCreationGate,
  type CreationGateVerdict,
} from "./evaluateCreationGate";
import {
  loadCreationGatePolicies,
  type CreationGatePolicySource,
} from "./loadCreationGatePolicies";
import { textOf, valuesOf } from "./refs";

/** Parse a file's text into its frontmatter (`{}` when there is none). */
export function parseCandidateFrontmatter(content: string): Record<string, unknown> {
  const body = frontmatterBlockBody(content);
  if (body === null) return {};
  return parseYamlFrontmatterTolerant(body) ?? {};
}

export interface CreationGateSessionOptions {
  /** Where rule assets come from (loaded once per session). */
  readonly source: CreationGatePolicySource;
  /** The surface's vault lookup; the session puts its journal in front of it. */
  readonly frontmatterByRef: FrontmatterByRef;
}

/**
 * One command execution's view of the gate: the rules, loaded ONCE, and the
 * EXECUTION JOURNAL — the frontmatter of every file this execution has already
 * been allowed to create. A parent created earlier in the same batch or
 * composite command is not yet visible to the vault index (or to the plugin's
 * `metadataCache`), so every lookup consults the journal first.
 */
export class CreationGateSession {
  private policiesLoad?: Promise<CreationGatePolicy[]>;
  private readonly journal = new Map<string, Record<string, unknown>>();
  /** The surface lookup with the journal in front of it. */
  readonly frontmatterByRef: FrontmatterByRef;

  constructor(private readonly options: CreationGateSessionOptions) {
    this.frontmatterByRef = async (ref: string) => {
      const hit = this.journal.get(ref.trim().toLowerCase());
      if (hit) return hit;
      return options.frontmatterByRef(ref);
    };
  }

  /** The rules in force for this execution (loaded on first use). */
  policies(): Promise<CreationGatePolicy[]> {
    this.policiesLoad ??= loadCreationGatePolicies(this.options.source, {
      frontmatterByRef: this.frontmatterByRef,
    });
    return this.policiesLoad;
  }

  /** The verdict for a file this execution is about to create. */
  async judge(path: string, content: string): Promise<CreationGateVerdict> {
    const policies = await this.policies();
    if (policies.length === 0) return { allowed: true };
    return evaluateCreationGate(
      { path, content, frontmatter: parseCandidateFrontmatter(content) },
      policies,
      { frontmatterByRef: this.frontmatterByRef },
    );
  }

  /** {@link judge}, throwing {@link CreationGateRefusedError} on a refusal. */
  async assertAllowed(path: string, content: string): Promise<void> {
    const verdict = await this.judge(path, content);
    if (!verdict.allowed) throw new CreationGateRefusedError(verdict, path);
  }

  /**
   * Put a file into the execution journal, addressable by its UID, label,
   * aliases, basename and path — the forms a later reference may use.
   */
  remember(path: string, content: string): void {
    const frontmatter = parseCandidateFrontmatter(content);
    const keys = new Set<string>();
    const add = (value: string | null): void => {
      if (value) keys.add(value.trim().toLowerCase());
    };
    add(textOf(frontmatter.exo__Asset_uid));
    add(textOf(frontmatter.exo__Asset_label));
    for (const alias of valuesOf(frontmatter.aliases)) {
      if (typeof alias === "string") add(alias);
    }
    add(path);
    const basename = path.replace(/^.*\//, "");
    add(basename);
    add(basename.replace(/\.md$/i, ""));
    for (const key of keys) {
      if (key.length > 0) this.journal.set(key, frontmatter);
    }
  }
}

/**
 * What a gated writer needs from a session: judge-and-throw BEFORE the write,
 * journal AFTER it. {@link CreationGateSession} is one; a surface that builds
 * its writers once (the plugin) passes a scope that opens a session per
 * command execution.
 */
export interface CreationGateWriterSession {
  assertAllowed(path: string, content: string): Promise<void>;
  remember(path: string, content: string): void;
}

type WriterMethod = (path: string, content: string) => Promise<unknown>;

async function fileAlreadyThere(target: object, path: string): Promise<boolean> {
  const probe = target as {
    fileExists?: (p: string) => Promise<boolean>;
    exists?: (p: string) => Promise<boolean>;
  };
  try {
    if (typeof probe.fileExists === "function") return await probe.fileExists(path);
    if (typeof probe.exists === "function") return await probe.exists(path);
  } catch {
    return false;
  }
  return false;
}

/**
 * Gate a writer: `createFile` (IFileSystemWriter), `create` (IVaultAdapter) and
 * `writeFile` when the file does not exist yet judge the bytes they are handed
 * BEFORE writing; a refusal throws and nothing is written. An allowed file goes
 * into the execution journal after it is written. Every other member passes
 * through unchanged, bound to the original object, so the wrapper is a drop-in
 * for the writer it wraps (readers keep using the original).
 */
export function withCreationGate<T extends object>(
  writer: T,
  session: CreationGateWriterSession,
): T {
  return new Proxy(writer, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const method = value as WriterMethod;
      if (property === "createFile" || property === "create") {
        return async (path: string, content: string) => {
          await session.assertAllowed(path, content);
          const result = await method.call(target, path, content);
          session.remember(path, content);
          return result;
        };
      }
      if (property === "writeFile") {
        return async (path: string, content: string) => {
          const creating = !(await fileAlreadyThere(target, path));
          if (creating) await session.assertAllowed(path, content);
          const result = await method.call(target, path, content);
          if (creating) session.remember(path, content);
          return result;
        };
      }
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  });
}
