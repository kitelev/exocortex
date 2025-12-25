/**
 * InferenceManager - Manages ontology inference and reasoning
 *
 * Provides inference functionality for:
 * - RDFS entailment (subclass, domain, range)
 * - OWL 2 RL reasoning (inverseOf, transitiveProperty, symmetricProperty)
 * - Justification chain generation
 * - Inference caching and invalidation
 *
 * @module presentation/renderers/graph/inference
 * @since 1.0.0
 */

import type {
  Triple,
  TriplePattern,
  InferenceType,
  InferenceRule,
  InferenceStep,
  Justification,
  InferredFact,
  InferenceEvent,
  InferenceEventType,
  InferenceEventListener,
} from "./InferenceTypes";

// ============================================================
// Types
// ============================================================

/**
 * Triple store adapter for inference queries
 */
export interface InferenceTripleStore {
  /** Match triples by pattern */
  match(subject?: string, predicate?: string, object?: string): Promise<Triple[]>;

  /** Check if triple exists */
  has(triple: Triple): Promise<boolean>;

  /** Get all triples */
  getAll(): Promise<Triple[]>;
}

/**
 * Configuration for InferenceManager
 */
export interface InferenceManagerConfig {
  /** Maximum inference depth @default 10 */
  maxDepth: number;

  /** Maximum inferences per source @default 1000 */
  maxInferences: number;

  /** Cache TTL in milliseconds @default 60000 */
  cacheTTL: number;

  /** Whether to compute justifications @default true */
  computeJustifications: boolean;

