# Inference and Reasoning System

> Ontology-driven inference engine for discovering implicit relationships in your knowledge graph.

## Overview

The Exocortex inference system automatically discovers new facts from your knowledge graph using RDFS and OWL 2 RL reasoning rules. It enables:

- **Type inference** — Discover what types entities have based on property usage
- **Relationship discovery** — Find implicit connections between entities
- **Hierarchy navigation** — Understand class and property hierarchies
- **Neighborhood exploration** — Explore multi-hop relationships from any node

## Core Components

### InferenceManager

The `InferenceManager` is the reasoning engine that computes inferences from your triple store.

```typescript
import {
  InferenceManager,
  createInferenceManager,
} from "@exocortex/obsidian-plugin/presentation/renderers/graph/inference";

// Create inference manager with triple store adapter
const manager = createInferenceManager(tripleStore, {
  maxDepth: 10,           // Maximum reasoning iterations
  maxInferences: 1000,    // Maximum inferences to compute
  cacheTTL: 60000,        // Cache duration in milliseconds
  computeJustifications: true,  // Generate explanations
});

// Compute all inferences
const inferences = await manager.computeInferences();

// Get justification for a specific fact
const justification = await manager.justify({
  subject: "ex:Dog",
  predicate: "rdfs:subClassOf",
  object: "ex:LivingThing",
});
```

### NeighborhoodExplorer

The `NeighborhoodExplorer` enables BFS-based multi-hop exploration from any node.

```typescript
import {
  NeighborhoodExplorer,
  createNeighborhoodExplorer,
} from "@exocortex/obsidian-plugin/presentation/renderers/graph/inference";

const explorer = createNeighborhoodExplorer(tripleStore, inferenceManager);

// Explore 2 hops from a node
const result = await explorer.explore("node:123", {
  maxHops: 2,
  direction: "both",      // "incoming" | "outgoing" | "both"
  includeInferred: true,  // Include inferred relationships
  maxNodes: 100,
  maxEdges: 500,
});

// Access results
console.log(`Found ${result.stats.totalNodes} nodes`);
console.log(`Found ${result.stats.inferredEdgeCount} inferred edges`);

// Get nodes by hop distance
const hop1Nodes = result.nodes.filter((n) => n.hopDistance === 1);
const hop2Nodes = result.nodes.filter((n) => n.hopDistance === 2);
```

### InferenceRenderer

The `InferenceRenderer` provides visual differentiation between asserted and inferred facts.

```typescript
import {
  InferenceRenderer,
  createInferenceRenderer,
} from "@exocortex/obsidian-plugin/presentation/renderers/graph/inference";

const renderer = createInferenceRenderer();

// Get render data for edges
const edgeData = renderer.getEdgeRenderData(edge);
// edgeData contains: color, width, dashPattern, opacity, typeBadge, etc.

// Toggle inference type visibility
renderer.toggleInferenceType("owl:inverseOf", true);

// Highlight an inference chain
renderer.highlightChain(inferredFact);
```

## Supported Inference Rules

### RDFS Rules

| Rule | Description | Example |
|------|-------------|---------|
| **rdfs:subClassOf-transitivity** | If A is subclass of B, and B is subclass of C, then A is subclass of C | Dog ⊆ Animal ⊆ LivingThing → Dog ⊆ LivingThing |
| **rdfs:subPropertyOf-transitivity** | Subproperty relationships are transitive | hasMother ⊆ hasParent ⊆ hasAncestor → hasMother ⊆ hasAncestor |
| **rdfs:domain** | If property P has domain C, and X has property P, then X is of type C | `hasAge rdfs:domain Person` + `John hasAge 30` → `John rdf:type Person` |
| **rdfs:range** | If property P has range C, and X P Y, then Y is of type C | `worksFor rdfs:range Company` + `John worksFor Acme` → `Acme rdf:type Company` |

### OWL 2 RL Rules

