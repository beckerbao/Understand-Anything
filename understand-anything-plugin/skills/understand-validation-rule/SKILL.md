---
name: understand-validation-rule
description: Extract route-first input contracts, validation logic, defaults, and downstream behavior from code into a structured index for functions, handlers, middleware, and schema-driven validators.
---

# Understand Validation Rule

## Overview

Use this skill when you need to extract input-contract facts from source code so an agent can answer contract questions without rereading the whole function.
It is intended for endpoints, route handlers, service methods, middleware, decorators, schema files, and custom validator helpers.

## What To Capture

Extract only contract facts that improve retrieval:

- whether validation exists
- where validation happens
- which inputs or fields are checked
- route params, query params, and request body fields
- rule type and rule values
- default values and normalization behavior
- conditional or cross-field behavior
- failure behavior and error type
- whether behavior is inline, schema-based, middleware-based, delegated, or context-derived
- request headers and default values when they affect downstream behavior
- middleware-derived context values that alter downstream resolution

## Workflow

1. Identify the endpoint route first, then the route handler and middleware chain.
2. Read the route definition and middleware stack before reading the handler body.
3. Follow helper, decorator, schema, or context references only as needed to resolve the final contract.
4. Normalize validation, headers, defaults, params, and query behavior into a stable record.
5. Capture source locations so each contract fact can be traced back to code.
6. Write the result to the contract index artifact.
7. If the project maintains `knowledge-graph.json`, add a lightweight `validationRef`, `contractRef`, or `has_validation` edge from the function node when available.

## Output

Write one record per function, handler, or route-level contract in a separate JSON index.

See [validation-index.md](references/validation-index.md) for the canonical record shape and normalization rules.
Use `scripts/generate_validation_index.js` to build the index and `scripts/merge_validation_refs.js` to add lightweight refs to the graph.

Recommended fields:

- `id`
- `functionId`
- `sourceType`
- `present`
- `type`
- `contractType`
- `summary`
- `messages`
- `headers`
- `authHeaders`
- `defaultValueByMethod`
- `params`
- `query`
- `defaults`
- `contextKeys`
- `sourceChain`
- `route`
- `rules`
- `invalidOutcome`
- `errorType`
- `confidence`
- `evidenceLines`
- `sourceLocations`

## Decision Rule

Prefer the structured index when the validation is simple and local.
Read the source code when validation is:

- conditional or cross-field
- spread across multiple helpers
- generated dynamically
- ambiguous after normalization

Treat headers like `X-Storefront-ID` as part of the input contract when they supply defaults or alter downstream resolution, even if they do not fail validation.
Treat the route and middleware chain as first-class context. If the contract is only visible in middleware or router setup, capture it there instead of waiting for the handler body.
Discover route contracts across all router files under `cmd/server/router/` and merge them with handler-derived contract facts.

## Integration Rule

Keep the graph small.
Do not duplicate the full validation rule set inside `knowledge-graph.json` unless a downstream consumer explicitly requires denormalized data.
Keep the index route-first. If a service is missing a function-level node match, still record the route or middleware-level contract fact instead of dropping it.
