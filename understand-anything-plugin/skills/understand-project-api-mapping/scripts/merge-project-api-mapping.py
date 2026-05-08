#!/usr/bin/env python3
"""
Build or merge endpoint-graph.json from collected API context.

Usage:
  python merge-project-api-mapping.py <project-root> <api-context-path>
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def endpoint_node(ep: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": ep["id"],
        "type": "endpoint",
        "name": f"{ep.get('method', 'UNKNOWN')} {ep.get('canonicalPath', '/')}",
        "summary": ep.get("summary") or f"Endpoint in {ep.get('service', 'unknown')} for {ep.get('path', '')}",
        "tags": ep.get("tags") or ["endpoint", ep.get("service", "unknown")],
        "complexity": "moderate",
        "domainMeta": {
            "service": ep.get("service", ""),
            "method": ep.get("method", "UNKNOWN"),
            "path": ep.get("path", ""),
            "canonicalPath": ep.get("canonicalPath", ""),
            "auth": "unknown",
            "rateLimit": "",
            "confidence": "medium",
            "evidence": [
                {
                    "sourceRepo": ep.get("service", ""),
                    "filePath": ep.get("filePath") or "",
                    "lineRange": [0, 0],
                    "reason": f"Derived from {ep.get('sourceType', 'graph')} node {ep.get('sourceNodeId', '')}",
                }
            ],
        },
    }


def service_node(service: str) -> dict[str, Any]:
    return {
        "id": f"service:{service}",
        "type": "service",
        "name": service,
        "summary": f"Service node for {service} in project endpoint topology.",
        "tags": ["service", service],
        "complexity": "simple",
    }


def build_graph(project_root: Path, context: dict[str, Any]) -> dict[str, Any]:
    nodes_by_id: dict[str, dict[str, Any]] = {}
    edges_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}

    leaves = context.get("leaves", [])
    all_eps: list[dict[str, Any]] = []
    for leaf in leaves:
        service = leaf.get("repoName", "")
        if service:
            nodes_by_id[f"service:{service}"] = service_node(service)
        for ep in leaf.get("endpoints", []):
            all_eps.append(ep)
            en = endpoint_node(ep)
            nodes_by_id[en["id"]] = en
            key = (f"service:{service}", en["id"], "serves")
            edges_by_key[key] = {
                "source": key[0],
                "target": key[1],
                "type": "serves",
                "direction": "forward",
                "weight": 1.0,
            }

    def strip_gateway_prefix(path: str) -> str:
        m = re.match(r"^/(stock|order|interface)(/.*)$", path)
        return m.group(2) if m else path

    for src in all_eps:
        src_service = str(src.get("service", ""))
        src_method = str(src.get("method", "UNKNOWN")).upper()
        src_path = str(src.get("canonicalPath", ""))
        if not src_path:
            continue
        src_paths = {src_path}
        if "gateway" in src_service:
            src_paths.add(strip_gateway_prefix(src_path))

        for tgt in all_eps:
            if src is tgt:
                continue
            tgt_service = str(tgt.get("service", ""))
            if src_service == tgt_service:
                continue
            if "gateway" not in src_service and "gateway" not in tgt_service:
                continue

            tgt_method = str(tgt.get("method", "UNKNOWN")).upper()
            tgt_path = str(tgt.get("canonicalPath", ""))
            if not tgt_path:
                continue

            method_compatible = (
                src_method == tgt_method
                or src_method == "UNKNOWN"
                or tgt_method == "UNKNOWN"
            )
            path_compatible = tgt_path in src_paths
            if not method_compatible or not path_compatible:
                continue

            weight = 0.9 if src_method == tgt_method and src_method != "UNKNOWN" else 0.7
            edge = {
                "source": src["id"],
                "target": tgt["id"],
                "type": "routes",
                "direction": "forward",
                "weight": weight,
            }
            edges_by_key[(edge["source"], edge["target"], edge["type"])] = edge

    # Fallback gateway -> service dependency mapping when exact endpoint
    # pairing cannot be proven from leaf graphs.
    for ep in all_eps:
        service = str(ep.get("service", ""))
        if "gateway" not in service:
            continue
        p = str(ep.get("canonicalPath", ""))
        downstream = ""
        if p.startswith("/stock/"):
            downstream = "ms-stock"
        elif p.startswith("/order/"):
            downstream = "ms-order"
        elif p.startswith("/interface/"):
            downstream = "ms-interface"
        if not downstream:
            continue
        svc_id = f"service:{downstream}"
        if svc_id not in nodes_by_id:
            nodes_by_id[svc_id] = service_node(downstream)
        dep_edge = {
            "source": ep["id"],
            "target": svc_id,
            "type": "depends_on",
            "direction": "forward",
            "weight": 0.7,
        }
        edges_by_key[(dep_edge["source"], dep_edge["target"], dep_edge["type"])] = dep_edge

    now = datetime.now(timezone.utc).isoformat()
    graph = {
        "version": "1.0.0",
        "project": {
            "name": project_root.name,
            "languages": ["json"],
            "frameworks": ["understand-anything"],
            "description": "Project-level endpoint mapping graph generated from leaf graphs.",
            "analyzedAt": now,
            "gitCommitHash": "",
        },
        "nodes": sorted(nodes_by_id.values(), key=lambda n: (n["type"], n["id"])),
        "edges": sorted(edges_by_key.values(), key=lambda e: (e["type"], e["source"], e["target"])),
        "layers": [],
        "tour": [],
    }
    return graph


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: merge-project-api-mapping.py <project-root> <api-context-path>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    context_path = Path(sys.argv[2]).resolve()
    ua_dir = project_root / ".understand-anything"
    output_path = ua_dir / "endpoint-graph.json"

    if not ua_dir.exists():
        print(f"Error: missing {ua_dir}", file=sys.stderr)
        sys.exit(1)
    if not context_path.exists():
        print(f"Error: missing context file {context_path}", file=sys.stderr)
        sys.exit(1)

    context = load_json(context_path)
    graph = build_graph(project_root, context)
    output_path.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Written to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
