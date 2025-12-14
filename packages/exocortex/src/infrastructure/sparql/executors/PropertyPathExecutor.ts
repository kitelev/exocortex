import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type { Triple as AlgebraTriple, TripleElement, PropertyPath, IRI } from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import { IRI as RDFiri } from "../../../domain/models/rdf/IRI";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { Subject, Object as RDFObject } from "../../../domain/models/rdf/Triple";

export class PropertyPathExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "PropertyPathExecutorError";
  }
}

/**
 * Executes property path expressions against a triple store.
 *
 * Supports SPARQL 1.1 property paths:
 * - Sequence (/) - matches path elements in order
 * - Alternative (|) - matches any of the alternatives
 * - Inverse (^) - reverses direction
 * - OneOrMore (+) - transitive closure, at least one step
 * - ZeroOrMore (*) - transitive closure, including zero steps
 * - ZeroOrOne (?) - optional single step
 */
export class PropertyPathExecutor {
  private readonly MAX_DEPTH = 100; // Prevent infinite loops

  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Execute a property path pattern and return solution mappings.
   */
  async *execute(
    subject: TripleElement,
    path: PropertyPath,
    object: TripleElement
  ): AsyncIterableIterator<SolutionMapping> {
    // Get start and end nodes
    const startNodes = await this.resolveElement(subject);
    const endNodes = this.isVariable(object) ? null : await this.resolveElement(object);

    for (const startNode of startNodes) {
      const reachable = await this.evaluatePath(startNode, path, endNodes);

      for (const endNode of reachable) {
        const mapping = new SolutionMapping();

        if (this.isVariable(subject)) {
          mapping.set(subject.value, startNode);
        }
        if (this.isVariable(object)) {
          mapping.set(object.value, endNode);
        }

        yield mapping;
      }
    }
  }

  /**
   * Execute with an existing solution mapping.
   * Instantiates variables from the solution before evaluating.
   */
  async *executeWithBindings(
    pattern: AlgebraTriple,
    existingSolution: SolutionMapping
  ): AsyncIterableIterator<SolutionMapping> {
    if (!this.isPropertyPath(pattern.predicate)) {
      throw new PropertyPathExecutorError("Predicate is not a property path");
    }

    // Instantiate subject and object with existing bindings
    const subject = this.instantiateElement(pattern.subject, existingSolution);
    const object = this.instantiateElement(pattern.object, existingSolution);

    for await (const newMapping of this.execute(subject, pattern.predicate, object)) {
      const merged = existingSolution.merge(newMapping);
      if (merged !== null) {
        yield merged;
      }
    }
  }

  /**
   * Evaluate a property path from a starting node.
   * Returns all reachable nodes.
   */
  private async evaluatePath(
    start: Subject | RDFObject,
    path: PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    switch (path.pathType) {
      case "/":
        return this.evaluateSequencePath(start, path.items, targetNodes);
      case "|":
        return this.evaluateAlternativePath(start, path.items, targetNodes);
      case "^":
        return this.evaluateInversePath(start, path.items[0], targetNodes);
      case "+":
        return this.evaluateOneOrMorePath(start, path.items[0], targetNodes);
      case "*":
        return this.evaluateZeroOrMorePath(start, path.items[0], targetNodes);
      case "?":
        return this.evaluateZeroOrOnePath(start, path.items[0], targetNodes);
    }
  }

  /**
   * Sequence path: a / b / c
   * Match predicates in order.
   */
  private async evaluateSequencePath(
    start: Subject | RDFObject,
    items: (IRI | PropertyPath)[],
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    let current = new Set<Subject | RDFObject>([start]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isLast = i === items.length - 1;
      const nextNodes = new Set<Subject | RDFObject>();

      for (const node of current) {
        const reachable = await this.evaluatePathItem(
          node,
          item,
          isLast ? targetNodes : null
        );
        for (const r of reachable) {
          nextNodes.add(r);
        }
      }

      current = nextNodes;
      if (current.size === 0) break;
    }

    return current;
  }

  /**
   * Alternative path: a | b
   * Match any of the alternatives.
   */
  private async evaluateAlternativePath(
    start: Subject | RDFObject,
    items: (IRI | PropertyPath)[],
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    const result = new Set<Subject | RDFObject>();

    for (const item of items) {
      const reachable = await this.evaluatePathItem(start, item, targetNodes);
      for (const node of reachable) {
        result.add(node);
      }
    }

    return result;
  }

  /**
   * Inverse path: ^predicate
   * Traverse in reverse direction.
   */
  private async evaluateInversePath(
    start: Subject | RDFObject,
    item: IRI | PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    // For inverse, we swap the direction: find triples where start is the object
    if (item.type === "iri") {
      const predicate = new RDFiri(item.value);
      const triples = await this.tripleStore.match(undefined, predicate, start as RDFObject);

      const result = new Set<Subject | RDFObject>();
      for (const triple of triples) {
        if (targetNodes === null || this.nodeInSet(triple.subject, targetNodes)) {
          result.add(triple.subject);
        }
      }
      return result;
    } else {
      // Nested path - create inverse path and evaluate
      return this.evaluatePath(start, this.invertPath(item), targetNodes);
    }
  }