  /** Enabled inference types @default all RDFS and common OWL */
  enabledTypes: Set<InferenceType>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: InferenceManagerConfig = {
  maxDepth: 10,
  maxInferences: 1000,
  cacheTTL: 60000,
  computeJustifications: true,
  enabledTypes: new Set<InferenceType>([
    "rdfs:subClassOf-transitivity",
    "rdfs:subPropertyOf-transitivity",
    "rdfs:domain",
    "rdfs:range",
    "owl:equivalentClass",
    "owl:sameAs",
    "owl:inverseOf",
    "owl:transitiveProperty",
    "owl:symmetricProperty",
    "owl:propertyChain",
  ]),
};

// ============================================================
// Built-in Inference Rules
// ============================================================

/**
 * RDFS and OWL 2 RL inference rules
 */
export const BUILT_IN_RULES: InferenceRule[] = [
  // RDFS Rules
  {
    id: "rdfs2",
    name: "RDFS Domain",
    description: "If property P has domain C, and subject S has property P, then S is of type C",
    type: "rdfs:domain",
    premises: [
      { predicate: "rdfs:domain", object: "?C" },
      { subject: "?S", predicate: "?P", object: "?O" },
    ],
    conclusion: { subject: "?S", predicate: "rdf:type", object: "?C" },
    priority: 1,
  },
  {
    id: "rdfs3",
    name: "RDFS Range",
    description: "If property P has range C, and subject S has property P with object O, then O is of type C",
    type: "rdfs:range",
    premises: [
      { predicate: "rdfs:range", object: "?C" },
      { subject: "?S", predicate: "?P", object: "?O" },
    ],
    conclusion: { subject: "?O", predicate: "rdf:type", object: "?C" },
    priority: 1,
  },
  {
    id: "rdfs5",
    name: "RDFS SubPropertyOf Transitivity",
    description: "If P1 is subproperty of P2, and P2 is subproperty of P3, then P1 is subproperty of P3",
    type: "rdfs:subPropertyOf-transitivity",
    premises: [
      { subject: "?P1", predicate: "rdfs:subPropertyOf", object: "?P2" },
      { subject: "?P2", predicate: "rdfs:subPropertyOf", object: "?P3" },
    ],
    conclusion: { subject: "?P1", predicate: "rdfs:subPropertyOf", object: "?P3" },
    priority: 2,
  },
  {
    id: "rdfs9",
    name: "RDFS SubClassOf Type Propagation",
    description: "If X is of type C1, and C1 is subclass of C2, then X is of type C2",
    type: "rdfs:subClassOf-transitivity",
    premises: [
      { subject: "?X", predicate: "rdf:type", object: "?C1" },
      { subject: "?C1", predicate: "rdfs:subClassOf", object: "?C2" },
    ],
    conclusion: { subject: "?X", predicate: "rdf:type", object: "?C2" },
    priority: 1,
  },
  {
    id: "rdfs11",
    name: "RDFS SubClassOf Transitivity",
    description: "If C1 is subclass of C2, and C2 is subclass of C3, then C1 is subclass of C3",
    type: "rdfs:subClassOf-transitivity",
    premises: [
      { subject: "?C1", predicate: "rdfs:subClassOf", object: "?C2" },
      { subject: "?C2", predicate: "rdfs:subClassOf", object: "?C3" },
    ],
    conclusion: { subject: "?C1", predicate: "rdfs:subClassOf", object: "?C3" },
    priority: 2,
  },

  // OWL 2 RL Rules
  {
    id: "owl-inverse",
    name: "OWL Inverse Property",
    description: "If P1 is inverse of P2, and X P1 Y, then Y P2 X",
    type: "owl:inverseOf",
    premises: [
      { subject: "?P1", predicate: "owl:inverseOf", object: "?P2" },
      { subject: "?X", predicate: "?P1", object: "?Y" },
    ],
    conclusion: { subject: "?Y", predicate: "?P2", object: "?X" },
    priority: 1,
  },
  {
    id: "owl-symmetric",
    name: "OWL Symmetric Property",
    description: "If P is symmetric, and X P Y, then Y P X",
    type: "owl:symmetricProperty",
    premises: [
      { subject: "?P", predicate: "rdf:type", object: "owl:SymmetricProperty" },
      { subject: "?X", predicate: "?P", object: "?Y" },
    ],
    conclusion: { subject: "?Y", predicate: "?P", object: "?X" },
    priority: 1,
  },
  {
    id: "owl-transitive",
    name: "OWL Transitive Property",
    description: "If P is transitive, and X P Y, and Y P Z, then X P Z",
    type: "owl:transitiveProperty",
    premises: [
      { subject: "?P", predicate: "rdf:type", object: "owl:TransitiveProperty" },
      { subject: "?X", predicate: "?P", object: "?Y" },
      { subject: "?Y", predicate: "?P", object: "?Z" },
    ],
    conclusion: { subject: "?X", predicate: "?P", object: "?Z" },
    priority: 2,
  },
  {
    id: "owl-eq-class1",
    name: "OWL Equivalent Class (symmetric)",
    description: "If C1 is equivalent to C2, then C2 is equivalent to C1",
    type: "owl:equivalentClass",
    premises: [
      { subject: "?C1", predicate: "owl:equivalentClass", object: "?C2" },
    ],
    conclusion: { subject: "?C2", predicate: "owl:equivalentClass", object: "?C1" },
    priority: 1,
  },
  {
    id: "owl-eq-class2",
    name: "OWL Equivalent Class to SubClass",
    description: "If C1 is equivalent to C2, then C1 is subclass of C2",
    type: "owl:equivalentClass",
    premises: [
      { subject: "?C1", predicate: "owl:equivalentClass", object: "?C2" },
    ],
    conclusion: { subject: "?C1", predicate: "rdfs:subClassOf", object: "?C2" },
    priority: 1,
  },
  {
    id: "owl-same-as",
    name: "OWL sameAs Property Propagation",
    description: "If X sameAs Y, and X P O, then Y P O",
    type: "owl:sameAs",
    premises: [
      { subject: "?X", predicate: "owl:sameAs", object: "?Y" },
      { subject: "?X", predicate: "?P", object: "?O" },
    ],
    conclusion: { subject: "?Y", predicate: "?P", object: "?O" },
    priority: 3,
  },
];

// ============================================================
// InferenceManager Implementation
// ============================================================

/**
 * Manages ontology inference and reasoning
 *
 * @example
 * ```typescript
 * const manager = new InferenceManager(tripleStore);
 *
 * // Compute all inferences
 * const inferences = await manager.computeInferences();
 *
 * // Get justification for a specific triple
 * const justification = await manager.justify(triple);
 *
 * // Listen for inference events
 * manager.addEventListener("inference:computed", (event) => {
 *   console.log(`Computed ${event.data?.count} inferences`);
 * });
 * ```
 */
export class InferenceManager {
  private readonly store: InferenceTripleStore;
  private readonly config: InferenceManagerConfig;
  private readonly rules: Map<string, InferenceRule>;
  private readonly inferredFacts: Map<string, InferredFact>;
  private readonly listeners: Set<InferenceEventListener>;
  private cacheTimestamp: number = 0;

