#!/usr/bin/env python3
"""
Collect endpoint-centric context across leaf graphs.

Usage:
  python collect-api-context.py <project-root> <output-path> <leaf-root> [<leaf-root> ...]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def find_graph_file(repo_root: Path) -> Path | None:
    ua_dir = repo_root / ".understand-anything"
    for candidate in (ua_dir / "domain-graph.json", ua_dir / "knowledge-graph.json"):
        if candidate.exists():
            return candidate
    return None


def graph_files(repo_root: Path) -> list[Path]:
    ua_dir = repo_root / ".understand-anything"
    return [p for p in (ua_dir / "domain-graph.json", ua_dir / "knowledge-graph.json") if p.exists()]


def normalize_path(path: str) -> str:
    p = path.strip()
    if "?" in p:
        p = p.split("?", 1)[0]
    p = re.sub(r"/+", "/", p)
    p = re.sub(r"\{[^}]+\}", "{id}", p)
    p = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "{id}", p)
    if p != "/" and p.endswith("/"):
        p = p[:-1]
    return p or "/"


def extract_endpoint_nodes(graph: dict[str, Any], repo_root: Path) -> list[dict[str, Any]]:
    nodes = [n for n in graph.get("nodes", []) if isinstance(n, dict)]
    endpoints: list[dict[str, Any]] = []

    for node in nodes:
        node_type = str(node.get("type", "")).strip()
        # Strict: only endpoint nodes are accepted as real HTTP endpoint candidates.
        # flow nodes are business/process abstractions and must not be converted
        # into endpoint paths.
        if node_type != "endpoint":
            continue
        meta = node.get("domainMeta", {}) if isinstance(node.get("domainMeta"), dict) else {}
        entry_point = str(meta.get("entryPoint", "")).strip()
        entry_type = str(meta.get("entryType", "")).strip()
        method = "UNKNOWN"
        path = ""
        if entry_point:
            m = re.match(r"^\s*([A-Z]+)\s+(.+)$", entry_point)
            if m:
                method = m.group(1).upper()
                path = m.group(2).strip()
            else:
                path = entry_point

        if not path:
            path = str(node.get("name", "")).strip()
            # Many leaf endpoint nodes encode HTTP signature in the node name,
            # e.g. "GET /api/v1/orders". Recover method/path from that form.
            m_name = re.match(r"^\s*([A-Z]+)\s+(.+)$", path)
            if m_name:
                method = m_name.group(1).upper()
                path = m_name.group(2).strip()

        if not path:
            continue
        # HTTP-only filter: require explicit method/path from entryPoint OR
        # endpoint name that starts with METHOD + path.
        looks_like_http = bool(re.match(r"^\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/", f"{method} {path}", re.IGNORECASE))
        if not looks_like_http and entry_type.lower() != "http":
            continue

        endpoint_id = f"endpoint:{repo_root.name}:{method}:{normalize_path(path)}"
        endpoints.append(
            {
                "id": endpoint_id,
                "sourceNodeId": node.get("id", ""),
                "sourceType": node_type,
                "service": repo_root.name,
                "method": method,
                "path": path,
                "canonicalPath": normalize_path(path),
                "entryType": entry_type,
                "summary": str(node.get("summary", "")).strip(),
                "tags": node.get("tags", []),
                "filePath": node.get("filePath"),
            }
        )
    return endpoints


def main() -> None:
    if len(sys.argv) < 4:
        print("Usage: collect-api-context.py <project-root> <output-path> <leaf-root> [<leaf-root> ...]", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    leaf_roots = [Path(arg).resolve() for arg in sys.argv[3:]]

    if not project_root.is_dir():
        print(f"Error: project root does not exist: {project_root}", file=sys.stderr)
        sys.exit(1)

    missing: list[str] = []
    leaves_payload: list[dict[str, Any]] = []
    for leaf in leaf_roots:
        if not leaf.is_dir():
            missing.append(f"{leaf} (missing directory)")
            continue
        files = graph_files(leaf)
        if not files:
            missing.append(f"{leaf} (missing .understand-anything/domain-graph.json or knowledge-graph.json)")
            continue

        endpoints: list[dict[str, Any]] = []
        loaded_graphs: list[Path] = []
        for graph_file in files:
            graph = load_json(graph_file)
            loaded_graphs.append(graph_file)
            endpoints.extend(extract_endpoint_nodes(graph, leaf))

        # Deduplicate endpoint ids across domain/knowledge sources.
        dedup: dict[str, dict[str, Any]] = {}
        for ep in endpoints:
            dedup[ep["id"]] = ep
        endpoints = sorted(dedup.values(), key=lambda e: e["id"])

        warning = None
        if not endpoints:
            warning = (
                "No HTTP endpoints detected from existing leaf graphs. "
                "Agent must read leaf graph semantics directly and keep unresolved; "
                "do not infer from flow/file paths."
            )

        leaves_payload.append(
            {
                "repoRoot": str(leaf),
                "repoName": leaf.name,
                "graphPaths": [str(p) for p in loaded_graphs],
                "endpoints": endpoints,
                **({"warning": warning} if warning else {}),
            }
        )

    if missing:
        print("Missing leaf graphs:", file=sys.stderr)
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        sys.exit(1)

    payload = {
        "projectRoot": str(project_root),
        "leaves": leaves_payload,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote API context for {len(leaves_payload)} leaf repo(s) to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
