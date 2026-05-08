#!/usr/bin/env python3
"""
Validate a project-level analysis graph against the Understand-Anything top-level
output contract used by understand-project-knowledge.

Usage:
    python validate-project-analysis.py <analysis-path>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ALLOWED_NODE_TYPES = {"document", "domain", "flow", "step", "concept", "config"}
ALLOWED_EDGE_TYPES = {"contains", "contains_flow", "flow_step", "cross_domain", "depends_on", "documents", "related"}


def load_graph(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Error: cannot read graph at {path}: {exc}", file=sys.stderr)
        return None
    if not isinstance(data, dict):
        print(f"Error: graph at {path} must be a JSON object", file=sys.stderr)
        return None
    return data


def validate_graph(graph: dict[str, Any]) -> list[str]:
    issues: list[str] = []

    if graph.get("version") != "1.0.0":
        issues.append("version must be '1.0.0'")

    project = graph.get("project")
    if not isinstance(project, dict):
        issues.append("project must be an object")
    else:
        if not str(project.get("name", "")).strip():
            issues.append("project.name must be non-empty")
        if not isinstance(project.get("languages", []), list):
            issues.append("project.languages must be an array")
        if not isinstance(project.get("frameworks", []), list):
            issues.append("project.frameworks must be an array")
        if not isinstance(project.get("description", ""), str):
            issues.append("project.description must be a string")
        if not isinstance(project.get("analyzedAt", ""), str):
            issues.append("project.analyzedAt must be a string")
        if not isinstance(project.get("gitCommitHash", ""), str):
            issues.append("project.gitCommitHash must be a string")

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    layers = graph.get("layers")
    tour = graph.get("tour")

    if not isinstance(nodes, list):
        issues.append("nodes must be an array")
        nodes = []
    if not isinstance(edges, list):
        issues.append("edges must be an array")
        edges = []
    if not isinstance(layers, list):
        issues.append("layers must be an array")
    if not isinstance(tour, list):
        issues.append("tour must be an array")

    node_ids: set[str] = set()
    for idx, node in enumerate(nodes):
        if not isinstance(node, dict):
            issues.append(f"node[{idx}] must be an object")
            continue

        node_id = str(node.get("id", "")).strip()
        node_type = str(node.get("type", "")).strip()
        node_name = str(node.get("name", "")).strip()
        summary = str(node.get("summary", "")).strip()
        tags = node.get("tags")

        if not node_id:
            issues.append(f"node[{idx}] is missing id")
        elif node_id in node_ids:
            issues.append(f"duplicate node id: {node_id}")
        else:
            node_ids.add(node_id)

        if node_type not in ALLOWED_NODE_TYPES:
            issues.append(f"node {node_id or idx} uses unsupported type {node_type!r}")
        if not node_name:
            issues.append(f"node {node_id or idx} must have a name")
        if not summary:
            issues.append(f"node {node_id or idx} must have a non-empty summary")
        if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) and tag.strip() for tag in tags):
            issues.append(f"node {node_id or idx} must have a non-empty tags array")

    for idx, edge in enumerate(edges):
        if not isinstance(edge, dict):
            issues.append(f"edge[{idx}] must be an object")
            continue

        source = str(edge.get("source", "")).strip()
        target = str(edge.get("target", "")).strip()
        edge_type = str(edge.get("type", "")).strip()

        if not source or not target:
            issues.append(f"edge[{idx}] must have source and target")
        if edge_type not in ALLOWED_EDGE_TYPES:
            issues.append(f"edge {source or idx} -> {target or idx} uses unsupported type {edge_type!r}")
        if source and source not in node_ids:
            issues.append(f"edge {source} -> {target} references missing source node")
        if target and target not in node_ids:
            issues.append(f"edge {source} -> {target} references missing target node")

    return issues


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: validate-project-analysis.py <analysis-path>", file=sys.stderr)
        sys.exit(1)

    analysis_path = Path(sys.argv[1]).resolve()
    graph = load_graph(analysis_path)
    if graph is None:
        sys.exit(1)

    issues = validate_graph(graph)
    if issues:
        print(f"Invalid project analysis graph: {analysis_path}", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print(f"OK: {analysis_path}")


if __name__ == "__main__":
    main()
