import { injectable } from "tsyringe";
import { ITripleStore } from "../interfaces/ITripleStore";
import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * Registry of properties that must NOT be inherited through prototype chain resolution.
 *
 * Loads the set from the triple store by querying for properties marked with
 * exo__NonInheritableProperty class, then provides O(1) lookup by predicate IRI.
 *
 * Used by PrototypeChainMaterializer to skip excluded properties during inheritance.
 */
@injectable()
export class NonInheritablePropertyRegistry {
  private readonly nonInheritableIRIs: Set<string> = new Set();
  private initialized = false;

  /**
   * Load non-inheritable property set from triple store.
   *
   * Queries for: ?property exo:Instance_class exo:NonInheritableProperty
   * Then maps each property's Asset_label to its predicate IRI.
   *
   * Safe default: if query fails or returns no results, all properties are inheritable.
   */
  async initialize(store: ITripleStore): Promise<void> {
    this.nonInheritableIRIs.clear();

    try {
      const allPredicates = await store.predicates();

      const instanceClassPredicate = allPredicates.find((p) =>
        p.value.includes("Instance_class"),
      );

      if (!instanceClassPredicate) {
        this.initialized = true;
        return;
      }

      // Find the NonInheritableProperty class IRI in the store
      const nonInheritableClassIRI = await this.findNonInheritableClassIRI(
        store,
        allPredicates,
      );

      if (!nonInheritableClassIRI) {
        this.initialized = true;
        return;
      }

      // Find all properties marked as NonInheritableProperty
      const markedProperties = await store.match(
        undefined,
        instanceClassPredicate,
        nonInheritableClassIRI,
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
              this.nonInheritableIRIs.add(predicateIRI);
            }
          }
        }
      }
    } catch {
      // Safe default: empty set = all properties inheritable
    }

    this.initialized = true;
  }

  /**
   * Check if a property predicate IRI is non-inheritable.
   * Returns false (safe default) if not initialized or property not found.
   */
  isNonInheritable(propertyIRI: string): boolean {
    return this.nonInheritableIRIs.has(propertyIRI);
  }

  /**
   * Get the count of registered non-inheritable properties.
   */
  get size(): number {
    return this.nonInheritableIRIs.size;
  }

  /**
   * Check if the registry has been initialized.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Find the IRI used for exo__NonInheritableProperty class in the store.
   * Uses Asset_label matching since the class IRI varies by vault path.
   */
  private async findNonInheritableClassIRI(
    store: ITripleStore,
    allPredicates: IRI[],
  ): Promise<IRI | null> {
    const labelPredicate = allPredicates.find((p) =>
      p.value.includes("Asset_label"),
    );

    if (!labelPredicate) {
      return null;
    }

    // Search for assets labeled "exo__NonInheritableProperty"
    const labelTriples = await store.match(
      undefined,
      labelPredicate,
      new Literal("exo__NonInheritableProperty"),
    );

    if (labelTriples.length > 0 && labelTriples[0].subject instanceof IRI) {
      return labelTriples[0].subject as IRI;
    }

    // Fallback: look for IRI containing "NonInheritableProperty"
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
          t.object.value.includes("NonInheritableProperty")
        ) {
          return t.object as IRI;
        }
      }
    }

    return null;
  }

  /**
   * Convert a property key (e.g. "ems__Effort_startTimestamp") to its predicate IRI.
   * Follows the same convention as NoteToRDFConverter.propertyKeyToIRI().
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
