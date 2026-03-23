import { DisplayNameTemplateEngine } from "./DisplayNameTemplateEngine";
import type { MetadataResolver } from "./DisplayNameTemplateEngine";
import type { PrintNameRuleService } from "./PrintNameRuleService";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

export interface DisplayNameContext {
  metadata: Record<string, unknown>;
  basename: string;
  createdDate?: Date;
}

export class DisplayNameResolver {
  constructor(
    private readonly settings: DisplayNameSettings,
    private readonly ruleService?: PrintNameRuleService | null,
    private readonly metadataResolver?: MetadataResolver | null,
  ) {}

  resolve(context: DisplayNameContext): string | null {
    const { metadata, basename, createdDate } = context;

    const assetClass = this.extractAssetClass(metadata);
    const template = this.getTemplateForClass(assetClass);
    const engine = new DisplayNameTemplateEngine(template);

    return engine.render(
      metadata,
      basename,
      createdDate,
      this.metadataResolver ?? undefined,
    );
  }

  getTemplateForClass(assetClass: string | null): string {
    if (assetClass && this.ruleService) {
      const dynamicRule = this.ruleService.getTemplateForClass(assetClass);
      if (dynamicRule) {
        return dynamicRule.template;
      }
    }

    if (assetClass && this.settings.classTemplates[assetClass]) {
      return this.settings.classTemplates[assetClass];
    }

    return this.settings.defaultTemplate;
  }

  private extractAssetClass(metadata: Record<string, unknown>): string | null {
    const instanceClass = metadata.exo__Instance_class;

    if (!instanceClass) {
      return null;
    }

    if (Array.isArray(instanceClass)) {
      if (instanceClass.length === 0) return null;
      return this.cleanClassValue(instanceClass[0]);
    }

    if (typeof instanceClass === "string") {
      return this.cleanClassValue(instanceClass);
    }

    return null;
  }

  private cleanClassValue(value: unknown): string | null {
    if (typeof value !== "string") return null;

    let cleaned = value
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"|"$/g, "")
      .trim();

    if (cleaned.includes("|")) {
      cleaned = cleaned.split("|").pop()!.trim();
    }

    return cleaned || null;
  }

  getConfiguredClasses(): string[] {
    return Object.keys(this.settings.classTemplates);
  }

  hasClassTemplates(): boolean {
    return Object.keys(this.settings.classTemplates).length > 0;
  }
}

export async function createDefaultResolver(): Promise<DisplayNameResolver> {
  const { DEFAULT_DISPLAY_NAME_SETTINGS } = await import("@plugin/domain/settings/ExocortexSettings");
  return new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);
}
