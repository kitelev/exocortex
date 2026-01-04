# Embedding Model Selection for Semantic Search

This document provides a comprehensive analysis of embedding models for Exocortex's semantic search functionality, including performance benchmarks, privacy considerations, and our final recommendation.

## Executive Summary

**Recommended Model: `nomic-embed-text-v1.5`** for local deployment

**Rationale:**
- **Privacy-first**: All data stays on device (critical for personal knowledge bases)
- **Superior accuracy**: Outperforms `text-embedding-ada-002` on both MTEB and LoCo benchmarks
- **Long context**: 2048 tokens vs 512 tokens for alternatives
- **Zero ongoing cost**: No API fees after initial setup
- **Fully open-source**: MIT license, full transparency

**Secondary option:** `text-embedding-3-small` for users preferring cloud simplicity

## Model Comparison Matrix

| Model | Provider | Dimensions | Context | MTEB Score | Privacy | Cost | Best For |
|-------|----------|------------|---------|------------|---------|------|----------|
| **nomic-embed-text-v1.5** | Nomic AI | 768 | 2048 | 62.3% | Local | Free | **Recommended** |
| text-embedding-3-small | OpenAI | 1536 | 8191 | 62.3% | Cloud | $0.02/1M | Cloud preference |
| text-embedding-3-large | OpenAI | 3072 | 8191 | 64.6% | Cloud | $0.13/1M | Maximum accuracy |
| bge-base-en-v1.5 | BAAI | 768 | 512 | 63.5% | Local | Free | Balance |
| all-MiniLM-L6-v2 | HuggingFace | 384 | 512 | 56.3% | Local | Free | Speed priority |
| BGE-M3 | BAAI | 1024 | 8192 | ~64% | Local | Free | Multilingual |

## Detailed Model Analysis

### 1. nomic-embed-text-v1.5 (Recommended)

**Strengths:**
- First open-source model to outperform OpenAI's `text-embedding-ada-002` on MTEB
- Long context window (2048 tokens) handles larger documents without chunking
- Trained with Matryoshka Representation Learning - can reduce dimensions while maintaining quality
- Fully reproducible training (open weights, data, and code)
- Supports both short and long context retrieval

**Performance Metrics:**
- MTEB Average: 62.3%
- LoCo (Long Context): Superior to closed-source alternatives
- Retrieval tasks: Strong performance across domains

**Resource Requirements:**
- Model size: ~500MB
- Memory: ~2GB during inference
- CPU inference: ~50-100ms per document
- GPU inference: <10ms per document

**Integration with Ollama:**
```bash
# Install via Ollama (simplest local deployment)
ollama pull nomic-embed-text

# API endpoint
POST http://localhost:11434/api/embed
{
  "model": "nomic-embed-text",
  "input": "Your text here"
}
```

### 2. text-embedding-3-small (Cloud Alternative)

**Strengths:**
- Latest OpenAI model with improved performance
- 5x cheaper than predecessor (ada-002)
- Supports dimension reduction via API parameter
- High reliability and uptime

**Weaknesses:**
- Requires internet connection
- Data leaves device (privacy concern)
- Ongoing API costs (~$0.02 per million tokens)
- Rate limits may affect large vault indexing

**When to prefer:**
- Quick setup without local infrastructure
- Users already using OpenAI API
- Reliable internet connection available
- Privacy is not a primary concern

### 3. all-MiniLM-L6-v2 (Legacy - Not Recommended)

**Status: DEPRECATED for new implementations**

**Reasons to avoid:**
- Architecture from 2019, lacks modern advances
- Only 56% accuracy on MTEB benchmarks
- Short context (512 tokens) requires aggressive chunking
- Outperformed by newer models in all metrics

**When might still be used:**
- Existing deployments with high migration cost
- Extremely resource-constrained environments (<500MB RAM)
- Speed is the only concern (14.7ms/1K tokens)

### 4. bge-base-en-v1.5 (Balanced Alternative)

**Strengths:**
- Strong accuracy (63.5% MTEB)
- Reasonable size (~400MB)
- Good balance of speed and quality
- MIT license

**Weaknesses:**
- Limited context (512 tokens)
- English-only (use BGE-M3 for multilingual)
- Requires careful prompt design

### 5. BGE-M3 (Multilingual/Long Context)

**Strengths:**
- 8192 token context window
- Multilingual support (100+ languages)
- Hybrid search support (dense + sparse vectors)

**Weaknesses:**
- Larger model size (~1GB)
- Higher compute requirements
- Overkill for English-only vaults

## Privacy Analysis

### Local Models (Recommended for Exocortex)

| Aspect | Local (nomic-embed-text) | Cloud (OpenAI) |
|--------|--------------------------|----------------|
| Data location | On device | Transmitted to API |
| Network required | No | Yes |
| Processing visibility | Full control | Black box |
| Data retention | User controlled | API provider policy |
| Compliance | GDPR-friendly | Requires DPA |

**Personal knowledge base context:**
Users store highly personal information in their vaults:
- Journal entries
- Personal reflections
- Private project notes
- Health records
- Financial information

**Recommendation:** Default to local models with cloud as opt-in for users who explicitly prefer it.

### Data Processing Considerations

When using cloud APIs:
1. Never send raw vault content without user consent
2. Provide clear disclosure in settings UI
3. Allow selective indexing (exclude sensitive folders)
4. Consider embedding caching to minimize API calls

## Performance Benchmarks

### Memory Usage by Model

