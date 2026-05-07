---
name: understand-fe-api-call
description: Extract frontend-to-backend API calls from a codebase that already has a structural knowledge graph, then update the knowledge graph with endpoint nodes and calls edges.
argument-hint: [--full]
---

# /understand-fe-api-call

Use this skill to discover which backend endpoints a frontend codebase calls and persist that information into `.understand-anything/knowledge-graph.json`.

## When to Use

- The project already has a structural `knowledge-graph.json`
- You want FE-to-BE call sites, not domain analysis
- You want the graph updated with `endpoint` nodes and `calls` edges

## Preconditions

1. Require `.understand-anything/knowledge-graph.json`
2. Require `kind: "codebase"`
3. If the graph is missing, stale, or not structural, stop and tell the user to run `/understand` first

## Workflow

1. Load the existing structural graph
2. Find frontend call sites by inspecting:
   - `fetch(...)`
   - `axios.*(...)`
   - `createApiClient(...)` wrappers
   - custom `client.get/post/put/delete(...)`
   - direct webhook or XHR usage when it targets a BE URL
3. Resolve each call to:
   - source file node
   - source function node if available
   - endpoint node with a stable ID
4. Add or update graph content:
   - create `endpoint` nodes for concrete backend routes
   - add `contains` edges from file nodes to endpoint nodes
   - add `calls` edges from function nodes to endpoint nodes
5. Keep the graph deterministic:
   - dedupe repeated endpoints
   - preserve existing nodes/edges
   - do not rewrite unrelated layers or tours
6. Validate the graph with the standard `validateGraph` pipeline
7. Save the updated graph back to `.understand-anything/knowledge-graph.json`

## Endpoint Node Convention

Use this ID format:

```text
endpoint:<relative-file-path>:<METHOD> <normalized-path>
```

Examples:

- `endpoint:src/widgets/TugoWallet/api.ts:GET /loyalty/api/v1/admin/token`
- `endpoint:src/widgets/CashbackForm/CashbackForm.tsx:POST /support/api/tickets/webhooks/cashback`

## Edge Convention

- `contains`: file node -> endpoint node
- `calls`: function node -> endpoint node

## Notes

- Prefer real runtime endpoints over generic wrapper functions
- If a wrapper builds multiple calls, create one endpoint node per concrete backend route
- If the source already has a good structural graph, update that graph in place instead of producing a separate file
