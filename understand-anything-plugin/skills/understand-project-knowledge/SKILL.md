---
name: understand-project-knowledge
description: Build or update a top-level project knowledge base by federating multiple leaf understand-anything graphs, resolving cross-service relationships, and producing canonical control-plane knowledge for the whole system.
argument-hint: <project-root> [--leaf <leaf-root> ...]
---

# /understand-project-knowledge

Build the **top-level knowledge layer** for a multi-repo system.

This skill is for the project control plane, not a single service.

For merge rules and canonical naming, read:

- `references/ontology.md`
- `references/merge-policy.md`
- `references/output-schema.md`

## Purpose

Federate knowledge from leaf repos into a canonical project-level view that answers:

- Which service owns what
- Which flows span multiple services
- Which service is source of truth
- Which rules apply across services
- Which conflicts must be resolved at the project level

## Arguments

- `<project-root>`: the master repo whose `.understand-anything/` output will be updated.
- `--leaf <leaf-root>`: one or more leaf repo roots to read and merge.

Example:

```bash
/understand-project-knowledge /path/to/amaze-project-doc --leaf /path/to/ms-stock --leaf /path/to/ms-setting
```

## Inputs

Prefer existing leaf artifacts when available:

- `.understand-anything/domain-graph.json`
- `.understand-anything/knowledge-graph.json`
- service-level docs and architecture notes

If a leaf repo has both graphs, prefer `domain-graph.json` for business semantics and use `knowledge-graph.json` only for supporting detail.

## Preconditions

- `<project-root>` must exist and be the repo that receives the merged output.
- Every referenced leaf repo must already have at least one `domain-graph.json` or `knowledge-graph.json`.
- This skill does not run `/understand` or `/understand-domain` for leaf repos.
- If any leaf repo is missing both graphs, stop and tell the user exactly which repo needs to be analyzed first.

## Output

Produce or update the top-level project knowledge artifacts for the target repo:

- canonical domains
- cross-service flows
- system ownership map
- source-of-truth rules
- event contracts
- operational control rules

## Workflow

1. Read the master project root from the first argument.
2. Read the leaf repo roots from `--leaf` arguments.
3. Run `scripts/collect-project-context.py` to build `<project-root>/.understand-anything/intermediate/project-context.json` from the master repo and every leaf graph.
4. Dispatch `agents/project-analyzer.md` with that context so the model can infer canonical domains, cross-service flows, and governance concepts.
5. Write the analyzer output to `<project-root>/.understand-anything/intermediate/project-analysis.json`.
6. Validate the analyzer output against `references/output-schema.md`.
7. Run `scripts/merge-project-knowledge.py` to merge the analyzer output into the master repo's `knowledge-graph.json`.
8. Keep references back to source leaf repos in summaries and supporting nodes.
9. Save the federated project-level result.

## Federation Rules

- Follow the promotion rules in `references/merge-policy.md`.
- Use the canonical naming map in `references/ontology.md`.
- If no canonical rule can be inferred, mark the item as unresolved rather than guessing.
- When a clear cross-domain journey exists across multiple services, synthesize a top-level journey flow that stitches the boundary steps together instead of only adding separate domain-local flows.
- Prefer a journey flow when the path crosses service boundaries in a stable business sequence such as request intake -> domain decision -> downstream handoff.

## Canonical Top-Level Concepts

Use project-level nodes and edge semantics defined in `references/ontology.md`.

## Guardrails

- Do not flatten leaf implementation detail into the project graph.
- Do not duplicate the same fact across multiple canonical nodes.
- Do not assume a service owns behavior unless the source explicitly shows it.
- Do not replace leaf knowledge, only summarize and govern it.
- Keep the top-level graph smaller, cleaner, and more stable than leaf graphs.

## When to Read More

If a cross-service flow is unclear, check both service-level domain graphs and architecture docs before creating a canonical rule.

## Execution Files

- `scripts/collect-project-context.py` gathers the master/leaf graph summaries used for semantic federation.
- `agents/project-analyzer.md` performs the semantic lift from leaf graphs to canonical top-level knowledge.
- `scripts/merge-project-knowledge.py` merges the analyzer output into the master graph and preserves an existing base graph if present.
