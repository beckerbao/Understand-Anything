# Ontology

## Purpose

This skill builds a **project-level control plane**. It should summarize and govern the system, not mirror leaf repo implementation.

## Canonical Node Types

Use these top-level node types:

- `domain`
- `flow`
- `step`
- `concept`
- `document`
- `config`

## Canonical Domain Map

Normalize service-specific labels into project-wide names.

Examples:

- `ms-stock` -> `stock`
- `ms-setting` -> `settings`
- `ms-catalog` -> `catalog`
- `ms-order` -> `order`
- `ms-promotion` -> `promotion`
- `ms-shop` -> `shop`
- `ms-ads` -> `ads`
- `ms-media-center` -> `media`
- `ms-reporting` -> `reporting`

If multiple repos use different labels for the same concept, collapse them into one canonical node.

## Canonical Edge Types

Use these edge types at top level:

- `contains`
- `contains_flow`
- `flow_step`
- `cross_domain`
- `depends_on`
- `documents`
- `related`

## What Belongs at Top Level

Promote items that explain:

- ownership boundaries
- cross-service flows
- source-of-truth decisions
- shared event contracts
- operational control rules
- system-wide invariants

## What Stays in Leaf Repos

Keep leaf details out of the project graph:

- handlers/controllers
- function and method internals
- repository queries
- cache key implementation
- DTO/field-level validation unless it affects multiple services
- one-service-only implementation detail
