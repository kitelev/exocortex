import { injectable, inject } from "tsyringe";
import type { IFileSystemAdapter } from "../interfaces/IFileSystemAdapter";
import { DI_TOKENS } from "../interfaces/tokens";

export interface URIConstructionOptions {
  defaultOntologyURL?: string;
  strictValidation?: boolean;
}

export interface AssetMetadata {
  path: string;
  frontmatter?: Record<string, any>;
}

@injectable()
export class URIConstructionService {
  private defaultOntologyURL: string = "https://exocortex.my/default/";
  private strictValidation: boolean = true;

  constructor(
    @inject(DI_TOKENS.IFileSystemAdapter) private readonly fileSystem: IFileSystemAdapter,
  ) {}

  configure(options?: URIConstructionOptions): void {
    if (options?.defaultOntologyURL) {
      this.defaultOntologyURL = options.defaultOntologyURL;
    }
    if (options?.strictValidation !== undefined) {
      this.strictValidation = options.strictValidation;
    }
  }

  async constructAssetURI(asset: AssetMetadata): Promise<string> {
    const uid = this.extractUID(asset);
    if (!uid) {
      if (this.strictValidation) {
        throw new Error(`Asset missing exo__Asset_uid: ${asset.path}`);
      }
      console.warn(
        `Asset ${asset.path} missing UID, using filename fallback`,
      );
      return this.constructFallbackURI(asset);
    }

    const ontologyURL = await this.resolveOntologyURL(asset);
    if (!this.validateOntologyURL(ontologyURL)) {
      throw new Error(`Invalid ontology URL: ${ontologyURL}`);
    }

    const baseURL = ontologyURL.endsWith("/")
      ? ontologyURL
      : `${ontologyURL}/`;
    return `${baseURL}${uid}`;
  }

  validateOntologyURL(url: string | null | undefined): boolean {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private async resolveOntologyURL(asset: AssetMetadata): Promise<string> {
    const isDefinedBy = asset.frontmatter?.exo__Asset_isDefinedBy;

    if (!isDefinedBy) {
      return this.defaultOntologyURL;
    }

    const ontologyPath = this.extractWikiLink(isDefinedBy);

    let ontologyFilePath = ontologyPath;
    let fileExists = await this.fileSystem.fileExists(ontologyPath);

    if (!fileExists && !ontologyPath.endsWith(".md")) {
      ontologyFilePath = `${ontologyPath}.md`;
      fileExists = await this.fileSystem.fileExists(ontologyFilePath);
    }

    if (!fileExists) {
      console.warn(
        `Ontology file not found: ${ontologyPath}, using default`,
      );
      return this.defaultOntologyURL;
    }

    const ontologyMetadata =
      await this.fileSystem.getFileMetadata(ontologyFilePath);
    const ontologyURL = ontologyMetadata?.exo__Ontology_url;

    return ontologyURL || this.defaultOntologyURL;
  }

  private extractUID(asset: AssetMetadata): string | null {
    return asset.frontmatter?.exo__Asset_uid || null;
  }

  private extractWikiLink(wikiLink: string): string {
    return wikiLink.replace(/^\[\[|\]\]$/g, "");
  }

  private constructFallbackURI(asset: AssetMetadata): string {
    const filename =
      asset.path.split("/").pop()?.replace(".md", "") || "unknown";
    return `${this.defaultOntologyURL}${filename}`;
  }
}
