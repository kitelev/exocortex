import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { Triple } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { DI_TOKENS } from "../interfaces/tokens";
import { RDFVocabularyMapper } from "../infrastructure/rdf/RDFVocabularyMapper";

/**
 * Service for converting Obsidian notes (frontmatter + wikilinks) to RDF triples.
 *
 * @example
 * ```typescript
 * const converter = new NoteToRDFConverter(vault);
 * const triples = await converter.convertNote(file);
 * ```
 */
@injectable()
export class NoteToRDFConverter {
  private readonly OBSIDIAN_VAULT_SCHEME = "obsidian://vault/";
  private readonly vocabularyMapper: RDFVocabularyMapper;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private readonly vault: IVaultAdapter,
  ) {
    this.vocabularyMapper = new RDFVocabularyMapper();
  }

  /**
   * Converts a single note to RDF triples.
   *
   * @param file - The file to convert
   * @returns Array of RDF triples representing the note's metadata
   *
   * @example
   * ```typescript
   * const file = vault.getAbstractFileByPath("My Task.md");
   * const triples = await converter.convertNote(file);
   * ```
   */
  async convertNote(file: IFile): Promise<Triple[]> {
    const frontmatter = this.vault.getFrontmatter(file);

    if (!frontmatter) {
      return [];
    }

    const triples: Triple[] = [];
    const subject = this.notePathToIRI(file.path);

    // Always add Asset_fileName triple (Issue #666)
    // This allows SPARQL queries to search by filename without hardcoded URIs
    const fileNamePredicate = Namespace.EXO.term("Asset_fileName");
    triples.push(new Triple(subject, fileNamePredicate, new Literal(file.basename)));

    for (const [key, value] of Object.entries(frontmatter)) {
      if (!this.isExocortexProperty(key)) {
        continue;
      }

      const predicate = this.propertyKeyToIRI(key);
      const values = Array.isArray(value) ? value : [value];

      for (const val of values) {
        // Issue #663: For exo__Instance_class, always use namespace URIs for class references
        // This enables canonical SPARQL JOINs: ?s exo:Instance_class ?class . ?class exo:Asset_label ?label .
        // Previously, if the class file existed, we'd use the file URI which couldn't be joined with
        // class definitions (which use namespace URIs as subjects).
        if (key === "exo__Instance_class") {
          const objectNode = this.valueToClassURI(val);
          triples.push(new Triple(subject, predicate, objectNode));
        } else {
          const objectNode = await this.valueToRDFObject(val, file);
          triples.push(new Triple(subject, predicate, objectNode));

          // Issue #871: Generate additional RDFS triple for properties with vocabulary mappings
          // This enables SPARQL queries using standard RDFS predicates like rdfs:domain, rdfs:range
          // to work with Exocortex ontology properties.
          if (this.vocabularyMapper.hasMappingFor(key) && objectNode instanceof IRI) {
            const mappedTriple = this.vocabularyMapper.generateMappedTriple(
              subject,
              key,
              objectNode,
            );
            if (mappedTriple) {
              triples.push(mappedTriple);
            }
          }
        }
      }

      if (key === "exo__Instance_class") {
        for (const val of values) {
          const classIRI = this.expandClassValue(val);
          if (classIRI) {
            const rdfType = Namespace.RDF.term("type");
            triples.push(new Triple(subject, rdfType, classIRI));
          }
        }
      }
    }

    return triples;
  }

  /**
   * Converts all notes in the vault to RDF triples.
   *
   * @returns Array of all RDF triples from the vault
   *
   * @example
   * ```typescript
   * const allTriples = await converter.convertVault();
   * console.log(`Converted ${allTriples.length} triples`);
   * ```
   */
  async convertVault(): Promise<Triple[]> {
    const files = this.vault.getAllFiles();
    const allTriples: Triple[] = [];

    for (const file of files) {
      try {
        const triples = await this.convertNote(file);
        allTriples.push(...triples);
      } catch (error) {
        // Issue #684: Skip files with invalid IRIs instead of crashing
        // This allows SPARQL queries to continue processing valid files
        // even when vault contains files with problematic characters (e.g., angle brackets <>)
        console.warn(`⚠️ Skipping file with invalid IRI: ${file.path}`);
        console.warn(`   Reason: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    return allTriples;
  }

  /**
   * Converts a note path to an obsidian:// IRI.
   *
   * Uses encodeURI (not encodeURIComponent) to preserve forward slashes
   * while encoding spaces and other special characters. This ensures
   * consistent URI normalization for exact SPARQL query matches.
   *
   * @param path - The note path (e.g., "path/to/note.md")
   * @returns IRI with obsidian:// scheme
   *
   * @example
   * ```typescript
   * const iri = converter.notePathToIRI("My Folder/My Note.md");
   * // Returns: obsidian://vault/My%20Folder/My%20Note.md
   * ```
   */
  notePathToIRI(path: string): IRI {
    // Use encodeURI to preserve forward slashes (/) while encoding
    // spaces and other special characters. This fixes query mismatch
    // issues where exact URI matches fail due to inconsistent encoding.
    // See: https://github.com/kitelev/exocortex-obsidian-plugin/issues/621
    const encodedPath = encodeURI(path);
    return new IRI(`${this.OBSIDIAN_VAULT_SCHEME}${encodedPath}`);
  }

  private isExocortexProperty(key: string): boolean {
    return key.startsWith("exo__") || key.startsWith("ems__");
  }

  private propertyKeyToIRI(key: string): IRI {
    if (key.startsWith("exo__")) {
      const localName = key.substring(5);
      return Namespace.EXO.term(localName);
    }

    if (key.startsWith("ems__")) {
      const localName = key.substring(5);
      return Namespace.EMS.term(localName);
    }

    throw new Error(`Invalid property key: ${key}`);
  }

  private async valueToRDFObject(
    value: any,
    sourceFile: IFile
  ): Promise<IRI | Literal> {
    if (typeof value === "string") {
      const cleanValue = this.removeQuotes(value);

      const wikilink = this.extractWikilink(cleanValue);
      if (wikilink) {
        const targetFile = this.vault.getFirstLinkpathDest(
          wikilink,
          sourceFile.path
        );
        if (targetFile) {
          return this.notePathToIRI(targetFile.path);
        }
        // If target file not found but wikilink is a class reference,
        // expand to namespace URI (Issue #667, #668: normalize Instance_class/Property_domain)
        if (this.isClassReference(wikilink)) {
          const classIRI = this.expandClassValue(wikilink);
          if (classIRI) {
            return classIRI;
          }
        }
        return new Literal(cleanValue);
      }

      if (this.isClassReference(cleanValue)) {
        const classIRI = this.expandClassValue(cleanValue);
        if (classIRI) {
          return classIRI;
        }
      }

      // Check for ISO 8601 dateTime format and apply xsd:dateTime datatype
      if (this.isISO8601DateTime(cleanValue)) {
        return new Literal(cleanValue, Namespace.XSD.term("dateTime"));
      }

      return new Literal(cleanValue);
    }

    if (typeof value === "boolean") {
      return new Literal(value.toString());
    }

    if (typeof value === "number") {
      return new Literal(
        value.toString(),
        Namespace.XSD.term("decimal")
      );
    }

    // Handle Date objects (js-yaml auto-parses ISO 8601 strings to Date)
    if (value instanceof Date) {
      return new Literal(value.toISOString(), Namespace.XSD.term("dateTime"));
    }

    return new Literal(String(value));
  }

  /**
   * Check if a string is a valid ISO 8601 dateTime format.
   *
   * Matches formats:
   * - `YYYY-MM-DDTHH:MM:SSZ` (UTC with Z suffix)
   * - `YYYY-MM-DDTHH:MM:SS` (local time without timezone)
   * - `YYYY-MM-DDTHH:MM:SS.sssZ` (with milliseconds)
   * - `YYYY-MM-DDTHH:MM:SS+HH:MM` (with timezone offset)
   *
   * @param value - String to check
   * @returns True if value matches ISO 8601 dateTime pattern
   */
  private isISO8601DateTime(value: string): boolean {
    // Pattern matches:
    // - Date: YYYY-MM-DD
    // - Time separator: T
    // - Time: HH:MM:SS
    // - Optional milliseconds: .sss
    // - Optional timezone: Z or +/-HH:MM
    const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;
    return iso8601Pattern.test(value);
  }

  private removeQuotes(value: string): string {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.substring(1, trimmed.length - 1);
    }
    return value;
  }

  private extractWikilink(value: string): string | null {
    const match = value.match(/^\[\[([^\]]+)\]\]$/);
    return match ? match[1] : null;
  }

  /**
   * Converts a value for exo__Instance_class to a namespace URI.
   *
   * Issue #663: Always stores class references as namespace URIs (not file URIs),
   * enabling canonical SPARQL JOINs with class definitions.
   *
   * @param value - The value from frontmatter (e.g., "[[ems__Task]]", "ems__Task", '"[[exo__Class]]"')
   * @returns IRI with namespace URI for class references, or Literal for non-class values
   *
   * @example
   * ```typescript
   * valueToClassURI("[[ems__Task]]")  // → IRI("https://exocortex.my/ontology/ems#Task")
   * valueToClassURI("ems__Task")      // → IRI("https://exocortex.my/ontology/ems#Task")
   * valueToClassURI('"[[exo__Class]]"')  // → IRI("https://exocortex.my/ontology/exo#Class")
   * valueToClassURI("[[SomeNote]]")   // → Literal("[[SomeNote]]") (not a class reference)
   * ```
   */
  private valueToClassURI(value: any): IRI | Literal {
    if (typeof value !== "string") {
      return new Literal(String(value));
    }

    const cleanValue = this.removeQuotes(value);
    const wikilink = this.extractWikilink(cleanValue);
    const classRef = wikilink || cleanValue;

    // Try to expand as a class reference (ems__ or exo__ prefix)
    const classIRI = this.expandClassValue(classRef);
    if (classIRI) {
      return classIRI;
    }

    // Not a class reference - return as literal (preserves original wiki-link format)
    return new Literal(cleanValue);
  }

  private isClassReference(value: string): boolean {
    // Class references cannot contain whitespace or special characters
    // Valid: "ems__Task", "exo__ObjectProperty"
    // Invalid: "ems__Effort_blocker сделать массивом" (contains spaces)
    return (value.startsWith("ems__") || value.startsWith("exo__"))
      && !/\s/.test(value);
  }

  private expandClassValue(value: string): IRI | null {
    const cleanValue = this.removeQuotes(value);

    if (cleanValue.startsWith("ems__")) {
      const className = cleanValue.substring(5);
      return Namespace.EMS.term(className);
    }

    if (cleanValue.startsWith("exo__")) {
      const className = cleanValue.substring(5);
      return Namespace.EXO.term(className);
    }

    return null;
  }
}
