/**
 * Visual Regression Tests for SPARQL Components
 *
 * Tests visual appearance of SPARQL-related UI components
 * including error views and empty states.
 *
 * Run with: npm run test:component
 * Update snapshots: npm run test:component -- --update-snapshots
 */
import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { SPARQLErrorView } from "../../../src/presentation/components/sparql/SPARQLErrorView";
import { SPARQLEmptyState } from "../../../src/presentation/components/sparql/SPARQLEmptyState";

test.describe("SPARQLErrorView Visual Regression", () => {
  test("syntax error with position", async ({ mount }) => {
    const component = await mount(
      <SPARQLErrorView
        error={{
          message: "Unexpected token 'x'",
          line: 3,
          column: 15,
          queryString: `PREFIX exo: <https://exocortex.my/ontology#>
SELECT ?subject ?predicate ?object
WHERE { ?s ?p x }`,
        }}
      />,
    );
    await expect(component).toHaveScreenshot("sparql-error-syntax.png");
  });

  test("execution error without position", async ({ mount }) => {
    const component = await mount(
      <SPARQLErrorView
        error={{
          message: "Unknown property: exo__InvalidProperty",
        }}
      />,
    );
    await expect(component).toHaveScreenshot("sparql-error-execution.png");
  });

  test("long error with multiline query", async ({ mount }) => {
    const component = await mount(
      <SPARQLErrorView
        error={{
          message:
            "Parse error: Expected one of SELECT, CONSTRUCT, DESCRIBE, ASK, PREFIX, BASE",
          line: 5,
          column: 1,
          queryString: `PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>

SELECT ?task ?label ?status
INVALID
WHERE {
  ?task rdf:type ems:Task .
  ?task exo:Asset_label ?label .
}
LIMIT 100`,
        }}
      />,
    );
    await expect(component).toHaveScreenshot("sparql-error-multiline.png");
  });
});

test.describe("SPARQLEmptyState Visual Regression", () => {
  test("default empty state", async ({ mount }) => {
    const component = await mount(<SPARQLEmptyState />);
    await expect(component).toHaveScreenshot("sparql-empty-default.png");
  });

  test("empty state with SELECT query", async ({ mount }) => {
    const component = await mount(
      <SPARQLEmptyState queryString="SELECT ?s ?p ?o WHERE { ?s ?p ?o }" />,
    );
    await expect(component).toHaveScreenshot("sparql-empty-select.png");
  });

  test("empty state with CONSTRUCT query", async ({ mount }) => {
    const component = await mount(
      <SPARQLEmptyState queryString="CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" />,
    );
    await expect(component).toHaveScreenshot("sparql-empty-construct.png");
  });

  test("empty state with ASK query", async ({ mount }) => {
    const component = await mount(
      <SPARQLEmptyState queryString="ASK WHERE { ?s ?p ?o }" />,
    );
    await expect(component).toHaveScreenshot("sparql-empty-ask.png");
  });
});
