import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * A single property-value pair to set on a new instance.
 */
export interface PropertySetRule {
  /** Property IRI local name (e.g. "ems__Effort_status") */
  property: string;
  /** String representation of the value */
  value: string;
  /** Value type: "literal" | "wikilink" | "timestamp" | "uid" etc. */
  valueType: string;
}

/**
 * Resolved instantiation rule for creating instances of a given class.
 */
export interface InstantiationRule {
  /** UID of the prototype asset to use as a template */
  prototypeUID: string | null;
  /** Default vault folder path for the new instance */
  defaultFolder: string | null;
  /** Property-value pairs to set on the new instance */
  propertySetRules: PropertySetRule[];
}

/**
 * Loads exo:InstantiationRule assets from the triple store and resolves
 * how to create a new instance of any given type.
 *
 * Replaces hardcoded INSTANCE_CLASS_MAP and EFFORT_PROPERTY_MAP.
 *
 * Issue #2534
 */
@injectable()
export class InstantiationRuleResolver {
  private readonly cache = new Map<string, InstantiationRule | null>();

  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Get the instantiation rule for a target class.
   *
   * @param targetClass - The class name (e.g. "ems__Task", "ems__Project")
   * @returns The resolved rule, or null if no rule is defined for this class
   */
  async getRule(targetClass: string): Promise<InstantiationRule | null> {
    const cached = this.cache.get(targetClass);
    if (cached !== undefined) return cached;

    const rule = await this.findRuleForClass(targetClass);
    this.cache.set(targetClass, rule);
    return rule;
  }

  /**
   * Invalidate all cached rules.
   * Call when vault assets change.
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Find the InstantiationRule for a given target class from the triple store.
   */
  private async findRuleForClass(
    targetClass: string,
  ): Promise<InstantiationRule | null> {
    // Find all exo:InstantiationRule instances
    const ruleTriples = await this.tripleStore.match(
      undefined,
      Namespace.RDF.term("type"),
      Namespace.EXO.term("InstantiationRule"),
    );

    for (const triple of ruleTriples) {
      const subject = triple.subject as IRI;

      // Check if rule_targetClass matches
      const targetClassTriples = await this.tripleStore.match(
        subject,
        Namespace.EXO.term("rule_targetClass"),
        undefined,
      );

      const matchesClass = targetClassTriples.some((t) =>
        this.matchesTargetClass(t.object, targetClass),
      );

      if (!matchesClass) continue;

      // Found a matching rule — load it
      return this.loadRule(subject);
    }

    return null;
  }

  /**
   * Load a complete InstantiationRule from a rule subject IRI.
   */
  private async loadRule(ruleSubject: IRI): Promise<InstantiationRule> {
    // Load prototypeUID
    const protoTriples = await this.tripleStore.match(
      ruleSubject,
      Namespace.EXO.term("rule_prototypeUID"),
      undefined,
    );
    const prototypeUID =
      protoTriples.length > 0 && protoTriples[0].object instanceof Literal
        ? protoTriples[0].object.value
        : null;

    // Load defaultFolder
    const folderTriples = await this.tripleStore.match(
      ruleSubject,
      Namespace.EXO.term("rule_defaultFolder"),
      undefined,
    );
    const defaultFolder =
      folderTriples.length > 0 && folderTriples[0].object instanceof Literal
        ? folderTriples[0].object.value
        : null;

    // Load propertySetRules
    const propertySetRulesTriples = await this.tripleStore.match(
      ruleSubject,
      Namespace.EXO.term("rule_propertySetRules"),
      undefined,
    );

    const propertySetRules: PropertySetRule[] = [];

    for (const psrTriple of propertySetRulesTriples) {
      const psrSubject = psrTriple.object;
      if (!(psrSubject instanceof IRI)) continue;

      const psr = await this.loadPropertySetRule(psrSubject);
      if (psr) {
        propertySetRules.push(psr);
      }
    }

    return { prototypeUID, defaultFolder, propertySetRules };
  }

  /**
   * Load a single PropertySetRule from its subject IRI.
   */
  private async loadPropertySetRule(
    subject: IRI,
  ): Promise<PropertySetRule | null> {
    // Load property
    const propertyTriples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("rule_property"),
      undefined,
    );
    if (propertyTriples.length === 0) return null;

    const propertyObj = propertyTriples[0].object;
    const property =
      propertyObj instanceof IRI
        ? this.extractLocalName(propertyObj)
        : propertyObj instanceof Literal
          ? this.normalizeWikilink(propertyObj.value)
          : null;
    if (!property) return null;

    // Load value
    const valueTriples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("rule_value"),
      undefined,
    );
    const value =
      valueTriples.length > 0 && valueTriples[0].object instanceof Literal
        ? valueTriples[0].object.value
        : "";

    // Load valueType (default: "literal")
    const valueTypeTriples = await this.tripleStore.match(
      subject,
      Namespace.EXO.term("rule_valueType"),
      undefined,
    );
    const valueType =
      valueTypeTriples.length > 0 &&
      valueTypeTriples[0].object instanceof Literal
        ? valueTypeTriples[0].object.value
        : "literal";

    return { property, value, valueType };
  }

  // ─── Helpers ────────────────────────────────────────────────

  /**
   * Check if an RDF object matches the given target class name.
   * Handles both IRI references and literal/wikilink values.
   */
  private matchesTargetClass(
    obj: import("../domain/models/rdf/Triple").Object,
    targetClass: string,
  ): boolean {
    if (obj instanceof IRI) {
      // e.g. https://exocortex.my/ontology/ems#Task → ems__Task
      const localName = this.extractLocalName(obj);
      return localName === targetClass;
    }
    if (obj instanceof Literal) {
      const normalized = this.normalizeWikilink(obj.value);
      return normalized === targetClass;
    }
    return false;
  }

  /**
   * Extract a prefixed local name from an IRI.
   * e.g. "https://exocortex.my/ontology/ems#Task" → "ems__Task"
   */
  private extractLocalName(iri: IRI): string {
    const value = iri.value;
    const hashIdx = value.lastIndexOf("#");
    if (hashIdx >= 0) {
      const localName = value.substring(hashIdx + 1);
      // Determine prefix from namespace
      if (value.includes("/ems#")) return `ems__${localName}`;
      if (value.includes("/exo#")) return `exo__${localName}`;
      if (value.includes("/ims#")) return `ims__${localName}`;
      return localName;
    }
    const slashIdx = value.lastIndexOf("/");
    if (slashIdx >= 0) {
      return value.substring(slashIdx + 1);
    }
    return value;
  }

  /**
   * Normalize a wikilink value by removing brackets and quotes.
   */
  private normalizeWikilink(value: string): string {
    return value.replace(/["'[\]]/g, "").trim();
  }
}
