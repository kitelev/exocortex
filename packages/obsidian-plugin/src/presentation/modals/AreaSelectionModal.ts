import { App, Modal } from "obsidian";
import { MetadataExtractor } from "exocortex";
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { AssetClass } from "exocortex";

export interface AreaSelectionModalResult {
  selectedArea: string | null;
}

export class AreaSelectionModal extends Modal {
  private selectedArea: string | null = null;
  private onSubmit: (result: AreaSelectionModalResult) => void;
  private selectEl: HTMLSelectElement | null = null;
  private vaultAdapter: ObsidianVaultAdapter;
  private metadataExtractor: MetadataExtractor;

  constructor(
    app: App,
    onSubmit: (result: AreaSelectionModalResult) => void,
    currentActiveArea: string | null,
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.selectedArea = currentActiveArea;
    this.vaultAdapter = new ObsidianVaultAdapter(
      app.vault,
      app.metadataCache,
      app,
    );
    this.metadataExtractor = new MetadataExtractor(this.vaultAdapter);
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("exocortex-area-selection-modal");

    contentEl.createEl("h2", { text: "Set focus area" });

    contentEl.createEl("p", {
      text: "Select an area to focus on. Only efforts related to this area (or its children) will be shown in daily note layouts.",
      cls: "exocortex-modal-description",
    });

    const selectContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.selectEl = selectContainer.createEl("select", {
      cls: "exocortex-modal-select dropdown",
    });

    const noneOption = this.selectEl.createEl("option", {
      value: "",
      text: "None (show all)",
    });

    if (!this.selectedArea) {
      noneOption.selected = true;
    }

    const rootAreas = this.getRootAreas();
    rootAreas.sort((a, b) => {
      const aLabel = a.label || a.title;
      const bLabel = b.label || b.title;
      return aLabel.localeCompare(bLabel);
    });

    for (const area of rootAreas) {
      const displayName = area.label || area.title;
      const option = this.selectEl.createEl("option", {
        value: area.title,
        text: displayName,
      });

      if (this.selectedArea === area.title) {
        option.selected = true;
      }
    }

    this.selectEl.addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.selectedArea = value || null;
    });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const okButton = buttonContainer.createEl("button", {
      text: "OK",
      cls: "mod-cta",
    });
    okButton.addEventListener("click", () => this.submit());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    setTimeout(() => {
      this.selectEl?.focus();
    }, 50);
  }

  private getRootAreas(): Array<{ title: string; label?: string }> {
    const rootAreas: Array<{ title: string; label?: string }> = [];
    const allFiles = this.app.vault.getMarkdownFiles();

    for (const file of allFiles) {
      const metadata = this.metadataExtractor.extractMetadata(file);

      const instanceClass = metadata.exo__Instance_class;
      const instanceClassArray = Array.isArray(instanceClass)
        ? instanceClass
        : [instanceClass];

      const isArea = instanceClassArray.some((cls: string) =>
        String(cls).includes(AssetClass.AREA),
      );

      if (!isArea) {
        continue;
      }

      const areaParent = metadata.ems__Area_parent;
      if (areaParent) {
        continue;
      }

      const isArchived = this.isArchivedAsset(metadata);
      if (isArchived) {
        continue;
      }

      // Skip areas from "09 Templates" folder
      if (file.path.includes("09 Templates")) {
        continue;
      }

      const label = metadata.exo__Asset_label
        ? String(metadata.exo__Asset_label)
        : undefined;

      rootAreas.push({
        title: file.basename,
        label,
      });
    }

    return rootAreas;
  }

  private isArchivedAsset(metadata: Record<string, unknown>): boolean {
    const archivedProp = metadata.exo__Asset_isArchived;
    if (archivedProp === true || archivedProp === "true") {
      return true;
    }
    if (Array.isArray(archivedProp) && archivedProp.length > 0) {
      const first = archivedProp[0];
      return first === true || first === "true";
    }
    return false;
  }

  private submit(): void {
    this.onSubmit({
      selectedArea: this.selectedArea,
    });
    this.close();
  }

  private cancel(): void {
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
