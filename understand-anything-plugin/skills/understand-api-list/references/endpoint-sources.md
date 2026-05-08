# Endpoint Source Heuristics

Use these source orders when extracting exposed API endpoints into a structural knowledge graph.

## Gateway repos

Prefer runtime route definitions and generated gateway config in this order:

1. KrakenD config templates and assembled config
2. Per-service endpoint fragments such as `_endpoints_*.tmpl`
3. Backend host or environment mapping that explains upstream selection
4. Docs or API lists only when the route template does not show the full picture

What to capture:

- public method and path
- upstream service or proxy target
- auth or rate-limit hints when present
- source template file and any named fragment that owns the route

## Backend repos

Prefer runtime routing sources in this order:

1. Router registration files
2. HTTP handler files
3. Middleware that wraps or blocks access to routes
4. API lists, Postman collections, OpenAPI specs, and docs
5. Tests that explicitly enumerate public routes

What to capture:

- method and normalized path
- handler function or registration site
- auth, tenancy, storefront, or API-key hints when explicit
- whether the endpoint is public, internal, or admin-facing if the source says so

## Conflict Rules

- Treat router registration as the source of truth when docs disagree.
- Treat gateway templates as the source of truth when generated docs disagree.
- If the graph already has a route node, update it instead of creating a duplicate.
- Keep endpoint IDs stable across reruns by using the file path plus method and normalized path.

## Normalization

- Keep path variables consistent, for example `{id}` or `:id`, but do not invent a new style if the codebase already uses one.
- Remove query strings from endpoint IDs.
- Collapse duplicate slashes.
- Preserve version prefixes such as `/v1` or `/api/v2`.
