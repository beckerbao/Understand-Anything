#!/usr/bin/env python3
"""
Validate endpoint-graph.json shape for project API mapping.

Usage:
  python validate-project-api-mapping.py <graph-path>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


ALLOWED_NODE_TYPES = {"service", "endpoint"}
ALLOWED_EDGE_TYPES = {"serves", "routes", "depends_on"}


def validate(path: Path) -> list[str]:
    issues: list[str] = []
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"cannot parse JSON: {e}"]

    if graph.get("version") != "1.0.0":
        issues.append("version must be '1.0.0'")

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list):
        issues.append("nodes must be array")
        nodes = []
    if not isinstance(edges, list):
        issues.append("edges must be array")
        edges = []

    node_ids: set[str] = set()
    node_types_by_id: dict[str, str] = {}
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            issues.append(f"node[{i}] must be object")
            continue
        node_id = str(node.get("id", "")).strip()
        node_type = str(node.get("type", "")).strip()
        if not node_id:
            issues.append(f"node[{i}] missing id")
            continue
        if node_id in node_ids:
            issues.append(f"duplicate node id: {node_id}")
        node_ids.add(node_id)
        node_types_by_id[node_id] = node_type
        if node_type not in ALLOWED_NODE_TYPES:
            issues.append(f"node {node_id} has unsupported type {node_type}")
        if not str(node.get("name", "")).strip():
            issues.append(f"node {node_id} missing name")
        if not str(node.get("summary", "")).strip():
            issues.append(f"node {node_id} missing summary")
        if node_type == "endpoint":
            dm = node.get("domainMeta")
            if not isinstance(dm, dict):
                issues.append(f"endpoint node {node_id} missing domainMeta")
            else:
                if not str(dm.get("service", "")).strip():
                    issues.append(f"endpoint node {node_id} missing domainMeta.service")
                if not str(dm.get("method", "")).strip():
                    issues.append(f"endpoint node {node_id} missing domainMeta.method")
                if not str(dm.get("path", "")).strip():
                    issues.append(f"endpoint node {node_id} missing domainMeta.path")
                if not str(dm.get("canonicalPath", "")).strip():
                    issues.append(f"endpoint node {node_id} missing domainMeta.canonicalPath")

    for i, edge in enumerate(edges):
        if not isinstance(edge, dict):
            issues.append(f"edge[{i}] must be object")
            continue
        src = str(edge.get("source", "")).strip()
        tgt = str(edge.get("target", "")).strip()
        et = str(edge.get("type", "")).strip()
        if not src or not tgt:
            issues.append(f"edge[{i}] missing source/target")
            continue
        if src not in node_ids:
            issues.append(f"edge[{i}] missing source node: {src}")
        if tgt not in node_ids:
            issues.append(f"edge[{i}] missing target node: {tgt}")
        if et not in ALLOWED_EDGE_TYPES:
            issues.append(f"edge[{i}] unsupported type: {et}")
            continue

        src_t = node_types_by_id.get(src, "")
        tgt_t = node_types_by_id.get(tgt, "")
        if et == "serves" and not (src_t == "service" and tgt_t == "endpoint"):
            issues.append(f"edge[{i}] serves must be service->endpoint, got {src_t}->{tgt_t}")
        elif et == "routes" and not (src_t == "endpoint" and tgt_t == "endpoint"):
            issues.append(f"edge[{i}] routes must be endpoint->endpoint, got {src_t}->{tgt_t}")
        elif et == "depends_on" and not (
            (src_t == "service" and tgt_t == "service")
            or (src_t == "endpoint" and tgt_t == "service")
        ):
            issues.append(f"edge[{i}] depends_on must be service->service or endpoint->service, got {src_t}->{tgt_t}")

    return issues


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: validate-project-api-mapping.py <graph-path>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1]).resolve()
    issues = validate(path)
    if issues:
        print("Validation failed:", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)
    print("Validation passed", file=sys.stderr)


if __name__ == "__main__":
    main()