  constructor(
    store: InferenceTripleStore,
    config: Partial<InferenceManagerConfig> = {}
  ) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rules = new Map();
    this.inferredFacts = new Map();
    this.listeners = new Set();

    // Initialize built-in rules
    this.initializeRules();
  }

  /**
   * Initialize built-in inference rules
   */
  private initializeRules(): void {
    for (const rule of BUILT_IN_RULES) {
      if (this.config.enabledTypes.has(rule.type)) {
        this.rules.set(rule.id, { ...rule, enabled: true });
      }
    }
  }

  /**
   * Add a custom inference rule
   */
  addRule(rule: InferenceRule): void {
    this.rules.set(rule.id, rule);
    this.invalidateCache();
  }

  /**
   * Remove an inference rule
   */
  removeRule(ruleId: string): boolean {
    const result = this.rules.delete(ruleId);
    if (result) {
      this.invalidateCache();
    }
    return result;
  }

  /**
   * Enable or disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.invalidateCache();
    }
  }

  /**
   * Get all registered rules
   */
  getRules(): InferenceRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Compute all inferences from the triple store
   */
  async computeInferences(): Promise<InferredFact[]> {
    const startTime = performance.now();

    // Check cache
    if (this.isCacheValid()) {
      return Array.from(this.inferredFacts.values());
    }

    // Clear existing inferences
    this.inferredFacts.clear();

    // Get all triples from store
    const triples = await this.store.getAll();

    // Apply rules iteratively until fixed point
    let changed = true;
    let iteration = 0;
    const maxIterations = this.config.maxDepth;

    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;

      // Get enabled rules sorted by priority
      const enabledRules = Array.from(this.rules.values())
        .filter((r) => r.enabled !== false)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      for (const rule of enabledRules) {
        const newInferences = await this.applyRule(rule, triples);

        for (const inference of newInferences) {
          const key = this.getTripleKey(inference.triple);
          if (!this.inferredFacts.has(key)) {
            this.inferredFacts.set(key, inference);
            changed = true;

            // Check limit
            if (this.inferredFacts.size >= this.config.maxInferences) {
              break;
            }
          }
        }

        if (this.inferredFacts.size >= this.config.maxInferences) {
          break;
        }
      }
    }

    // Update cache timestamp
    this.cacheTimestamp = Date.now();

    const result = Array.from(this.inferredFacts.values());

    // Emit event
    this.emit({
      type: "inference:computed",
      data: {
        count: result.length,
        iterations: iteration,
        timeMs: performance.now() - startTime,
      },
    });