| Rule | Description | Example |
|------|-------------|---------|
| **owl:inverseOf** | If P1 is inverse of P2, and X P1 Y, then Y P2 X | `hasChild owl:inverseOf hasParent` + `John hasChild Mary` → `Mary hasParent John` |
| **owl:symmetricProperty** | If P is symmetric, and X P Y, then Y P X | `knows rdf:type owl:SymmetricProperty` + `Alice knows Bob` → `Bob knows Alice` |
| **owl:transitiveProperty** | If P is transitive, and X P Y, and Y P Z, then X P Z | `ancestor rdf:type owl:TransitiveProperty` + `A ancestor B` + `B ancestor C` → `A ancestor C` |
| **owl:equivalentClass** | Equivalent classes are mutual subclasses | `Person owl:equivalentClass Human` → bidirectional subclass |
| **owl:sameAs** | Properties propagate between same individuals | `John owl:sameAs JohnDoe` + `John hasAge 30` → `JohnDoe hasAge 30` |
| **owl:propertyChain** | Property chains derive new properties | `hasMother o hasBrother → hasUncle` |

## Configuration

### InferenceManagerConfig

```typescript
interface InferenceManagerConfig {
  /** Maximum inference depth (iterations) @default 10 */
  maxDepth: number;

  /** Maximum inferences to compute @default 1000 */
  maxInferences: number;

  /** Cache TTL in milliseconds @default 60000 */
  cacheTTL: number;

  /** Whether to compute justifications @default true */
  computeJustifications: boolean;

  /** Enabled inference types @default all RDFS and common OWL */
  enabledTypes: Set<InferenceType>;
}
```

### NeighborhoodExplorationOptions

```typescript
interface NeighborhoodExplorationOptions {
  /** Maximum hops from center node @default 2 */
  maxHops: number;

  /** Direction to explore @default "both" */
  direction: "incoming" | "outgoing" | "both";

  /** Include inferred relationships @default true */
  includeInferred: boolean;

  /** Filter by predicate URIs (include only these) */
  predicateFilter?: string[];

  /** Predicate URIs to exclude */
  excludePredicates?: string[];

  /** Maximum nodes to return @default 100 */
  maxNodes: number;

  /** Maximum edges to return @default 500 */
  maxEdges: number;

  /** Timeout in milliseconds @default 10000 */
  timeout: number;

  /** Expand inferred nodes further @default false */
  expandInferred: boolean;

  /** Filter by class types */
  classFilter?: string[];
}
```

## Visual Styling

### Default Visual Style

Inferred facts are visually differentiated from asserted facts:

