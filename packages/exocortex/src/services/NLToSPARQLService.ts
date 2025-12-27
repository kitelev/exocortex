import { injectable } from "tsyringe";
import { LoggingService } from "./LoggingService";
import {
  SPARQL_TEMPLATES,
  SPARQL_PREFIXES,
  PREDICATES,
  KNOWN_PROTOTYPES,
  findMatchingTemplates,
  fillTemplate,
  validateParameters,
  getTemplateByName,
  type SPARQLTemplate,
} from "./SPARQLTemplateLibrary";

/**
 * Configuration for NL to SPARQL service
 */
export interface NLToSPARQLConfig {
  /** Default result limit */
  defaultLimit: number;
  /** Whether to include explanations in results */
  includeExplanation: boolean;
  /** Confidence threshold for template matching (0-1) */
  confidenceThreshold: number;
}

/**
 * Default configuration
 */
export const DEFAULT_NL_TO_SPARQL_CONFIG: NLToSPARQLConfig = {
  defaultLimit: 100,
  includeExplanation: true,
  confidenceThreshold: 0.3,
};

/**
 * Result of NL to SPARQL conversion
 */
export interface NLToSPARQLResult {
  /** The generated SPARQL query */
  query: string;
  /** Template used for generation */
  templateName: string | null;
  /** Extracted parameters */
  parameters: Record<string, string>;
  /** Confidence score (0-1) */
  confidence: number;
  /** Explanation of the conversion */
  explanation: string;
  /** Whether this was a fallback generic query */
  isFallback: boolean;
  /** Alternative queries that could be used */
  alternatives: string[];
}


/**
 * Service for converting Natural Language queries to SPARQL.
 *
 * This service analyzes natural language questions in Russian/English
 * and generates appropriate SPARQL queries using template matching
 * and parameter extraction.
 */
@injectable()
export class NLToSPARQLService {
  private config: NLToSPARQLConfig;

  // UUID extraction pattern (with or without dashes)
  private uuidPattern =
    /\b([0-9a-f]{8}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{12})\b/i;

  // Date patterns (YYYY-MM or YYYY-MM-DD)
  private datePattern = /\b(20\d{2}[-]?\d{2}(?:[-]?\d{2})?)\b/;

