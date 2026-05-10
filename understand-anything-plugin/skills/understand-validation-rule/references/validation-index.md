# Validation Index

## Purpose

This index stores extracted input-contract facts so an agent can answer endpoint questions without reading the full function body.

## Record Schema

```json
{
  "id": "validation:function:src/orders/create.ts:createOrder",
  "functionId": "function:src/orders/create.ts:createOrder",
  "contractType": "route-contract",
  "route": {
    "method": "POST",
    "path": "/api/v1/orders"
  },
  "sourceChain": [
    "router",
    "middleware",
    "handler",
    "service"
  ],
  "sourceType": "inline",
  "present": true,
  "type": "manual",
  "summary": "Validates customerId, items, and quantity before creating the order.",
  "messages": [
    "customer ID is required"
  ],
  "headers": [
    {
      "name": "X-Storefront-ID",
      "required": false,
      "source": "middleware",
      "defaultValueByMethod": {
        "POST": "amaze",
        "PUT": "amaze",
        "PATCH": "amaze",
        "DELETE": "amaze",
        "GET": "",
        "HEAD": "",
        "OPTIONS": ""
      },
      "impact": "used for storefront-scoped product resolution"
    }
  ],
  "authHeaders": [
    "X-API-Key"
  ],
  "params": [
    {
      "name": "reservationId",
      "required": false,
      "source": "path"
    }
  ],
  "query": [],
  "defaults": [
    {
      "field": "storefrontId",
      "value": "amaze",
      "source": "middleware",
      "condition": "POST/PUT/PATCH/DELETE when header missing"
    }
  ],
  "contextKeys": [
    "storefrontId"
  ],
  "rules": [
    {
      "field": "customerId",
      "rule": "required"
    },
    {
      "field": "items",
      "rule": "required"
    },
    {
      "field": "quantity",
      "rule": "greater_than",
      "value": 0
    }
  ],
  "invalidOutcome": "reject_request",
  "errorType": "ValidationError",
  "confidence": 0.95,
  "evidenceLines": [18, 22, 29],
  "sourceLocations": [
    {
      "filePath": "src/orders/create.ts",
      "startLine": 18,
      "endLine": 41
    }
  ]
}
```

## Normalization Rules

- Capture route-level contract facts even when there is no validation failure.
- Use stable `functionId` values that match the graph convention.
- Keep `rules` atomic when possible.
- Prefer one rule object per field constraint.
- Preserve conditional validation with an explicit `condition` field when needed.
- Record `sourceType` as one of `inline`, `schema`, `middleware`, `decorator`, `helper`, or `mixed`.
- Use `contractType` values such as `validation`, `business-precondition`, `route-contract`, `middleware-contract`, `header-contract`, `defaulting`, and `normalization`.

## Common Rule Values

- `required`
- `optional`
- `min_length`
- `max_length`
- `min_items`
- `max_items`
- `greater_than`
- `greater_than_or_equal`
- `less_than`
- `less_than_or_equal`
- `regex`
- `enum`
- `type`
- `custom`

## Failure Semantics

- `invalidOutcome`: `reject_request`, `throw`, `fallback`, `sanitize_and_continue`
- `errorType`: the concrete error class or response label when known

## Input Contracts

Use `headers` and `defaultValueByMethod` for request metadata that changes downstream behavior even when it does not fail validation.
Prefer this for storefront, tenant, locale, and auth-context headers.
Use `authHeaders` for request headers that gate access before handler execution.
Use `params`, `query`, `defaults`, `contextKeys`, and `sourceChain` to capture route behavior that affects downstream resolution.

## Graph Linking

If the graph is updated, prefer one of these lightweight links:

- `function -> validation` via `has_validation`
- `function.validationRef = <validation-id>`

Do not duplicate the full rule set inside the graph unless the downstream consumer explicitly needs it.