| Property | Asserted | Inferred |
|----------|----------|----------|
| **Edge color** | Blue (#3b82f6) | Purple (#9333ea) |
| **Edge style** | Solid | Dashed [5, 5] |
| **Edge width** | 1x | 0.8x |
| **Opacity** | 1.0 | 0.85 |
| **Glow effect** | No | Yes (when highlighted) |
| **Node border** | Solid | Dashed [3, 3] |

### Inference Type Badges

Each inference type has a short badge code for compact display:

| Type | Badge | Description |
|------|-------|-------------|
| rdfs:subClassOf-transitivity | SC | Subclass transitivity |
| rdfs:subPropertyOf-transitivity | SP | Subproperty transitivity |
| rdfs:domain | D | Domain inference |
| rdfs:range | R | Range inference |
| owl:equivalentClass | EC | Equivalent class |
| owl:sameAs | = | Same individual |
| owl:inverseOf | INV | Inverse property |
| owl:transitiveProperty | TR | Transitive property |
| owl:symmetricProperty | SYM | Symmetric property |
| owl:propertyChain | PC | Property chain |
| custom-rule | CR | Custom rule |

## Justification Chains

Every inferred fact comes with a justification explaining how it was derived:

```typescript
interface Justification {
  /** Ground facts (asserted triples) supporting the inference */
  supportingFacts: Triple[];

  /** Ordered sequence of inference steps */
  inferenceChain: InferenceStep[];

  /** Human-readable explanation */
  explanation: string;

  /** Total depth of the inference chain */
  depth: number;
}

// Example justification for "Dog subClassOf LivingThing"
{
  supportingFacts: [
    { subject: "ex:Dog", predicate: "rdfs:subClassOf", object: "ex:Animal" },
    { subject: "ex:Animal", predicate: "rdfs:subClassOf", object: "ex:LivingThing" }
  ],
  inferenceChain: [{
    rule: { id: "rdfs11", name: "RDFS SubClassOf Transitivity", ... },
    premises: [/* the two supporting facts */],
    conclusion: { subject: "ex:Dog", predicate: "rdfs:subClassOf", object: "ex:LivingThing" }
  }],
  explanation: "By RDFS SubClassOf Transitivity: (ex:Dog rdfs:subClassOf ex:Animal) AND (ex:Animal rdfs:subClassOf ex:LivingThing) => (ex:Dog rdfs:subClassOf ex:LivingThing)",
  depth: 1
}
```

## Event System

Both `InferenceManager` and `NeighborhoodExplorer` emit events for monitoring:

```typescript
// Inference events
manager.addEventListener("inference:computed", (event) => {
  console.log(`Computed ${event.data?.count} inferences in ${event.data?.timeMs}ms`);
});

manager.addEventListener("inference:cleared", () => {
  console.log("Inference cache cleared");
});

// Neighborhood exploration events
explorer.addEventListener("neighborhood:explore-start", (event) => {
  console.log(`Starting exploration from ${event.data?.centerId}`);
});

explorer.addEventListener("neighborhood:hop-expand", (event) => {
  console.log(`Hop ${event.data?.hop}: found ${event.data?.nodesDiscovered} nodes`);
});

explorer.addEventListener("neighborhood:explore-complete", (event) => {
  const stats = event.neighborhood?.stats;
  console.log(`Exploration complete: ${stats?.totalNodes} nodes, ${stats?.totalEdges} edges`);
});
```

### Event Types

| Event | Triggered When |
|-------|----------------|
| `inference:computed` | Inference computation completes |
| `inference:cleared` | Cache is cleared |
| `inference:highlight` | An inference chain is highlighted |
| `inference:unhighlight` | Highlight is removed |
| `inference:toggle-type` | Inference type visibility changes |
| `inference:style-change` | Visual style changes |
| `neighborhood:explore-start` | Exploration begins |
| `neighborhood:explore-complete` | Exploration completes successfully |
| `neighborhood:explore-error` | Exploration fails |
| `neighborhood:hop-expand` | Each hop level is processed |

## Custom Inference Rules

You can add custom inference rules beyond the built-in RDFS/OWL rules:

```typescript
manager.addRule({
  id: "custom-inverse-likes",
  name: "Inverse Likes",
  description: "If X likes Y, infer that Y is liked by X",
  type: "custom-rule",
  premises: [
    { subject: "?X", predicate: "ex:likes", object: "?Y" }
  ],
  conclusion: {
    subject: "?Y",
    predicate: "ex:likedBy",
    object: "?X"
  },
  priority: 1,
  enabled: true,
});

// Enable/disable rules dynamically
manager.setRuleEnabled("custom-inverse-likes", false);

// Remove custom rules
manager.removeRule("custom-inverse-likes");
```

### Rule Structure

```typescript
interface InferenceRule {
  id: string;           // Unique identifier
  name: string;         // Human-readable name
  description: string;  // What the rule does
  type: InferenceType;  // Category (RDFS, OWL, custom)
  premises: TriplePattern[];  // Patterns that must match
  conclusion: TriplePattern;  // Pattern to produce
  priority?: number;    // Higher = applied first
  enabled?: boolean;    // Whether rule is active
}

// Triple patterns use variables starting with ?
interface TriplePattern {
  subject?: string;   // "?X" for variable, "ex:Foo" for literal
  predicate?: string;
  object?: string;
}
```

## Performance Optimization

### Caching

The inference manager caches computed inferences:

```typescript
// Configure cache TTL (default: 60 seconds)
const manager = createInferenceManager(store, {
  cacheTTL: 120000, // 2 minutes
});

// Force recomputation by invalidating cache
manager.invalidateCache();

// Clear all inferences and cache
manager.clear();
```

### Limiting Inference Scope

For large knowledge graphs, limit inference scope:

```typescript
const manager = createInferenceManager(store, {
  maxDepth: 5,        // Reduce iteration depth
  maxInferences: 500, // Cap total inferences
  enabledTypes: new Set([
    // Only enable needed inference types
    "rdfs:subClassOf-transitivity",
    "owl:inverseOf",
  ]),
});
```

### Neighborhood Exploration Limits

```typescript
const result = await explorer.explore("node:123", {
  maxHops: 1,        // Reduce exploration depth
  maxNodes: 50,      // Cap node count
  maxEdges: 200,     // Cap edge count
  timeout: 5000,     // 5 second timeout
  expandInferred: false,  // Don't expand from inferred nodes
  excludePredicates: [
    "rdfs:label",    // Skip non-structural properties
    "rdfs:comment",
  ],
});

// Cancel ongoing exploration
explorer.cancel();
```

## Statistics and Monitoring

### Inference Statistics

```typescript
const stats = manager.getStats();
// {
//   totalInferred: 42,
//   byType: {
//     "rdfs:subClassOf-transitivity": 15,
//     "owl:inverseOf": 12,
//     "owl:symmetricProperty": 8,
//     ...
//   },
//   rulesEnabled: 10,
//   rulesTotal: 12,
//   cacheAge: 5000  // milliseconds since last computation
// }
```

### Neighborhood Statistics

```typescript
const result = await explorer.explore("node:123", options);
const stats = result.stats;
// {
//   totalNodes: 25,
//   totalEdges: 42,
//   nodesPerHop: [1, 8, 16],  // nodes at each distance
//   inferredEdgeCount: 12,
//   assertedEdgeCount: 30,
//   explorationTimeMs: 145,
//   maxHopReached: 2
// }
```

## Use Cases

### 1. Discovering Hidden Relationships

```typescript
// Find all inverse relationships
const manager = createInferenceManager(store, {
  enabledTypes: new Set(["owl:inverseOf"]),
});

const inferences = await manager.computeInferences();
const inverseRelationships = manager.getInferredByType("owl:inverseOf");

for (const fact of inverseRelationships) {
  console.log(`${fact.triple.subject} → ${fact.triple.predicate} → ${fact.triple.object}`);
}
```

### 2. Exploring Entity Context

```typescript
// Get full context around an entity
const result = await explorer.explore("entity:person-123", {
  maxHops: 2,
  direction: "both",
  includeInferred: true,
});

// Group by relationship type
const byPredicate = new Map();
for (const edge of result.edges) {
  const edges = byPredicate.get(edge.property) || [];
  edges.push(edge);
  byPredicate.set(edge.property, edges);
}
```

### 3. Type Discovery

```typescript
// Find what types an entity has (including inferred)
const manager = createInferenceManager(store, {
  enabledTypes: new Set([
    "rdfs:domain",
    "rdfs:range",
    "rdfs:subClassOf-transitivity",
  ]),
});

await manager.computeInferences();

// Get all inferred types for an entity
const typeInferences = manager.getInferredForSubject("entity:123")
  .filter(f => f.triple.predicate === "rdf:type");
```

### 4. Explaining Relationships

```typescript
// Get human-readable explanation for any fact
const justification = await manager.justify({
  subject: "ex:Fido",
  predicate: "rdf:type",
  object: "ex:LivingThing",
});

if (justification) {
  console.log("Explanation:", justification.explanation);
  console.log("Based on facts:");
  for (const fact of justification.supportingFacts) {
    console.log(`  - ${fact.subject} ${fact.predicate} ${fact.object}`);
  }
}
```

## Cleanup

Always dispose of managers when done to release resources:

```typescript
// Clean up inference manager
manager.dispose();

// Clean up neighborhood explorer
explorer.dispose();
```

## Related Documentation

- **[SPARQL User Guide](../../sparql/User-Guide.md)** — Query your knowledge graph
- **[Property Schema](../../PROPERTY_SCHEMA.md)** — Understanding ontology properties
- **[Architecture Guide](../../../ARCHITECTURE.md)** — System architecture overview