  /**
   * OneOrMore path: predicate+
   * Transitive closure, at least one step.
   */
  private async evaluateOneOrMorePath(
    start: Subject | RDFObject,
    item: IRI | PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    const visited = new Set<string>();
    const result = new Set<Subject | RDFObject>();
    const queue: { node: Subject | RDFObject; depth: number }[] = [{ node: start, depth: 0 }];

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;

      if (depth >= this.MAX_DEPTH) continue;

      const reachable = await this.evaluatePathItem(node, item, null);

      for (const nextNode of reachable) {
        const key = this.nodeToKey(nextNode);

        // Add to result (only nodes reachable in 1+ steps)
        if (targetNodes === null || this.nodeInSet(nextNode, targetNodes)) {
          result.add(nextNode);
        }

        // Continue traversal if not visited
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ node: nextNode, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  /**
   * ZeroOrMore path: predicate*
   * Transitive closure, including zero steps.
   */
  private async evaluateZeroOrMorePath(
    start: Subject | RDFObject,
    item: IRI | PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    const result = await this.evaluateOneOrMorePath(start, item, targetNodes);

    // Also include start node (zero steps)
    if (targetNodes === null || this.nodeInSet(start, targetNodes)) {
      result.add(start);
    }

    return result;
  }

  /**
   * ZeroOrOne path: predicate?
   * Optional single step.
   */
  private async evaluateZeroOrOnePath(
    start: Subject | RDFObject,
    item: IRI | PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    const result = new Set<Subject | RDFObject>();

    // Zero steps - include start
    if (targetNodes === null || this.nodeInSet(start, targetNodes)) {
      result.add(start);
    }

    // One step
    const oneStep = await this.evaluatePathItem(start, item, targetNodes);
    for (const node of oneStep) {
      result.add(node);
    }

    return result;
  }

  /**
   * Evaluate a single path item (IRI or nested path).
   */
  private async evaluatePathItem(
    start: Subject | RDFObject,
    item: IRI | PropertyPath,
    targetNodes: Set<Subject | RDFObject> | null
  ): Promise<Set<Subject | RDFObject>> {
    if (item.type === "iri") {
      // Simple predicate - query triple store
      const predicate = new RDFiri(item.value);
      const triples = await this.tripleStore.match(start as Subject, predicate, undefined);

      const result = new Set<Subject | RDFObject>();
      for (const triple of triples) {
        if (targetNodes === null || this.nodeInSet(triple.object, targetNodes)) {
          result.add(triple.object);
        }
      }
      return result;
    } else {
      // Nested path - recursively evaluate
      return this.evaluatePath(start, item, targetNodes);
    }
  }

  /**
   * Invert a property path (swap direction).
   */
  private invertPath(path: PropertyPath): PropertyPath {
    switch (path.pathType) {
      case "^":
        // Double inverse cancels out
        return path.items[0] as PropertyPath;
      case "/":
        // Reverse sequence and invert each element
        return {
          type: "path",
          pathType: "/",
          items: [...path.items].reverse().map((item) =>
            item.type === "iri" ? { type: "path", pathType: "^", items: [item] } as PropertyPath : this.invertPath(item)
          ),
        };
      case "|":
        // Invert each alternative
        return {
          type: "path",
          pathType: "|",
          items: path.items.map((item) =>
            item.type === "iri" ? { type: "path", pathType: "^", items: [item] } as PropertyPath : this.invertPath(item)
          ),
        };
      case "+":
      case "*":
      case "?":
        // Invert the inner path
        const innerInverted = path.items[0].type === "iri"
          ? { type: "path", pathType: "^", items: [path.items[0]] } as PropertyPath
          : this.invertPath(path.items[0]);
        return {
          type: "path",
          pathType: path.pathType,
          items: [innerInverted],
        } as PropertyPath;
    }
  }

  /**
   * Resolve a triple element to a set of RDF nodes.
   */
  private async resolveElement(element: TripleElement): Promise<Set<Subject | RDFObject>> {
    if (this.isVariable(element)) {
      // For unbound variables, we need to get all possible values
      // This is done by the caller who iterates all subjects/objects
      const allNodes = new Set<Subject | RDFObject>();
      const allTriples = await this.tripleStore.match(undefined, undefined, undefined);
      for (const triple of allTriples) {
        allNodes.add(triple.subject);
        allNodes.add(triple.object);
      }
      return allNodes;
    }

    const result = new Set<Subject | RDFObject>();
    switch (element.type) {
      case "iri":
        result.add(new RDFiri(element.value));
        break;
      case "blank":
        result.add(new BlankNode(element.value));
        break;
      default:
        throw new PropertyPathExecutorError(`Unsupported element type in subject/object position: ${element.type}`);
    }
    return result;
  }

  /**
   * Instantiate an element with solution bindings.
   */
  private instantiateElement(element: TripleElement, solution: SolutionMapping): TripleElement {
    if (this.isVariable(element)) {
      const bound = solution.get(element.value);
      if (bound) {
        if (bound instanceof RDFiri) {
          return { type: "iri", value: bound.value };
        } else if (bound instanceof BlankNode) {
          return { type: "blank", value: bound.id };
        }
      }
    }
    return element;
  }

  private isVariable(element: TripleElement): boolean {
    return element.type === "variable";
  }

  private isPropertyPath(predicate: TripleElement | PropertyPath): predicate is PropertyPath {
    return predicate.type === "path";
  }

  private nodeToKey(node: Subject | RDFObject): string {
    return node.toString();
  }

  private nodeInSet(node: Subject | RDFObject, set: Set<Subject | RDFObject>): boolean {
    const key = this.nodeToKey(node);
    for (const n of set) {
      if (this.nodeToKey(n) === key) return true;
    }
    return false;
  }
}
