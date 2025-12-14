import {
  type IPropertyValidationService,
  type ValidationResult,
  ApplicationErrorHandler,
  ValidationError,
  type ILogger,
  type INotificationService,
} from "exocortex";
import { SPARQLQueryService } from "./SPARQLQueryService";

export class PropertyValidationService implements IPropertyValidationService {
  private errorHandler: ApplicationErrorHandler;

  constructor(
    private sparqlService: SPARQLQueryService,
    logger?: ILogger,
    notifier?: INotificationService,
  ) {
    this.errorHandler = new ApplicationErrorHandler({}, logger, notifier);
  }

  async validatePropertyDomain(
    propertyName: string,
    assetClass: string,
  ): Promise<ValidationResult> {
    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      PREFIX ims: <https://exocortex.my/ontology/ims#>

      SELECT ?domain WHERE {
        ?property rdfs:domain ?domain .
        FILTER (
          STRSTARTS(STR(?property), STR(exo:)) ||
          STRSTARTS(STR(?property), STR(ems:)) ||
          STRSTARTS(STR(?property), STR(ims:))
        )
        FILTER (CONTAINS(STR(?property), "${this.extractPropertyLocalName(propertyName)}"))
      }
    `;

    try {
      const results = await this.sparqlService.query(query);

      if (results.length === 0) {
        return { isValid: true };
      }

      const allowedDomains = results
        .map((binding) => {
          const domain = binding.get("domain");
          return domain ? String(domain) : null;
        })
        .filter((d): d is string => d !== null);

      if (allowedDomains.length === 0) {
        return { isValid: true };
      }

      const isValid = allowedDomains.some((domain) => {
        const domainLocalName = this.extractLocalName(domain);
        return (
          assetClass.includes(domainLocalName) || domainLocalName === assetClass
        );
      });

      return {
        isValid,
        errorMessage: isValid
          ? undefined
          : `Property "${propertyName}" not allowed on ${assetClass}`,
      };
    } catch (error) {
      const validationError = new ValidationError(
        `Property domain validation failed for "${propertyName}" on ${assetClass}`,
        {
          propertyName,
          assetClass,
          originalError: error instanceof Error ? error.message : String(error),
        },
      );

      this.errorHandler.handle(validationError);
      return { isValid: true };
    }
  }

  async validatePropertyRange(
    propertyName: string,
    propertyValue: unknown,
  ): Promise<ValidationResult> {
    const query = `
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX exo: <https://exocortex.my/ontology/exo#>
      PREFIX ems: <https://exocortex.my/ontology/ems#>
      PREFIX ims: <https://exocortex.my/ontology/ims#>

      SELECT ?range WHERE {
        ?property rdfs:range ?range .
        FILTER (
          STRSTARTS(STR(?property), STR(exo:)) ||
          STRSTARTS(STR(?property), STR(ems:)) ||
          STRSTARTS(STR(?property), STR(ims:))
        )
        FILTER (CONTAINS(STR(?property), "${this.extractPropertyLocalName(propertyName)}"))
      }
    `;

    try {
      const results = await this.sparqlService.query(query);

      if (results.length === 0) {
        return { isValid: true };
      }

      const expectedRange = results[0]?.get("range");
      if (!expectedRange) {
        return { isValid: true };
      }

      const actualType = this.detectValueType(propertyValue);
      const isValid = this.typeMatches(actualType, String(expectedRange));

      return {
        isValid,
        errorMessage: isValid
          ? undefined
          : `Expected ${String(expectedRange)}, got ${actualType}`,
      };
    } catch (error) {
      const validationError = new ValidationError(
        `Property range validation failed for "${propertyName}"`,
        {
          propertyName,
          propertyValue,
          originalError: error instanceof Error ? error.message : String(error),
        },
      );

      this.errorHandler.handle(validationError);
      return { isValid: true };
    }
  }

  private extractPropertyLocalName(propertyName: string): string {
    const parts = propertyName.split("__");
    return parts.length > 1 ? parts[1] : propertyName;
  }

  private extractLocalName(iri: string): string {
    const hashIndex = iri.lastIndexOf("#");
    const slashIndex = iri.lastIndexOf("/");
    const separatorIndex = Math.max(hashIndex, slashIndex);

    if (separatorIndex === -1) {
      return iri;
    }

    return iri.substring(separatorIndex + 1);
  }

  private detectValueType(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";

    if (typeof value === "string") {
      if (/^\[\[.*\]\]$/.test(value)) return "wikilink";

      const dateRegex =
        /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z?)?$/;
      if (dateRegex.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return "datetime";
        }
      }

      return "string";
    }

    return "unknown";
  }

  private typeMatches(actualType: string, expectedRange: string): boolean {
    const typeMapping: Record<string, string[]> = {
      "http://www.w3.org/2001/XMLSchema#string": ["string", "wikilink"],
      "http://www.w3.org/2001/XMLSchema#dateTime": ["datetime"],
      "http://www.w3.org/2001/XMLSchema#integer": ["number"],
      "http://www.w3.org/2001/XMLSchema#boolean": ["boolean"],
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#List": ["array"],
      "xsd:string": ["string", "wikilink"],
      "xsd:dateTime": ["datetime"],
      "xsd:integer": ["number"],
      "xsd:boolean": ["boolean"],
      "rdf:List": ["array"],
    };

    const rangeKey = expectedRange.includes("XMLSchema")
      ? expectedRange
      : expectedRange.includes("#")
        ? expectedRange
        : expectedRange;

    const compatibleTypes =
      typeMapping[rangeKey] || typeMapping[this.extractLocalName(rangeKey)] || [];

    if (compatibleTypes.length === 0) {
      return true;
    }

    return compatibleTypes.includes(actualType);
  }
}
