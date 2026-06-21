import type { App } from "obsidian";
import type { CommandPromptAdapter, UserInput } from "@kitelev/exocortex-core";
import { DynamicFormModal } from "@plugin/presentation/modals/DynamicFormModal";
import type { InputSchemaField } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";

/**
 * Obsidian-side implementation of {@link CommandPromptAdapter}.
 *
 * - `confirm()` uses `window.confirm` (matches legacy
 *   `DynamicCommandButtonGroupBuilder.showConfirmation` UX; replacing it
 *   with an Obsidian modal is tracked as a separate UX task).
 * - `promptInputSchema()` opens {@link DynamicFormModal}. The schema array
 *   is already validated by `CommandResolver` when parsing
 *   `exocmd__Grounding_inputSchema` JSON, so the cast to
 *   `InputSchemaField[]` is safe — the runtime invariants match.
 *
 * Source: code-RFC `1429fcd0-0948-4a42-89c4-8d1426e9bc7a` (PR-1).
 */
export class ObsidianCommandPromptAdapter implements CommandPromptAdapter {
  constructor(private readonly app: App) {}

  async confirm(message: string): Promise<boolean> {
    // eslint-disable-next-line no-alert -- preserves legacy UX; modal replacement tracked separately
    return window.confirm(message);
  }

  async promptInputSchema(
    fields: ReadonlyArray<unknown>,
  ): Promise<UserInput | null> {
    const modal = new DynamicFormModal(this.app, fields as InputSchemaField[]);
    const result = await modal.waitForResult();
    return result;
  }
}
