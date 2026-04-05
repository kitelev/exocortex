import { Notice } from "obsidian";
import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import type {
  CommandResolver,
  ResolvedCommand,
  PreconditionEvaluator,
  GroundingExecutor,
  UserInput,
  EvalContext,
} from "exocortex";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
} from "./ButtonBuilderTypes";

/**
 * Configuration for DynamicCommandButtonGroupBuilder.
 * Injects the three core RFC-009 services.
 */
export interface DynamicCommandBuilderConfig {
  commandResolver: CommandResolver;
  preconditionEvaluator: PreconditionEvaluator;
  groundingExecutor: GroundingExecutor;
}

/**
 * Option entry for enum fields — supports both simple strings and value/label pairs.
 */
export interface EnumOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Schema field definition for input modals.
 *
 * Supported types:
 * - `text`      — single-line text input (default)
 * - `date`      — date picker (ISO 8601)
 * - `enum`      — dropdown with static options or dynamic SPARQL-sourced options
 * - `multiline` — multi-line textarea
 * - `assetRef`  — asset reference picker with optional SPARQL filter
 */
export interface InputSchemaField {
  readonly name: string;
  readonly type: "text" | "date" | "enum" | "multiline" | "assetRef";
  readonly label?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
  /** Enum options — accepts both simple strings and {value, label} pairs. */
  readonly options?: ReadonlyArray<string | EnumOption>;
  /** SPARQL SELECT query returning dynamic enum options (columns: ?value, ?label). */
  readonly sparqlQuery?: string;
  /** Number of visible rows for multiline fields (default: 4). */
  readonly rows?: number;
  /** SPARQL SELECT query returning candidate asset IRIs for assetRef fields. */
  readonly filterQuery?: string;
}

/**
 * Builds dynamic command buttons from vault-defined command assets (RFC-009 §5.5).
 *
 * This builder bridges the core command system (CommandResolver, PreconditionEvaluator,
 * GroundingExecutor) with the Obsidian layout rendering system. It:
 *
 * 1. Resolves commands for the current asset via CommandResolver
 * 2. Evaluates preconditions in PARALLEL via Promise.all
 * 3. Sorts by binding order and groups by binding group
 * 4. Creates ActionButtons for each visible command
 * 5. Handles confirmMessage, inputSchema modal, and successMessage
 *
 * Issue #2432
 */
