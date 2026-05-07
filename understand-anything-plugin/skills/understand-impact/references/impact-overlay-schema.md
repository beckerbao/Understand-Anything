# Impact Overlay Schema

`impact-overlay.json` is an analysis artifact written by `/understand-impact`.

## Top-Level Fields

```json
{
  "version": "1.0.0",
  "kind": "impact",
  "generatedAt": "2026-05-07T15:00:00.000Z",
  "project": {
    "name": "fe-widget-loyalty",
    "gitCommitHash": "..."
  },
  "baseGraph": {
    "kind": "codebase",
    "gitCommitHash": "..."
  },
  "scope": {
    "seedNodeIds": ["..."],
    "seedFilePaths": ["..."],
    "maxHops": 3,
    "direction": "upstream"
  },
  "nodes": {
    "seedNodeIds": ["..."],
    "upstreamNodeIds": ["..."],
    "downstreamNodeIds": ["..."],
    "impactNodeIds": ["..."]
  },
  "edges": {
    "impactEdgeRefs": [
      {
        "source": "...",
        "target": "...",
        "type": "calls",
        "direction": "forward",
        "traversalDirections": ["upstream"],
        "pathDirections": ["upstream"]
      }
    ]
  },
  "paths": [
    {
      "direction": "upstream",
      "traversalDirection": "upstream",
      "from": "...",
      "to": "...",
      "nodeIds": ["..."],
      "hopCount": 2,
      "reason": "..."
    }
  ],
  "layers": {
    "affectedLayerIds": ["..."]
  },
  "stats": {
    "seedCount": 1,
    "upstreamCount": 3,
    "downstreamCount": 4,
    "impactCount": 6,
    "maxDepthReached": 3
  },
  "notes": [
    "impactNodeIds is the computed closure",
    "paths is optional but useful for UI and explanations"
  ]
}
```

## Rules

- Use graph node IDs exactly as stored in `knowledge-graph.json`
- Prefer `calls` edges for function impact
- Include `depends_on` and `imports` when they contribute to transitive impact
- Keep the overlay deterministic for the same input graph and seed
