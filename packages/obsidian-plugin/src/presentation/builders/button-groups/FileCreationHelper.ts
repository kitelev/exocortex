import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { showLabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianApp } from '@plugin/types';

export interface FileCreationResult {
  path: string;
}

export interface FileCreationOptions {
  openInNewTab?: boolean;
}

/**
 * Helper for common file creation and navigation patterns
 */
export async function openCreatedFile(
  app: ObsidianApp,
  createdFile: FileCreationResult,
  options: FileCreationOptions,
  logger: ILogger,
  logMessage: string,
): Promise<void> {
  const tFile = app.vault.getAbstractFileByPath(createdFile.path);
  if (!tFile || !(tFile instanceof TFile)) {
    throw new Error(`Created file not found: ${createdFile.path}`);
  }
  const leaf = options.openInNewTab
    ? app.workspace.getLeaf("tab")
    : app.workspace.getLeaf(false);
  await leaf.openFile(tFile);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  logger.info(logMessage);
}

/**
 * Prompt user for label with optional task size
 */
export async function promptForLabel(
  app: ObsidianApp,
  defaultValue: string = "",
  showTaskSize: boolean = true,
): Promise<LabelInputModalResult> {
  return showLabelInputModal(app, defaultValue, showTaskSize);
}
