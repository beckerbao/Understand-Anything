# Expected Final Output

## Purpose

The project analyzer should emit a canonical top-level Understand-Anything graph for the master repo. The graph should summarize cross-service meaning, not mirror leaf implementation.

## Shape

Use the standard knowledge-graph envelope:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "amaze-project-doc",
    "languages": ["markdown"],
    "frameworks": [],
    "description": "Top-level governance and cross-service knowledge for the Amaze platform",
    "analyzedAt": "2026-05-08T00:00:00Z",
    "gitCommitHash": "..."
  },
  "nodes": [],
  "edges": [],
  "layers": [],
  "tour": []
}
```

## Suggested Node Set

Use a small canonical set:

- `document` nodes for the master overview and major reference pages
- `domain` nodes for platform-wide business areas such as stock, settings, order, promotion, shop, catalog
- `flow` nodes for cross-service flows such as stock sync or seller configuration sync
- `step` nodes for the major ordered steps inside important flows
- `concept` nodes for governance, ownership, source-of-truth, and boundary rules
- `config` nodes only when a top-level config file is part of the project governance layer

## Suggested Edge Set

Use only schema-valid edge types:

- `contains`
- `contains_flow`
- `flow_step`
- `cross_domain`
- `depends_on`
- `documents`
- `related`

## Suggested Layer Set

Top-level federation may add a synthetic layer to keep canonical project nodes visible in structural view:

- `layer:project-federation`

Use it for project-wide domains, flows, steps, concepts, and top-level docs that were promoted from leaf graphs.

## Minimal Example

```json
{
  "version": "1.0.0",
  "project": {
    "name": "amaze-project-doc",
    "languages": ["markdown"],
    "frameworks": [],
    "description": "Top-level governance and cross-service knowledge for the Amaze platform",
    "analyzedAt": "2026-05-08T00:00:00Z",
    "gitCommitHash": "abc123"
  },
  "nodes": [
    {
      "id": "document:docs/wiki/overview/project_Overview.md",
      "type": "document",
      "name": "Project Overview",
      "summary": "Top-level overview of the Amaze Seller Center and its main business domains.",
      "tags": ["documentation", "overview", "governance"],
      "complexity": "moderate",
      "filePath": "docs/wiki/overview/project_Overview.md"
    },
    {
      "id": "domain:stock",
      "type": "domain",
      "name": "Stock",
      "summary": "Project-wide stock ownership, reservation, and sync rules across the platform.",
      "tags": ["domain", "stock", "governance"],
      "complexity": "moderate"
    },
    {
      "id": "flow:stock-federation",
      "type": "flow",
      "name": "Stock Federation",
      "summary": "Defines how stock knowledge is governed across seller-facing and platform-facing services.",
      "tags": ["flow", "stock", "cross-service"],
      "complexity": "moderate"
    },
    {
      "id": "step:stock-federation:identify-source-of-truth",
      "type": "step",
      "name": "Identify Source of Truth",
      "summary": "Determine which service owns stock authority and which services only consume it.",
      "tags": ["step", "governance"],
      "complexity": "simple"
    },
    {
      "id": "concept:stock-source-of-truth",
      "type": "concept",
      "name": "Stock Source of Truth",
      "summary": "Stock updates must be governed by the canonical stock service and reflected consistently across dependent services.",
      "tags": ["concept", "source-of-truth", "stock"],
      "complexity": "moderate"
    }
  ],
  "edges": [
    {
      "source": "document:docs/wiki/overview/project_Overview.md",
      "target": "domain:stock",
      "type": "documents",
      "direction": "forward",
      "weight": 0.7
    },
    {
      "source": "domain:stock",
      "target": "flow:stock-federation",
      "type": "contains_flow",
      "direction": "forward",
      "weight": 1.0
    },
    {
      "source": "flow:stock-federation",
      "target": "step:stock-federation:identify-source-of-truth",
      "type": "flow_step",
      "direction": "forward",
      "weight": 0.5
    },
    {
      "source": "concept:stock-source-of-truth",
      "target": "domain:stock",
      "type": "cross_domain",
      "direction": "forward",
      "weight": 0.6
    }
  ],
  "layers": [],
  "tour": []
}
```

## Quality Rules

- Keep the top-level graph smaller than any leaf graph.
- Prefer summary nodes over implementation nodes.
- Preserve leaf references in summaries, not by copying code detail.
- Use `concept` for governance and policy statements that do not belong to a single service.
- Never emit unsupported node or edge types.
