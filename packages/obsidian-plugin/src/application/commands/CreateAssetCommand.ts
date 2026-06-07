import type { App } from "obsidian";
import { ICommand } from "./ICommand";
import {
  GenericAssetCreationService,
  LoggingService,
  ShapeLoader,
  type AssetPropertyDefinition,
  type INotificationService,
  type ShapeRegistry,
} from "exocortex";
import type { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
import {
  showClassSelectionModal,
  type ClassSelectionModalResult,
} from '@plugin/presentation/modals/modalSchemas';
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
    private notifier: INotificationService,
    private schemaService?: OntologySchemaService,
    private sparqlQueryService?: SPARQLQueryService,
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

      // Step 3.5: Lazily load SHACL-lite shapes (#3384 H3 PR2). Built ONLY here,
      // on the Create command — never on plugin onload (the onload path is
      // fragile; see Profile bootstrap). The plugin already has the
      // in-memory triple store populated by the class-discovery query above, so
      // this is a cheap read of the existing graph. Failure is non-fatal: the
      // core service falls back to scalar (label-form / scalar) emission.
      const shapeRegistry = await this.loadShapeRegistry();

      // Step 4: Create the asset. Opt in (#3384 H3 PR2) to UID-canon class refs
      // (`exo__Instance_class: [[<uuid>]]`) and cardinality-aware property
      // emission. `classUid` is resolved during class discovery; when absent
      // the core service falls back to the legacy `[[<className>]]` label form.
      const createdFile = await this.genericAssetCreationService.createAsset(
        {
          className: selectedClass.className,
          classRefForm: "uuid",
          classUid: selectedClass.classUid,
          label: assetResult.label || undefined,
          propertyValues: assetResult.propertyValues,
          shapeRegistry,
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

      this.notifier.success(`${selectedClass.label} created: ${createdFile.basename}`);
    } catch (error) {
      this.notifier.error(`Failed to create asset: ${error instanceof Error ? error.message : String(error)}`);
      LoggingService.error("Create asset error", error instanceof Error ? error : undefined);
    }
  };

  /**
   * Show the class selection modal.
   */
  private async showClassSelectionModal(): Promise<ClassSelectionModalResult<DiscoveredClass>> {
    // Discover available classes
    let classes: DiscoveredClass[];

    try {
      classes = await this.classDiscoveryService.getCreatableClasses();
    } catch (error) {
      this.logger.warn("Failed to discover classes, using defaults", error);
      classes = this.classDiscoveryService.getDefaultClasses();
    }

    return showClassSelectionModal(this.app, classes);
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
   * Lazily build a SHACL-lite {@link ShapeRegistry} from the plugin's in-memory
   * RDF triple store for cardinality-aware property emission (#3179, #3384 H3
   * PR2).
   *
   * STRICT laziness: this runs only when the user executes the Create command,
   * never on plugin onload. It reads the already-populated triple store (the
   * class-discovery query ran first in the same flow), so no vault walk is
   * triggered here. Any failure — store unavailable, not yet initialised, or a
   * graph-walk error — is swallowed and `undefined` is returned, which makes
   * the core service fall back to scalar property emission.
   */
  private async loadShapeRegistry(): Promise<ShapeRegistry | undefined> {
    if (!this.sparqlQueryService || !this.sparqlQueryService.isReady()) {
      return undefined;
    }
    try {
      return await ShapeLoader.loadFromRDFGraph(
        this.sparqlQueryService.getTripleStore(),
      );
    } catch (error) {
      this.logger.warn("Failed to load shapes; falling back to scalar emission", error);
      return undefined;
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
