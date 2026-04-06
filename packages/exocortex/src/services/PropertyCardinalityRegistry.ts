import { injectable } from "tsyringe";
import { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * Registry of multi-valued properties for prototype chain merge semantics.
 *
 * Loads from triple store by querying for properties marked with
 * exo__Property_cardinality: exo__PropertyCardinalityMultiple,
 * then provides O(1) lookup by predicate IRI.
 *
 * Used by PrototypeChainMaterializer to APPEND (not skip) inherited values
 * for multi-valued properties like exo__Instance_class.
 */
@injectable()
export class PropertyCardinalityRegistry {
  private readonly multiValuedIRIs: Set<string> = new Set();
  private initialized = false;

  /**
   * Load multi-valued property set from triple store.
   *
   * Queries for: ?property exo:Property_cardinality exo:PropertyCardinalityMultiple
   * Then maps each property's Asset_label to its predicate IRI.
   *
   * Safe default: if query fails or returns no results, all properties are single-valued.
   */
  async initialize(store: ITripleStore): Promise<void> {
    this.multiValuedIRIs.clear();

    try {
      const allPredicates = await store.predicates();

      const cardinalityPredicate = allPredicates.find((p) =>
        p.value.includes("Property_cardinality"),
      );

      if (!cardinalityPredicate) {
        this.initialized = true;
        return;
      }

      // Find the PropertyCardinalityMultiple class IRI in the store
      const multipleClassIRI = await this.findMultipleCardinalityIRI(
        store,
        allPredicates,
      );

      if (!multipleClassIRI) {
        this.initialized = true;
        return;
      }

      // Find all properties marked as multi-valued
      const markedProperties = await store.match(
        undefined,
        cardinalityPredicate,
        multipleClassIRI,
      );

      if (markedProperties.length === 0) {
        this.initialized = true;
        return;
      }

      // For each marked property, get its Asset_label and convert to predicate IRI
      const labelPredicate = allPredicates.find((p) =>
        p.value.includes("Asset_label"),
      );

      if (!labelPredicate) {
        this.initialized = true;
        return;
      }

      for (const triple of markedProperties) {
        const labelTriples = await store.match(
          triple.subject,
          labelPredicate,
          undefined,
        );

        for (const labelTriple of labelTriples) {
          if (labelTriple.object instanceof Literal) {
            const propertyKey = labelTriple.object.value;
            const predicateIRI = this.propertyKeyToIRI(propertyKey);
            if (predicateIRI) {
              this.multiValuedIRIs.add(predicateIRI);
            }
          }
        }
      }
    } catch {
      // Safe default: empty set = all properties single-valued (skip behavior)
    }

    this.initialized = true;
  }

  /**
   * Check if a property predicate IRI is multi-valued.
   * Returns false (safe default) if not initialized or property not found.
   */
  isMultiValued(propertyIRI: string): boolean {
    return this.multiValuedIRIs.has(propertyIRI);
  }

  /**
   * Get the count of registered multi-valued properties.
   */
  get size(): number {
    return this.multiValuedIRIs.size;
  }

  /**
   * Check if the registry has been initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Find the IRI used for exo__PropertyCardinalityMultiple class in the store.
   * Uses Asset_label matching since the class IRI varies by vault path.
   */
  private async findMultipleCardinalityIRI(
    store: ITripleStore,
    allPredicates: IRI[],
  ): Promise<IRI | null> {
    const labelPredicate = allPredicates.find((p) =>
      p.value.includes("Asset_label"),
    );

    if (!labelPredicate) {
      return null;
    }

    // Search for assets labeled "exo__PropertyCardinalityMultiple"
    const labelTriples = await store.match(
      undefined,
      labelPredicate,
      new Literal("exo__PropertyCardinalityMultiple"),
    );

    if (labelTriples.length > 0 && labelTriples[0].subject instanceof IRI) {
      return labelTriples[0].subject as IRI;
    }

    // Fallback: look for IRI containing "PropertyCardinalityMultiple"
    const instanceClassPredicate = allPredicates.find((p) =>
      p.value.includes("Instance_class"),
    );

    if (instanceClassPredicate) {
      const allClassTriples = await store.match(
        undefined,
        instanceClassPredicate,
        undefined,
      );

      for (const t of allClassTriples) {
        if (
          t.object instanceof IRI &&
          t.object.value.includes("PropertyCardinalityMultiple")
        ) {
          return t.object as IRI;
        }
      }
    }

    return null;
  }

  /**
   * Convert a property key (e.g. "exo__Instance_class") to its predicate IRI.
   */
  private propertyKeyToIRI(key: string): string | null {
    if (key.startsWith("exo__")) {
      return Namespace.EXO.term(key.substring(5)).value;
    }

    if (key.startsWith("ems__")) {
      return Namespace.EMS.term(key.substring(5)).value;
    }

    if (key.startsWith("exocmd__")) {
      return Namespace.EXOCMD.term(key.substring(8)).value;
    }

    return null;
  }
}
