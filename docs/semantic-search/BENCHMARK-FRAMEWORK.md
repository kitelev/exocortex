# Embedding Quality Benchmark Framework

This document defines the methodology for evaluating embedding model quality in Exocortex's semantic search system.

## Overview

A robust benchmark framework ensures:
1. **Objective comparison** between embedding models
2. **Quality assurance** when upgrading models
3. **Performance regression detection** in CI/CD
4. **User-facing quality metrics** in the UI

## Evaluation Dimensions

### 1. Retrieval Quality Metrics

#### Mean Reciprocal Rank (MRR@K)

Measures how quickly the correct result appears in ranked results.

```typescript
/**
 * Calculate MRR@K for a set of queries
 * @param queries Array of { query, expectedDocuments }
 * @param k Number of results to consider
 */
function calculateMRR(
  results: Array<{
    query: string;
    expectedDocs: string[];
    returnedDocs: string[];
  }>,
  k: number = 10
): number {
  let sum = 0;

  for (const result of results) {
    const rank = result.returnedDocs
      .slice(0, k)
      .findIndex(doc => result.expectedDocs.includes(doc));

    if (rank !== -1) {
      sum += 1 / (rank + 1);
    }
  }

  return sum / results.length;
}
```

**Target**: MRR@10 ≥ 0.6

#### Recall@K

Percentage of relevant documents found in top K results.

```typescript
function calculateRecall(
  results: Array<{
    expectedDocs: string[];
    returnedDocs: string[];
  }>,
  k: number = 10
): number {
  let totalRecall = 0;

  for (const result of results) {
    const found = result.returnedDocs
      .slice(0, k)
      .filter(doc => result.expectedDocs.includes(doc));

    totalRecall += found.length / result.expectedDocs.length;
  }

  return totalRecall / results.length;
}
```

**Target**: Recall@10 ≥ 0.7

#### Normalized Discounted Cumulative Gain (NDCG@K)

Accounts for position-weighted relevance.

```typescript
function calculateNDCG(
  results: Array<{
    query: string;
    returnedDocs: string[];
    relevanceScores: Map<string, number>;  // 0-3 relevance scale
  }>,
  k: number = 10
): number {
  // Implementation follows standard NDCG formula
  // DCG = sum(rel_i / log2(i + 1))
  // NDCG = DCG / IDCG
}
```

**Target**: NDCG@10 ≥ 0.65

### 2. Performance Metrics

#### Indexing Throughput

```typescript
interface IndexingBenchmark {
  totalFiles: number;
  totalTokens: number;
  durationMs: number;
  filesPerSecond: number;
  tokensPerSecond: number;
  peakMemoryMB: number;
}

async function benchmarkIndexing(
  files: string[],
  embeddingService: EmbeddingService
): Promise<IndexingBenchmark> {
  const startMemory = process.memoryUsage().heapUsed;
  const start = performance.now();

  let totalTokens = 0;
  for (const file of files) {
    const content = await readFile(file);
    const result = await embeddingService.generateEmbedding(content);
    totalTokens += result.tokenCount;
  }

  const duration = performance.now() - start;
  const peakMemory = process.memoryUsage().heapUsed;

  return {
    totalFiles: files.length,
    totalTokens,
    durationMs: duration,
    filesPerSecond: files.length / (duration / 1000),
    tokensPerSecond: totalTokens / (duration / 1000),
    peakMemoryMB: (peakMemory - startMemory) / (1024 * 1024),
  };
}
```

**Targets:**
- Indexing: ≥10 files/second (local), ≥20 files/second (API)
- Memory: ≤2GB peak during indexing

#### Search Latency

```typescript
interface SearchLatencyBenchmark {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
}

async function benchmarkSearchLatency(
  queries: string[],
  vectorStore: VectorStore,
  embeddingService: EmbeddingService
): Promise<SearchLatencyBenchmark> {
  const latencies: number[] = [];

  for (const query of queries) {
    const start = performance.now();
    const embedding = await embeddingService.generateEmbedding(query);
    vectorStore.search(embedding.embedding, 10);
    latencies.push(performance.now() - start);
  }

  latencies.sort((a, b) => a - b);

  return {
    p50Ms: latencies[Math.floor(latencies.length * 0.5)],
    p95Ms: latencies[Math.floor(latencies.length * 0.95)],
    p99Ms: latencies[Math.floor(latencies.length * 0.99)],
    avgMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
  };
}
```

