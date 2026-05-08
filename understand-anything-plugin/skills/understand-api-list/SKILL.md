---
name: understand-api-list
description: Extract and persist exposed API endpoints for gateway and backend services from a structural knowledge graph. Use when a codebase has `.understand-anything/knowledge-graph.json` and you need to identify public HTTP routes from router files, handler files, KrakenD or gateway templates, Postman collections, OpenAPI specs, API docs, or tests, then update the graph with endpoint nodes and relationships.
---

# Understand Api List

## Overview

Use this skill to turn a structural knowledge graph into an endpoint inventory. It is for both gateway repos, where routes are usually defined declaratively, and backend repos, where routes are usually registered through routers and handlers.

## Workflow

1. Require `.understand-anything/knowledge-graph.json`.
2. If the graph is missing, stale, or not structural, stop and tell the user to run `/understand` first.
3. Load the existing graph and determine the service shape:
   - Gateway: inspect KrakenD config, endpoint templates, route fragments, and backend host mapping.
   - Backend: inspect router files, handlers, middleware, docs, Postman collections, OpenAPI specs, and API-list docs.
4. Extract concrete exposed endpoints, not generic route groups:
   - capture method, normalized path, source file, and handler or upstream target
   - include auth or access-control hints when they are explicit in the source
   - split one file into multiple endpoint nodes when it registers multiple routes
5. Update the graph in place:
   - add `endpoint` nodes for concrete exposed endpoints
   - use stable IDs so repeated runs dedupe cleanly
   - add `contains` edges from source file nodes to endpoint nodes
   - add `calls` edges from source function nodes to endpoint nodes when the function is known
   - preserve existing nodes, edges, layers, and tours unless they are directly affected
6. For gateway repos, also note the upstream service or proxy target when it is resolvable.
7. Validate the graph before saving it back to `.understand-anything/knowledge-graph.json`.

## Node Convention

Create one `endpoint` node per concrete exposed route.

Recommended fields:

- `id`: stable endpoint ID
- `type`: `endpoint`
- `name`: `METHOD /normalized/path`
- `summary`: short source-aware description, for example `Public GET health endpoint registered in cmd/server/router/v1.go`
- `filePath`: source file that defines or documents the route
- `tags`: include `api`, `gateway` or `backend`, plus `public`, `admin`, `internal`, `auth`, `rate-limit`, or service-specific tags when explicit

Prefer the smallest stable source unit:

- Gateway: route fragment or assembled KrakenD config file
- Backend: router registration file, then handler file if registration is indirect
- Docs/tests: only when they are the clearest source for the exposed list and no runtime source is available in the graph

## Endpoint IDs

Use this stable format:

```text
endpoint:<relative-file-path>:<METHOD> <normalized-path>
```

Examples:

- `endpoint:cmd/server/router/v1.go:GET /v1/health`
- `endpoint:internal/handlers/rest/v1/stock.go:POST /v1/stock/reserve`
- `endpoint:config/templates/_endpoints_stock.tmpl:GET /stock/*`

## Edge Convention

- `contains`: file node -> endpoint node
- `calls`: function node -> endpoint node
- `documents`: doc node -> endpoint node only when the doc is the source of truth for the exposed list

## Extraction Rules

- Prefer runtime route registration over derived docs.
- Prefer a gateway template over a narrative gateway document.
- Prefer a router file over a handler file when both exist.
- If one file defines many routes, add one endpoint node per route, not one aggregate node.
- If a route is private by design, still add it when it is exposed through the service API surface; mark it with the correct visibility tag.
- If the route is duplicated in docs and runtime code, keep the runtime definition and treat docs as supporting evidence.

## Output Rules

- Prefer concrete public routes over helper functions or internal plumbing.
- Prefer source-of-truth route definitions over derived docs when both exist.
- If multiple sources disagree, keep the route definition that is actually registered at runtime and note the mismatch in the graph summary.

## Reference

See [endpoint-sources.md](references/endpoint-sources.md) for the source-order heuristics to use when extracting gateway and backend endpoints.
