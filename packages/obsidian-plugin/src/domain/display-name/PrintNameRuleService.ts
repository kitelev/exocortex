import { TFile } from "obsidian";
import type { App } from "obsidian";

export interface PrintNameRule {
  className: string;
  template: string;
  priority: number;
  sourceFile: string;
}

type MetadataResolver = (wikilinkTarget: string) => Record<string, unknown> | null;

export class PrintNameRuleService {
  private rules: Map<string, PrintNameRule[]> = new Map();
  private classHierarchy: Map<string, string[]> = new Map();
  private initialized = false;

  constructor(private readonly app: App) {}

  initialize(): void {
    this.scanVault();
    this.initialized = true;
  }

  getTemplateForClass(className: string): { template: string; priority: number } | null {
    if (!this.initialized) return null;

    const directRules = this.rules.get(className);
    if (directRules && directRules.length > 0) {
      return { template: directRules[0].template, priority: directRules[0].priority };
    }

    const ancestors = this.getAncestorClasses(className);
    for (const ancestor of ancestors) {
      const ancestorRules = this.rules.get(ancestor);
      if (ancestorRules && ancestorRules.length > 0) {
        return { template: ancestorRules[0].template, priority: ancestorRules[0].priority };
      }
    }

    return null;
  }

  createMetadataResolver(): MetadataResolver {
    return (wikilinkTarget: string): Record<string, unknown> | null => {
      const cleaned = wikilinkTarget
        .replace(/^\[\[|\]\]$/g, "")
        .replace(/^"|"$/g, "")
        .trim();

      if (!cleaned) return null;

      let file = this.app.metadataCache.getFirstLinkpathDest(cleaned, "");
      if (!file && !cleaned.endsWith(".md")) {
        file = this.app.metadataCache.getFirstLinkpathDest(cleaned + ".md", "");
      }

      if (!(file instanceof TFile)) {
        return null;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter ? { ...cache.frontmatter } : null;
    };
  }

  refresh(): void {
    this.scanVault();
  }

  private scanVault(): void {
    this.rules.clear();
    this.classHierarchy.clear();

    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const instanceClass = this.cleanClassValue(fm.exo__Instance_class);

      if (instanceClass === "exoob__PrintNameRule") {
        this.processRuleAsset(fm, file.path);
      }

      const superClass = this.cleanClassValue(fm.exo__Class_superClass);
      if (superClass && instanceClass) {
        const cleanedChild = this.cleanClassValue(fm.exo__Asset_label) || instanceClass;

        const existing = this.classHierarchy.get(cleanedChild);
        if (existing) {
          existing.push(superClass);
        } else {
          this.classHierarchy.set(cleanedChild, [superClass]);
        }
      }
    }
  }

  private processRuleAsset(fm: Record<string, unknown>, path: string): void {
    const ruleClass = this.cleanClassValue(fm.exoob__PrintNameRule_class);
    const template = fm.exoob__PrintNameRule_template;
    const priority = fm.exoob__Rule_priority;

    if (!ruleClass || typeof template !== "string" || !template.trim()) {
      return;
    }

    const rule: PrintNameRule = {
      className: ruleClass,
      template: template.trim(),
      priority: typeof priority === "number" ? priority : 0,
      sourceFile: path,
    };

    const existing = this.rules.get(ruleClass);
    if (existing) {
      existing.push(rule);
      existing.sort((a, b) => b.priority - a.priority);
    } else {
      this.rules.set(ruleClass, [rule]);
    }
  }

  private getAncestorClasses(className: string): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    const queue = [className];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const parents = this.classHierarchy.get(current);
      if (parents) {
        for (const parent of parents) {
          if (!visited.has(parent)) {
            ancestors.push(parent);
            queue.push(parent);
          }
        }
      }
    }

    return ancestors;
  }

  private cleanClassValue(value: unknown): string | null {
    if (!value) return null;

    if (Array.isArray(value)) {
      if (value.length === 0) return null;
      return this.cleanClassValue(value[0]);
    }

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

  getRulesCount(): number {
    let count = 0;
    for (const rules of this.rules.values()) {
      count += rules.length;
    }
    return count;
  }
}
