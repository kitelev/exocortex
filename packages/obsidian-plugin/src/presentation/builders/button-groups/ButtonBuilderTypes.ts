import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ActionButton, ButtonGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { CommandVisibilityContext } from "@kitelev/exocortex-core";
import { ObsidianApp, ExocortexPluginInterface, MetadataRecord } from '@plugin/types';

/**
 * Context passed to button group builders
 */
export interface ButtonBuilderContext {
  app: ObsidianApp;
  settings: ExocortexSettings;
  plugin: ExocortexPluginInterface;
  file: TFile;
  metadata: MetadataRecord;
  instanceClass: string | string[] | null;
  visibilityContext: CommandVisibilityContext;
  logger: ILogger;
  refresh: () => Promise<void>;
}

/**
 * Interface for button group builders
 */
export interface IButtonGroupBuilder {
  build(context: ButtonBuilderContext): ActionButton[] | Promise<ActionButton[]>;
  getGroupId(): string;
  getGroupTitle(): string;
}

/**
 * Helper to create button group if it has visible buttons
 */
export async function createButtonGroupIfVisible(
  builder: IButtonGroupBuilder,
  context: ButtonBuilderContext,
): Promise<ButtonGroup | null> {
  const buttons = await builder.build(context);
  if (buttons.some((btn) => btn.visible)) {
    return {
      id: builder.getGroupId(),
      title: builder.getGroupTitle(),
      buttons,
    };
  }
  return null;
}
