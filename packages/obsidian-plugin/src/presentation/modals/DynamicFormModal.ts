import { Modal, App } from "obsidian";
import React from "react";
import type {
  InputSchemaField,
  AssetRefCandidate,
} from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { DynamicForm } from "@plugin/presentation/components/dynamic-form/DynamicForm";
import { ErrorBoundary } from "@plugin/presentation/components/ErrorBoundary";
import { findAssetRefCandidates } from "@plugin/presentation/utils/assetRefCandidates";

export type UserInput = Record<string, string>;

/** Resolves the picker candidates for an `assetRef` field's `targetClassUid`. */
export type AssetRefCandidatesResolver = (
  classUid: string,
) => AssetRefCandidate[];

export interface DynamicFormModalOptions {
  readonly title?: string;
  readonly submitLabel?: string;
}

export class DynamicFormModal extends Modal {
  private readonly schema: InputSchemaField[];
  private readonly options: DynamicFormModalOptions;
  private readonly reactRenderer: ReactRenderer;
  private readonly candidatesResolver: AssetRefCandidatesResolver;
  private resolvePromise: ((value: UserInput | null) => void) | null = null;

  constructor(
    app: App,
    schema: InputSchemaField[],
    options?: DynamicFormModalOptions,
    // T1 "Create Instance" (project bbe40f8c) — injectable for unit tests;
    // production wiring scans the vault metadata cache by class UID.
    candidatesResolver?: AssetRefCandidatesResolver,
  ) {
    super(app);
    this.schema = schema;
    this.options = options ?? {};
    this.reactRenderer = new ReactRenderer();
    this.candidatesResolver =
      candidatesResolver ?? ((classUid) => findAssetRefCandidates(app, classUid));
  }

  /**
   * T1: build the per-field candidate lists for `assetRef` fuzzy-picker fields
   * that declare a `targetClassUid`. Done once at open time so the React form
   * receives a stable snapshot.
   */
  private buildCandidates(): Record<string, AssetRefCandidate[]> {
    const candidates: Record<string, AssetRefCandidate[]> = {};
    for (const field of this.schema) {
      if (field.type === "assetRef" && field.targetClassUid) {
        candidates[field.name] = this.candidatesResolver(field.targetClassUid);
      }
    }
    return candidates;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("dynamic-form-modal");

    const titleEl = contentEl.createEl("h3", { cls: "dynamic-form-modal-title" });
    titleEl.textContent = this.options.title ?? "Input required";

    const container = contentEl.createEl("div", { cls: "dynamic-form-container" });

    const candidates = this.buildCandidates();

    this.reactRenderer.render(
      container,
      React.createElement(
        ErrorBoundary,
        {
          children: React.createElement(DynamicForm, {
            schema: this.schema,
            candidates,
            submitLabel: this.options.submitLabel,
            onSubmit: (values: UserInput) => {
              this.resolvePromise?.(values);
              this.resolvePromise = null;
              this.close();
            },
            onCancel: () => {
              this.resolvePromise?.(null);
              this.resolvePromise = null;
              this.close();
            },
          }),
          onError: (error: Error) => {
            console.error("[Exocortex DynamicFormModal] Render error:", error);
          },
        },
      ),
    );
  }

  override onClose(): void {
    const { contentEl } = this;
    this.reactRenderer.cleanup();
    contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
  }

  waitForResult(): Promise<UserInput | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }
}
