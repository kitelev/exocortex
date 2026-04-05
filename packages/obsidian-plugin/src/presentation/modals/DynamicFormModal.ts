import { Modal, App } from "obsidian";
import React from "react";
import type { InputSchemaField } from "@plugin/presentation/builders/button-groups/DynamicCommandButtonGroupBuilder";
import { ReactRenderer } from "@plugin/presentation/utils/ReactRenderer";
import { DynamicForm } from "@plugin/presentation/components/dynamic-form/DynamicForm";
import { ErrorBoundary } from "@plugin/presentation/components/ErrorBoundary";

export type UserInput = Record<string, string>;

export interface DynamicFormModalOptions {
  readonly title?: string;
  readonly submitLabel?: string;
}

export class DynamicFormModal extends Modal {
  private readonly schema: InputSchemaField[];
  private readonly options: DynamicFormModalOptions;
  private readonly reactRenderer: ReactRenderer;
  private resolvePromise: ((value: UserInput | null) => void) | null = null;

  constructor(app: App, schema: InputSchemaField[], options?: DynamicFormModalOptions) {
    super(app);
    this.schema = schema;
    this.options = options ?? {};
    this.reactRenderer = new ReactRenderer();
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("dynamic-form-modal");

    const titleEl = contentEl.createEl("h3", { cls: "dynamic-form-modal-title" });
    titleEl.textContent = this.options.title ?? "Input required";

    const container = contentEl.createEl("div", { cls: "dynamic-form-container" });

    this.reactRenderer.render(
      container,
      React.createElement(
        ErrorBoundary,
        {
          children: React.createElement(DynamicForm, {
            schema: this.schema,
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
