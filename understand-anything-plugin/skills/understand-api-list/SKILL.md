---
name: understand-api-list
description: Extract and persist exposed API endpoints plus outbound API call-outs from structural knowledge graph and source code. Supports Go, Node.js backend, and frontend JavaScript/TypeScript call-sites.
---

# Understand Api List

## Overview

Use this skill to build a complete API inventory:

- inbound exposed endpoints (`endpoint` nodes)
- outbound integrations/call-outs (`callout` nodes)

Supported runtime/language scope:

- Go backend
- Node.js backend (JavaScript/TypeScript)
- Frontend JavaScript/TypeScript

## Workflow

1. Require `.understand-anything/knowledge-graph.json`.
2. If graph is missing/stale, run `/understand` first.
3. Extract inbound endpoints from runtime routing sources (gateway or backend routers).
4. Extract outbound call-outs from code:
   - Go: `rest.Request + RestSend/rest.Send`, `http.NewRequest + client.Do`
   - Node.js/backend: `axios`, `fetch`, `got`, `superagent/request`, graphql clients
   - Frontend JS/TS: `fetch`, `axios`, Apollo/graphql-request style call-sites
5. Persist outbound artifact to `.understand-anything/api-callout-list.json`.
6. Merge call-outs into `.understand-anything/knowledge-graph.json` as `callout` nodes and edges.
7. Validate JSON before finishing.

## Runtime Commands (Recommended)

```bash
python3 .understand-anything/scripts/generate_api_callouts.py
python3 .understand-anything/scripts/merge_callouts_into_kg.py
```

## Node Convention

### Inbound Endpoint Node

- `id`: `endpoint:<relative-file-path>:<METHOD> <normalized-path>`
- `type`: `endpoint`
- `name`: `METHOD /normalized/path`

### Outbound Callout Node

- `id`: stable `callout:*` id from detector
- `type`: `callout`
- `name`: `METHOD <target-path-or-expression>`
- `meta`: include `service`, `function`, `target_base`, `target_path`, `protocol`, `language`, `runtime`, `library`
- `tags`: must include `outbound` and exactly one grouping tag:
  - `third-party`: external partner/public provider APIs (for example Grab, AliExpress, Stripe)
  - `internal-service`: internal microservice-to-microservice APIs (for example Catalog, Shop, Order service)

## Outbound Grouping Rules (Required)

When extracting outbound call-outs, always assign one of two groups:

1. `third-party`
2. `internal-service`

Classification priority:

1. If config/base URL clearly points to partner/public vendor domain, classify as `third-party`.
2. If config/base URL clearly points to internal service domain or internal service env var (for example `CATALOG_URL`, `SHOP_URL`, `ORDER_URL`), classify as `internal-service`.
3. If still ambiguous, default to `third-party` and add note in `summary` that classification is heuristic.

For `endpoint` nodes that represent outbound call-outs (legacy compatibility mode), apply the same grouping tags in `tags`.

## Edge Convention

- `contains`: file node -> endpoint/callout node
- `calls`: function node -> endpoint/callout node (when function node exists)

## Output Rules

- Keep inbound and outbound separated by node type (`endpoint` vs `callout`).
- Keep IDs stable across reruns.
- Prefer runtime route definitions over docs when conflicting.
- For dynamic URLs, keep expression-level target instead of fabricating concrete URL.

## Reference

See [endpoint-sources.md](references/endpoint-sources.md).

## Linking Step (Required)

After merge, build traversal edges so dashboard can show story flow:

```bash
python3 .understand-anything/scripts/augment_endpoint_callout_links.py
```

This adds:

- `endpoint -> controller function` (`calls`)
- `controller function -> activity/outbound callout` (`calls`)

Use this so users can traverse from ms-order inbound endpoints to outbound integrations (for example `POST /api/v1/activity`) in one path.