**Targets:**
- p50: ≤50ms (including embedding generation)
- p95: ≤100ms
- p99: ≤200ms

### 3. Storage Efficiency

```typescript
interface StorageMetrics {
  indexSizeBytes: number;
  bytesPerDocument: number;
  compressionRatio: number;
}

function measureStorageEfficiency(
  vectorStore: VectorStore,
  documentCount: number
): StorageMetrics {
  const serialized = vectorStore.serialize();
  const jsonSize = JSON.stringify(serialized).length;

  return {
    indexSizeBytes: jsonSize,
    bytesPerDocument: jsonSize / documentCount,
    compressionRatio: 1, // Baseline, can compare with compressed variants
  };
}
```

**Targets:**
- Average: ≤10KB per document
- Total: ≤100MB for 10K document vault

## Test Dataset Structure

### Synthetic Test Suite

```typescript
interface BenchmarkDataset {
  name: string;
  documents: Array<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
  }>;
  queries: Array<{
    query: string;
    expectedResults: string[];  // Document IDs in relevance order
  }>;
}

const BENCHMARK_DATASETS: BenchmarkDataset[] = [
  {
    name: "exact-match",
    // Tests finding documents with exact phrase matches
  },
  {
    name: "semantic-similarity",
    // Tests finding conceptually similar documents
  },
  {
    name: "cross-domain",
    // Tests retrieval across different topic areas
  },
  {
    name: "long-documents",
    // Tests handling of documents >2000 tokens
  },
  {
    name: "short-queries",
    // Tests 1-3 word search queries
  },
];
```

### Example Test Cases

```typescript
const SEMANTIC_SIMILARITY_TESTS = [
  {
    query: "How do I manage daily tasks?",
    expectedResults: [
      "daily-workflow.md",      // Contains "daily task management"
      "productivity-tips.md",   // Contains "task organization"
      "gtd-implementation.md",  // Contains "getting things done"
    ],
  },
  {
    query: "Project planning best practices",
    expectedResults: [
      "project-management.md",
      "agile-methodology.md",
      "milestone-tracking.md",
    ],
  },
  {
    query: "Meeting notes from last week",
    expectedResults: [
      "2024-01-meeting.md",
      "team-standup.md",
      "weekly-review.md",
    ],
  },
];
```

## Benchmark Runner

### CLI Command

```bash
# Run full benchmark suite
npx exocortex-cli benchmark --model nomic-embed-text --dataset all

# Run specific benchmark
npx exocortex-cli benchmark --model text-embedding-3-small --dataset semantic-similarity

# Compare two models
npx exocortex-cli benchmark compare --models nomic-embed-text,bge-base-en-v1.5
```

### Benchmark Report Format

```typescript
interface BenchmarkReport {
  modelId: string;
  timestamp: string;
  environment: {
    platform: string;
    nodeVersion: string;
    memory: number;
    cpuCores: number;
  };
  results: {
    retrieval: {
      mrr10: number;
      recall10: number;
      ndcg10: number;
    };
    performance: {
      indexing: IndexingBenchmark;
      search: SearchLatencyBenchmark;
    };
    storage: StorageMetrics;
  };
  datasets: Array<{
    name: string;
    mrr10: number;
    recall10: number;
  }>;
}
```

### Example Report Output

```json
{
  "modelId": "nomic-embed-text",
  "timestamp": "2026-01-04T12:00:00Z",
  "environment": {
    "platform": "darwin-arm64",
    "nodeVersion": "20.10.0",
    "memory": 16384,
    "cpuCores": 10
  },
  "results": {
    "retrieval": {
      "mrr10": 0.72,
      "recall10": 0.81,
      "ndcg10": 0.68
    },
    "performance": {
      "indexing": {
        "totalFiles": 1000,
        "filesPerSecond": 15.3,
        "peakMemoryMB": 1850
      },
      "search": {
        "p50Ms": 32,
        "p95Ms": 78,
        "p99Ms": 145
      }
    },
    "storage": {
      "indexSizeBytes": 8542000,
      "bytesPerDocument": 8542
    }
  }
}
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Embedding Benchmark

on:
  push:
    paths:
      - 'packages/exocortex/src/services/EmbeddingService.ts'
      - 'packages/exocortex/src/services/VectorStore.ts'
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Setup Ollama
        run: |
          curl -fsSL https://ollama.ai/install.sh | sh
          ollama pull nomic-embed-text

      - name: Run benchmarks
        run: npm run benchmark -- --model nomic-embed-text

      - name: Check regression
        run: |
          npm run benchmark:check-regression -- \
            --baseline .benchmark/baseline.json \
            --current .benchmark/latest.json \
            --threshold 0.05

      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: .benchmark/
```