    return result;
  }

  /**
   * Apply a single inference rule
   */
  private async applyRule(
    rule: InferenceRule,
    existingTriples: Triple[]
  ): Promise<InferredFact[]> {
    const results: InferredFact[] = [];

    // For each combination of triples that could match premises
    const matchResults = await this.matchPremises(rule.premises, existingTriples);

    for (const bindings of matchResults) {
      // Apply bindings to conclusion pattern
      const conclusion = this.applyBindings(rule.conclusion, bindings);

      // Skip if conclusion is same as any premise (no new information)
      const conclusionKey = this.getTripleKey(conclusion);
      const alreadyExists = existingTriples.some(
        (t) => this.getTripleKey(t) === conclusionKey
      );

      if (alreadyExists) {
        continue;
      }

      // Skip if already inferred
      if (this.inferredFacts.has(conclusionKey)) {
        continue;
      }

      // Build justification
      const premises = rule.premises.map((p) => this.applyBindings(p, bindings));
      const justification = this.config.computeJustifications
        ? this.buildJustification(rule, premises, conclusion)
        : this.minimalJustification(rule, premises, conclusion);

      results.push({
        triple: conclusion,
        inferenceType: rule.type,
        rule,
        justification,
        confidence: 1.0,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  /**
   * Match premise patterns against existing triples
   */
  private async matchPremises(
    premises: TriplePattern[],
    triples: Triple[]
  ): Promise<Map<string, string>[]> {
    if (premises.length === 0) {
      return [new Map()];
    }

    // Start with first premise
    let bindings = this.matchPattern(premises[0], triples, new Map());

    // Join with subsequent premises
    for (let i = 1; i < premises.length; i++) {
      const newBindings: Map<string, string>[] = [];

      for (const binding of bindings) {
        const matches = this.matchPattern(premises[i], triples, binding);
        newBindings.push(...matches);
      }

      bindings = newBindings;
    }

    return bindings;
  }

  /**
   * Match a single pattern against triples with existing bindings
   */
  private matchPattern(
    pattern: TriplePattern,
    triples: Triple[],
    existingBindings: Map<string, string>
  ): Map<string, string>[] {
    const results: Map<string, string>[] = [];

    for (const triple of triples) {
      const newBindings = new Map(existingBindings);
      let matches = true;

      // Match subject
      if (pattern.subject) {
        if (!this.matchComponent(pattern.subject, triple.subject, newBindings)) {
          matches = false;
        }
      }

      // Match predicate
      if (matches && pattern.predicate) {
        if (!this.matchComponent(pattern.predicate, triple.predicate, newBindings)) {
          matches = false;
        }
      }

      // Match object
      if (matches && pattern.object) {
        if (!this.matchComponent(pattern.object, triple.object, newBindings)) {
          matches = false;
        }
      }

      if (matches) {
        results.push(newBindings);
      }
    }

    return results;
  }

  /**
   * Match a pattern component against a value
   */
  private matchComponent(
    pattern: string,
    value: string,
    bindings: Map<string, string>
  ): boolean {
    // Variable pattern
    if (pattern.startsWith("?")) {
      const existingValue = bindings.get(pattern);
      if (existingValue !== undefined) {
        return existingValue === value;
      }
      bindings.set(pattern, value);
      return true;
    }

    // Literal match
    return pattern === value;
  }

  /**
   * Apply variable bindings to a pattern
   */
  private applyBindings(
    pattern: TriplePattern,
    bindings: Map<string, string>
  ): Triple {
    const resolve = (value: string | undefined): string => {
      if (!value) return "";
      if (value.startsWith("?")) {
        return bindings.get(value) ?? value;
      }
      return value;
    };

    return {
      subject: resolve(pattern.subject),
      predicate: resolve(pattern.predicate),
      object: resolve(pattern.object),
    };
  }

  /**
   * Build a full justification for an inference
   */
  private buildJustification(
    rule: InferenceRule,
    premises: Triple[],
    conclusion: Triple
  ): Justification {
    const step: InferenceStep = {
      rule,
      premises,
      conclusion,
      stepNumber: 0,
    };

    return {
      supportingFacts: premises,
      inferenceChain: [step],
      explanation: this.generateExplanation(rule, premises, conclusion),
      depth: 1,
    };
  }

  /**
   * Create a minimal justification (no chain computation)
   */
  private minimalJustification(
    rule: InferenceRule,
    premises: Triple[],
    _conclusion: Triple
  ): Justification {
    return {
      supportingFacts: premises,
      inferenceChain: [],
      explanation: `Inferred via ${rule.name}`,
      depth: 1,
    };
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(
    rule: InferenceRule,
    premises: Triple[],
    conclusion: Triple
  ): string {
    const premiseStr = premises
      .map((p) => `(${p.subject} ${p.predicate} ${p.object})`)
      .join(" AND ");

    return `By ${rule.name}: ${premiseStr} => (${conclusion.subject} ${conclusion.predicate} ${conclusion.object})`;
  }

  /**
   * Get justification for a specific triple
   */
  async justify(triple: Triple): Promise<Justification | null> {
    const key = this.getTripleKey(triple);
    const inferred = this.inferredFacts.get(key);

    if (inferred) {
      return inferred.justification;
    }

    // Check if it's an asserted fact
    const exists = await this.store.has(triple);
    if (exists) {
      return {
        supportingFacts: [triple],
        inferenceChain: [],
        explanation: "Asserted fact (ground truth)",
        depth: 0,
      };
    }

    return null;
  }

  /**
   * Check if a triple is inferred
   */
  isInferred(triple: Triple): boolean {
    return this.inferredFacts.has(this.getTripleKey(triple));
  }

  /**
   * Get all inferred facts
   */
  getInferredFacts(): InferredFact[] {
    return Array.from(this.inferredFacts.values());
  }

  /**
   * Get inferred facts by type
   */
  getInferredByType(type: InferenceType): InferredFact[] {
    return Array.from(this.inferredFacts.values()).filter(
      (f) => f.inferenceType === type
    );
  }

  /**
   * Get inferred facts for a specific subject
   */
  getInferredForSubject(subject: string): InferredFact[] {
    return Array.from(this.inferredFacts.values()).filter(
      (f) => f.triple.subject === subject
    );
  }

  /**
   * Clear all computed inferences
   */
  clear(): void {
    this.inferredFacts.clear();
    this.cacheTimestamp = 0;
    this.emit({ type: "inference:cleared" });
  }

  /**
   * Invalidate the inference cache
   */
  invalidateCache(): void {
    this.cacheTimestamp = 0;
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    if (this.cacheTimestamp === 0) {
      return false;
    }
    return Date.now() - this.cacheTimestamp < this.config.cacheTTL;
  }

  /**
   * Generate unique key for a triple
   */
  private getTripleKey(triple: Triple): string {
    return `${triple.subject}|${triple.predicate}|${triple.object}`;
  }

  // ============================================================
  // Event Handling
  // ============================================================

  /**
   * Add event listener
   */
  addEventListener(
    _type: InferenceEventType,
    listener: InferenceEventListener
  ): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: InferenceEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event
   */
  private emit(event: InferenceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in inference event listener:", error);
      }
    }
  }

  /**
   * Dispose of manager resources
   */
  dispose(): void {
    this.clear();
    this.listeners.clear();
    this.rules.clear();
  }

  /**
   * Get inference statistics
   */
  getStats(): {
    totalInferred: number;
    byType: Record<InferenceType, number>;
    rulesEnabled: number;
    rulesTotal: number;
    cacheAge: number;
  } {
    const byType: Record<string, number> = {};

    for (const fact of this.inferredFacts.values()) {
      byType[fact.inferenceType] = (byType[fact.inferenceType] || 0) + 1;
    }

    return {
      totalInferred: this.inferredFacts.size,
      byType: byType as Record<InferenceType, number>,
      rulesEnabled: Array.from(this.rules.values()).filter((r) => r.enabled !== false).length,
      rulesTotal: this.rules.size,
      cacheAge: this.cacheTimestamp > 0 ? Date.now() - this.cacheTimestamp : -1,
    };
  }
}

/**
 * Create an InferenceManager instance
 */
export function createInferenceManager(
  store: InferenceTripleStore,
  config?: Partial<InferenceManagerConfig>
): InferenceManager {
  return new InferenceManager(store, config);
}
