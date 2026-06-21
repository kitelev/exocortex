/**
 * Core type definitions for Exocortex plugin
 */

import type { App, Plugin, TFile } from "obsidian";
import type { IVaultAdapter } from "@kitelev/exocortex-core";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import type { ThemeResolver } from '@plugin/application/services/ThemeResolver';

/**
 * Metadata extracted from Obsidian frontmatter
 */
export interface AssetMetadata {
  exo__Asset_uid?: string;
  exo__Asset_label?: string;
  exo__Asset_createdAt?: string;
  exo__Asset_isDefinedBy?: string;
  exo__Asset_isArchived?: boolean | string | number;
  exo__Instance_class?: string | string[];

  ems__Effort_status?: string | string[];
  ems__Effort_votes?: number;
  exo__Asset_prototype?: string;
  ems__Effort_startTimestamp?: string | number;
  ems__Effort_plannedStartTimestamp?: string | number;
  ems__Effort_endTimestamp?: string | number;
  ems__Effort_plannedEndTimestamp?: string | number;
  ems__Effort_resolutionTimestamp?: string | number;

  ems__Task_size?: TaskSize;
  ems__Area_parent?: string;

  pn__DailyNote_day?: string;

  archived?: boolean | string | number;

  [key: string]: unknown;
}

/**
 * Task size options
 */
export type TaskSize = "S" | "M" | "L" | "XL";

/**
 * Command visibility context for determining which commands are available
 */
export interface CommandVisibilityContext {
  instanceClass: string | string[] | null;
  currentStatus: string | string[] | null;
  metadata: AssetMetadata;
  isArchived: boolean;
  currentFolder: string;
  expectedFolder: string | null;
}

/**
 * Extended plugin interface with Exocortex-specific properties
 */
export interface ExocortexPluginInterface extends Plugin {
  settings: Record<string, unknown> & {
    layoutVisible?: boolean;
    showArchivedAssets?: boolean;
    showEffortArea?: boolean;
    showEffortVotes?: boolean;
    excludedFolders?: string[];
  };
  vaultAdapter: IVaultAdapter;
  themeResolver?: ThemeResolver;
  saveSettings(): Promise<void>;
  refreshLayout?(): void;
}

/**
 * Type-safe plugin reference for Exocortex-specific features
 */
export type ExocortexPluginInstance = ExocortexPlugin;

/**
 * Generic metadata record for cases where full typing isn't needed
 */
export type MetadataRecord = Record<string, unknown>;

/**
 * Obsidian App type - re-exported from obsidian for type-safe usage
 */
export type ObsidianApp = App;

/**
 * Obsidian TFile type - re-exported for type-safe file handling
 */
export type ObsidianFile = TFile;