### Regression Detection

```typescript
interface RegressionCheckResult {
  passed: boolean;
  metrics: Array<{
    name: string;
    baseline: number;
    current: number;
    delta: number;
    threshold: number;
    passed: boolean;
  }>;
}

function checkRegression(
  baseline: BenchmarkReport,
  current: BenchmarkReport,
  threshold: number = 0.05
): RegressionCheckResult {
  const metrics = [
    {
      name: 'mrr10',
      baseline: baseline.results.retrieval.mrr10,
      current: current.results.retrieval.mrr10,
    },
    {
      name: 'recall10',
      baseline: baseline.results.retrieval.recall10,
      current: current.results.retrieval.recall10,
    },
    {
      name: 'p95Latency',
      baseline: baseline.results.performance.search.p95Ms,
      current: current.results.performance.search.p95Ms,
    },
  ];

  const results = metrics.map(m => ({
    ...m,
    delta: (m.current - m.baseline) / m.baseline,
    threshold,
    // For latency, increase is bad; for quality, decrease is bad
    passed: m.name.includes('Latency')
      ? m.current <= m.baseline * (1 + threshold)
      : m.current >= m.baseline * (1 - threshold),
  }));

  return {
    passed: results.every(r => r.passed),
    metrics: results,
  };
}
```

## User-Facing Quality Metrics

### Search Quality Feedback

```typescript
interface SearchFeedback {
  queryId: string;
  query: string;
  clickedResult?: string;
  clickPosition?: number;
  feedbackType?: 'helpful' | 'not-helpful';
}

// Aggregate feedback for quality monitoring
function calculateUserSatisfactionScore(
  feedbacks: SearchFeedback[]
): number {
  const clickThroughRate = feedbacks.filter(f => f.clickedResult).length / feedbacks.length;
  const helpfulRate = feedbacks.filter(f => f.feedbackType === 'helpful').length /
    feedbacks.filter(f => f.feedbackType).length;

  return (clickThroughRate + helpfulRate) / 2;
}
```

### Quality Dashboard Metrics

Display in settings/debug panel:
- Total indexed documents
- Index last updated
- Average search latency (last 100 searches)
- Click-through rate (if tracking enabled)
- Model version and dimensions

## Future Enhancements

### A/B Testing Framework

```typescript
interface ABTestConfig {
  testId: string;
  variants: Array<{
    name: string;
    model: string;
    weight: number;  // Traffic allocation percentage
  }>;
  metrics: string[];
  minSampleSize: number;
}

// Route users to variant based on hash
function getVariant(userId: string, config: ABTestConfig): string {
  const hash = simpleHash(userId + config.testId);
  const normalizedHash = hash / MAX_HASH_VALUE;

  let cumulative = 0;
  for (const variant of config.variants) {
    cumulative += variant.weight;
    if (normalizedHash < cumulative) {
      return variant.name;
    }
  }

  return config.variants[0].name;
}
```

### Continuous Calibration

```typescript
// Use user feedback to fine-tune similarity thresholds
function calibrateThresholds(
  searchLogs: SearchFeedback[],
  currentThreshold: number
): number {
  // Analyze at which score cut-off users stop clicking
  // Adjust threshold to maximize utility
}
```

## Running Benchmarks Locally

```bash
# Setup test environment
cd packages/exocortex

# Generate test dataset (if not present)
npm run benchmark:generate-dataset

# Run full benchmark
npm run benchmark

# Run with specific model
EMBEDDING_MODEL=bge-base-en-v1.5 npm run benchmark

# Compare models
npm run benchmark:compare -- --models nomic-embed-text,text-embedding-3-small
```

## Conclusion

This benchmark framework provides:
1. **Quantitative metrics** for model comparison
2. **Automated regression detection** in CI
3. **User-facing quality indicators**
4. **Foundation for A/B testing** new models

Regular benchmarking ensures Exocortex's semantic search maintains high quality as models and data evolve.

---

*Document created: January 2026*
*Last updated: January 2026*
*Issue: #1354*