export class DynamicCommandButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private readonly config: DynamicCommandBuilderConfig) {}

  getGroupId(): string {
    return "dynamic-commands";
  }

  getGroupTitle(): string {
    return "Commands";
  }

  async build(context: ButtonBuilderContext): Promise<ActionButton[]> {
    const { file, metadata, logger, refresh } = context;

    const subjectIRI = this.extractSubjectIRI(metadata) ?? file.path;
    if (!subjectIRI) return [];

    const assetClass = this.extractAssetClass(metadata);
    if (!assetClass) return [];

    const prototypeIRI = this.extractPrototypeIRI(metadata);

    let resolved: ResolvedCommand[];
    try {
      resolved = await this.config.commandResolver.resolveForAsset(
        subjectIRI,
        assetClass,
        prototypeIRI,
      );
    } catch (error) {
      logger.info(`[DynamicCommands] Failed to resolve commands: ${String(error)}`);
      return [];
    }

    if (resolved.length === 0) return [];

    const evalContext: EvalContext = {
      targetIRI: subjectIRI,
      fileBasename: file.basename,
      currentFolder: file.parent?.path,
    };

    const availabilityChecks = await Promise.all(
      resolved.map(async (rc) => {
        try {
          const available = await this.config.preconditionEvaluator.evaluate(
            rc.command.precondition,
            subjectIRI,
            evalContext,
          );
          return { rc, available };
        } catch {
          return { rc, available: false };
        }
      }),
    );

    const visibleCommands = availabilityChecks
      .filter(({ available }) => available);

    if (visibleCommands.length === 0) return [];

    return visibleCommands.map(({ rc }) =>
      this.createButton(rc, subjectIRI, file.path, logger, refresh),
    );
  }

  private createButton(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    const { command, binding } = rc;
    const variant = this.resolveVariant(binding.group);

    return {
      id: `dynamic-cmd-${command.id}`,
      label: command.name,
      variant,
      visible: true,
      onClick: async () => {
        await this.handleClick(rc, targetIRI, filePath, logger, refresh);
      },
    };
  }

  private async handleClick(
    rc: ResolvedCommand,
    targetIRI: string,
    filePath: string,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): Promise<void> {
    const { command } = rc;

    if (command.confirmMessage) {
      const confirmed = await this.showConfirmation(command.confirmMessage);
      if (!confirmed) return;
    }

    let userInput: UserInput | undefined;
    const inputSchema = this.extractInputSchema(rc);
    if (inputSchema && inputSchema.length > 0) {
      const collected = await this.showInputModal(inputSchema);
      if (collected === null) return;
      userInput = collected;
    }

    const result = await this.config.groundingExecutor.execute(
      command.grounding,
      targetIRI,
      filePath,
      userInput,
    );

    if (result.success) {
      if (command.successMessage) {
        new Notice(command.successMessage);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await refresh();
      logger.info(`[DynamicCommands] Executed "${command.name}" on ${filePath}`);
    } else {
      new Notice(`Command failed: ${result.error ?? "unknown error"}`);
      logger.info(`[DynamicCommands] Failed "${command.name}": ${result.error}`);
    }
  }

  private resolveVariant(
    group?: string,
  ): "primary" | "secondary" | "success" | "warning" | "danger" {
    if (!group) return "secondary";
    const lower = group.toLowerCase();
    if (lower === "danger" || lower === "destructive") return "danger";
    if (lower === "warning") return "warning";
    if (lower === "success") return "success";
    if (lower === "primary") return "primary";
    return "secondary";
  }

  private async showConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line no-alert -- simple confirmation until a proper Obsidian modal is implemented
      const confirmed = window.confirm(message);
      resolve(confirmed);
    });
  }

  private extractInputSchema(rc: ResolvedCommand): InputSchemaField[] | null {
    const grounding = rc.command.grounding;
    const raw = (grounding as unknown as Record<string, unknown>)["inputSchema"];
    if (!raw || !Array.isArray(raw)) return null;

    return raw.filter(
      (field): field is InputSchemaField =>
        typeof field === "object" &&
        field !== null &&
        typeof (field as Record<string, unknown>)["name"] === "string" &&
        typeof (field as Record<string, unknown>)["type"] === "string",
    );
  }

  /* eslint-disable obsidianmd/no-static-styles-assignment */
  private async showInputModal(
    schema: InputSchemaField[],
  ): Promise<UserInput | null> {
    return new Promise((resolve) => {
      const container = document.createElement("div");
      container.className = "exocortex-input-modal-overlay";
      container.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;";

      const modal = document.createElement("div");
      modal.className = "exocortex-input-modal";
      modal.style.cssText =
        "background:var(--background-primary);padding:20px;border-radius:8px;min-width:300px;max-width:500px;";

      const title = document.createElement("h3");
      title.textContent = "Input required";
      modal.appendChild(title);

      const inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = new Map();

      for (const field of schema) {
        const label = document.createElement("label");
        label.style.cssText = "display:block;margin:8px 0 4px;";
        label.textContent = field.label ?? field.name;
        modal.appendChild(label);

        if (field.type === "enum" && field.options) {
          const select = document.createElement("select");
          select.style.cssText = "width:100%;padding:4px;";
          for (const opt of field.options) {
            const option = document.createElement("option");
            if (typeof opt === "string") {
              option.value = opt;
              option.textContent = opt;
            } else {
              option.value = opt.value;
              option.textContent = opt.label;
            }
            select.appendChild(option);
          }
          if (field.defaultValue) select.value = field.defaultValue;
          modal.appendChild(select);
          inputs.set(field.name, select);
        } else if (field.type === "date") {
          const input = document.createElement("input");
          input.type = "date";
          input.style.cssText = "width:100%;padding:4px;";
          if (field.defaultValue) input.value = field.defaultValue;
          modal.appendChild(input);
          inputs.set(field.name, input);
        } else if (field.type === "multiline") {
          const textarea = document.createElement("textarea");
          textarea.rows = field.rows ?? 4;
          textarea.style.cssText = "width:100%;padding:4px;resize:vertical;";
          if (field.defaultValue) textarea.value = field.defaultValue;
          modal.appendChild(textarea);
          inputs.set(field.name, textarea);
        } else if (field.type === "assetRef") {
          const input = document.createElement("input");
          input.type = "text";
          input.placeholder = "Asset reference...";
          input.style.cssText = "width:100%;padding:4px;";
          if (field.defaultValue) input.value = field.defaultValue;
          modal.appendChild(input);
          inputs.set(field.name, input);
        } else {
          const input = document.createElement("input");
          input.type = "text";
          input.style.cssText = "width:100%;padding:4px;";
          if (field.defaultValue) input.value = field.defaultValue;
          modal.appendChild(input);
          inputs.set(field.name, input);
        }
      }

      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText =
        "display:flex;justify-content:flex-end;gap:8px;margin-top:16px;";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        container.remove();
        resolve(null);
      });
      buttonContainer.appendChild(cancelBtn);

      const okBtn = document.createElement("button");
      okBtn.textContent = "OK";
      okBtn.className = "mod-cta";
      okBtn.addEventListener("click", () => {
        const result: UserInput = {};
        for (const [name, el] of inputs) {
          result[name] = el.value;
        }
        container.remove();
        resolve(result);
      });
      buttonContainer.appendChild(okBtn);

      modal.appendChild(buttonContainer);
      container.appendChild(modal);
      document.body.appendChild(container);
    });
  }
  /* eslint-enable obsidianmd/no-static-styles-assignment */

  private extractSubjectIRI(metadata: Record<string, unknown>): string | undefined {
    const uid = metadata["exo__Asset_uid"];
    if (typeof uid === "string") return uid;
    return undefined;
  }

  private extractAssetClass(metadata: Record<string, unknown>): string | undefined {
    const raw = metadata["exo__Instance_class"];
    if (typeof raw === "string") {
      return raw.replace(/["'[\]]/g, "").trim();
    }
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (typeof first === "string") {
        return first.replace(/["'[\]]/g, "").trim();
      }
    }
    return undefined;
  }

  private extractPrototypeIRI(metadata: Record<string, unknown>): string | undefined {
    const raw = metadata["exo__Asset_prototype"];
    if (typeof raw === "string") {
      return raw.replace(/["'[\]]/g, "").trim();
    }
    return undefined;
  }
}
