# Merge Policy

## Goal

Build a stable, canonical project knowledge base from multiple leaf understand-anything graphs.

## Source Priority

1. Existing leaf `domain-graph.json`
2. Existing leaf `knowledge-graph.json`
3. Service architecture docs
4. Repo README / overview docs
5. Raw implementation files only when necessary

## Promotion Rules

Promote to top-level only if at least one is true:

- the concept spans 2 or more services
- the concept defines an ownership boundary
- the concept is a source-of-truth rule
- the concept is a cross-service flow
- the concept is an event or contract consumed outside the service
- the concept is needed for operational control or incident handling

Top-level canonical outputs should be represented with valid Understand-Anything node types:

- `domain` for business areas
- `flow` for cross-service or project-wide processes
- `step` for ordered actions within a flow
- `concept` for governance, ownership, source-of-truth, or boundary rules
- `document` for master wiki pages that explain or govern the project

## Keep Leaf-Only

Keep in the leaf repo if the concept is:

- function-level implementation
- repository/query detail
- handler/controller detail
- cache key detail
- internal schema field detail
- one-service-only behavior with no cross-service impact

## Conflict Resolution

When leaf repos disagree:

1. Prefer the source with explicit ownership or operational authority
2. Prefer the source that describes the system boundary, not the implementation
3. If still unclear, create an `unresolved` note at top level
4. Never invent a compromise rule without evidence

## Merge Behavior

- Collapse duplicate concepts into one canonical node.
- Preserve a reference back to the original leaf source.
- Prefer stable project names over repo-specific naming.
- If a leaf detail is useful but too specific, summarize it as a top-level rule instead of copying the detail.
- Keep edge types within the supported graph schema: `contains`, `contains_flow`, `flow_step`, `cross_domain`, `depends_on`, `documents`, `related`.

## Quality Bar

A good top-level result should let an agent answer:

- Who owns this capability?
- Which service is authoritative?
- What happens when this service changes?
- Which downstream systems depend on it?
- What is the canonical flow for this business case?

If the result cannot answer those questions, it is still too leaf-level.
