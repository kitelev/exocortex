/**
 * Contract Definitions for Plugin-Core Interface
 *
 * These contracts define the expected behaviors of exocortex components
 * when consumed by obsidian-plugin or any other consumer. Contract tests verify
 * that implementations adhere to these specifications.
 *
 * Contract Structure:
 * - name: Component identifier
 * - version: Contract version (semver)
 * - methods: Method signatures with input/output types and behavior specs
 * - behaviors: List of behavioral guarantees
 * - errorConditions: Expected error handling
 */

export * from "./SPARQLParser.contract";
export * from "./TripleStore.contract";
export * from "./FrontmatterService.contract";
export * from "./QueryExecutor.contract";
export * from "./SolutionMapping.contract";