  // Month names mapping
  private monthNames: Record<string, string> = {
    январ: "01",
    феврал: "02",
    март: "03",
    апрел: "04",
    май: "05",
    июн: "06",
    июл: "07",
    август: "08",
    сентябр: "09",
    октябр: "10",
    ноябр: "11",
    декабр: "12",
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  // Known activity patterns
  private activityPatterns: Record<string, string> = {
    душ: "душ",
    "morning shower": "душ",
    "утренний душ": "душ",
    сон: "Поспать",
    спать: "Поспать",
    поспать: "Поспать",
    sleep: "Поспать",
    йога: "йог",
    yoga: "йог",
    пресс: "Пресс",
    "wim hof": "Wim Hof",
    мочи: "МОЧИ",
  };

  // Known prototype mappings
  private prototypeMapping: Record<string, string> = {
    душ: KNOWN_PROTOTYPES.MORNING_SHOWER,
    "утренний душ": KNOWN_PROTOTYPES.MORNING_SHOWER,
    "morning shower": KNOWN_PROTOTYPES.MORNING_SHOWER,
    ногти: KNOWN_PROTOTYPES.CUT_NAILS,
    "подстричь ногти": KNOWN_PROTOTYPES.CUT_NAILS,
  };

  constructor(config: Partial<NLToSPARQLConfig> = {}) {
    this.config = { ...DEFAULT_NL_TO_SPARQL_CONFIG, ...config };
  }

  /**
   * Convert natural language query to SPARQL
   */
  convert(naturalLanguageQuery: string): NLToSPARQLResult {
    const query = naturalLanguageQuery.trim().toLowerCase();

    // 1. Try to extract UUID and use properties query
    const uuidMatch = query.match(this.uuidPattern);
    if (uuidMatch) {
      return this.handleUuidQuery(query, uuidMatch[1]);
    }

    // 2. Find matching templates
    const matchingTemplates = findMatchingTemplates(query, 3);

    if (matchingTemplates.length === 0) {
      return this.createFallbackQuery(query);
    }

    // 3. Get the best matching template
    const bestTemplate = matchingTemplates[0];
    const params = this.extractParameters(query, bestTemplate);

    // 4. Validate parameters
    const validation = validateParameters(bestTemplate, params);

    if (!validation.valid) {
      // Try to infer missing parameters
      for (const missing of validation.missing) {
        const inferred = this.inferParameter(query, missing, bestTemplate);
        if (inferred) {
          params[missing] = inferred;
        }
      }

      // Re-validate
      const revalidation = validateParameters(bestTemplate, params);
      if (!revalidation.valid) {
        return this.createFallbackQuery(query, {
          template: bestTemplate,
          missingParams: revalidation.missing,
        });
      }
    }

    // 5. Fill template and return result
    const sparqlQuery = fillTemplate(bestTemplate, params);
    const confidence = this.calculateConfidence(query, bestTemplate, params);

    // Generate alternatives
    const alternatives = matchingTemplates
      .slice(1)
      .map((t) => {
        const altParams = this.extractParameters(query, t);
        return fillTemplate(t, altParams);
      })
      .filter((q) => q !== sparqlQuery);

    return {
      query: sparqlQuery,
      templateName: bestTemplate.name,
      parameters: params,
      confidence,
      explanation: this.generateExplanation(bestTemplate, params),
      isFallback: false,
      alternatives,
    };
  }

  /**
   * Handle UUID-based queries
   */
  private handleUuidQuery(query: string, uuid: string): NLToSPARQLResult {
    // Determine if looking for prototype instances or entity properties
    if (
      query.includes("прототип") ||
      query.includes("prototype") ||
      query.includes("инстанс")
    ) {
      const template = getTemplateByName("find_by_prototype_uuid");
      if (!template) {
        throw new Error("Template find_by_prototype_uuid not found");
      }
      const params = { prototypeUuid: uuid, limit: "100" };
      return {
        query: fillTemplate(template, params),
        templateName: template.name,
        parameters: params,
        confidence: 0.9,
        explanation: `Поиск инстансов прототипа с UUID ${uuid}`,
        isFallback: false,
        alternatives: [],
      };
    }

    // Default: get entity properties
    const template = getTemplateByName("properties_by_uuid");
    if (!template) {
      throw new Error("Template properties_by_uuid not found");
    }
    const params = { uuid };
    return {
      query: fillTemplate(template, params),
      templateName: template.name,
      parameters: params,
      confidence: 0.9,
      explanation: `Получение свойств сущности с UUID ${uuid}`,
      isFallback: false,
      alternatives: [],
    };
  }

  /**
   * Extract parameters from natural language query based on template
   */
  private extractParameters(
    query: string,
    template: SPARQLTemplate
  ): Record<string, string> {
    const params: Record<string, string> = {};

    for (const param of template.parameters) {
      switch (param.name) {
        case "keyword":
        case "pattern":
        case "taskLabel":
        case "entityLabel":
          params[param.name] = this.extractKeyword(query, template);
          break;

        case "prototypeUuid":
          params[param.name] = this.extractPrototypeUuid(query);
          break;

        case "yearMonth":
          params[param.name] = this.extractYearMonth(query);
          break;

        case "limit":
          params[param.name] = this.extractLimit(query);
          break;

        case "uuid": {
          const uuidMatch = query.match(this.uuidPattern);
          if (uuidMatch) {
            params[param.name] = uuidMatch[1];
          }
          break;
        }
      }
    }

    return params;
  }

  /**
   * Extract keyword/pattern from query
   */
  private extractKeyword(query: string, _template: SPARQLTemplate): string {
    // Check for known activity patterns
    for (const [pattern, replacement] of Object.entries(this.activityPatterns)) {
      if (query.includes(pattern)) {
        return replacement;
      }
    }

    // Try to extract quoted text
    const quotedMatch = query.match(/["'«»]([^"'«»]+)["'«»]/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Remove common question words and extract the subject
    const cleaned = query
      .replace(
        /^(найди|найти|покажи|покажешь|какие|какой|сколько|где|как|что|все|всех|мои|моих|за|в|по|для|который|которые)\s+/gi,
        ""
      )
      .replace(
        /\s+(за|в|по|для|с|на|от)\s+\d+.*$/gi,
        ""
      )
      .trim();

    // Get the first meaningful word(s)
    const words = cleaned.split(/\s+/);
    if (words.length > 0) {
      return words.slice(0, 2).join(" ");
    }

    return cleaned || query;
  }

  /**
   * Extract prototype UUID from query
   */
  private extractPrototypeUuid(query: string): string {
    // First check for explicit UUID
    const uuidMatch = query.match(this.uuidPattern);
    if (uuidMatch) {
      return uuidMatch[1];
    }

    // Check for known prototype mappings
    for (const [pattern, uuid] of Object.entries(this.prototypeMapping)) {
      if (query.includes(pattern)) {
        return uuid;
      }
    }

    return "";
  }

  /**
   * Extract year-month from query
   */
  private extractYearMonth(query: string): string {
    // Check for explicit date format
    const dateMatch = query.match(this.datePattern);
    if (dateMatch) {
      return dateMatch[1].replace(/(\d{4})(\d{2})/, "$1-$2");
    }

    // Check for month names
    for (const [monthName, monthNum] of Object.entries(this.monthNames)) {
      if (query.includes(monthName)) {
        // Get current year or extract from query
        const yearMatch = query.match(/\b(20\d{2})\b/);
        const year = yearMatch ? yearMatch[1] : new Date().getFullYear();
        return `${year}-${monthNum}`;
      }
    }

    return "";
  }

  /**
   * Extract limit from query
   */
  private extractLimit(query: string): string {
    const limitMatch = query.match(
      /(?:первые|последние|топ|limit|лимит)\s*(\d+)/i
    );
    if (limitMatch) {
      return limitMatch[1];
    }

    const numberMatch = query.match(/\b(\d{1,3})\b/);
    if (numberMatch && parseInt(numberMatch[1]) <= 500) {
      return numberMatch[1];
    }

    return String(this.config.defaultLimit);
  }

  /**
   * Infer missing parameter from context
   */
  private inferParameter(
    query: string,
    paramName: string,
    _template: SPARQLTemplate
  ): string | null {
    switch (paramName) {
      case "prototypeUuid":
        // Try to find activity and get its prototype
        for (const [pattern, uuid] of Object.entries(this.prototypeMapping)) {
          if (query.includes(pattern)) {
            return uuid;
          }
        }
        break;

      case "keyword":
      case "pattern":
        // Extract the most likely keyword
        for (const [pattern, value] of Object.entries(this.activityPatterns)) {
          if (query.includes(pattern)) {
            return value;
          }
        }
        break;
    }

    return null;
  }

  /**
   * Create fallback query when no template matches
   */
  private createFallbackQuery(
    query: string,
    context?: { template?: SPARQLTemplate; missingParams?: string[] }
  ): NLToSPARQLResult {
    // Generate a simple search query
    const keyword = this.extractKeyword(query, SPARQL_TEMPLATES[0]);

    const fallbackQuery = `${SPARQL_PREFIXES}

SELECT ?s ?label ?class WHERE {
  ?s ${PREDICATES.ASSET_LABEL} ?label .
  OPTIONAL { ?s ${PREDICATES.INSTANCE_CLASS} ?class }
  FILTER(CONTAINS(LCASE(?label), "${keyword.toLowerCase()}"))
}
ORDER BY ?label
LIMIT ${this.config.defaultLimit}`;

    let explanation =
      "Не удалось точно определить тип запроса. Выполняется поиск по ключевому слову.";
    if (context?.template && context?.missingParams) {
      explanation += ` Для шаблона "${context.template.name}" не хватает параметров: ${context.missingParams.join(", ")}.`;
    }

    return {
      query: fallbackQuery,
      templateName: null,
      parameters: { keyword },
      confidence: 0.3,
      explanation,
      isFallback: true,
      alternatives: [],
    };
  }

  /**
   * Calculate confidence score for the conversion
   */
  private calculateConfidence(
    query: string,
    template: SPARQLTemplate,
    params: Record<string, string>
  ): number {
    let score = 0.5; // Base score for template match

    // Bonus for keyword matches
    for (const keyword of template.keywords) {
      if (query.includes(keyword.toLowerCase())) {
        score += 0.1;
      }
    }

    // Bonus for complete parameters
    const requiredParams = template.parameters.filter((p) => p.required);
    const providedRequired = requiredParams.filter(
      (p) => params[p.name] && params[p.name].length > 0
    );
    if (requiredParams.length > 0) {
      score += (providedRequired.length / requiredParams.length) * 0.2;
    } else {
      score += 0.2;
    }

    // Bonus for known entity matches
    for (const [pattern] of Object.entries(this.prototypeMapping)) {
      if (query.includes(pattern)) {
        score += 0.1;
        break;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Generate human-readable explanation of the conversion
   */
  private generateExplanation(
    template: SPARQLTemplate,
    params: Record<string, string>
  ): string {
    let explanation = template.description;

    if (Object.keys(params).length > 0) {
      explanation += ". Параметры: ";
      explanation += Object.entries(params)
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");
    }

    return explanation;
  }

  /**
   * Get all available templates
   */
  getAvailableTemplates(): SPARQLTemplate[] {
    return [...SPARQL_TEMPLATES];
  }

  /**
   * Get template by name
   */
  getTemplate(name: string): SPARQLTemplate | undefined {
    return getTemplateByName(name);
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<NLToSPARQLConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): NLToSPARQLConfig {
    return { ...this.config };
  }

  /**
   * Add a custom template
   */
  addTemplate(template: SPARQLTemplate): void {
    // Add to the templates array
    SPARQL_TEMPLATES.push(template);
    LoggingService.debug(`Added custom template: ${template.name}`);
  }

  /**
   * Get suggestions for improving a query
   */
  getSuggestions(query: string): string[] {
    const suggestions: string[] = [];

    // Suggest adding date context
    if (
      query.includes("сколько") ||
      query.includes("средн") ||
      query.includes("статистик")
    ) {
      if (!query.match(/\b20\d{2}\b/) && !this.containsMonth(query)) {
        suggestions.push(
          "Добавьте период времени (например: 'за декабрь' или 'за 2025-12')"
        );
      }
    }

    // Suggest using prototype UUID
    if (query.includes("задач") || query.includes("активност")) {
      suggestions.push(
        "Для точного поиска используйте UUID прототипа вместо названия"
      );
    }

    // Suggest specific keywords
    if (query.length < 10) {
      suggestions.push(
        "Уточните запрос: добавьте название активности или тип данных"
      );
    }

    return suggestions;
  }

  /**
   * Check if query contains a month name
   */
  private containsMonth(query: string): boolean {
    return Object.keys(this.monthNames).some((month) => query.includes(month));
  }
}
