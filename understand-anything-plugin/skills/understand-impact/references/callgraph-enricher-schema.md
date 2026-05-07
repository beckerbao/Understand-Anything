# Callgraph Enricher Schema

This schema defines the optional enrichment layer that extracts `function -> function`
calls from a structural knowledge graph without polluting the base graph.

The enricher reads `.understand-anything/knowledge-graph.json` and writes a sidecar
artifact such as `.understand-anything/callgraph-overlay.json`.

## Purpose

- Keep the core structural graph clean and stable
- Add only high-confidence internal function call edges
- Give `/understand-impact` a richer graph for multi-hop impact traversal

## Input Contract

The enricher consumes a valid `knowledge-graph.json` with:

- `kind: "codebase"`
- `project` metadata
- `nodes[]` containing at least:
  - `file`
  - `function`
  - `class`
- `edges[]` containing existing structural relations such as:
  - `imports`
  - `contains`
  - `depends_on`
  - existing `calls` edges to endpoints

The enricher must not require domain or knowledge graphs.

## Output Contract

The output is a sidecar overlay with this shape:

```json
{
  "version": "1.0.0",
  "kind": "callgraph",
  "generatedAt": "2026-05-08T00:00:00.000Z",
  "project": {
    "name": "fe-widget-loyalty",
    "gitCommitHash": "..."
  },
  "baseGraph": {
    "kind": "codebase",
    "gitCommitHash": "..."
  },
  "scope": {
    "includeNodeTypes": ["function", "class"],
    "edgeTypes": ["calls"],
    "minConfidence": 0.7,
    "maxDepth": 1
  },
  "nodes": {
    "functionNodeIds": ["function:..."],
    "callerNodeIds": ["function:..."],
    "calleeNodeIds": ["function:..."]
  },
  "edges": {
    "functionCalls": [
      {
        "source": "function:src/widgets/TugoWallet/TugoWallet.tsx:TugoWallet",
        "target": "function:src/widgets/TugoWallet/api.ts:getUserLedger",
        "type": "calls",
        "direction": "forward",
        "confidence": 0.96,
        "callKind": "direct",
        "resolvedFrom": "Identifier",
        "sourceFilePath": "src/widgets/TugoWallet/TugoWallet.tsx",
        "targetFilePath": "src/widgets/TugoWallet/api.ts",
        "sourceRange": [52, 78],
        "targetRange": [121, 141]
      }
    ]
  },
  "stats": {
    "candidateCallSites": 120,
    "resolvedCalls": 74,
    "dedupedCalls": 8,
    "droppedCalls": 38,
    "maxDepthReached": 1
  },
  "notes": [
    "This overlay contains only internal function-to-function call edges.",
    "Endpoint calls remain in knowledge-graph.json.",
    "The overlay is deterministic for the same input graph."
  ]
}
```

## Edge Schema

Each call edge should follow this record shape:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | string | yes | Function node ID of the caller |
| `target` | string | yes | Function node ID of the callee |
| `type` | string | yes | Always `calls` |
| `direction` | string | yes | Always `forward` |
| `confidence` | number | yes | Score from `0` to `1` |
| `callKind` | string | yes | `direct`, `imported`, `member`, `hook`, `callback`, or `indirect` |
| `resolvedFrom` | string | no | AST construct used to resolve the call |
| `sourceFilePath` | string | no | Relative file path of caller |
| `targetFilePath` | string | no | Relative file path of callee |
| `sourceRange` | tuple | no | Inclusive line range for the call site |
| `targetRange` | tuple | no | Inclusive line range for the callee declaration |

## CallKind Rules

- `direct` - a plain local function call with an unambiguous symbol target
- `imported` - call resolves through an import binding or alias
- `member` - `obj.fn()` or `this.fn()` when the receiver can be resolved
- `hook` - React hook or hook-like wrapper call
- `callback` - callback passed into a higher-order function when the callback body can be resolved
- `indirect` - fallback for resolvable but less precise cases

## Inclusion Rules

Prefer edges that satisfy all of the following:

- caller and callee are both inside the repository
- callee resolves to a named function, arrow function, method, or class method
- call is syntactically unambiguous
- confidence is at or above `minConfidence`

## Exclusion Rules

Do not emit edges for:

- unresolved identifiers
- third-party package internals
- anonymous callbacks without a stable callee node
- dynamic property access that cannot be tied to a known function
- runtime/framework bootstrap noise unless it resolves to a project function

## Merge Strategy

The overlay should be treated as a separate layer.

- Keep `knowledge-graph.json` unchanged
- Load `callgraph-overlay.json` alongside the base graph when impact analysis needs deeper call chains
- Join on stable node IDs only
- Deduplicate by `(source, target, type, direction)`

## Relationship to Impact

`/understand-impact` should:

- read the base structural graph
- optionally load the callgraph overlay if present
- traverse both graphs as a unified adjacency view
- write `impact-overlay.json` as the final computed blast-radius artifact

This keeps the enrichment step deterministic and reversible.
