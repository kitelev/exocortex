import { injectable } from "tsyringe";
import { LoggingService } from "./LoggingService";

/**
 * Supported embedding providers
 */
export type EmbeddingProvider = "openai" | "local";

/**
 * Configuration for the embedding service
 */
export interface EmbeddingConfig {
  /** Embedding provider to use */
  provider: EmbeddingProvider;
  /** API key for OpenAI (required when provider is "openai") */
  apiKey?: string;
  /** Model to use for embeddings */
  model?: string;
  /** Base URL for API (optional, for custom endpoints) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum text length before truncation */
  maxTextLength?: number;
}

/**
 * Default embedding configuration
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  timeout: 30000,
  maxTextLength: 8000,
};

/**
 * Result of an embedding generation
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** Number of tokens processed */
  tokenCount: number;
  /** Model used for generation */
  model: string;
}

/**
 * Batch embedding request item
 */
export interface EmbeddingRequest {
  /** Unique identifier for the text (e.g., file path) */
  id: string;
  /** Text content to embed */
  text: string;
}

/**
 * Batch embedding result item
 */
export interface BatchEmbeddingResult {
  /** Identifier matching the request */
  id: string;
  /** The embedding result or null if failed */
  result: EmbeddingResult | null;
  /** Error message if failed */
  error?: string;
}

/**
 * Service for generating text embeddings using various providers.
 * Supports OpenAI API and can be extended for local models.
 */
@injectable()
export class EmbeddingService {
  private config: EmbeddingConfig;
  private requestCount = 0;
  private tokenCount = 0;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }

  /**
   * Update the service configuration
   */
  setConfig(config: Partial<EmbeddingConfig>): void {
    this.config = { ...this.config, ...config };
    LoggingService.debug(
      `EmbeddingService config updated: provider=${this.config.provider}, model=${this.config.model}`
    );
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<EmbeddingConfig, "apiKey"> {
    const { apiKey: _, ...safeConfig } = this.config;
    return safeConfig;
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    if (this.config.provider === "openai") {
      return !!this.config.apiKey;
    }
    return true;
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.isConfigured()) {
      throw new Error("EmbeddingService is not properly configured");
    }

    const truncatedText = this.truncateText(text);

    if (this.config.provider === "openai") {
      return this.generateOpenAIEmbedding(truncatedText);
    }

    throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateBatchEmbeddings(
    requests: EmbeddingRequest[]
  ): Promise<BatchEmbeddingResult[]> {
    if (!this.isConfigured()) {
      throw new Error("EmbeddingService is not properly configured");
    }

    if (requests.length === 0) {
      return [];
    }

    const results: BatchEmbeddingResult[] = [];

    if (this.config.provider === "openai") {
      // OpenAI supports batch embeddings
      const texts = requests.map((r) => this.truncateText(r.text));

      try {
        const batchResults = await this.generateOpenAIBatchEmbeddings(texts);

        for (let i = 0; i < requests.length; i++) {
          results.push({
            id: requests[i].id,
            result: batchResults[i] ?? null,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        // If batch fails, return all as failed
        for (const request of requests) {
          results.push({
            id: request.id,
            result: null,
            error: errorMessage,
          });
        }
      }
    } else {
      throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
    }

    return results;
  }

  /**
   * Generate embedding using OpenAI API
   */
  private async generateOpenAIEmbedding(text: string): Promise<EmbeddingResult> {
    const results = await this.generateOpenAIBatchEmbeddings([text]);
    if (results.length === 0 || !results[0]) {
      throw new Error("Failed to generate embedding");
    }
    return results[0];
  }

  /**
   * Generate batch embeddings using OpenAI API
   */
  private async generateOpenAIBatchEmbeddings(
    texts: string[]
  ): Promise<EmbeddingResult[]> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl}/embeddings`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout ?? 30000
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || "text-embedding-3-small",
          input: texts,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as OpenAIEmbeddingResponse;

      this.requestCount++;
      this.tokenCount += data.usage?.total_tokens || 0;

      return data.data.map((item) => ({
        embedding: item.embedding,
        tokenCount: Math.round((data.usage?.total_tokens || 0) / texts.length),
        model: data.model,
      }));
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("OpenAI API request timeout");
      }
      throw error;
    }
  }

  /**
   * Truncate text to maximum allowed length
   */
  private truncateText(text: string): string {
    const maxLength = this.config.maxTextLength ?? 8000;
    if (text.length <= maxLength) {
      return text;
    }
    LoggingService.debug(
      `Truncating text from ${text.length} to ${maxLength} characters`
    );
    return text.slice(0, maxLength);
  }

  /**
   * Prepare text content for embedding (clean and normalize)
   */
  prepareTextForEmbedding(content: string, metadata?: Record<string, unknown>): string {
    const parts: string[] = [];

    // Add metadata context if available
    if (metadata) {
      const label = metadata.exo__Asset_label;
      if (typeof label === "string" && label) {
        parts.push(`Title: ${label}`);
      }

      const instanceClass = metadata.exo__Instance_class;
      if (instanceClass) {
        const className = Array.isArray(instanceClass)
          ? instanceClass[0]
          : instanceClass;
        if (typeof className === "string") {
          parts.push(`Type: ${this.cleanWikiLink(className)}`);
        }
      }
    }

    // Clean markdown content
    const cleanedContent = this.cleanMarkdownContent(content);
    if (cleanedContent) {
      parts.push(cleanedContent);
    }

    return parts.join("\n\n");
  }

  /**
   * Clean markdown content for embedding
   */
  private cleanMarkdownContent(content: string): string {
    let cleaned = content
      // Remove frontmatter
      .replace(/^---[\s\S]*?---\n*/m, "")
      // Remove code blocks but keep code content
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```\w*\n?|\n?```/g, "");
        return code;
      })
      // Remove inline code markers
      .replace(/`([^`]+)`/g, "$1")
      // Clean wiki-links to just text
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, alias) => alias || link)
      // Remove markdown links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove image syntax
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      // Remove horizontal rules
      .replace(/^---+$/gm, "");

    // Remove HTML tags using loop to handle nested/malformed tags
    cleaned = this.removeHtmlTags(cleaned);

    // Normalize whitespace
    return cleaned.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Remove HTML tags from text, handling nested and malformed tags.
   * Uses iterative approach to ensure complete sanitization.
   */
  private removeHtmlTags(text: string): string {
    const htmlTagPattern = /<[^>]*>/g;
    let result = text;
    let previousResult: string;

    // Repeat until no more tags are found
    do {
      previousResult = result;
      result = result.replace(htmlTagPattern, "");
    } while (result !== previousResult);

    return result;
  }

  /**
   * Clean wiki-link format from string
   */
  private cleanWikiLink(value: string): string {
    return value
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  /**
   * Get usage statistics
   */
  getStats(): { requestCount: number; tokenCount: number } {
    return {
      requestCount: this.requestCount,
      tokenCount: this.tokenCount,
    };
  }

  /**
   * Reset usage statistics
   */
  resetStats(): void {
    this.requestCount = 0;
    this.tokenCount = 0;
  }
}

/**
 * OpenAI API response types
 */
interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
