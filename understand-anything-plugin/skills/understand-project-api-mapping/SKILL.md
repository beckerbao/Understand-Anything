---
name: understand-project-api-mapping
description: Build or update a top-level endpoint mapping graph by correlating API routes across leaf repos (for example gateway to downstream services).
argument-hint: <project-root> [--leaf <leaf-root> ...]
---

# /understand-project-api-mapping

Build the project-level endpoint mapping layer from existing leaf graphs.

This skill is for API topology and route mapping, not structural code analysis.

## Purpose

Answer:

- Which endpoint in leaf A maps to which endpoint in leaf B
- Which service routes or proxies to another service
- Which auth/rate-limit constraints apply on mapped paths
- Which mappings are unresolved and need manual review

Scope is strictly project API topology:

- `service` and `endpoint` nodes only
- no function-level or file-level modeling
- default view target is cross-service connected endpoints only
- gateway endpoints are retained in data but should be hidden by default in UI

## Inputs

- `<project-root>`: master repo that will receive output
- `--leaf <leaf-root>`: one or more leaf repos
- each leaf must already contain `.understand-anything/domain-graph.json` or `.understand-anything/knowledge-graph.json`

This skill does not run `/understand` for leaf repos.

## Output

- `<project-root>/.understand-anything/endpoint-graph.json`

## Workflow

1. Collect endpoint-centric context from every leaf graph.
   - Prefer structural evidence chain inside each leaf:
     `endpoint -> function (calls) -> callout (calls)`.
   - Persist `sourceEndpointNodeIds` for each outbound callout when this chain is available.
2. Normalize endpoint signatures (`method + canonical path`).
3. Build candidate mappings across leaves.
   - Priority order:
     1) evidence-backed mapping from `sourceEndpointNodeIds`
     2) direct `method + canonicalPath` endpoint match
     3) heuristic keyword fallback (only when evidence is missing)
4. Score mappings with confidence (`high`, `medium`, `low`).
5. Keep only evidence-backed mappings; mark uncertain ones unresolved.
6. Merge and validate final `endpoint-graph.json`.
7. Propagate `businessActions/useCases` from leaf endpoint/callout semantics into project endpoint nodes for impact analysis.
8. Mark endpoint visibility metadata:
   - `crossServiceConnected=true` when endpoint has cross-service connector evidence
   - `hiddenByDefault=true` for gateway endpoints unless explicitly requested

If a leaf has no detected HTTP endpoint candidates, do not run any extra leaf tool.
Agent must read existing leaf graph semantics directly and keep unresolved when evidence is insufficient.

## Execution Files

- `scripts/collect-api-context.py`
- `scripts/validate-project-api-mapping.py`
- `scripts/merge-project-api-mapping.py`
- `references/mapping-policy.md`
- `references/output-schema.md`
- `agents/openai.yaml`
