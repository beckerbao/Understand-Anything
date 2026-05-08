#!/usr/bin/env python3
"""
Collect project-level semantic context from a master repo and one or more leaf
repos that already have Understand-Anything graphs.

Usage:
    python collect-project-context.py <project-root> <output-path> <leaf-root> [<leaf-root> ...]
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


READ_RE = re.compile(r"^(README|readme)(\.md|\.rst|\.txt)?$")
DOC_HINT_RE = re.compile(r"(readme|overview|architecture|reference|guide|context|spec|wiki)", re.I)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_read_text(path: Path, limit: int = 3000) -> str:
    try:
        return path.read_text(encoding="utf-8")[:limit]
    except Exception:
        return ""


def find_graph_file(repo_root: Path) -> Path | None:
    ua_dir = repo_root / ".understand-anything"
    for candidate in (ua_dir / "domain-graph.json", ua_dir / "knowledge-graph.json"):
        if candidate.exists():
            return candidate
    return None


def degree_maps(graph: dict[str, Any]) -> tuple[Counter[str], Counter[str], Counter[str]]:
    indeg: Counter[str] = Counter()
    outdeg: Counter[str] = Counter()
    total: Counter[str] = Counter()
    for edge in graph.get("edges", []):
        src = edge.get("source")
        tgt = edge.get("target")
        if isinstance(src, str):
            outdeg[src] += 1
            total[src] += 1
        if isinstance(tgt, str):
            indeg[tgt] += 1
            total[tgt] += 1
    return indeg, outdeg, total


def node_by_id(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {n.get("id", ""): n for n in graph.get("nodes", []) if isinstance(n, dict) and n.get("id")}


def graph_stats(graph: dict[str, Any]) -> dict[str, Any]:
    node_types = Counter(n.get("type", "unknown") for n in graph.get("nodes", []) if isinstance(n, dict))
    edge_types = Counter(e.get("type", "unknown") for e in graph.get("edges", []) if isinstance(e, dict))
    return {
        "totalNodes": len(graph.get("nodes", [])),
        "totalEdges": len(graph.get("edges", [])),
        "totalLayers": len(graph.get("layers", [])),
        "tourSteps": len(graph.get("tour", [])),
        "nodeTypes": dict(sorted(node_types.items())),
        "edgeTypes": dict(sorted(edge_types.items())),
    }


def is_domain_graph(graph: dict[str, Any]) -> bool:
    return any(n.get("type") in {"domain", "flow", "step"} for n in graph.get("nodes", []))


def importance_order(graph: dict[str, Any]) -> list[str]:
    indeg, outdeg, total = degree_maps(graph)
    nodes = node_by_id(graph)

    def score(nid: str) -> tuple[int, int, int, str]:
        node = nodes.get(nid, {})
        t = node.get("type", "")
        kind_score = {"domain": 5, "flow": 4, "step": 3, "concept": 2, "document": 1}.get(t, 0)
        return (total[nid], indeg[nid], kind_score, nid)

    return [nid for nid, _ in sorted(((nid, score(nid)) for nid in nodes), key=lambda item: item[1], reverse=True)]


def select_semantic_nodes(graph: dict[str, Any]) -> set[str]:
    nodes = node_by_id(graph)
    if not nodes:
        return set()
    if is_domain_graph(graph) or len(nodes) <= 150:
        return set(nodes.keys())

    ordered = importance_order(graph)
    selected: set[str] = set()
    for nid in ordered[:60]:
        selected.add(nid)

    for nid, node in nodes.items():
        if node.get("type") in {"domain", "flow", "step", "concept"}:
            selected.add(nid)
        fp = str(node.get("filePath", ""))
        name = str(node.get("name", ""))
        if node.get("type") == "document" and (READ_RE.match(name) or DOC_HINT_RE.search(fp) or DOC_HINT_RE.search(name)):
            selected.add(nid)
        if node.get("type") in {"config"} and any(k in fp.lower() for k in ("package.json", "go.mod", "pyproject", "cargo.toml")):
            selected.add(nid)

    return selected


def compact_graph(graph: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    nodes = node_by_id(graph)
    selected = select_semantic_nodes(graph)
    if not selected:
        selected = set(nodes.keys())

    selected_nodes = [n for n in graph.get("nodes", []) if n.get("id") in selected]
    selected_edges = [
        e for e in graph.get("edges", [])
        if e.get("source") in selected and e.get("target") in selected
    ]

    # Keep a small but useful amount of graph structure.
    if len(selected_edges) > 300:
        selected_edges = selected_edges[:300]

    layers = graph.get("layers", [])
    tour = graph.get("tour", [])

    indeg, outdeg, total = degree_maps(graph)
    top_nodes = []
    for nid in importance_order(graph)[:25]:
        node = nodes.get(nid, {})
        top_nodes.append({
            "id": nid,
            "type": node.get("type", ""),
            "name": node.get("name", ""),
            "summary": node.get("summary", ""),
            "filePath": node.get("filePath"),
            "inDegree": indeg[nid],
            "outDegree": outdeg[nid],
            "degree": total[nid],
        })

    doc_nodes = [
        {
            "id": n.get("id", ""),
            "name": n.get("name", ""),
            "type": n.get("type", ""),
            "summary": n.get("summary", ""),
            "filePath": n.get("filePath"),
        }
        for n in selected_nodes
        if n.get("type") in {"document", "config", "service", "pipeline", "table", "schema", "resource", "endpoint"}
    ]

    return {
        "repoRoot": str(repo_root),
        "graphPath": None,
        "graphType": "domain" if is_domain_graph(graph) else "knowledge",
        "project": graph.get("project", {}),
        "stats": graph_stats(graph),
        "selectedNodes": selected_nodes,
        "selectedEdges": selected_edges,
        "topNodes": top_nodes,
        "nonCodeNodes": doc_nodes,
        "layers": layers,
        "tour": tour,
        "nodeSummaryIndex": {
            n.get("id", ""): {
                "name": n.get("name", ""),
                "type": n.get("type", ""),
                "summary": n.get("summary", ""),
            }
            for n in selected_nodes
            if n.get("id")
        },
    }


def extract_master_context(project_root: Path) -> dict[str, Any]:
    ua_dir = project_root / ".understand-anything"
    master_graph = find_graph_file(project_root)
    master = {
        "repoRoot": str(project_root),
        "readme": safe_read_text(project_root / "README.md"),
        "graphPath": str(master_graph) if master_graph else None,
    }
    if master_graph:
        graph = load_json(master_graph)
        master["graph"] = compact_graph(graph, project_root)
    return master


def main() -> None:
    if len(sys.argv) < 4:
        print("Usage: collect-project-context.py <project-root> <output-path> <leaf-root> [<leaf-root> ...]", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    leaf_roots = [Path(arg).resolve() for arg in sys.argv[3:]]

    if not project_root.is_dir():
        print(f"Error: project root does not exist or is not a directory: {project_root}", file=sys.stderr)
        sys.exit(1)
    if not leaf_roots:
        print("Error: at least one leaf root is required", file=sys.stderr)
        sys.exit(1)

    leaves: list[dict[str, Any]] = []
    missing: list[str] = []

    for leaf_root in leaf_roots:
        if not leaf_root.is_dir():
            missing.append(f"{leaf_root} (missing directory)")
            continue

        graph_file = find_graph_file(leaf_root)
        if graph_file is None:
            missing.append(f"{leaf_root} (missing .understand-anything/domain-graph.json or knowledge-graph.json)")
            continue

        graph = load_json(graph_file)
        leaves.append({
            "repoRoot": str(leaf_root),
            "graphPath": str(graph_file),
            "graphType": "domain" if is_domain_graph(graph) else "knowledge",
            "project": graph.get("project", {}),
            "readme": safe_read_text(leaf_root / "README.md"),
            "graph": compact_graph(graph, leaf_root),
        })

    if missing:
        print("Missing leaf graphs:", file=sys.stderr)
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        sys.exit(1)

    payload = {
        "projectRoot": str(project_root),
        "master": extract_master_context(project_root),
        "leaves": leaves,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote project context for {len(leaves)} leaf repo(s) to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
