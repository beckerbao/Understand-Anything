---
name: understand-impact
description: Analyze a structural knowledge graph to compute upstream/downstream call-chain impact for a seed node or changed file, then write an impact overlay for dashboard and agent use.
argument-hint: "[node-or-file-path [--max-hops N] [--upstream|--downstream|--both]]"
---

# /understand-impact

Use this skill when you want to answer: "If this function, file, or endpoint changes, what else is impacted?"

This skill is intentionally scoped to a structural knowledge graph:

- It requires `.understand-anything/knowledge-graph.json`
- It assumes the graph is already `kind: "codebase"`
- It computes impact from existing `calls`, `depends_on`, `imports`, and `contains` edges
- If present, it also includes API mapping edges from `.understand-anything/endpoint-graph.json` (`routes`, `serves`, `implements`, `configures`)
- If endpoint nodes carry `domainMeta.businessActions/useCases`, output also includes business-impact summary (use-case blast radius)
- If present, it may also read a separate `callgraph-overlay.json` containing internal
  `function -> function` call edges for deeper multi-hop impact traversal
- The optional callgraph overlay is produced by `scripts/build-callgraph-overlay.mjs`
- It writes `.understand-anything/impact-overlay.json`
- It uses the bundled deterministic script at `scripts/build-impact-overlay.mjs`
- The dashboard auto-loads `impact-overlay.json` on refresh, so the agent only needs to write the file

## What It Produces

- Seed nodes
- Upstream closure
- Downstream closure
- Impact paths
- Hop counts and summary stats
- Business impact summary (`businessImpact.impactedBusinessActions`, `businessImpact.impactedEndpoints`)

## Workflow

1. Load `.understand-anything/knowledge-graph.json`
2. If deeper internal call chains are desired, run the optional callgraph enricher:
   ```bash
   node scripts/build-callgraph-overlay.mjs <project-root>
   ```
3. Resolve the seed input:
   - file path -> matching file node(s)
   - node id -> exact node
   - plain name -> fuzzy match against node names and summaries
4. Build a traversal graph from the structural edges:
   - `calls`
   - `depends_on`
   - `imports`
   - `contains`
   - optionally endpoint mapping edges (`routes`, `serves`, `implements`, `configures`)
   - optionally merge in internal function-call edges from `callgraph-overlay.json`
5. Traverse according to the requested direction:
   - `downstream` = what the seed depends on
   - `upstream` = what depends on the seed
   - `both` = both directions
6. Limit traversal with `--max-hops` when provided
7. Run the bundled deterministic script:
   ```bash
   node scripts/build-impact-overlay.mjs <project-root> <seed> --max-hops <N> --upstream|--downstream|--both
   ```
8. Preserve stable node IDs and edge references from the knowledge graph
9. Write `impact-overlay.json` with the computed closure and paths
10. Tell the user to reload the dashboard so the new impact overlay is picked up
11. If requested, also summarize the result in human-readable form

## Traversal Rules

- Prefer `calls` edges for function-level impact
- Include `depends_on` edges for higher-level logic and wrapper dependencies
- Use `imports` edges to reach wrapper modules and composition roots
- Use `contains` edges to map file-level seeds to child function/class nodes
- De-duplicate nodes and paths
- Keep direction explicit so the overlay can distinguish upstream from downstream

## Decision Policy

Use the base structural graph first. Only add the callgraph enrichment layer when
the base graph is not sufficient to answer the impact question with acceptable
confidence.

Treat the impact as **narrow / structural-only** when:

- the seed is a file, config, document, or other module-level node
- a 1-hop traversal already surfaces the likely affected files/functions
- the graph path is dominated by `imports`, `contains`, or `depends_on`
- the user only needs a coarse blast radius

Treat the impact as **deep / call-chain** when:

- the seed is a function, class method, hook, or component with internal helpers
- the 1-hop result is sparse or cuts off too early to explain the change
- the question is clearly about transitive function impact
- the seed sits in a helper-heavy module where `function -> function` links are likely missing
- the user asks for "what else changes" in a way that implies transitive impact

Operational rule:

1. Inspect `knowledge-graph.json` first.
2. Compute a quick 1-hop structural closure.
3. If the closure is already explanatory, stop.
4. If the closure looks too shallow, run:
   ```bash
   node scripts/build-callgraph-overlay.mjs <project-root>
   ```
5. Recompute impact with the enriched callgraph overlay.

## Output Contract

The overlay should include:

- `seedNodeIds`
- `upstreamNodeIds`
- `downstreamNodeIds`
- `impactNodeIds`
- `paths`
- `edges`
- `stats`
- `layers`
- `scope`
- `baseGraph`

See `references/impact-overlay-schema.md` for the exact JSON shape.
See `references/callgraph-enricher-schema.md` for the optional callgraph enrichment layer.
