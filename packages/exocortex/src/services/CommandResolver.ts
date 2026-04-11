import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";
import { GroundingType } from "../domain/constants/GroundingType";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type {
  CommandDefinition,
  PreconditionDefinition,
  GroundingDefinition,
  CommandBindingDefinition,
} from "../domain/models/CommandDefinition";

/**
 * A resolved command: a CommandDefinition bound to a specific context.
 */
export interface ResolvedCommand {
  readonly command: CommandDefinition;
  readonly binding: CommandBindingDefinition;
}

/** Maximum depth for transitive loading to prevent infinite loops */
const MAX_TRANSITIVE_DEPTH = 10;

/**
 * Resolves dynamic commands from vault assets stored in an ITripleStore (RFC-009 §5.3).
 *
 * Binding priority (specific → general):
 * 1. targetAsset — only for a specific asset
 * 2. targetPrototype — for all instances of a prototype
 * 3. targetClass — for all assets of a class
 *
 * Issue #2428
 */
@injectable()
export class CommandResolver {
  private readonly cache = new Map<string, ResolvedCommand[]>();

  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Resolve all available commands for a specific asset.
   *
   * Returns commands ordered by binding priority (asset > prototype > class),
   * then by binding order within the same priority level.
   */
  async resolveForAsset(
    subjectIRI: string,
    assetClass: string,
    prototypeIRI?: string,
  ): Promise<ResolvedCommand[]> {
    const cacheKey = `${subjectIRI}:${assetClass}:${prototypeIRI ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const bindings = await this.findBindings(assetClass, prototypeIRI, subjectIRI);

    const resolved: ResolvedCommand[] = [];
    for (const binding of bindings) {
      const command = await this.loadCommand(binding.commandRef);
      if (!command) continue;

      // Apply binding-level precondition override
      const finalCommand = binding.precondition
        ? { ...command, precondition: binding.precondition }
        : command;

      resolved.push({ command: finalCommand, binding });
    }

    // Sort by binding priority: targetAsset (0) > targetPrototype (1) > targetClass (2)
    // Within same priority, sort by order
    resolved.sort((a, b) => {
      const priorityA = this.getBindingPriority(a.binding);
      const priorityB = this.getBindingPriority(b.binding);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.binding.order ?? 100) - (b.binding.order ?? 100);
    });

    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Load a single command definition by UID, including linked Precondition and Grounding.
   * Returns null if the command is not found.
   */
  async loadCommand(commandUID: string): Promise<CommandDefinition | null> {
    // Find the command subject by UID
    const subject = await this.findSubjectByUID(commandUID);
    if (!subject) return null;

    // Verify it's a Command type
    const typeTriples = await this.tripleStore.match(
      subject,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("Command"),
    );
    if (typeTriples.length === 0) return null;

    // Load command properties
    const name = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "Unknown Command";
    const labelTemplate = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_labelTemplate"));
    const icon = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_icon"));
    const confirmMessage = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_confirmMessage"));
    const successMessage = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_successMessage"));
    const category = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Command_category"));

    // Transitively load linked Precondition
    const precondition = await this.loadLinkedPrecondition(subject);

    // Transitively load linked Grounding
    const grounding = await this.loadLinkedGrounding(subject, 0);
    if (!grounding) return null; // Grounding is required

    return {
      id: commandUID,
      name,
      labelTemplate: labelTemplate ?? undefined,
      icon: icon ?? undefined,
      precondition: precondition ?? undefined,
      grounding,
      confirmMessage: confirmMessage ?? undefined,
      successMessage: successMessage ?? undefined,
      category: category ?? undefined,
    };
  }

  /**
   * Find all command bindings matching the given filters.
   *
   * Returns bindings for:
   * - targetAsset matching subjectIRI
   * - targetPrototype matching prototypeIRI
   * - targetClass matching assetClass
   */
  async findBindings(
    assetClass?: string,
    prototypeIRI?: string,
    assetIRI?: string,
  ): Promise<CommandBindingDefinition[]> {
    // Find all CommandBinding instances
    const bindingTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EXOCMD.term("CommandBinding"),
    );

    const bindings: CommandBindingDefinition[] = [];

    for (const triple of bindingTriples) {
      const bindingSubject = triple.subject as IRI;
      const binding = await this.loadBindingDefinition(bindingSubject);
      if (!binding) continue;

      // Check if this binding applies to the given context
      if (this.bindingMatches(binding, assetClass, prototypeIRI, assetIRI)) {
        bindings.push(binding);
      }
    }

    return bindings;
  }

  /**
   * Invalidate all cached command resolutions.
   * Call when vault files change.
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Resolve a dynamic label for a command bound to a specific target asset.
   *
   * If the command has a `labelTemplate`, each `{...}` placeholder is executed
   * as a SPARQL SELECT query (with `$target` substituted for the target IRI).
   * The first binding value of the first result row replaces the placeholder.
   * On error or empty result, the placeholder is replaced with an empty string.
   *
   * If the command has no `labelTemplate`, returns the static `name`.
   *
   * @param command - The command definition (may have labelTemplate)
   * @param targetIRI - IRI of the current asset (substituted for $target)
   * @returns The resolved label string
   */
  async resolveLabel(
    command: CommandDefinition,
    targetIRI: string,
  ): Promise<string> {
    if (!command.labelTemplate) {
      return command.name;
    }

    let result = command.labelTemplate;
    const placeholders = this.extractPlaceholders(command.labelTemplate);

    for (const { full, body } of placeholders) {
      const resolved = await this.evaluateSelectSnippet(body, targetIRI);
      result = result.replace(full, resolved);
    }

    return result;
  }

  // -- Private helpers --

  /**
   * Extract top-level `{...}` placeholders from a label template,
   * correctly handling nested braces in SPARQL WHERE clauses.
   *
   * Returns array of { full: "{...}", body: "..." } for each placeholder.
   */
  private extractPlaceholders(template: string): Array<{ full: string; body: string }> {
    const results: Array<{ full: string; body: string }> = [];
    let i = 0;

    while (i < template.length) {
      if (template[i] === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < template.length && depth > 0) {
          if (template[j] === "{") depth++;
          else if (template[j] === "}") depth--;
          j++;
        }
        if (depth === 0) {
          const full = template.slice(i, j);
          const body = template.slice(i + 1, j - 1);
          results.push({ full, body });
        }
        i = j;
      } else {
        i++;
      }
    }

    return results;
  }

  /**
   * Execute a SPARQL SELECT snippet and return the first binding value
   * of the first result row, or empty string on failure / no results.
   */
  private async evaluateSelectSnippet(
    sparqlBody: string,
    targetIRI: string,
  ): Promise<string> {
    try {
      const query = sparqlBody.replace(/\$target/g, `<${targetIRI}>`);
      const parser = new ExoQLParser();
      const parsed = parser.parse(query);
      const translator = new ExoQLAlgebraTranslator();
      const algebra = translator.translate(parsed);
      const executor = new ExoQLQueryExecutor(this.tripleStore);
      const solutions = await executor.executeAll(algebra);

      if (solutions.length === 0) return "";

      // Return the first binding value of the first solution
      const firstSolution = solutions[0];
      const vars = firstSolution.variables();
      if (vars.length === 0) return "";

      const value = firstSolution.get(vars[0]);
      if (!value) return "";
      if (value instanceof Literal) return value.value;
      if (value instanceof IRI) return value.value;
      return String(value);
    } catch {
      return "";
    }
  }

  private async loadBindingDefinition(subject: IRI): Promise<CommandBindingDefinition | null> {
    const uid = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_uid"));
    if (!uid) return null;

    const label = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "";

    // Load command reference
    const commandRef = await this.getLinkedUID(subject, Namespace.EXOCMD.term("CommandBinding_command"));
    if (!commandRef) return null;

    // Load target filters
    const targetClass = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetClass"));
    const targetPrototype = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetPrototype"));
    const targetAsset = await this.getLinkedValue(subject, Namespace.EXOCMD.term("CommandBinding_targetAsset"));

    // At least one target is required
    if (!targetClass && !targetPrototype && !targetAsset) return null;

    // Load display options
    const position = await this.getLiteralValue(subject, Namespace.EXOCMD.term("CommandBinding_position"));
    const orderStr = await this.getLiteralValue(subject, Namespace.EXOCMD.term("CommandBinding_order"));
    const group = await this.getLiteralValue(subject, Namespace.EXOCMD.term("CommandBinding_group"));

    // Load binding-level precondition override
    const precondition = await this.loadLinkedPreconditionFromProperty(
      subject,
      Namespace.EXOCMD.term("CommandBinding_precondition"),
    );

    return {
      id: uid,
      label,
      commandRef,
      targetClass: targetClass ?? undefined,
      targetPrototype: targetPrototype ?? undefined,
      targetAsset: targetAsset ?? undefined,
      position: position ?? undefined,
      order: orderStr ? parseInt(orderStr, 10) : undefined,
      group: group ?? undefined,
      precondition: precondition ?? undefined,
    };
  }

  private bindingMatches(
    binding: CommandBindingDefinition,
    assetClass?: string,
    prototypeIRI?: string,
    assetIRI?: string,
  ): boolean {
    // targetAsset: match specific asset
    if (binding.targetAsset && assetIRI) {
      if (this.matchesReference(binding.targetAsset, assetIRI)) return true;
    }

    // targetPrototype: match prototype
    if (binding.targetPrototype && prototypeIRI) {
      if (this.matchesReference(binding.targetPrototype, prototypeIRI)) return true;
    }

    // targetClass: match asset class
    if (binding.targetClass && assetClass) {
      if (this.matchesReference(binding.targetClass, assetClass)) return true;
    }

    return false;
  }

  private matchesReference(bindingValue: string, target: string): boolean {
    // Normalize both sides: remove wikilink brackets, quotes, extract UID
    const normalized = this.normalizeWikilink(bindingValue);
    const normalizedTarget = this.normalizeWikilink(target);
    if (normalized === normalizedTarget) return true;

    // Cross-match aliases: when one side is UUID|alias and the other is just alias,
    // the UUID part won't match the alias. Try matching against the alias part too.
    // Issue #2740
    const targetAlias = this.extractAlias(target);
    if (targetAlias && normalized === targetAlias) return true;

    const bindingAlias = this.extractAlias(bindingValue);
    if (bindingAlias && bindingAlias === normalizedTarget) return true;

    return false;
  }

  private extractAlias(value: string): string | null {
    const cleaned = value.replace(/["'[\]]/g, "").trim();
    const pipeIndex = cleaned.indexOf("|");
    return pipeIndex >= 0 ? cleaned.substring(pipeIndex + 1).trim() : null;
  }

  private getBindingPriority(binding: CommandBindingDefinition): number {
    if (binding.targetAsset) return 0;
    if (binding.targetPrototype) return 1;
    return 2; // targetClass
  }

  private async loadLinkedPrecondition(commandSubject: IRI): Promise<PreconditionDefinition | null> {
    return this.loadLinkedPreconditionFromProperty(
      commandSubject,
      Namespace.EXOCMD.term("Command_precondition"),
    );
  }

  private async loadLinkedPreconditionFromProperty(
    subject: IRI,
    predicate: IRI,
  ): Promise<PreconditionDefinition | null> {
    const refTriples = await this.tripleStore.match(subject, predicate, undefined);
    if (refTriples.length === 0) return null;

    const ref = refTriples[0].object;
    let preconditionSubject: IRI | null = null;

    if (ref instanceof IRI) {
      preconditionSubject = ref;
    } else if (ref instanceof Literal) {
      // Wikilink reference: resolve by UID
      const uid = this.normalizeWikilink(ref.value);
      preconditionSubject = await this.findSubjectByUID(uid);
    }

    if (!preconditionSubject) return null;

    const uid = await this.getLiteralValue(preconditionSubject, Namespace.EXO.term("Asset_uid"));
    const label = await this.getLiteralValue(preconditionSubject, Namespace.EXO.term("Asset_label")) ?? "";
    const sparqlAsk = await this.getLiteralValue(preconditionSubject, Namespace.EXOCMD.term("Precondition_sparqlAsk"));
    const hostFunction = await this.getLiteralValue(preconditionSubject, Namespace.EXOCMD.term("Precondition_hostFunction"));

    if (!uid) return null;

    // A precondition must have either sparqlAsk or hostFunction
    if (!sparqlAsk && !hostFunction) return null;

    return {
      id: uid,
      label,
      ...(sparqlAsk && { sparqlAsk }),
      ...(hostFunction && { hostFunction }),
    };
  }

  private async loadLinkedGrounding(
    parentSubject: IRI,
    depth: number,
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const refTriples = await this.tripleStore.match(
      parentSubject,
      Namespace.EXOCMD.term("Command_grounding"),
      undefined,
    );
    if (refTriples.length === 0) return null;

    const ref = refTriples[0].object;
    let groundingSubject: IRI | null = null;

    if (ref instanceof IRI) {
      groundingSubject = ref;
    } else if (ref instanceof Literal) {
      const uid = this.normalizeWikilink(ref.value);
      groundingSubject = await this.findSubjectByUID(uid);
    }

    if (!groundingSubject) return null;
    return this.loadGroundingDefinition(groundingSubject, depth);
  }

  private async loadGroundingDefinition(
    subject: IRI,
    depth: number,
  ): Promise<GroundingDefinition | null> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return null;

    const uid = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_uid"));
    if (!uid) return null;

    const label = await this.getLiteralValue(subject, Namespace.EXO.term("Asset_label")) ?? "";
    const typeStr = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_type"));
    if (!typeStr) return null;

    const type = this.resolveGroundingType(typeStr);
    if (!type) return null;

    let targetProperty = await this.getObsidianName(subject, Namespace.EXOCMD.term("Grounding_targetProperty"));
    // For service_call groundings, serviceId is stored in Grounding_serviceId (not targetProperty)
    if (!targetProperty && type === GroundingType.SERVICE_CALL) {
      targetProperty = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_serviceId"));
    }
    const targetValue = await this.getObsidianWikilinkValue(subject, Namespace.EXOCMD.term("Grounding_targetValue"));
    const sparqlUpdate = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_sparqlUpdate"));
    const targetClass = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_targetClass"));
    const targetPrototype = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_targetPrototype"));
    const targetFolder = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_targetFolder"));
    const inputSchemaRaw = await this.getLiteralValue(subject, Namespace.EXOCMD.term("Grounding_inputSchema"));

    // Load composite steps if applicable
    let steps: GroundingDefinition[] | undefined;
    if (type === GroundingType.COMPOSITE) {
      steps = await this.loadCompositeSteps(subject, depth + 1);
    }

    // Parse inputSchema JSON into array of field descriptors for form modals
    let inputSchema: unknown[] | undefined;
    if (inputSchemaRaw) {
      try {
        const parsed = JSON.parse(inputSchemaRaw);
        if (parsed?.properties) {
          inputSchema = Object.entries(parsed.properties as Record<string, Record<string, string>>).map(
            ([name, prop]) => ({
              name,
              type: prop.type === "string" ? "text" : prop.type,
              label: prop.title ?? name,
              required: Array.isArray(parsed.required) && parsed.required.includes(name),
            }),
          );
        }
      } catch {
        // Invalid JSON — skip inputSchema
      }
    }

    const grounding: GroundingDefinition = {
      id: uid,
      label,
      type,
      targetProperty: targetProperty ?? undefined,
      targetValue: targetValue ?? undefined,
      sparqlUpdate: sparqlUpdate ?? undefined,
      steps,
      targetClass: targetClass ?? undefined,
      targetPrototype: targetPrototype ?? undefined,
      targetFolder: targetFolder ?? undefined,
    };

    if (inputSchema) {
      (grounding as GroundingDefinition & { inputSchema: unknown[] }).inputSchema = inputSchema;
    }

    return grounding;
  }

  private async loadCompositeSteps(
    compositeSubject: IRI,
    depth: number,
  ): Promise<GroundingDefinition[]> {
    if (depth >= MAX_TRANSITIVE_DEPTH) return [];

    const stepsTriples = await this.tripleStore.match(
      compositeSubject,
      Namespace.EXOCMD.term("Grounding_steps"),
      undefined,
    );

    const steps: GroundingDefinition[] = [];
    for (const triple of stepsTriples) {
      let stepSubject: IRI | null = null;

      if (triple.object instanceof IRI) {
        stepSubject = triple.object;
      } else if (triple.object instanceof Literal) {
        const uid = this.normalizeWikilink(triple.object.value);
        stepSubject = await this.findSubjectByUID(uid);
      }

      if (!stepSubject) continue;

      const step = await this.loadGroundingDefinition(stepSubject, depth);
      if (step) steps.push(step);
    }

    return steps;
  }

  private resolveGroundingType(value: string): GroundingType | null {
    const normalized = value.toLowerCase().trim();
    const values = Object.values(GroundingType) as string[];
    return values.includes(normalized) ? (normalized as GroundingType) : null;
  }

  // -- Triple store helpers --

  private async findSubjectByUID(uid: string): Promise<IRI | null> {
    // Try optimized UUID lookup first (works for UUID v4 format)
    if (this.tripleStore.findSubjectsByUUID) {
      const subjects = await this.tripleStore.findSubjectsByUUID(uid);
      if (subjects.length > 0) return subjects[0] as IRI;
    }

    // Fallback: scan for Asset_uid literal (handles non-UUID identifiers)
    const uidTriples = await this.tripleStore.match(
      undefined,
      Namespace.EXO.term("Asset_uid"),
      undefined,
    );

    for (const triple of uidTriples) {
      if (
        triple.object instanceof Literal &&
        triple.object.value === uid
      ) {
        return triple.subject as IRI;
      }
    }

    return null;
  }

  private async getLiteralValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return obj.value;
    if (obj instanceof IRI) return obj.value;
    return null;
  }

  private async getLinkedUID(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof IRI) {
      // Try to find UID of the linked asset
      const uidTriples = await this.tripleStore.match(
        obj,
        Namespace.EXO.term("Asset_uid"),
        undefined,
      );
      if (uidTriples.length > 0 && uidTriples[0].object instanceof Literal) {
        return uidTriples[0].object.value;
      }
      // Fallback: extract from IRI
      return obj.value.split("/").pop()?.replace(".md", "") ?? null;
    }

    if (obj instanceof Literal) {
      return this.normalizeWikilink(obj.value);
    }

    return null;
  }

  private async getLinkedValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.normalizeWikilink(obj.value);
    if (obj instanceof IRI) {
      return this.iriToObsidianName(obj.value) ?? obj.value;
    }
    return null;
  }

  /**
   * Reverse-map an IRI to Obsidian-style property name (e.g., ems__Effort_status).
   * Falls back to getLiteralValue for Literal objects.
   */
  private async getObsidianName(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return obj.value;
    if (obj instanceof IRI) return this.iriToObsidianName(obj.value) ?? obj.value;
    return null;
  }

  /**
   * Read a grounding target value, converting IRIs back to wikilink format.
   * Literal values are returned as-is (they already contain wikilink syntax).
   */
  private async getObsidianWikilinkValue(subject: IRI, predicate: IRI): Promise<string | null> {
    const triples = await this.tripleStore.match(subject, predicate, undefined);
    if (triples.length === 0) return null;

    const obj = triples[0].object;
    if (obj instanceof Literal) return this.resolveWikilinkAlias(obj.value);
    if (obj instanceof IRI) {
      const name = this.iriToObsidianName(obj.value);
      return name ? `"[[${name}]]"` : obj.value;
    }
    return null;
  }

  /**
   * Resolve UUID-only wikilinks to include alias from the triple store.
   * Converts "[[UUID]]" to "[[UUID|label]]" when the asset exists.
   * Already-aliased values ("[[UUID|alias]]") pass through unchanged.
   */
  private async resolveWikilinkAlias(value: string): Promise<string> {
    const match = value.match(/\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/);
    if (!match) return value;

    const uuid = match[1];
    const assetSubject = await this.findSubjectByUID(uuid);
    if (!assetSubject) return value;

    const label = await this.getLiteralValue(assetSubject, Namespace.EXO.term("Asset_label"));
    if (!label) return value;

    return value.replace(`[[${uuid}]]`, `[[${uuid}|${label}]]`);
  }

  private iriToObsidianName(iri: string): string | null {
    const hash = iri.lastIndexOf("#");
    if (hash >= 0) {
      const ns = iri.substring(0, hash + 1);
      const local = iri.substring(hash + 1);
      if (ns === Namespace.EMS.iri.value) return `ems__${local}`;
      if (ns === Namespace.EXO.iri.value) return `exo__${local}`;
      if (ns === Namespace.EXOCMD.iri.value) return `exocmd__${local}`;
      if (ns === Namespace.IMS.iri.value) return `ims__${local}`;
      if (ns === Namespace.ZTLK.iri.value) return `ztlk__${local}`;
      if (ns === Namespace.PTMS.iri.value) return `ptms__${local}`;
      if (ns === Namespace.LIT.iri.value) return `lit__${local}`;
      if (ns === Namespace.INBOX.iri.value) return `inbox__${local}`;
    }
    // Handle obsidian:// vault URLs (e.g., obsidian://vault/ems/ems__EffortStatusDoing.md)
    const obsMatch = iri.match(/\/([^/]+)\.md$/);
    if (obsMatch) return obsMatch[1];
    return null;
  }

  private normalizeWikilink(value: string): string {
    const cleaned = value.replace(/["'[\]]/g, "").trim();
    const pipeIndex = cleaned.indexOf("|");
    return pipeIndex >= 0 ? cleaned.substring(0, pipeIndex) : cleaned;
  }
}
