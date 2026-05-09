# Mapping Policy

## Goal

Map endpoint-to-endpoint relationships across leaf repos with explicit evidence.

## Preconditions

Each leaf repo must already have at least one:

- `.understand-anything/domain-graph.json`
- `.understand-anything/knowledge-graph.json`

If both are missing, fail and report the leaf path.

## Endpoint Signature

Canonical signature:

- `method` uppercase
- `canonicalPath` normalized path template

Path normalization rules:

1. Trim query strings.
2. Collapse duplicate slashes.
3. Convert path params to `{id}` shape.
4. Remove trailing slash except root.

## Mapping Priority

1. Exact match on `method + canonicalPath` and gateway backend hint.
2. Exact path match with compatible method.
3. Prefix match with strong backend evidence.
4. Otherwise mark unresolved.

## Confidence

- `high`: exact signature match + backend evidence.
- `medium`: method/path match without strong backend evidence.
- `low`: heuristic-only candidate (must not become a `routes` edge automatically).

## Output Rules

1. Only `high` and `medium` candidates can produce `routes` edges.
2. `low` candidates stay unresolved in endpoint metadata (`confidence: low`) and do not produce `routes`.
3. Always preserve evidence in endpoint node metadata.
4. Never fabricate downstream endpoints that do not exist in leaf graphs.
5. Project-level graph must stay `service/endpoint` only; never emit function/config/concept nodes.
6. Mark endpoint `crossServiceConnected=true` only if it participates in at least one cross-service connector edge.
7. Endpoints without cross-service connector must be marked unconnected and treated as hidden in default project endpoint view.
8. Gateway endpoint nodes should be retained for traceability but default to `hiddenByDefault=true`.