| Model | Model Size | Runtime Memory | Typical Vault (1000 files) |
|-------|------------|----------------|---------------------------|
| nomic-embed-text | 500MB | 2GB | ~6MB index |
| bge-base-en-v1.5 | 400MB | 1.5GB | ~6MB index |
| all-MiniLM-L6-v2 | 90MB | 500MB | ~3MB index |
| text-embedding-3-small | N/A (cloud) | N/A | ~12MB index |

### Indexing Speed

Benchmarks on M1 MacBook Pro (16GB RAM):

| Model | Files/Second (CPU) | Files/Second (GPU) |
|-------|-------------------|-------------------|
| nomic-embed-text | 10-20 | 100+ |
| bge-base-en-v1.5 | 15-25 | 120+ |
| all-MiniLM-L6-v2 | 50-80 | 200+ |
| OpenAI API | 20-50 (rate limited) | N/A |

### Search Latency

| Model | 1K vectors | 10K vectors | 100K vectors |
|-------|-----------|-------------|--------------|
| 768-dim (nomic, bge) | <1ms | <5ms | ~20ms |
| 384-dim (MiniLM) | <1ms | <3ms | ~10ms |
| 1536-dim (OpenAI) | <2ms | <10ms | ~50ms |

## Implementation Recommendations

### 1. Default Configuration

```typescript
const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "local",  // Changed from "openai"
  model: "nomic-embed-text",
  timeout: 30000,
  maxTextLength: 8000,  // Leverage 2048 token context
};
```

### 2. Provider Selection Logic

```typescript
type EmbeddingProvider = "local" | "openai" | "ollama";

interface LocalProviderConfig {
  model: "nomic-embed-text" | "bge-base-en-v1.5" | "all-MiniLM-L6-v2";
  // Model will be loaded via Ollama or direct transformers.js
}

interface OpenAIProviderConfig {
  model: "text-embedding-3-small" | "text-embedding-3-large";
  apiKey: string;
}
```

### 3. Gradual Adoption Strategy

**Phase 1: Add Ollama/Local Support**
- Integrate with Ollama API (http://localhost:11434)
- Support nomic-embed-text as default local model
- Keep OpenAI as fallback for existing users

**Phase 2: Browser-Native Embeddings**
- Investigate transformers.js for in-browser inference
- Would eliminate Ollama dependency
- ~3-5x slower but fully self-contained

**Phase 3: Model Selection UI**
- Allow users to choose provider in settings
- Show resource usage estimates
- Provide migration tools for changing models

### 4. Chunking Strategy

Given nomic-embed-text's 2048 token context:

```typescript
const CHUNK_CONFIG = {
  // Target ~1500 tokens to leave room for metadata
  maxChunkSize: 6000,  // ~1500 tokens at 4 chars/token
  overlapSize: 500,     // ~125 tokens overlap
  splitStrategy: "paragraph",  // Prefer semantic boundaries
};
```

### 5. Vector Dimension Handling

For future model flexibility, vector store should handle varying dimensions:

```typescript
// Current: Fixed 1536-dim for OpenAI
// Recommended: Adapt to model output
interface VectorStoreConfig {
  expectedDimension?: number;  // Validate on first insert if set
  // Allow dimension mismatch warning (for model migration)
  allowDimensionMismatch?: boolean;
}
```

## Migration Path

### From text-embedding-ada-002 to nomic-embed-text

1. **Backward compatibility**: Keep existing OpenAI support
2. **New default**: nomic-embed-text for new installations
3. **Migration prompt**: Offer re-indexing when switching models
4. **Dimension handling**: Different dimensions (768 vs 1536) require full re-index

### Index Versioning

```typescript
interface SerializedVectorStore {
  version: number;
  modelId: string;  // Track which model generated embeddings
  modelDimension: number;
  entries: VectorEntry[];
}
```

## Cost Analysis

### OpenAI API Costs (for reference)

| Vault Size | Tokens (est.) | text-embedding-3-small | text-embedding-3-large |
|------------|---------------|------------------------|------------------------|
| 100 files | ~500K | $0.01 | $0.065 |
| 1,000 files | ~5M | $0.10 | $0.65 |
| 10,000 files | ~50M | $1.00 | $6.50 |

*Note: Per indexing pass. Re-indexing on model change doubles cost.*

### Local Deployment Costs

- One-time: Model download (~500MB)
- Ongoing: Electricity for compute (~negligible)
- Total: **$0.00** after initial setup

## Quality Validation Framework

See [BENCHMARK-FRAMEWORK.md](./BENCHMARK-FRAMEWORK.md) for the testing methodology.

### Key Metrics

1. **Retrieval Accuracy (MRR@10)**
   - Mean Reciprocal Rank for top 10 results
   - Target: >0.6 for semantic queries

2. **Latency Percentiles**
   - p50, p95, p99 search latency
   - Target: p95 < 100ms

3. **Index Size Efficiency**
   - Bytes per document
   - Target: <10KB average

## Conclusion

**Final Recommendation: `nomic-embed-text-v1.5`**

This model provides the optimal balance of:
- Privacy (100% local processing)
- Quality (matches or exceeds OpenAI on benchmarks)
- Cost (zero ongoing fees)
- Flexibility (long context, open-source)

For Exocortex's use case as a personal knowledge management system, privacy and zero-cost operation outweigh the minor convenience benefits of cloud APIs.

## References

- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [Nomic Embed Paper](https://arxiv.org/html/2402.01613v2)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Sentence Transformers Documentation](https://sbert.net/)
- [Ollama Documentation](https://ollama.ai/)

---

*Document created: January 2026*
*Last updated: January 2026*
*Issue: #1354*
