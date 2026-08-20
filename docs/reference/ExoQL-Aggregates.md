# ExoQL statistical aggregates (`agg:`)

ExoQL extends SPARQL 1.1's `COUNT/SUM/AVG/MIN/MAX/GROUP_CONCAT/SAMPLE` with a namespace
of statistical aggregates:

```sparql
PREFIX agg: <https://exocortex.my/ontology/agg#>
```

They compose with `GROUP BY`, `HAVING` and `ORDER BY` like any built-in aggregate, and
work from both the CLI (`exocortex-cli query`) and `sparql` / `exoql` code blocks.

> Every example below was executed against a real vault; the numbers are actual output,
> not illustrations.

## Single-column

| Aggregate | Returns |
|---|---|
| `agg:median(?x)` | median (same as `agg:percentile50`) |
| `agg:variance(?x)` | population variance |
| `agg:stddev(?x)` | population standard deviation (√variance) |
| `agg:mode(?x)` | most frequent value |
| `agg:percentile25` `50` `75` `90` `95` `99` | that percentile |

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX agg: <https://exocortex.my/ontology/agg#>
SELECT (agg:median(?n) AS ?med) (agg:stddev(?n) AS ?sd) (agg:percentile90(?n) AS ?p90)
WHERE { ?s exo:Asset_label ?l . BIND(STRLEN(?l) AS ?n) }
```
```
med = 33      sd = 40.359      p90 = 74
```

⚠ **The percentile set is fixed, not parametric.** `agg:percentile33` is not registered
and raises — it does not fall back to anything:

```
Unknown aggregate agg:percentile33. Registered: agg:corr, agg:intercept, agg:median, …
```

The error lists what IS registered, so a typo (`agg:medain`) is self-correcting.

## Two-column

| Aggregate | Returns |
|---|---|
| `agg:corr(?x, ?y)` | Pearson correlation r |
| `agg:slope(?x, ?y)` | least-squares slope b in `y = a + b·x` |
| `agg:intercept(?x, ?y)` | least-squares intercept a |

Accumulation is single-pass and O(1) in group size — six running sums
(n, Σx, Σy, Σx², Σy², Σxy). No pair is retained, unlike `agg:median`.

```sparql
SELECT (agg:corr(?x, ?y) AS ?r) (agg:slope(?x, ?y) AS ?b) (agg:intercept(?x, ?y) AS ?a)
WHERE { ?s ex:x ?x . ?s ex:y ?y }
```

A pair is counted **only when both columns are numeric**: an unbound or non-numeric `?y`
skips that pair rather than shifting the `?x`-only sums.

### ⛔ Undefined answers are `NaN`, never `0`

When `n < 2`, or either column is constant (zero variance), the two-column aggregates
return `NaN`^^`xsd:double`.

This is deliberate and **differs from the single-column aggregates**, which return `0`
on empty input. For a median `0` is merely arbitrary; for a correlation it is a
specific, wrong finding a reader would act on — *"measured, no correlation"* is a
different claim from *"the question has no answer"*. Check for `NaN` before treating a
correlation as a result.

## Arity is checked

Each aggregate declares how many columns it consumes, and a mismatched call raises
rather than silently dropping the extra argument:

```
agg:corr(?x)        →  agg:corr takes exactly 2 arguments, got 1
agg:median(?x, ?y)  →  agg:median takes exactly 1 argument, got 2
```

Before this check, `agg:median(?x, ?y)` answered with the median of `?x` alone — a
plausible one-column number in place of the two-column statistic that was asked for.

## With `GROUP BY`

```sparql
PREFIX exo: <https://exocortex.my/ontology/exo#>
PREFIX ems: <https://exocortex.my/ontology/ems#>
PREFIX agg: <https://exocortex.my/ontology/agg#>
SELECT ?st (COUNT(?t) AS ?n) (agg:median(?len) AS ?med)
WHERE { ?t ems:Effort_status ?st . ?t exo:Asset_label ?l . BIND(STRLEN(?l) AS ?len) }
GROUP BY ?st ORDER BY DESC(?n)
```
```
ems#EffortStatusDone      n = 724   med = 70
ems#EffortStatusBacklog   n = 231   med = 64
```

## Registering your own

`CustomAggregateRegistry.getInstance().register(iri, aggregate)` takes an object with
`init()` / `step(state, value, value2?)` / `finalize(state) → Literal`, plus an optional
`arity: 1 | 2` (omitted means 1). A registered IRI outside the `agg:` namespace is
resolved the same way; the namespace only governs which unknown names raise.

## Implementation

- `packages/core/src/infrastructure/sparql/aggregates/BuiltInAggregates.ts` — the registry
- `.../aggregates/CustomAggregateRegistry.ts` — the `CustomAggregate` contract
- `.../algebra/AggregateTranslator.ts` — name resolution and the arity check
- `.../executors/AggregateExecutor.ts` — accumulation over solutions
