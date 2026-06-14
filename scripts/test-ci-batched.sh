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

# Run the FULL exocortex core suite (TF-gate O1+O2, project "Exocortex Alpha
# Launch"). Previously this ran a hand-maintained allow-list of ~55 of the ~319
# suites under packages/exocortex/jest.config.js, leaving ~83% of the core
# engine ungated and rotting silently (jest roots vs CI allowlist gotcha — see
# packages/obsidian-plugin/CLAUDE.md "Test Suite Awareness"). The allow-list was
# also a maintenance trap (every new suite had to be hand-added). Dropping it
# runs all suites under jest.config.js `roots` (`<rootDir>/tests`). Mirrors the
# CI gate in .github/workflows/ci.yml `test-coverage-exocortex`.
echo "📦 Running exocortex core test suite (full)..."
# tests/performance/** excluded — wall-clock micro-benchmarks with tight ms
# thresholds flake under parallel-worker CI load (mirrors the CI gate in
# .github/workflows/ci.yml test-coverage-exocortex).
EXOCORTEX_JEST_ARGS="--config packages/exocortex/jest.config.js --testPathIgnorePatterns /node_modules/ /tests/performance/ --forceExit"
if [ "$CI" = "true" ]; then
    if timeout 300 node ./node_modules/jest/bin/jest.js $EXOCORTEX_JEST_ARGS; then
        echo "✅ Exocortex core tests passed!"
    else
        RESULT=$?
        if [ $RESULT -eq 124 ]; then
            echo "❌ Exocortex core tests timed out after 5 minutes!"
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
