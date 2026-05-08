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

function toCustomNode(node: GraphNode, onClick: (id: string) => void): CustomFlowNode {
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
      isSelectionFaded: false,
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

  const built = useMemo(() => {
    if (!endpointGraph) return null;
    const dims = new Map<string, { width: number; height: number }>();
    const nodes: Node[] = endpointGraph.nodes.map((node) => {
      dims.set(node.id, { width: 220, height: 120 });
      return toCustomNode(node, selectNode) as unknown as Node;
    });
    const nodeIds = new Set(endpointGraph.nodes.map((n) => n.id));
    const edges: Edge[] = endpointGraph.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, i) => toFlowEdge(e, i));
    return { nodes, edges, dims };
  }, [endpointGraph, selectNode]);

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
    <div className="h-full w-full">
      <ReactFlow
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
