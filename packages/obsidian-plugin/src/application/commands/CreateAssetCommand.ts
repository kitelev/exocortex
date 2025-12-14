import { App, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  GenericAssetCreationService,
  LoggingService,
  type AssetPropertyDefinition,
} from "exocortex";
import {
  ClassSelectionModal,
  type ClassSelectionModalResult,
} from '@plugin/presentation/modals/ClassSelectionModal';
import {
  DynamicAssetCreationModal,
  type DynamicAssetCreationResult,
} from '@plugin/presentation/modals/DynamicAssetCreationModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import type { OntologySchemaService, OntologyPropertyDefinition } from '@plugin/application/services/OntologySchemaService';
import type { ClassDiscoveryService, DiscoveredClass } from '@plugin/application/services/ClassDiscoveryService';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Global command for creating assets of any class type.
 *
 * This command can be invoked from anywhere (Ctrl/Cmd+P → "Create Asset")
 * and provides a two-step workflow:
 *
 * 1. **Class Selection**: User selects the type of asset to create
 *    from a dropdown of all available classes.
 *
 * 2. **Property Input**: User fills in a dynamically generated form
 *    with fields based on the selected class's ontology properties.
 *
 * The command uses the ontology schema to:
 * - Discover available classes (exo__Class instances)
 * - Fetch properties for the selected class (including inherited)
 * - Render appropriate input widgets based on property ranges
 * - Filter out deprecated properties
 *
 * @example
 * ```typescript
 * // User invokes "Create Asset" command
 * // Step 1: Modal shows dropdown with classes (Task, Project, Area, etc.)
 * // Step 2: After selecting "Task", form shows: Label, Task Size, Status, etc.
 * // On submit: Creates a new task file with the provided properties
 * ```
 */
export class CreateAssetCommand implements ICommand {
  id = "create-asset";
  name = "Create asset";
  private readonly logger = LoggerFactory.create("CreateAssetCommand");

  constructor(
    private app: App,
    private genericAssetCreationService: GenericAssetCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
    private classDiscoveryService: ClassDiscoveryService,
    private schemaService?: OntologySchemaService,
  ) {}

  /**
   * Global callback - no context file required.
   */
  callback = async (): Promise<void> => {
    try {
      // Step 1: Show class selection modal
      const classResult = await this.showClassSelectionModal();

      if (!classResult.selectedClass) {
        // User cancelled
        return;
      }

      const selectedClass = classResult.selectedClass;

      // Step 2: Show asset creation modal with dynamic fields
      const assetResult = await this.showAssetCreationModal(selectedClass);

      if (assetResult.label === null) {
        // User cancelled
        return;
      }

      // Step 3: Get property definitions for formatting
      const propertyDefinitions = await this.getPropertyDefinitions(selectedClass.className);

      // Step 4: Create the asset
      const createdFile = await this.genericAssetCreationService.createAsset(
        {
          className: selectedClass.className,
          label: assetResult.label || undefined,
          propertyValues: assetResult.propertyValues,
        },
        propertyDefinitions,
      );

      // Step 5: Open the created file
      const leaf = assetResult.openInNewTab
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getLeaf(false);
      const tfile = this.vaultAdapter.toTFile(createdFile);

      if (!tfile) {
        throw new Error(`Failed to convert created file to TFile: ${createdFile.path}`);
      }

      await leaf.openFile(tfile);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });

      new Notice(`${selectedClass.label} created: ${createdFile.basename}`);
    } catch (error) {
      new Notice(`Failed to create asset: ${error instanceof Error ? error.message : String(error)}`);
      LoggingService.error("Create asset error", error instanceof Error ? error : undefined);
    }
  };

  /**
   * Show the class selection modal.
   */
  private async showClassSelectionModal(): Promise<ClassSelectionModalResult> {
    // Discover available classes
    let classes: DiscoveredClass[];

    try {
      classes = await this.classDiscoveryService.getCreatableClasses();
    } catch (error) {
      this.logger.warn("Failed to discover classes, using defaults", error);
      classes = this.classDiscoveryService.getDefaultClasses();
    }

    return new Promise<ClassSelectionModalResult>((resolve) => {
      new ClassSelectionModal(
        this.app,
        classes,
        resolve,
      ).open();
    });
  }

  /**
   * Show the asset creation modal with dynamic fields.
   */
  private async showAssetCreationModal(
    selectedClass: DiscoveredClass,
  ): Promise<DynamicAssetCreationResult> {
    return new Promise<DynamicAssetCreationResult>((resolve) => {
      new DynamicAssetCreationModal(
        this.app,
        selectedClass.className,
        resolve,
        this.schemaService,
      ).open();
    });
  }

  /**
   * Get property definitions for formatting frontmatter values.
   */
  private async getPropertyDefinitions(
    className: string,
  ): Promise<AssetPropertyDefinition[]> {
    if (!this.schemaService) {
      return [];
    }

    try {
      const ontologyProps = await this.schemaService.getClassProperties(className);
      return ontologyProps.map((prop) => this.toAssetPropertyDefinition(prop));
    } catch (error) {
      this.logger.warn(`Failed to get property definitions for ${className}`, error);
      return [];
    }
  }

  /**
   * Convert ontology property definition to asset property definition.
   */
  private toAssetPropertyDefinition(
    ontologyProp: OntologyPropertyDefinition,
  ): AssetPropertyDefinition {
    return {
      name: ontologyProp.uri,
      fieldType: ontologyProp.fieldType,
    };
  }
}
