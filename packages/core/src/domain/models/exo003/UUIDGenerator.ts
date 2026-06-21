import { v5 as uuidv5 } from "uuid";
import { UUID_URL_NAMESPACE } from "./types";

/**
 * Two-level namespace UUID generator for Exo 0.0.3.
 *
 * The UUID generation follows a deterministic two-level scheme:
 *
 * Level 1: Namespace UUID
 * - Generated from the namespace URI using UUID v5 with URL_NAMESPACE
 * - Example: namespace "https://exocortex.my/ontology/exo#" produces a stable UUID
 *
 * Level 2: Asset UUID
 * - Generated from the asset's local identifier using UUID v5 with the namespace UUID
 * - Example: anchor "Person" within exo namespace produces a stable UUID
 *
 * This ensures:
 * 1. Same inputs always produce same UUID (deterministic/idempotent)
 * 2. Different namespaces produce different UUIDs for same local names
 * 3. Full URI can be reconstructed from namespace + local name
 */
export class Exo003UUIDGenerator {
  /**
   * Generate a namespace UUID from a namespace URI.
   *
   * @param namespaceUri - The full namespace URI (e.g., "https://exocortex.my/ontology/exo#")
   * @returns UUID v5 generated from the namespace URI
   *
   * @example
   * ```typescript
   * const nsUuid = Exo003UUIDGenerator.generateNamespaceUUID("https://exocortex.my/ontology/exo#");
   * // Always returns the same UUID for the same namespace URI
   * ```
   */
  static generateNamespaceUUID(namespaceUri: string): string {
    if (!namespaceUri || namespaceUri.trim().length === 0) {
      throw new Error("Namespace URI cannot be empty");
    }
    return uuidv5(namespaceUri, UUID_URL_NAMESPACE);
  }

  /**
   * Generate an asset UUID using the two-level namespace scheme.
   *
   * @param namespaceUri - The namespace URI the asset belongs to
   * @param localIdentifier - The local identifier within the namespace
   * @returns UUID v5 generated from namespace UUID + local identifier
   *
   * @example
   * ```typescript
   * // Generate UUID for exo:Person
   * const uuid = Exo003UUIDGenerator.generateAssetUUID(
   *   "https://exocortex.my/ontology/exo#",
   *   "Person"
   * );
   * // Always returns the same UUID for the same namespace + local identifier
   * ```
   */
  static generateAssetUUID(namespaceUri: string, localIdentifier: string): string {
    if (!localIdentifier || localIdentifier.trim().length === 0) {
      throw new Error("Local identifier cannot be empty");
    }

    const namespaceUuid = this.generateNamespaceUUID(namespaceUri);
    return uuidv5(localIdentifier, namespaceUuid);
  }

  /**
   * Generate a UUID for a full IRI.
   *
   * This method automatically splits the IRI into namespace and local name,
   * then generates a deterministic UUID using the two-level scheme.
   *
   * @param iri - The full IRI (e.g., "https://exocortex.my/ontology/exo#Person")
   * @returns UUID v5 generated from the IRI
   *
   * @example
   * ```typescript
   * const uuid = Exo003UUIDGenerator.generateFromIRI("https://exocortex.my/ontology/exo#Person");
   * // Equivalent to: generateAssetUUID("https://exocortex.my/ontology/exo#", "Person")
   * ```
   */
  static generateFromIRI(iri: string): string {
    if (!iri || iri.trim().length === 0) {
      throw new Error("IRI cannot be empty");
    }

    const { namespace, localName } = this.splitIRI(iri);

    if (!localName) {
      // If no local name, treat the entire IRI as the identifier
      // Use a generic namespace for this case
      return uuidv5(iri, UUID_URL_NAMESPACE);
    }

    return this.generateAssetUUID(namespace, localName);
  }

  /**
   * Generate a UUID for a blank node.
   *
   * Blank node UUIDs are generated using the blank node ID within a special
   * blank node namespace to ensure uniqueness.
   *
   * @param blankNodeId - The blank node identifier (e.g., "b1", "node123")
   * @param contextUri - Optional context URI for scoping (e.g., file path)
   * @returns UUID v5 generated for the blank node
   *
   * @example
   * ```typescript
   * const uuid = Exo003UUIDGenerator.generateBlankNodeUUID("b1", "file:///path/to/context.md");
   * ```
   */
  static generateBlankNodeUUID(blankNodeId: string, contextUri?: string): string {
    if (!blankNodeId || blankNodeId.trim().length === 0) {
      throw new Error("Blank node ID cannot be empty");
    }

    // Use a special namespace for blank nodes
    const blankNodeNamespace = "urn:exocortex:blank-node:";
    const fullId = contextUri ? `${contextUri}#${blankNodeId}` : blankNodeId;

    return this.generateAssetUUID(blankNodeNamespace, fullId);
  }

