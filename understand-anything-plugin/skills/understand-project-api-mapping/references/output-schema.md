# Endpoint Mapping Graph Schema

The output file is:

- `.understand-anything/endpoint-graph.json`

## Envelope

```json
{
  "version": "1.0.0",
  "project": {
    "name": "string",
    "languages": ["string"],
    "frameworks": ["string"],
    "description": "string",
    "analyzedAt": "ISO-8601 string",
    "gitCommitHash": "string"
  },
  "nodes": [],
  "edges": [],
  "layers": [],
  "tour": []
}
```

## Node Types

- `service`
- `endpoint`

## Edge Types

- `serves` (`service -> endpoint`)
- `routes` (`endpoint -> endpoint`)
- `depends_on` (`service -> service` or `endpoint -> service`)

## Endpoint Node Metadata

Endpoint nodes should include `domainMeta` when available:

```json
{
  "service": "ms-gateway",
  "method": "GET",
  "path": "/stock/api/v1/stock/{productId}",
  "canonicalPath": "/stock/api/v1/stock/{id}",
  "auth": "api-key|bearer|none|unknown",
  "rateLimit": "string or empty",
  "confidence": "high|medium|low",
  "crossServiceConnected": true,
  "hiddenByDefault": false,
  "evidence": [
    {
      "sourceRepo": "/abs/path/to/repo",
      "filePath": "relative/path",
      "lineRange": [0, 0],
      "reason": "short explanation"
    }
  ]
}
```

## Validation Rules

1. Every node must have `id`, `type`, `name`, `summary`, `tags`, `complexity`.
2. Every edge must reference existing node IDs.
3. `routes` edges should carry `weight` between `0.0` and `1.0`.
4. `endpoint` nodes should include `method` and `path` in `domainMeta` if known.
5. Unresolved mappings stay at endpoint metadata level (`confidence: low`) and must not create `routes`.
6. `crossServiceConnected` should be `true` only when there is at least one cross-service connector.
7. Gateway endpoints should default `hiddenByDefault=true` for project-level dashboard views.
