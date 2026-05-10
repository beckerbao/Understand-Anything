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


def canonicalize_outbound_path(path: str) -> str:
    p = path.strip()
    if not p:
        return p
    # Convert dynamic base URL expressions to routable path:
    # ${BASE}/api/v1/x -> /api/v1/x
    m = re.search(r"(/api/.*)$", p)
    if m:
        p = m.group(1)
    elif p.startswith("http://") or p.startswith("https://"):
        m2 = re.match(r"^https?://[^/]+(/.*)$", p)
        if m2:
            p = m2.group(1)
    return normalize_path(p)


def unique_keep_order(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        s = v.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def infer_business_actions(text: str) -> list[str]:
    low = text.lower()
    actions: list[str] = []
    mapping = [
        ("create_order", ["create", "new order", "order/create", "order-request"]),
        ("update_order_status", ["status", "state", "update-status", "transition"]),
        ("print_waybill", ["waybill", "print-waybill", "awb"]),
        ("request_shipping_quote", ["quotation", "quote", "delivery/quotes"]),
        ("sync_activity_log", ["activity", "audit", "timeline", "log"]),
        ("reserve_stock", ["reservation", "reserve", "stock/hold"]),
    ]
    for action, keys in mapping:
        if any(k in low for k in keys):
            actions.append(action)
    return unique_keep_order(actions)


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
        meta = node.get("meta", {}) if isinstance(node.get("meta"), dict) else {}
        endpoint_actions = unique_keep_order(
            [
                *(meta.get("business_actions", []) if isinstance(meta.get("business_actions"), list) else []),
                *(meta.get("use_cases", []) if isinstance(meta.get("use_cases"), list) else []),
                *infer_business_actions(f"{node.get('name', '')} {node.get('summary', '')} {path}"),
            ]
        )
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
                "businessActions": endpoint_actions,
            }
        )
    return endpoints


def extract_callouts(graph: dict[str, Any], repo_root: Path) -> list[dict[str, Any]]:
    nodes = [n for n in graph.get("nodes", []) if isinstance(n, dict)]
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for n in nodes:
        nid = str(n.get("id", "")).strip()
        if nid:
            nodes_by_id[nid] = n
    edges = [e for e in graph.get("edges", []) if isinstance(e, dict)]
    endpoint_to_functions: dict[str, set[str]] = {}
    function_to_callouts: dict[str, set[str]] = {}
    for edge in edges:
        src = str(edge.get("source", "")).strip()
        tgt = str(edge.get("target", "")).strip()
        if src.startswith("endpoint:") and tgt.startswith("function:"):
            endpoint_to_functions.setdefault(src, set()).add(tgt)
        if src.startswith("function:") and (
            tgt.startswith("callout:")
            or (
                tgt.startswith("endpoint:")
                and (
                    (isinstance(nodes_by_id.get(tgt, {}).get("tags"), list) and "outbound" in nodes_by_id.get(tgt, {}).get("tags", []))
                    or "callout" in str(nodes_by_id.get(tgt, {}).get("summary", "")).lower()
                )
            )
        ):
            function_to_callouts.setdefault(tgt, set()).add(src)

    out: list[dict[str, Any]] = []
    for node in nodes:
        node_type = str(node.get("type", "")).strip()
        node_id = str(node.get("id", "")).strip()
        tags = node.get("tags", []) if isinstance(node.get("tags"), list) else []
        is_outbound_endpoint = node_type == "endpoint" and ("outbound" in tags or "callout" in str(node.get("summary", "")).lower())
        # Backward compatible:
        # - legacy leaf graphs: type == callout
        # - normalized leaf graphs: type == endpoint with id prefix callout:
        # - shipping-like graphs: type == endpoint with outbound tag/summary
        if node_type != "callout" and not (node_type == "endpoint" and node_id.startswith("callout:")) and not is_outbound_endpoint:
            continue
        meta = node.get("meta", {}) if isinstance(node.get("meta"), dict) else {}
        method = "UNKNOWN"
        path = str(meta.get("target_path", "")).strip()
        name = str(node.get("name", "")).strip()
        m = re.match(r"^\s*([A-Z]+)\s+(.+)$", name)
        if m:
            method = m.group(1).upper()
            if not path:
                path = m.group(2).strip()
        if not path:
            continue
        path = canonicalize_outbound_path(path)
        if not path.startswith("/"):
            continue
        caller_functions = sorted(function_to_callouts.get(node_id, set()))
        source_endpoint_node_ids: set[str] = set()
        if caller_functions:
            for endpoint_node_id, fn_ids in endpoint_to_functions.items():
                if any(fn in fn_ids for fn in caller_functions):
                    source_endpoint_node_ids.add(endpoint_node_id)

        out.append(
            {
                "id": node_id,
                "service": repo_root.name,
                "method": method,
                "path": path,
                "canonicalPath": normalize_path(path),
                "targetBase": str(meta.get("target_base", "")).strip(),
                "function": str(meta.get("function", "")).strip(),
                "filePath": node.get("filePath"),
                "summary": str(node.get("summary", "")).strip(),
                "tags": tags,
                "businessActions": infer_business_actions(f"{name} {path} {meta.get('function', '')}"),
                "callerFunctions": caller_functions,
                "sourceEndpointNodeIds": sorted(source_endpoint_node_ids),
            }
        )
    return out


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
        callouts: list[dict[str, Any]] = []
        loaded_graphs: list[Path] = []
        for graph_file in files:
            graph = load_json(graph_file)
            loaded_graphs.append(graph_file)
            endpoints.extend(extract_endpoint_nodes(graph, leaf))
            callouts.extend(extract_callouts(graph, leaf))

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
                "callouts": callouts,
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
