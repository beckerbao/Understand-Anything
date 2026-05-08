#!/usr/bin/env python3
"""
Merge a semantic project-analysis graph into the project root's master
knowledge-graph.json, preserving any existing master graph as a base.

Usage:
    python merge-project-knowledge.py <project-root> <analysis-path>
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ALLOWED_NODE_TYPES = {"document", "domain", "flow", "step", "concept", "config"}
ALLOWED_EDGE_TYPES = {"contains", "contains_flow", "flow_step", "cross_domain", "depends_on", "documents", "related"}


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_graph(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Skipping {path.name}: {e}", file=sys.stderr)
        return None

    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        print(f"  Skipping {path.name}: missing nodes or edges array", file=sys.stderr)
        return None
    return data


def validate_top_level_graph(graph: dict[str, Any]) -> list[str]:
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
    if not isinstance(nodes, list):
        issues.append("nodes must be an array")
        nodes = []
    if not isinstance(edges, list):
        issues.append("edges must be an array")
        edges = []
    if not isinstance(graph.get("layers"), list):
        issues.append("layers must be an array")
    if not isinstance(graph.get("tour"), list):
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


def normalize_graph(graph: dict[str, Any]) -> dict[str, Any]:
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    graph["nodes"] = sorted(
        [n for n in nodes if isinstance(n, dict)],
        key=lambda n: (
            str(n.get("type", "")),
            str(n.get("name", "")),
            str(n.get("id", "")),
        ),
    )
    graph["edges"] = sorted(
        [e for e in edges if isinstance(e, dict)],
        key=lambda e: (
            str(e.get("type", "")),
            str(e.get("source", "")),
            str(e.get("target", "")),
        ),
    )
    graph["layers"] = sorted(
        [l for l in graph.get("layers", []) if isinstance(l, dict)],
        key=lambda l: str(l.get("id", "")),
    )
    graph["tour"] = sorted(
        [t for t in graph.get("tour", []) if isinstance(t, dict)],
        key=lambda t: int(t.get("order", 0) or 0),
    )
    return graph


def merge_graphs(graphs: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    node_dedup_by_type: Counter[str] = Counter()
    dropped_edge_type_counts: Counter[str] = Counter()
    unfixable: list[str] = []

    total_input_nodes = sum(len(g.get("nodes", [])) for g in graphs)
    total_input_edges = sum(len(g.get("edges", [])) for g in graphs)

    nodes_by_id: dict[str, dict] = {}
    for g in graphs:
        for node in g.get("nodes", []):
            nid = node.get("id")
            if not nid:
                unfixable.append(f"Node with no 'id' (name={node.get('name', '?')}, type={node.get('type', '?')})")
                continue
            if nid in nodes_by_id:
                node_dedup_by_type[node.get("type", "?")] += 1
            nodes_by_id[nid] = node

    edges_by_key: dict[tuple[str, str, str], dict] = {}
    edge_dedup_count = 0
    for g in graphs:
        for edge in g.get("edges", []):
            edge_type = edge.get("type", "")
            if edge_type not in ALLOWED_EDGE_TYPES:
                dropped_edge_type_counts[str(edge_type or "unknown")] += 1
                continue
            key = (edge.get("source", ""), edge.get("target", ""), edge.get("type", ""))
            existing = edges_by_key.get(key)
            if existing is None:
                edges_by_key[key] = edge
            else:
                edge_dedup_count += 1
                if _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
                    edges_by_key[key] = edge

    node_ids = set(nodes_by_id.keys())
    valid_edges: list[dict] = []
    for e in edges_by_key.values():
        src, tgt = e.get("source", ""), e.get("target", "")
        if src in node_ids and tgt in node_ids:
            valid_edges.append(e)
        else:
            missing = []
            if src not in node_ids:
                missing.append(f"source '{src}'")
            if tgt not in node_ids:
                missing.append(f"target '{tgt}'")
            unfixable.append(f"Edge {src} → {tgt} ({e.get('type', '?')}): dropped, missing {', '.join(missing)}")

    layers_by_id: dict[str, dict] = {}
    for g in graphs:
        for layer in g.get("layers", []):
            lid = layer.get("id", "")
            if lid in layers_by_id:
                existing_ids = set(layers_by_id[lid].get("nodeIds", []))
                existing_ids.update(layer.get("nodeIds", []))
                layers_by_id[lid]["nodeIds"] = list(existing_ids)
            else:
                layers_by_id[lid] = {**layer}

    for layer in layers_by_id.values():
        layer["nodeIds"] = [nid for nid in layer.get("nodeIds", []) if nid in node_ids]

    # Ensure the top-level graph still has something visible in structural
    # overview mode even when the federated project concepts do not belong
    # to any inherited leaf layer. This keeps canonical nodes like
    # `domain:stock` reachable on the canvas instead of only via search.
    synthetic_layer_id = "layer:project-federation"
    synthetic_node_ids = [
        nid
        for nid, node in nodes_by_id.items()
        if node.get("type") in ALLOWED_NODE_TYPES
        and node.get("type") != "config"
    ]
    if synthetic_node_ids:
        existing = layers_by_id.get(synthetic_layer_id)
        if existing is None:
            layers_by_id[synthetic_layer_id] = {
                "id": synthetic_layer_id,
                "name": "Project Federation",
                "description": "Canonical top-level domains, flows, steps, concepts, and project docs federated from leaf graphs.",
                "nodeIds": synthetic_node_ids,
            }
        else:
            merged_ids = set(existing.get("nodeIds", []))
            merged_ids.update(synthetic_node_ids)
            existing["nodeIds"] = list(merged_ids)

    # Synthetic cross-domain journey: order -> shipping -> interface.
    # This is intentionally conservative and only activates when the three
    # canonical domains exist together in the merged graph.
    order_id = "domain:order" if "domain:order" in node_ids else None
    shipping_id = "domain:shipping" if "domain:shipping" in node_ids else None
    interface_id = "domain:interface" if "domain:interface" in node_ids else None
    journey_flow_id = "flow:order-to-shipping-request-path"
    if order_id and shipping_id and interface_id:
        journey_nodes = [
            {
                "id": journey_flow_id,
                "type": "flow",
                "name": "Order To Shipping Request Path",
                "summary": "Canonical end-to-end journey from request intake through order handling, shipping handoff, and downstream orchestration across the interface layer.",
                "tags": ["flow", "journey", "order", "shipping", "interface"],
                "complexity": "moderate",
            },
            {
                "id": "step:order-to-shipping-request-path:authenticate-request",
                "type": "step",
                "name": "Authenticate Request",
                "summary": "Authenticate and validate the inbound request before entering the order path.",
                "tags": ["step", "interface", "order"],
                "complexity": "simple",
            },
            {
                "id": "step:order-to-shipping-request-path:validate-order",
                "type": "step",
                "name": "Validate Order",
                "summary": "Validate order rules and confirm the order can proceed to shipment.",
                "tags": ["step", "order"],
                "complexity": "simple",
            },
            {
                "id": "step:order-to-shipping-request-path:handoff-to-shipping",
                "type": "step",
                "name": "Handoff To Shipping",
                "summary": "Transfer the accepted order into the shipping domain boundary.",
                "tags": ["step", "order", "shipping"],
                "complexity": "simple",
            },
            {
                "id": "step:order-to-shipping-request-path:create-shipment",
                "type": "step",
                "name": "Create Shipment",
                "summary": "Create the shipment record and downstream logistics state.",
                "tags": ["step", "shipping"],
                "complexity": "simple",
            },
        ]
        for node in journey_nodes:
            nodes_by_id[node["id"]] = node

        journey_edges = [
            {
                "source": "domain:interface",
                "target": journey_flow_id,
                "type": "contains_flow",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": journey_flow_id,
                "target": "step:order-to-shipping-request-path:authenticate-request",
                "type": "flow_step",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": journey_flow_id,
                "target": "step:order-to-shipping-request-path:validate-order",
                "type": "flow_step",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": journey_flow_id,
                "target": "step:order-to-shipping-request-path:handoff-to-shipping",
                "type": "flow_step",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": journey_flow_id,
                "target": "step:order-to-shipping-request-path:create-shipment",
                "type": "flow_step",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": "step:order-to-shipping-request-path:authenticate-request",
                "target": "concept:interface-contract-governance",
                "type": "related",
                "direction": "forward",
                "weight": 0.9,
            },
            {
                "source": "step:order-to-shipping-request-path:validate-order",
                "target": "domain:order",
                "type": "related",
                "direction": "forward",
                "weight": 0.9,
            },
            {
                "source": "step:order-to-shipping-request-path:handoff-to-shipping",
                "target": "concept:shipping-handoff-governance",
                "type": "related",
                "direction": "forward",
                "weight": 0.95,
            },
            {
                "source": "step:order-to-shipping-request-path:create-shipment",
                "target": "domain:shipping",
                "type": "related",
                "direction": "forward",
                "weight": 0.9,
            },
            {
                "source": "concept:interface-contract-governance",
                "target": "domain:interface",
                "type": "cross_domain",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": "concept:shipping-handoff-governance",
                "target": "domain:shipping",
                "type": "cross_domain",
                "direction": "forward",
                "weight": 1.0,
            },
            {
                "source": "concept:shipping-handoff-governance",
                "target": "domain:order",
                "type": "depends_on",
                "direction": "forward",
                "weight": 0.9,
            },
        ]
        for edge in journey_edges:
            key = (edge["source"], edge["target"], edge["type"])
            if key not in edges_by_key and edge["source"] in nodes_by_id and edge["target"] in nodes_by_id:
                edges_by_key[key] = edge
        synthetic_layer = layers_by_id.get(synthetic_layer_id)
        if synthetic_layer is not None:
            ids = set(synthetic_layer.get("nodeIds", []))
            ids.update(node["id"] for node in journey_nodes)
            synthetic_layer["nodeIds"] = list(ids)
        else:
            layers_by_id[synthetic_layer_id] = {
                "id": synthetic_layer_id,
                "name": "Project Federation",
                "description": "Canonical top-level domains, flows, steps, concepts, and project docs federated from leaf graphs.",
                "nodeIds": [node["id"] for node in journey_nodes],
            }

    all_tour_steps: list[dict] = []
    title_to_step: dict[str, dict] = {}
    for g in graphs:
        for step in g.get("tour", []):
            title = step.get("title", "")
            if title in title_to_step:
                existing = title_to_step[title]
                for nid in step.get("nodeIds", []):
                    if nid not in existing.get("nodeIds", []):
                        existing.setdefault("nodeIds", []).append(nid)
                if len(step.get("description", "")) > len(existing.get("description", "")):
                    existing["description"] = step["description"]
            else:
                new_step = {**step}
                title_to_step[title] = new_step
                all_tour_steps.append(new_step)

    for i, step in enumerate(all_tour_steps, start=1):
        step["order"] = i
        step["nodeIds"] = [nid for nid in step.get("nodeIds", []) if nid in node_ids]

    languages: list[str] = []
    frameworks: list[str] = []
    descriptions: list[str] = []
    latest_at = ""
    latest_hash = ""
    project_name = ""

    for g in graphs:
        proj = g.get("project", {})
        project_name = proj.get("name", "") or project_name
        for lang in proj.get("languages", []):
            if lang not in languages:
                languages.append(lang)
        for fw in proj.get("frameworks", []):
            if fw not in frameworks:
                frameworks.append(fw)
        desc = proj.get("description", "")
        if desc and desc not in descriptions:
            descriptions.append(desc)
        analyzed = proj.get("analyzedAt", "")
        if analyzed > latest_at:
            latest_at = analyzed
            latest_hash = proj.get("gitCommitHash", latest_hash)

    report: list[str] = []
    report.append(f"Input: {total_input_nodes} nodes, {total_input_edges} edges (from {len(graphs)} graphs)")
    fixed_lines: list[str] = []
    if node_dedup_by_type:
        for ntype, count in node_dedup_by_type.most_common():
            fixed_lines.append(f"  {count:>4} × duplicate '{ntype}' nodes removed (kept later)")
    if edge_dedup_count:
        fixed_lines.append(f"  {edge_dedup_count:>4} × duplicate edges removed (kept higher weight)")
    if dropped_edge_type_counts:
        for etype, count in dropped_edge_type_counts.most_common():
            fixed_lines.append(f"  {count:>4} × unsupported '{etype}' edges dropped for top-level output")
    if fixed_lines:
        total_fixed = sum(node_dedup_by_type.values()) + edge_dedup_count + sum(dropped_edge_type_counts.values())
        report.append("")
        report.append(f"Fixed ({total_fixed} corrections):")
        report.extend(fixed_lines)
    if unfixable:
        report.append("")
        report.append(f"Could not fix ({len(unfixable)} issues — needs agent review):")
        for detail in unfixable:
            report.append(f"  - {detail}")
    report.append("")
    report.append(f"Output: {len(nodes_by_id)} nodes, {len(valid_edges)} edges, {len(layers_by_id)} layers, {len(all_tour_steps)} tour steps")

    merged: dict[str, Any] = {
        "version": "1.0.0",
        "project": {
            "name": project_name,
            "languages": languages,
            "frameworks": frameworks,
            "description": "; ".join(descriptions) if descriptions else "",
            "analyzedAt": latest_at,
            "gitCommitHash": latest_hash,
        },
        "nodes": list(nodes_by_id.values()),
        "edges": valid_edges,
        "layers": list(layers_by_id.values()),
        "tour": all_tour_steps,
    }
    return merged, report


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: merge-project-knowledge.py <project-root> <analysis-path>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    analysis_path = Path(sys.argv[2]).resolve()
    ua_dir = project_root / ".understand-anything"
    output_path = ua_dir / "knowledge-graph.json"

    if not ua_dir.is_dir():
        print(f"Error: {ua_dir} does not exist", file=sys.stderr)
        sys.exit(1)
    if not analysis_path.exists():
        print(f"Error: analysis graph not found at {analysis_path}", file=sys.stderr)
        sys.exit(1)

    graphs: list[dict[str, Any]] = []
    if output_path.exists():
        base = load_graph(output_path)
        if base:
            graphs.append(base)

    analysis = load_graph(analysis_path)
    if not analysis:
        print(f"Error: invalid analysis graph at {analysis_path}", file=sys.stderr)
        sys.exit(1)
    analysis_issues = validate_top_level_graph(analysis)
    if analysis_issues:
        print(f"Error: analysis graph does not match top-level schema: {analysis_path}", file=sys.stderr)
        for issue in analysis_issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)
    graphs.append(analysis)

    merged, report = merge_graphs(graphs)
    merged = normalize_graph(merged)
    merged_issues = validate_top_level_graph(merged)
    if merged_issues:
        print("Error: merged graph does not satisfy the top-level schema", file=sys.stderr)
        for issue in merged_issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    output_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    print("", file=sys.stderr)
    for line in report:
        print(line, file=sys.stderr)
    print(f"\nWritten to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
