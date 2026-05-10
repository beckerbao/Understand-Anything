---
name: understand-project-pipeline
description: Orchestrate project-level federation across leaf understand-anything graphs, including project knowledge, API mapping, and optional impact analysis.
---

# Understand Project Pipeline

Use this skill when the user wants the **project-level** pipeline for a multi-repo system.

This is an orchestration skill, not a service scanner.

## What it does

- Reads existing leaf artifacts from service repos.
- Builds the canonical project knowledge graph.
- Builds the project API topology graph.
- Optionally builds project-level impact overlays from the API graph.
- Saves top-level artifacts in the project root.

## What it does not do

- It does not run the default service `understand` scan on leaf repos.
- It does not re-derive leaf file-level structure.
- It does not flatten service implementation detail into the project graph.

## Required inputs

- `project-root`: the master repo that receives the federated project artifacts.
- `leaf-root` values: one or more leaf repos that already have service-level understand artifacts.

If a leaf repo is missing `domain-graph.json` or `knowledge-graph.json`, analyze that repo first with the service pipeline.

## Pipeline

1. Collect leaf graphs and project context.
2. Run `understand-project-knowledge` to federate canonical domains, ownership, and cross-service flows.
3. Run `understand-api-list` for any leaf repo whose endpoint inventory is stale or missing.
4. Run `understand-project-api-mapping` to build the project `endpoint-graph.json`.
5. Optionally run `understand-impact` for blast-radius views that depend on the project endpoint graph.
6. Validate merged project artifacts.
7. Save the project-level outputs in the master repo.

## Output expectations

Project-level outputs should stay small and canonical:

- `knowledge-graph.json`
- `endpoint-graph.json`
- `impact-overlay.json` when requested or useful
- `meta.json`

Keep leaf implementation detail out of the project graph unless it creates a stable cross-service rule or mapping.

## Rule of thumb

- Use service pipeline for local truth.
- Use project pipeline for federated truth.
- If a fact is only true inside one service, keep it in the leaf graph.
- If a fact governs multiple services, promote it to the project graph.