  /**
   * Generate a UUID for a statement (triple).
   *
   * Statement UUIDs are generated from the combination of subject, predicate,
   * and object URIs, ensuring the same triple always gets the same UUID.
   *
   * @param subjectUri - The subject URI or blank node ID
   * @param predicateUri - The predicate URI
   * @param objectUri - The object URI, blank node ID, or literal identifier
   * @returns UUID v5 generated for the statement
   *
   * @example
   * ```typescript
   * const uuid = Exo003UUIDGenerator.generateStatementUUID(
   *   "https://exocortex.my/ontology/exo#Person",
   *   "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
   *   "http://www.w3.org/2000/01/rdf-schema#Class"
   * );
   * ```
   */
  static generateStatementUUID(
    subjectUri: string,
    predicateUri: string,
    objectUri: string
  ): string {
    if (!subjectUri || !predicateUri || !objectUri) {
      throw new Error("Subject, predicate, and object cannot be empty");
    }

    // Use a special namespace for statements
    const statementNamespace = "urn:exocortex:statement:";

    // Combine the triple components into a deterministic identifier
    const tripleIdentifier = `${subjectUri}\t${predicateUri}\t${objectUri}`;

    return this.generateAssetUUID(statementNamespace, tripleIdentifier);
  }

  /**
   * Generate a UUID for a body (literal content).
   *
   * Body UUIDs are generated from a hash of the content combined with
   * optional language and datatype information.
   *
   * @param content - The literal content
   * @param options - Optional language, direction, and datatype
   * @returns UUID v5 generated for the body
   *
   * @example
   * ```typescript
   * const uuid = Exo003UUIDGenerator.generateBodyUUID("Hello, World!", { language: "en" });
   * ```
   */
  static generateBodyUUID(
    content: string,
    options?: {
      language?: string;
      direction?: "ltr" | "rtl";
      datatype?: string;
    }
  ): string {
    // Use a special namespace for body content
    const bodyNamespace = "urn:exocortex:body:";

    // Build identifier from content and options
    let identifier = content;

    if (options?.datatype) {
      identifier += `^^${options.datatype}`;
    } else if (options?.language) {
      identifier += `@${options.language}`;
      if (options.direction) {
        identifier += `--${options.direction}`;
      }
    }

    return this.generateAssetUUID(bodyNamespace, identifier);
  }

  /**
   * Split an IRI into namespace and local name.
   *
   * Supports both hash (#) and slash (/) separators:
   * - https://exocortex.my/ontology/exo#Person → { namespace: "...exo#", localName: "Person" }
   * - http://example.org/vocab/Person → { namespace: "...vocab/", localName: "Person" }
   *
   * @param iri - The IRI to split
   * @returns Object with namespace and localName
   */
  static splitIRI(iri: string): { namespace: string; localName: string } {
    // Try hash separator first
    const hashIndex = iri.lastIndexOf("#");
    if (hashIndex !== -1 && hashIndex < iri.length - 1) {
      return {
        namespace: iri.substring(0, hashIndex + 1),
        localName: iri.substring(hashIndex + 1),
      };
    }

    // Try slash separator (but not in protocol)
    const slashIndex = iri.lastIndexOf("/");
    const protocolEnd = iri.indexOf("://");
    if (slashIndex !== -1 && slashIndex > protocolEnd + 2 && slashIndex < iri.length - 1) {
      return {
        namespace: iri.substring(0, slashIndex + 1),
        localName: iri.substring(slashIndex + 1),
      };
    }

    // No separator found - return entire IRI as namespace with empty local name
    return {
      namespace: iri,
      localName: "",
    };
  }

  /**
   * Validate that a string is a valid UUID v4 or v5.
   *
   * @param uuid - The string to validate
   * @returns True if valid UUID format
   */
  static isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
