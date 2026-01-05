# Semantic Search Documentation

This directory contains documentation for Exocortex's semantic search functionality.

## Documents

| Document | Description |
|----------|-------------|
| [EMBEDDING-MODEL-SELECTION.md](./EMBEDDING-MODEL-SELECTION.md) | Comprehensive analysis of embedding models with our recommendation |
| [BENCHMARK-FRAMEWORK.md](./BENCHMARK-FRAMEWORK.md) | Methodology for testing embedding quality |

## Quick Links

### For Users
- **Recommended model**: `nomic-embed-text-v1.5` (local, privacy-first)
- **Alternative**: `text-embedding-3-small` (OpenAI API)

### For Developers
- Services: `packages/exocortex/src/services/EmbeddingService.ts`
- Vector Store: `packages/exocortex/src/services/VectorStore.ts`
- Semantic Search: `packages/exocortex/src/services/SemanticSearchService.ts`

## Architecture Overview

```
User Query
    │
    ▼
┌─────────────────────┐
│ SemanticSearchService│
│  - search()         │
│  - indexFile()      │
│  - findSimilar()    │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌──────────┐  ┌──────────┐
│Embedding │  │ Vector   │
│ Service  │  │  Store   │
│ (nomic)  │  │ (cosine) │
└──────────┘  └──────────┘
```

## Configuration

Default configuration (privacy-first):

```typescript
const DEFAULT_EMBEDDING_CONFIG = {
  provider: "local",
  model: "nomic-embed-text",
  timeout: 30000,
  maxTextLength: 8000,
};

const DEFAULT_SEMANTIC_SEARCH_CONFIG = {
  maxResults: 10,
  minSimilarity: 0.7,
  autoEmbed: true,
  batchSize: 20,
};
```

## Related Issues

- #1354 - Research and select embedding model (this document)
- #1355 - Implement local embedding support
- #1356 - Add semantic search UI
