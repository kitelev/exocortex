#!/bin/bash

# Test runner for CI - supports parallel execution
set -e

echo "🚀 Running tests..."

# Clear cache in CI
if [ "$CI" = "true" ]; then
    echo "🧹 Clearing Jest cache..."
    rm -rf .jest-cache || true
    npx jest --clearCache || true
fi

# Set memory limits and ESM support for CLI tests (jest workers inherit NODE_OPTIONS)
export NODE_OPTIONS="--max-old-space-size=4096 --experimental-vm-modules"

# Run obsidian-plugin tests (with coverage if COVERAGE=true)
echo "📦 Running obsidian-plugin tests..."

# Build jest command with conditional coverage flag
# Uses parallel workers by default (configured in jest.config.js)
# --forceExit ensures Jest exits after tests (prevents hanging on open handles)
# --detectOpenHandles shows what's keeping Jest alive (helps debug hanging)
# Using node directly instead of npx for more reliable forceExit behavior
JEST_ARGS="--config packages/obsidian-plugin/jest.config.js --forceExit --detectOpenHandles"
if [ "$COVERAGE" = "true" ]; then
    echo "📊 Coverage collection enabled"
    JEST_ARGS="$JEST_ARGS --coverage --coverageReporters=lcov --coverageReporters=json-summary --coverageReporters=text-summary"
fi

# Run Jest with timeout to prevent hanging
# Using node directly for better signal handling (vs npx which can interfere with forceExit)
if [ "$CI" = "true" ]; then
    if timeout 300 node ./node_modules/jest/bin/jest.js $JEST_ARGS; then
        echo "✅ Obsidian plugin tests passed!"
    else
        RESULT=$?
        if [ $RESULT -eq 124 ]; then
            echo "❌ Obsidian plugin tests timed out after 5 minutes!"
        else
            echo "❌ Obsidian plugin tests failed!"
        fi
        exit 1
    fi
else
    if node ./node_modules/jest/bin/jest.js $JEST_ARGS; then
        echo "✅ Obsidian plugin tests passed!"
    else
        echo "❌ Obsidian plugin tests failed!"
        exit 1
    fi
fi

# Run CLI tests
echo "📦 Running CLI tests..."
CLI_JEST_ARGS="--config packages/cli/jest.config.js --forceExit"
if [ "$COVERAGE" = "true" ]; then
    echo "📊 CLI coverage collection enabled"
    CLI_JEST_ARGS="$CLI_JEST_ARGS --coverage --coverageReporters=lcov --coverageReporters=json-summary --coverageReporters=text-summary"
fi

# Use timeout for CLI tests as well
if [ "$CI" = "true" ]; then
    if timeout 120 node --experimental-vm-modules ./node_modules/jest/bin/jest.js $CLI_JEST_ARGS; then
        echo "✅ CLI tests passed!"
    else
        RESULT=$?
        if [ $RESULT -eq 124 ]; then
            echo "❌ CLI tests timed out after 2 minutes!"
        else
            echo "❌ CLI tests failed!"
        fi
        exit 1
    fi
else
    if node --experimental-vm-modules ./node_modules/jest/bin/jest.js $CLI_JEST_ARGS; then
        echo "✅ CLI tests passed!"
    else
        echo "❌ CLI tests failed!"
        exit 1
    fi
fi

# Run exocortex regression tests (narrow scope: allow-listed files only).
# The packages/exocortex/jest.config.js root-level config is otherwise unreachable
# from CI because obsidian-plugin/jest.config.js's `testMatch` with `<rootDir>/../exocortex/...`
# does not actually discover external roots without a `roots` entry. This narrow
# invocation pulls in only the files targeted by specific RFC regression /
# Phase-N green-gates so those TDD steps can produce CI-verified RED→GREEN proof.
# Pre-existing failures in the wider exocortex package (performance tests,
# QueryExecutor.branch, MetadataExtractor, etc.) are intentionally excluded —
# tracked as a separate follow-up (CI gap audit).
#
# Allow-list additions:
# - RFC-028 Findings 3+4: services/GroundingExecutor.test.ts
# - RFC-028 Finding 5 (3.C.1): services/AssetConversionService.test.ts
# - RFC be70f741 Phase 2: application/services/RelationColumnSetResolver(.property)?.test.ts
#   + performance/RelationColumnSetResolverPerformance.test.ts (p95 <1ms gate)
# - Issue #2959: services/NoteToRDFConverter.issue-2959.test.ts (class-named
#   wikilink → namespace IRI normalization regression suite)
# - Issue #2997 Phase 5 (RFC 0810aad3): infrastructure/sparql/executors/BGPExecutor.issue-2997.test.ts
#   (translator literal-safety guard regression gate)
# - RFC 82a72aca P1.2 (SHACL-lite): services/ShapeRegistry.test.ts + services/ShapeLoader.test.ts
# - RFC da3a7555 (v15.173.1 fix): integration/dynamic-commands/grounding-resolve-execute.test.ts
#   (RDF → Resolver → Executor pipeline regression — wikilink unwrap, targetClass IRI reverse-map,
#   copy-from-target ≥3 fields)
echo "📦 Running exocortex grounding + RFC regression tests..."
EXOCORTEX_JEST_ARGS="--config packages/exocortex/jest.config.js --testPathPatterns=(services/(GroundingExecutor|AssetConversionService|NoteToRDFConverter\.(issue-2959|rfc-31c1a0be-grounding-ref)|ShapeRegistry|ShapeLoader)\.test|application/services/RelationColumnSetResolver(\.property)?\.test|performance/RelationColumnSetResolverPerformance\.test|infrastructure/sparql/executors/BGPExecutor\.issue-2997\.test|integration/dynamic-commands/grounding-resolve-execute\.test)\.ts --forceExit"
if [ "$CI" = "true" ]; then
    if timeout 60 node ./node_modules/jest/bin/jest.js $EXOCORTEX_JEST_ARGS; then
        echo "✅ Exocortex grounding regression tests passed!"
    else
        RESULT=$?
        if [ $RESULT -eq 124 ]; then
            echo "❌ Exocortex grounding regression tests timed out after 1 minute!"
        else
            echo "❌ Exocortex grounding regression tests failed!"
        fi
        exit 1
    fi
else
    if node ./node_modules/jest/bin/jest.js $EXOCORTEX_JEST_ARGS; then
        echo "✅ Exocortex grounding regression tests passed!"
    else
        echo "❌ Exocortex grounding regression tests failed!"
        exit 1
    fi
fi

echo "✅ All tests passed!"
exit 0
