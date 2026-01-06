import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { Triple } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { BlankNode } from "../domain/models/rdf/BlankNode";
import { Namespace } from "../domain/models/rdf/Namespace";
import { DI_TOKENS } from "../interfaces/tokens";
import { RDFVocabularyMapper } from "../infrastructure/rdf/RDFVocabularyMapper";
import {
  Exo003Parser,
  Exo003MetadataType,
  type Exo003AnchorMetadata,
  type Exo003BlankNodeMetadata,
  type Exo003StatementMetadata,
  type Exo003BodyMetadata,
} from "../domain/models/exo003";

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

  /**
   * Regex pattern to match wikilinks in markdown body content.
   * Matches: [[Target]] or [[Target|Alias]]
   * Does not match wikilinks with angle brackets (embedded images: ![[image.png]])
   */
  private readonly BODY_WIKILINK_PATTERN = /(?<!!)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private readonly vault: IVaultAdapter,
  ) {
    this.vocabularyMapper = new RDFVocabularyMapper();
  }

  /**
   * Converts a single note to RDF triples.
   *
   * Supports both legacy format (exo__/ems__ prefixed properties) and
   * Exo 0.0.3 format (metadata: namespace|anchor|blank_node|statement|body).
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

    // Issue #1366: Check for Exo 0.0.3 format first
    if (Exo003Parser.isExo003Format(frontmatter)) {
      return this.convertExo003Note(file, frontmatter);
    }

    // Legacy format processing
    return this.convertLegacyNote(file, frontmatter);
  }

  /**
   * Converts a legacy format note (exo__/ems__ properties) to RDF triples.
   */
  private async convertLegacyNote(
    file: IFile,
    frontmatter: Record<string, unknown>
  ): Promise<Triple[]> {
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

    // Issue #1329: Index body wikilinks to RDF
    // This enables SPARQL queries to find all notes referencing a target note
    const bodyLinkTriples = await this.convertBodyWikilinks(file, subject);
    triples.push(...bodyLinkTriples);

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 format note to RDF triples.
   *
   * Issue #1366: Support for new file format where each RDF triple is stored as a separate file.
   *
   * @param file - The file to convert
   * @param frontmatter - The parsed frontmatter
   * @returns Array of RDF triples
   */
  private async convertExo003Note(
    file: IFile,
    frontmatter: Record<string, unknown>
  ): Promise<Triple[]> {
    const parseResult = Exo003Parser.parse(frontmatter);

    if (!parseResult.success || !parseResult.metadata) {
      // Invalid Exo 0.0.3 file - skip
      return [];
    }

    const metadata = parseResult.metadata;
    const triples: Triple[] = [];

    switch (metadata.metadata) {
      case Exo003MetadataType.Namespace:
        // Namespace files don't generate triples directly
        // They define prefix-to-URI mappings used by other files
        break;

      case Exo003MetadataType.Anchor:
        triples.push(...this.convertExo003Anchor(file, metadata as Exo003AnchorMetadata));
        break;

      case Exo003MetadataType.BlankNode:
        triples.push(...this.convertExo003BlankNode(file, metadata as Exo003BlankNodeMetadata));
        break;

      case Exo003MetadataType.Statement:
        triples.push(...this.convertExo003Statement(file, metadata as Exo003StatementMetadata));
        break;

      case Exo003MetadataType.Body:
        triples.push(...await this.convertExo003Body(file, metadata as Exo003BodyMetadata));
        break;
    }

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 anchor file to RDF triples.
   * Adds file-to-URI mapping triple.
   */
  private convertExo003Anchor(
    file: IFile,
    metadata: Exo003AnchorMetadata
  ): Triple[] {
    const fileIRI = this.notePathToIRI(file.path);
    const anchorIRI = new IRI(metadata.uri);

    // Map the file to its anchor URI using owl:sameAs
    // This enables queries to find the file by its semantic URI
    return [
      new Triple(fileIRI, Namespace.OWL.term("sameAs"), anchorIRI),
      new Triple(anchorIRI, Namespace.OWL.term("sameAs"), fileIRI),
    ];
  }

  /**
   * Converts an Exo 0.0.3 blank node file to RDF triples.
   */
  private convertExo003BlankNode(
    file: IFile,
    metadata: Exo003BlankNodeMetadata
  ): Triple[] {
    const fileIRI = this.notePathToIRI(file.path);

    // Create a blank node with the URI as its identifier
    // The URI in blank_node files is used as a stable identifier
    const blankNodeId = metadata.uri.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Map the file to the blank node
    return [
      new Triple(fileIRI, Namespace.OWL.term("sameAs"), new BlankNode(blankNodeId)),
    ];
  }

  /**
   * Converts an Exo 0.0.3 statement file to RDF triples.
   * Resolves wikilink references to anchor URIs.
   */
  private convertExo003Statement(
    file: IFile,
    metadata: Exo003StatementMetadata
  ): Triple[] {
    const triples: Triple[] = [];

    try {
      // Build a resolver function for wikilink references
      const resolveReference = this.createExo003ReferenceResolver(file);

      // Use Exo003Parser to convert to triple
      const triple = Exo003Parser.toTriple(metadata, resolveReference);
      triples.push(triple);

      // Also add a triple linking the file to the statement
      const fileIRI = this.notePathToIRI(file.path);
      triples.push(
        new Triple(fileIRI, Namespace.RDF.term("value"), triple.subject)
      );
    } catch {
      // If conversion fails, skip this statement
    }

    return triples;
  }

  /**
   * Converts an Exo 0.0.3 body file to RDF triples.
   * The body content becomes the literal value of the triple.
   */
  private async convertExo003Body(
    file: IFile,
    metadata: Exo003BodyMetadata
  ): Promise<Triple[]> {
    const triples: Triple[] = [];

    try {
      // Read the file to get body content
      const content = await this.vault.read(file);
      const bodyContent = this.extractBodyContent(content);

      // Build a resolver function for wikilink references
      const resolveReference = this.createExo003ReferenceResolver(file);

      // Resolve subject and predicate
      const subjectRef = resolveReference(metadata.subject);
      const predicateRef = resolveReference(metadata.predicate);

      if (subjectRef.type === "literal") {
        throw new Error("Body subject cannot be a literal");
      }
      if (predicateRef.type !== "iri") {
        throw new Error("Body predicate must be an IRI");
      }

      const subject = subjectRef.type === "iri"
        ? new IRI(subjectRef.value)
        : new BlankNode(subjectRef.value);
      const predicate = new IRI(predicateRef.value);

      // Create the literal from body content
      const literal = Exo003Parser.toLiteral(metadata, bodyContent.trim());

      triples.push(new Triple(subject, predicate, literal));

      // Also add a triple linking the file to the subject
      const fileIRI = this.notePathToIRI(file.path);
      triples.push(
        new Triple(fileIRI, Namespace.RDF.term("value"), subject)
      );
    } catch {
      // If conversion fails, skip this body
    }

    return triples;
  }

  /**
   * Creates a reference resolver function for Exo 0.0.3 wikilink references.
   *
   * Resolves [[wikilink]] references to anchor/namespace URIs by looking up
   * the target file's metadata.
   */
  private createExo003ReferenceResolver(
    sourceFile: IFile
  ): (ref: string) => {
    type: "iri" | "blank" | "literal";
    value: string;
    language?: string;
    direction?: "ltr" | "rtl";
    datatype?: string;
  } {
    return (ref: string) => {
      // Check if ref is a wikilink
      const wikilink = this.extractWikilink(ref);
      const targetPath = wikilink || ref;

      // Try to resolve the target file
      const targetFile = this.vault.getFirstLinkpathDest(targetPath, sourceFile.path);

      if (targetFile) {
        // Get the target file's frontmatter
        const targetFrontmatter = this.vault.getFrontmatter(targetFile);

        if (targetFrontmatter && Exo003Parser.isExo003Format(targetFrontmatter)) {
          const parseResult = Exo003Parser.parse(targetFrontmatter);

          if (parseResult.success && parseResult.metadata) {
            const metadata = parseResult.metadata;

            // Anchor and Namespace files have a URI
            if (
              metadata.metadata === Exo003MetadataType.Anchor ||
              metadata.metadata === Exo003MetadataType.Namespace
            ) {
              return {
                type: "iri",
                value: (metadata as Exo003AnchorMetadata).uri,
              };
            }

            // BlankNode files
            if (metadata.metadata === Exo003MetadataType.BlankNode) {
              return {
                type: "blank",
                value: (metadata as Exo003BlankNodeMetadata).uri.replace(/[^a-zA-Z0-9_-]/g, "_"),
              };
            }
          }
        }

        // Target exists but is not Exo 0.0.3 format - use file IRI
        return {
          type: "iri",
          value: this.notePathToIRI(targetFile.path).value,
        };
      }

      // Check if this is a full URI (not a wikilink)
      if (!wikilink && ref.includes("://")) {
        return {
          type: "iri",
          value: ref,
        };
      }

      // Could not resolve - treat as literal
      return {
        type: "literal",
        value: ref,
      };
    };
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
    // See: https://github.com/kitelev/exocortex/issues/621
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

  /**
   * Extracts the target path from a wikilink.
   *
   * Handles both formats:
   * - `[[Target]]` → "Target"
   * - `[[Target|Alias]]` → "Target" (strips the alias)
   *
   * Issue #1377: Statement files in Exo 0.0.3 format use wikilinks with aliases
   * like `[[UUID|rdfs:label]]`. The alias part must be stripped to resolve the file.
   *
   * @param value - The wikilink string
   * @returns The target path (without alias), or null if not a wikilink
   */
  private extractWikilink(value: string): string | null {
    // Match wikilinks with optional alias: [[Target]] or [[Target|Alias]]
    const match = value.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
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

  /**
   * Extracts the body content from a markdown file (everything after the frontmatter).
   *
   * @param content - Full file content including frontmatter
   * @returns Body content without frontmatter, or full content if no frontmatter
   */
  private extractBodyContent(content: string): string {
    // Frontmatter pattern: starts with ---, ends with ---
    const frontmatterPattern = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
    return content.replace(frontmatterPattern, "");
  }

  /**
   * Extracts all wikilinks from markdown body content.
   *
   * Matches both [[Target]] and [[Target|Alias]] formats.
   * Does NOT match embedded images: ![[image.png]]
   *
   * @param bodyContent - The markdown body content (without frontmatter)
   * @returns Array of unique wikilink targets
   *
   * @example
   * ```typescript
   * const links = extractBodyWikilinks("See [[Note A]] and [[Note B|alias]].");
   * // Returns: ["Note A", "Note B"]
   * ```
   */
  extractBodyWikilinks(bodyContent: string): string[] {
    const links = new Set<string>();
    let match: RegExpExecArray | null;

    // Reset regex lastIndex for each call (important for global regex)
    const pattern = new RegExp(this.BODY_WIKILINK_PATTERN.source, "g");

    while ((match = pattern.exec(bodyContent)) !== null) {
      // match[1] contains the link target (without alias)
      if (match[1]) {
        links.add(match[1]);
      }
    }

    return Array.from(links);
  }

  /**
   * Converts body wikilinks to RDF triples.
   *
   * Issue #1329: Index body wikilinks to enable complete graph analysis.
   * Body links are stored with predicate exo:Asset_bodyLink.
   *
   * @param file - The source file
   * @param subject - The subject IRI for the note
   * @returns Array of triples for body links
   */
  async convertBodyWikilinks(
    file: IFile,
    subject: IRI,
  ): Promise<Triple[]> {
    const triples: Triple[] = [];

    try {
      const content = await this.vault.read(file);
      const bodyContent = this.extractBodyContent(content);
      const wikilinks = this.extractBodyWikilinks(bodyContent);

      const bodyLinkPredicate = Namespace.EXO.term("Asset_bodyLink");

      for (const linkTarget of wikilinks) {
        // Try to resolve the wikilink to an actual file
        const targetFile = this.vault.getFirstLinkpathDest(
          linkTarget,
          file.path
        );

        if (targetFile) {
          // Link resolves to a file - use file IRI
          const objectIRI = this.notePathToIRI(targetFile.path);
          triples.push(new Triple(subject, bodyLinkPredicate, objectIRI));
        } else if (this.isClassReference(linkTarget)) {
          // Link might be a class reference (ems__/exo__ prefix)
          const classIRI = this.expandClassValue(linkTarget);
          if (classIRI) {
            triples.push(new Triple(subject, bodyLinkPredicate, classIRI));
          } else {
            // Could not expand - store as literal
            triples.push(new Triple(subject, bodyLinkPredicate, new Literal(linkTarget)));
          }
        } else {
          // Link doesn't resolve - store the target as literal for discoverability
          triples.push(new Triple(subject, bodyLinkPredicate, new Literal(linkTarget)));
        }
      }
    } catch {
      // If file read fails, silently skip body links (file may be binary or inaccessible)
    }

    return triples;
  }
}
