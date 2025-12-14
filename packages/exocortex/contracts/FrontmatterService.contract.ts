/**
 * FrontmatterService Contract
 *
 * Defines the expected behaviors of the frontmatter parsing/serialization service.
 * The obsidian-plugin relies on this for:
 * - Parsing YAML frontmatter from note content
 * - Serializing frontmatter back to YAML format
 * - Updating specific properties in frontmatter
 */

export interface FrontmatterServiceContractMethod {
  description: string;
  inputTypes: string[];
  outputType: string;
  mustNotThrow?: string[];
  mayThrow?: string[];
}

export interface FrontmatterServiceContract {
  name: "FrontmatterService";
  version: "1.0.0";

  staticMethods: {
    parseFrontmatter: FrontmatterServiceContractMethod;
    serializeFrontmatter: FrontmatterServiceContractMethod;
    updateFrontmatter: FrontmatterServiceContractMethod;
    extractFrontmatterSection: FrontmatterServiceContractMethod;
    hasFrontmatter: FrontmatterServiceContractMethod;
    mergeFrontmatter: FrontmatterServiceContractMethod;
  };

  behaviors: string[];
}

export const FrontmatterServiceContract: FrontmatterServiceContract = {
  name: "FrontmatterService",
  version: "1.0.0",

  staticMethods: {
    parseFrontmatter: {
      description: "Parse YAML frontmatter from markdown content",
      inputTypes: ["string"],
      outputType: "Record<string, any> | null",
      mustNotThrow: [
        "content without frontmatter (returns null)",
        "content with empty frontmatter",
        "content with valid YAML frontmatter",
        "content with nested object properties",
        "content with array properties",
        "content with wiki-link values",
      ],
      mayThrow: [
        "invalid YAML syntax in frontmatter",
      ],
    },

    serializeFrontmatter: {
      description: "Serialize frontmatter object to YAML string",
      inputTypes: ["Record<string, any>"],
      outputType: "string",
      mustNotThrow: [
        "empty object",
        "object with string values",
        "object with number values",
        "object with boolean values",
        "object with array values",
        "object with nested object values",
        "object with null values",
      ],
    },

    updateFrontmatter: {
      description: "Update frontmatter in markdown content",
      inputTypes: ["string", "Record<string, any>"],
      outputType: "string",
      mustNotThrow: [
        "content with existing frontmatter",
        "content without frontmatter (creates new)",
        "updates preserving existing properties",
      ],
    },

    extractFrontmatterSection: {
      description: "Extract raw frontmatter string from content",
      inputTypes: ["string"],
      outputType: "string | null",
      mustNotThrow: [
        "content with frontmatter",
        "content without frontmatter",
      ],
    },

    hasFrontmatter: {
      description: "Check if content has frontmatter",
      inputTypes: ["string"],
      outputType: "boolean",
      mustNotThrow: [
        "any string content",
      ],
    },

    mergeFrontmatter: {
      description: "Merge new properties into existing frontmatter",
      inputTypes: ["Record<string, any>", "Record<string, any>"],
      outputType: "Record<string, any>",
      mustNotThrow: [
        "both empty objects",
        "first empty, second with properties",
        "overlapping properties (second wins)",
      ],
    },
  },

  behaviors: [
    "parseFrontmatter returns null for content without --- delimiters",
    "parseFrontmatter returns empty object for empty frontmatter (--- ---)",
    "serializeFrontmatter produces valid YAML format",
    "serializeFrontmatter preserves property order",
    "updateFrontmatter preserves content after frontmatter",
    "updateFrontmatter creates frontmatter if none exists",
    "hasFrontmatter returns true only for properly delimited frontmatter",
    "mergeFrontmatter performs shallow merge (later values win)",
    "Wiki-link values are preserved as strings",
    "Timestamp values are preserved in ISO format",
    "Array values maintain order and format",
  ],
};
