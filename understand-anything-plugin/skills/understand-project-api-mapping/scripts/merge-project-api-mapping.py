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


def resolve_project_name(project_root: Path) -> str:
    ua_dir = project_root / ".understand-anything"
    for file_name in ("endpoint-graph.json", "knowledge-graph.json", "domain-graph.json"):
        p = ua_dir / file_name
        if not p.exists():
            continue
        try:
            data = load_json(p)
        except Exception:
            continue
        project = data.get("project")
        if isinstance(project, dict):
            name = str(project.get("name", "")).strip()
            if name:
                return name
    return project_root.name


def endpoint_node(ep: dict[str, Any]) -> dict[str, Any]:
    service_name = ep.get("service", "")
    is_gateway = "gateway" in str(service_name)
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
            "crossServiceConnected": False,
            "hiddenByDefault": is_gateway,
            "businessActions": ep.get("businessActions", []),
            "useCases": ep.get("businessActions", []),
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
    all_callouts: list[dict[str, Any]] = []
    for leaf in leaves:
        service = leaf.get("repoName", "")
        if service:
            nodes_by_id[f"service:{service}"] = service_node(service)
        is_gateway_service = "gateway" in str(service)
        for ep in leaf.get("endpoints", []):
            all_eps.append(ep)
            if is_gateway_service:
                # Keep gateway only at service level for project endpoint view.
                continue
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
        for callout in leaf.get("callouts", []):
            if isinstance(callout, dict):
                all_callouts.append(callout)

    # Unresolved endpoint-level cross-service fallback:
    # mark likely order -> shipping integrations when endpoint-to-endpoint
    # mapping evidence is insufficient.
    has_shipping_service = "service:ms-shipping" in nodes_by_id
    if has_shipping_service:
        keyword_re = re.compile(
            r"(shipping|delivery|waybill|shipment|order-to-ship|carrier|logistic|quotation)",
            re.IGNORECASE,
        )
        routed_sources = {
            str(e.get("source", ""))
            for e in edges_by_key.values()
            if str(e.get("type", "")) == "routes" and str(e.get("source", "")).startswith("endpoint:ms-order:")
        }
        for ep in all_eps:
            ep_id = str(ep.get("id", ""))
            if not ep_id.startswith("endpoint:ms-order:"):
                continue
            if ep_id in routed_sources:
                # already resolved to a concrete endpoint target
                continue
            text = f"{ep.get('canonicalPath', '')} {ep.get('path', '')} {ep.get('summary', '')}"
            if not keyword_re.search(text):
                continue
            dep = {
                "source": ep_id,
                "target": "service:ms-shipping",
                "type": "depends_on",
                "direction": "forward",
                "weight": 0.45,
            }
            edges_by_key[(dep["source"], dep["target"], dep["type"])] = dep

    # Gateway should stay at service level only in project endpoint view.
    # Keep only service -> service dependencies for gateway prefixes.
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
            "source": f"service:{service}",
            "target": svc_id,
            "type": "depends_on",
            "direction": "forward",
            "weight": 0.7,
        }
        edges_by_key[(dep_edge["source"], dep_edge["target"], dep_edge["type"])] = dep_edge

    # Callout-driven mapping from leaf outbound calls (evidence-based):
    # 1) create service->service dependency
    # 2) create endpoint->endpoint routes when we can map source endpoint candidates
    #    by method + semantic keyword against source service endpoints.
    endpoints_by_service: dict[str, list[dict[str, Any]]] = {}
    endpoints_by_source_node_id: dict[str, dict[str, Any]] = {}
    for ep in all_eps:
        svc = str(ep.get("service", ""))
        endpoints_by_service.setdefault(svc, []).append(ep)
        src_node_id = str(ep.get("sourceNodeId", "")).strip()
        if src_node_id:
            endpoints_by_source_node_id[src_node_id] = ep

    endpoints_index: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for ep in all_eps:
        m = str(ep.get("method", "UNKNOWN")).upper()
        p = str(ep.get("canonicalPath", ""))
        if not p:
            continue
        endpoints_index.setdefault((m, p), []).append(ep)
        if m == "UNKNOWN":
            endpoints_index.setdefault(("ANY", p), []).append(ep)

    def infer_target_services_from_path(path: str) -> set[str]:
        candidates: set[str] = set()
        low = path.lower()
        if "/activity" in low:
            candidates.add("ms-activity")
        if "shipping" in low or "/delivery" in low or "waybill" in low:
            candidates.add("ms-shipping")
        if "/stock" in low or "reservation" in low:
            candidates.add("ms-stock")
        if "/order" in low and "/interface/" in low:
            candidates.add("ms-order")
        return candidates

    for co in all_callouts:
        src_service = str(co.get("service", ""))
        method = str(co.get("method", "UNKNOWN")).upper()
        canonical = str(co.get("canonicalPath", ""))
        if not src_service or not canonical:
            continue

        direct_candidates = endpoints_index.get((method, canonical), [])
        if method == "UNKNOWN":
            direct_candidates = endpoints_index.get(("ANY", canonical), [])
        target_eps = [ep for ep in direct_candidates if str(ep.get("service", "")) != src_service]

        if not target_eps:
            inferred_services = infer_target_services_from_path(canonical)
            target_eps = [
                ep
                for ep in all_eps
                if str(ep.get("service", "")) in inferred_services
                and str(ep.get("canonicalPath", "")) == canonical
                and (method == "UNKNOWN" or str(ep.get("method", "UNKNOWN")).upper() in {method, "UNKNOWN"})
            ]

        if not target_eps:
            continue

        callout_actions = [str(a).strip() for a in co.get("businessActions", []) if str(a).strip()]

        # Service dependencies
        for tgt_ep in target_eps:
            tgt_service = str(tgt_ep.get("service", ""))
            if not tgt_service or tgt_service == src_service:
                continue
            s_edge = {
                "source": f"service:{src_service}",
                "target": f"service:{tgt_service}",
                "type": "depends_on",
                "direction": "forward",
                "weight": 0.9,
            }
            if s_edge["source"] in nodes_by_id and s_edge["target"] in nodes_by_id:
                edges_by_key[(s_edge["source"], s_edge["target"], s_edge["type"])] = s_edge

        # Endpoint->endpoint routes: choose source endpoints within src service
        # that best match the callout semantic keyword.
        src_eps = endpoints_by_service.get(src_service, [])
        fn_low = str(co.get("function", "")).lower()
        keyword = ""
        for token in ("quotation", "waybill", "order-to-ship", "activity", "delivery"):
            if token in canonical.lower() or token in fn_low:
                keyword = token
                break
        if not keyword and canonical:
            keyword = canonical.rstrip("/").split("/")[-1]

        source_candidates = []
        source_endpoint_node_ids = [
            str(v).strip()
            for v in co.get("sourceEndpointNodeIds", [])
            if str(v).strip()
        ]
        for src_node_id in source_endpoint_node_ids:
            mapped = endpoints_by_source_node_id.get(src_node_id)
            if mapped and str(mapped.get("service", "")) == src_service:
                source_candidates.append(mapped)

        if not source_candidates:
            source_candidates = [
                ep for ep in src_eps
                if (method == "UNKNOWN" or str(ep.get("method", "UNKNOWN")).upper() in {method, "UNKNOWN"})
                and (keyword.lower() in str(ep.get("canonicalPath", "")).lower())
            ]

        if not source_candidates:
            continue

        for src_ep in source_candidates:
            for tgt_ep in target_eps:
                if str(src_ep.get("service", "")) == str(tgt_ep.get("service", "")):
                    continue
                r_edge = {
                    "source": str(src_ep.get("id", "")),
                    "target": str(tgt_ep.get("id", "")),
                    "type": "routes",
                    "direction": "forward",
                    "weight": 0.85,
                }
                if r_edge["source"] and r_edge["target"]:
                    edges_by_key[(r_edge["source"], r_edge["target"], r_edge["type"])] = r_edge
                    src_node = nodes_by_id.get(r_edge["source"])
                    tgt_node = nodes_by_id.get(r_edge["target"])
                    for node in (src_node, tgt_node):
                        if not isinstance(node, dict):
                            continue
                        dm = node.get("domainMeta")
                        if not isinstance(dm, dict):
                            continue
                        current = [str(a).strip() for a in dm.get("businessActions", []) if str(a).strip()]
                        merged = sorted(set(current + callout_actions))
                        dm["businessActions"] = merged
                        dm["useCases"] = merged

    # Mark endpoint connectivity metadata from built connector edges.
    endpoint_connected_ids: set[str] = set()
    for edge in edges_by_key.values():
        et = edge.get("type")
        src = str(edge.get("source", ""))
        tgt = str(edge.get("target", ""))
        if et == "routes":
            if src.startswith("endpoint:"):
                endpoint_connected_ids.add(src)
            if tgt.startswith("endpoint:"):
                endpoint_connected_ids.add(tgt)
        elif et == "depends_on":
            # endpoint -> service fallback connectivity
            if src.startswith("endpoint:"):
                endpoint_connected_ids.add(src)

    for node in nodes_by_id.values():
        if node.get("type") != "endpoint":
            continue
        dm = node.get("domainMeta")
        if not isinstance(dm, dict):
            continue
        dm["crossServiceConnected"] = node["id"] in endpoint_connected_ids

    # Service-level cross-domain dependencies from project domain graph.
    domain_graph_path = project_root / ".understand-anything" / "domain-graph.json"
    if domain_graph_path.exists():
        try:
            dg = load_json(domain_graph_path)
            domain_nodes = {
                str(n.get("id", "")): str(n.get("name", "")).strip().lower()
                for n in dg.get("nodes", [])
                if isinstance(n, dict) and n.get("type") == "domain"
            }

            def domain_id_to_service(domain_id: str) -> str:
                if domain_id.startswith("domain:"):
                    suffix = domain_id.split(":", 1)[1]
                    return f"service:ms-{suffix}"
                return ""

            # Direct domain cross links.
            for e in dg.get("edges", []):
                if not isinstance(e, dict):
                    continue
                if str(e.get("type", "")) != "cross_domain":
                    continue
                src = str(e.get("source", ""))
                tgt = str(e.get("target", ""))
                src_svc = domain_id_to_service(src)
                tgt_svc = domain_id_to_service(tgt)
                if src_svc in nodes_by_id and tgt_svc in nodes_by_id and src_svc != tgt_svc:
                    dep = {
                        "source": src_svc,
                        "target": tgt_svc,
                        "type": "depends_on",
                        "direction": "forward",
                        "weight": 0.8,
                    }
                    edges_by_key[(dep["source"], dep["target"], dep["type"])] = dep

            # Journey-flow fallback: order->shipping from canonical top-level flow names.
            flow_nodes = [
                n for n in dg.get("nodes", [])
                if isinstance(n, dict) and n.get("type") == "flow"
            ]
            for flow in flow_nodes:
                flow_name = str(flow.get("name", "")).lower()
                flow_id = str(flow.get("id", "")).lower()
                text = f"{flow_name} {flow_id}"
                if "order" in text and "shipping" in text:
                    src_svc = "service:ms-order"
                    tgt_svc = "service:ms-shipping"
                    if src_svc in nodes_by_id and tgt_svc in nodes_by_id:
                        dep = {
                            "source": src_svc,
                            "target": tgt_svc,
                            "type": "depends_on",
                            "direction": "forward",
                            "weight": 0.85,
                        }
                        edges_by_key[(dep["source"], dep["target"], dep["type"])] = dep
        except Exception:
            # Keep API mapping resilient even when domain graph is malformed.
            pass

    now = datetime.now(timezone.utc).isoformat()
    graph = {
        "version": "1.0.0",
        "project": {
            "name": resolve_project_name(project_root),
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
