import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import CustomNode from "./CustomNode";
import type { CustomFlowNode } from "./CustomNode";
import { useDashboardStore } from "../store";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import type { GraphEdge, GraphNode } from "@understand-anything/core/types";

const nodeTypes = { custom: CustomNode };

function normalizedProjectPath(path: string): string {
  const p = (path || "").trim();
  if (!p) return p;
  const m = p.match(/^\/(order|stock|interface)(\/.*)$/);
  return m ? m[2] : p;
}

function toCustomNode(
  node: GraphNode,
  onClick: (id: string) => void,
  isSelectionFaded = false,
): CustomFlowNode {
  return {
    id: node.id,
    type: "custom",
    position: { x: 0, y: 0 },
    data: {
      label: node.name ?? node.id,
      nodeType: node.type,
      summary: node.summary,
      complexity: node.complexity,
      isHighlighted: false,
      isSelected: false,
      isTourHighlighted: false,
      isDiffChanged: false,
      isDiffAffected: false,
      isDiffFaded: false,
      isImpactSeed: false,
      isImpactUpstream: false,
      isImpactDownstream: false,
      isImpactFaded: false,
      isNeighbor: false,
      isSelectionFaded,
      onNodeClick: onClick,
    },
  };
}

function toFlowEdge(edge: GraphEdge, idx: number): Edge {
  return {
    id: `ep-${idx}-${edge.source}-${edge.target}-${edge.type}`,
    source: edge.source,
    target: edge.target,
    label: edge.type.replace(/_/g, " "),
    animated: edge.type === "routes",
    style: {
      stroke:
        edge.type === "routes"
          ? "var(--color-accent)"
          : edge.type === "depends_on"
            ? "var(--color-border-medium)"
            : "rgba(212,165,116,0.45)",
      strokeDasharray: edge.type === "depends_on" ? "5 3" : undefined,
      strokeWidth: edge.type === "routes" ? 2 : 1.5,
    },
    labelStyle: { fill: "var(--color-text-muted)", fontSize: 10 },
    labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.9 },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
  };
}

function EndpointGraphViewInner() {
  const endpointGraph = useDashboardStore((s) => s.endpointGraph);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);

  const built = useMemo(() => {
    if (!endpointGraph) return null;
    const allServices = endpointGraph.nodes.filter((n) => n.type === "service");
    const allEndpoints = endpointGraph.nodes.filter((n) => n.type === "endpoint");
    const nodeById = new Map(endpointGraph.nodes.map((n) => [n.id, n]));
    const edges = endpointGraph.edges;

    const isEndpointVisibleDefault = (node: GraphNode): boolean => {
      if (node.type !== "endpoint") return true;
      const meta = (node.domainMeta ?? {}) as Record<string, unknown>;
      const connected = meta.crossServiceConnected;
      const hidden = meta.hiddenByDefault;
      return connected === true && hidden !== true;
    };

    const onNodeClick = (id: string) => {
      const node = nodeById.get(id);
      if (!node) return;
      if (node.type === "service") {
        setActiveServiceId((prev) => (prev === id ? null : id));
      } else {
        selectNode(id);
      }
    };

    const visibleNodes = new Map<string, GraphNode>();
    const visibleEdges: GraphEdge[] = [];
    const highlightNodeIds = new Set<string>();

    // Overview: show only service nodes.
    if (!activeServiceId) {
      for (const service of allServices) visibleNodes.set(service.id, service);
      for (const edge of edges) {
        if (edge.source.startsWith("service:") && edge.target.startsWith("service:")) {
          visibleEdges.push(edge);
        }
      }
    } else {
      // Focused: keep all services visible (dim unrelated), expand connectors for selected service.
      for (const service of allServices) visibleNodes.set(service.id, service);
      highlightNodeIds.add(activeServiceId);

      // 1) Selected service -> served endpoints
      const servedEndpointIds = new Set<string>();
      for (const edge of edges) {
        if (edge.type === "serves" && edge.source === activeServiceId) {
          const endpointNode = nodeById.get(edge.target);
          if (endpointNode && isEndpointVisibleDefault(endpointNode)) {
            servedEndpointIds.add(edge.target);
          }
          visibleEdges.push(edge);
        }
      }

      // 2) For each served endpoint, collect direct connector edges + related service nodes
      for (const endpointId of servedEndpointIds) {
        const endpointNode = allEndpoints.find((n) => n.id === endpointId);
        if (!endpointNode) continue;
        visibleNodes.set(endpointId, endpointNode);
        highlightNodeIds.add(endpointId);
        const endpointMeta = (endpointNode.domainMeta ?? {}) as Record<string, unknown>;
        const endpointCanonical = normalizedProjectPath(String(endpointMeta.canonicalPath ?? endpointMeta.path ?? ""));

        for (const edge of edges) {
          if (edge.source !== endpointId && edge.target !== endpointId) continue;
          const otherId = edge.source === endpointId ? edge.target : edge.source;
          const otherNode = nodeById.get(otherId);
          if (!otherNode) continue;

          // Keep endpoint connector edges and any link to a service.
          if (
            edge.type === "depends_on" ||
            edge.type === "routes" ||
            edge.type === "implements" ||
            edge.type === "configures" ||
            otherNode.type === "service"
          ) {
            // Avoid duplicate visual endpoints when gateway-prefixed and backend
            // endpoints represent the same canonical business path.
            if (otherNode.type === "endpoint") {
              const otherMeta = (otherNode.domainMeta ?? {}) as Record<string, unknown>;
              const otherCanonical = normalizedProjectPath(String(otherMeta.canonicalPath ?? otherMeta.path ?? ""));
              const otherHidden = otherMeta.hiddenByDefault === true;
              if (otherHidden && endpointCanonical && otherCanonical && endpointCanonical === otherCanonical) {
                continue;
              }
            }
            visibleEdges.push(edge);
            visibleNodes.set(otherNode.id, otherNode);
            highlightNodeIds.add(otherNode.id);
          }
        }
      }
    }

    const dims = new Map<string, { width: number; height: number }>();
    const nodes: Node[] = [...visibleNodes.values()].map((node) => {
      const isService = node.type === "service";
      dims.set(node.id, { width: isService ? 250 : 220, height: isService ? 130 : 120 });
      const faded = Boolean(activeServiceId) && !highlightNodeIds.has(node.id);
      return toCustomNode(node, onNodeClick, faded) as unknown as Node;
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    const graphEdges: Edge[] = visibleEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, i) => toFlowEdge(e, i));
    return { nodes, edges: graphEdges, dims };
  }, [endpointGraph, selectNode, activeServiceId]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (!built) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    let cancelled = false;
    const elkInput = nodesToElkInput(built.nodes, built.edges, built.dims, {
      "elk.direction": "RIGHT",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    });
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        setLayout({
          nodes: mergeElkPositions(built.nodes, positioned),
          edges: built.edges,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[endpoint ELK] layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  if (!endpointGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No endpoint graph available. Run /understand-project-api-mapping to generate one.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        key={`endpoint-${activeServiceId ?? "overview"}`}
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-subtle)"
        />
        <Controls />
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
      </ReactFlow>
      {activeServiceId && (
        <div className="absolute top-3 left-3 z-10">
          <button
            type="button"
            onClick={() => setActiveServiceId(null)}
            className="px-3 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
          >
            Back to services
          </button>
        </div>
      )}
    </div>
  );
}

export default function EndpointGraphView() {
  return (
    <ReactFlowProvider>
      <EndpointGraphViewInner />
    </ReactFlowProvider>
  );
}
