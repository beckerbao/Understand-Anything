import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import { applyDagreLayout, applyDagreLayoutAsync, NODE_WIDTH, NODE_HEIGHT } from "../utils/layout";

const LAYER_PADDING = 40;

/**
 * Node count above which layout runs in a Web Worker
 * to avoid blocking the main thread.
 */
const ASYNC_LAYOUT_THRESHOLD = 200;

const nodeTypes = { custom: CustomNode };

/**
 * Inner component that pans/zooms to tour-highlighted nodes.
 * Must be rendered inside <ReactFlow> so useReactFlow() works.
 */
function TourFitView() {
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const { fitView } = useReactFlow();
  const prevRef = useRef<string[]>([]);

  useEffect(() => {
    const prev = prevRef.current;
    const changed =
      tourHighlightedNodeIds.length > 0 &&
      (tourHighlightedNodeIds.length !== prev.length ||
        tourHighlightedNodeIds.some((id, i) => id !== prev[i]));
    prevRef.current = tourHighlightedNodeIds;

    if (changed) {
      // Small delay to ensure nodes are rendered before fitting
      requestAnimationFrame(() => {
        fitView({
          nodes: tourHighlightedNodeIds.map((id) => ({ id })),
          duration: 500,
          padding: 0.3,
          maxZoom: 1.2,
          minZoom: 0.01,
        });
      });
    }
  }, [tourHighlightedNodeIds, fitView]);

  return null;
}

/**
 * Centers the graph on the selected node (e.g. from search).
 * Must be rendered inside <ReactFlow> so useReactFlow() works.
 */
function SelectedNodeFitView() {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const { fitView } = useReactFlow();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== prevRef.current) {
      requestAnimationFrame(() => {
        fitView({
          nodes: [{ id: selectedNodeId }],
          duration: 500,
          padding: 0.3,
          maxZoom: 1.2,
          minZoom: 0.01,
        });
      });
    }
    prevRef.current = selectedNodeId;
  }, [selectedNodeId, fitView]);

  return null;
}

/**
 * Build topology-only flow data: nodes and edges without visual-only state
 * (selection, tour highlights, search results). This output drives dagre
 * layout and should only recompute when the graph structure changes.
 */
function buildTopologyData(
  graph: NonNullable<ReturnType<typeof useDashboardStore.getState>["graph"]>,
  persona: string,
  diffMode: boolean,
  changedNodeIds: Set<string>,
  affectedNodeIds: Set<string>,
  handleNodeSelect: (nodeId: string) => void,
) {
  const filteredGraphNodes =
    persona === "non-technical"
      ? graph.nodes.filter(
          (n) =>
            n.type === "concept" || n.type === "module" || n.type === "file",
        )
      : graph.nodes;

  const filteredNodeIds = new Set(filteredGraphNodes.map((n) => n.id));
  const filteredGraphEdges =
    persona === "non-technical"
      ? graph.edges.filter(
          (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
        )
      : graph.edges;

  const flowNodes: CustomFlowNode[] = filteredGraphNodes.map((node) => ({
    id: node.id,
    type: "custom" as const,
    position: { x: 0, y: 0 },
    data: {
      label: node.name ?? node.filePath?.split("/").pop() ?? node.id,
      nodeType: node.type,
      summary: node.summary,
      complexity: node.complexity,
      isHighlighted: false,
      searchScore: undefined,
      isSelected: false,
      isTourHighlighted: false,
      isDiffChanged: diffMode && changedNodeIds.has(node.id),
      isDiffAffected: diffMode && affectedNodeIds.has(node.id),
      isDiffFaded: diffMode && !changedNodeIds.has(node.id) && !affectedNodeIds.has(node.id),
      onNodeClick: handleNodeSelect,
    },
  }));

  const diffNodeIds = diffMode ? new Set([...changedNodeIds, ...affectedNodeIds]) : new Set<string>();
  const flowEdges: Edge[] = filteredGraphEdges.map((edge, i) => {
    const sourceInDiff = diffMode && diffNodeIds.has(edge.source);
    const targetInDiff = diffMode && diffNodeIds.has(edge.target);
    const isImpacted = diffMode && (sourceInDiff || targetInDiff);

    return {
      id: `e-${i}`,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      animated: edge.type === "calls" || isImpacted,
      style: isImpacted
        ? {
            stroke: sourceInDiff && targetInDiff
              ? "rgba(224, 82, 82, 0.7)"
              : "rgba(212, 160, 48, 0.5)",
            strokeWidth: 2.5,
          }
        : diffMode
          ? { stroke: "rgba(212,165,116,0.08)", strokeWidth: 1 }
          : { stroke: "rgba(212,165,116,0.3)", strokeWidth: 1.5 },
      labelStyle: diffMode && !isImpacted
        ? { fill: "rgba(163,151,135,0.3)", fontSize: 10 }
        : { fill: "#a39787", fontSize: 10 },
    };
  });

  return { flowNodes, flowEdges };
}

/**
 * Lightweight overlay of visual-only state onto already-positioned nodes.
 * This is O(n) object spreads — cheap even for thousands of nodes — and
 * avoids triggering a dagre relayout when selection/highlight/search changes.
 */
function applyVisualState(
  nodes: (CustomFlowNode | Node)[],
  selectedNodeId: string | null,
  tourHighlightedNodeIds: string[],
  searchResults: Array<{ nodeId: string; score: number }>,
): (CustomFlowNode | Node)[] {
  const searchMap = new Map(searchResults.map((r) => [r.nodeId, r.score]));
  const tourSet = new Set(tourHighlightedNodeIds);

  return nodes.map((node) => {
    // Skip group nodes (layer containers) — they have no CustomNodeData
    if (node.type === "group") return node;

    const searchScore = searchMap.get(node.id);
    const isHighlighted = searchScore !== undefined;
    const isSelected = selectedNodeId === node.id;
    const isTourHighlighted = tourSet.has(node.id);

    const data = node.data as CustomFlowNode["data"];

    // Skip creating a new object if nothing visual changed
    if (
      data.isHighlighted === isHighlighted &&
      data.searchScore === searchScore &&
      data.isSelected === isSelected &&
      data.isTourHighlighted === isTourHighlighted
    ) {
      return node;
    }

    return {
      ...node,
      data: {
        ...data,
        isHighlighted,
        searchScore,
        isSelected,
        isTourHighlighted,
      },
    };
  });
}

function applyLayerGroups(
  laidNodes: CustomFlowNode[],
  edges: Edge[],
  layers: Array<{ id: string; name: string; nodeIds: string[] }>,
  showLayers: boolean,
): { initialNodes: (CustomFlowNode | Node)[]; initialEdges: Edge[] } {
  if (!showLayers || layers.length === 0) {
    return { initialNodes: laidNodes, initialEdges: edges };
  }

  const nodeToLayer = new Map<string, string>();
  for (const layer of layers) {
    for (const nodeId of layer.nodeIds) {
      nodeToLayer.set(nodeId, layer.id);
    }
  }

  const groupNodes: Node[] = [];
  const adjustedNodes: (CustomFlowNode | Node)[] = [];

  for (const layer of layers) {
    const memberNodes = laidNodes.filter((n) => layer.nodeIds.includes(n.id));
    if (memberNodes.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of memberNodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.position.y + NODE_HEIGHT);
    }

    const groupX = minX - LAYER_PADDING;
    const groupY = minY - LAYER_PADDING - 24;
    const groupWidth = maxX - minX + LAYER_PADDING * 2;
    const groupHeight = maxY - minY + LAYER_PADDING * 2 + 24;

    groupNodes.push({
      id: layer.id,
      type: "group",
      position: { x: groupX, y: groupY },
      data: { label: layer.name },
      style: {
        width: groupWidth,
        height: groupHeight,
        backgroundColor: "rgba(212,165,116,0.05)",
        borderRadius: 12,
        border: "2px dashed rgba(212,165,116,0.25)",
        padding: 8,
        fontSize: 13,
        fontWeight: 600,
        color: "#d4a574",
      },
    });

    for (const node of memberNodes) {
      adjustedNodes.push({
        ...node,
        parentId: layer.id,
        extent: "parent" as const,
        position: {
          x: node.position.x - groupX,
          y: node.position.y - groupY,
        },
      });
    }
  }

  for (const node of laidNodes) {
    if (!nodeToLayer.has(node.id)) {
      adjustedNodes.push(node);
    }
  }

  return {
    initialNodes: [...groupNodes, ...adjustedNodes],
    initialEdges: edges,
  };
}

function GraphViewInner() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const showLayers = useDashboardStore((s) => s.showLayers);
  const tourHighlightedNodeIds = useDashboardStore((s) => s.tourHighlightedNodeIds);
  const persona = useDashboardStore((s) => s.persona);
  const diffMode = useDashboardStore((s) => s.diffMode);
  const changedNodeIds = useDashboardStore((s) => s.changedNodeIds);
  const affectedNodeIds = useDashboardStore((s) => s.affectedNodeIds);

  const [layouting, setLayouting] = useState(false);

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      openCodeViewer(nodeId);
    },
    [selectNode, openCodeViewer],
  );

  // ── Topology memo: only recomputes when graph structure changes ──
  // Does NOT depend on selectedNodeId, tourHighlightedNodeIds, or searchResults.
  const { topoNodes, topoEdges, needsAsyncLayout } = useMemo(() => {
    if (!graph) {
      return { topoNodes: [] as CustomFlowNode[], topoEdges: [] as Edge[], needsAsyncLayout: false };
    }
    const { flowNodes, flowEdges } = buildTopologyData(
      graph, persona, diffMode, changedNodeIds, affectedNodeIds,
      handleNodeSelect,
    );
    return { topoNodes: flowNodes, topoEdges: flowEdges, needsAsyncLayout: flowNodes.length > ASYNC_LAYOUT_THRESHOLD };
  }, [graph, persona, handleNodeSelect, diffMode, changedNodeIds, affectedNodeIds]);

  // ── Laid-out nodes from the last completed layout pass ──
  // Stored in a ref so layout results persist across visual-state changes.
  const laidOutRef = useRef<{ initialNodes: (CustomFlowNode | Node)[]; initialEdges: Edge[] } | null>(null);

  // ── Sync layout: for small graphs, run dagre on the main thread ──
  const syncResult = useMemo(() => {
    if (!graph || needsAsyncLayout || topoNodes.length === 0) return null;
    const laid = applyDagreLayout(topoNodes, topoEdges);
    const layers = graph.layers ?? [];
    return applyLayerGroups(laid.nodes as CustomFlowNode[], laid.edges, layers, showLayers);
  }, [graph, topoNodes, topoEdges, needsAsyncLayout, showLayers]);

  // Keep laidOutRef in sync with sync layout results
  if (syncResult) {
    laidOutRef.current = syncResult;
  }

  // ── Visual memo: cheap overlay of selection/highlight/search state ──
  const visualNodes = useMemo(() => {
    const base = laidOutRef.current;
    if (!base) return [] as (CustomFlowNode | Node)[];
    return applyVisualState(base.initialNodes, selectedNodeId, tourHighlightedNodeIds, searchResults);
  }, [laidOutRef.current, selectedNodeId, tourHighlightedNodeIds, searchResults]);

  const [nodes, setNodes, onNodesChange] = useNodesState(visualNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laidOutRef.current?.initialEdges ?? []);

  // ── Push sync layout + visual state to ReactFlow ──
  useEffect(() => {
    if (syncResult) {
      const withVisual = applyVisualState(syncResult.initialNodes, selectedNodeId, tourHighlightedNodeIds, searchResults);
      setNodes(withVisual);
      setEdges(syncResult.initialEdges);
    }
  }, [syncResult, selectedNodeId, tourHighlightedNodeIds, searchResults, setNodes, setEdges]);

  // ── Push visual-only changes (no relayout) ──
  useEffect(() => {
    if (laidOutRef.current && !layouting) {
      const withVisual = applyVisualState(laidOutRef.current.initialNodes, selectedNodeId, tourHighlightedNodeIds, searchResults);
      setNodes(withVisual);
    }
  }, [selectedNodeId, tourHighlightedNodeIds, searchResults, setNodes, layouting]);

  // ── Async layout: for large graphs, run dagre in a Web Worker ──
  useEffect(() => {
    if (!graph || !needsAsyncLayout || topoNodes.length === 0) return;

    let cancelled = false;
    setLayouting(true);

    applyDagreLayoutAsync(topoNodes, topoEdges).then((laid) => {
      if (cancelled) return;
      const layers = graph.layers ?? [];
      const result = applyLayerGroups(laid.nodes as CustomFlowNode[], laid.edges, layers, showLayers);
      laidOutRef.current = result;
      const withVisual = applyVisualState(result.initialNodes, selectedNodeId, tourHighlightedNodeIds, searchResults);
      setNodes(withVisual);
      setEdges(result.initialEdges);
      setLayouting(false);
    }).catch(() => {
      if (cancelled) return;
      setLayouting(false);
    });

    return () => { cancelled = true; setLayouting(false); };
  }, [graph, topoNodes, topoEdges, needsAsyncLayout, showLayers, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      // Ignore clicks on group nodes
      const isGroupNode = graph?.layers?.some((l) => l.id === node.id);
      if (isGroupNode) return;
      selectNode(node.id);
      openCodeViewer(node.id);
    },
    [selectNode, openCodeViewer, graph],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-root rounded-lg">
        <p className="text-text-muted text-sm">No knowledge graph loaded</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {layouting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-root/80 rounded-lg">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-text-secondary text-sm">
              Laying out {topoNodes.length.toLocaleString()} nodes...
            </p>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ minZoom: 0.01, padding: 0.1 }}
        minZoom={0.01}
        maxZoom={2}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} color="rgba(212,165,116,0.15)" gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeColor="#1a1a1a"
          maskColor="rgba(10,10,10,0.7)"
          className="!bg-surface !border !border-border-subtle"
        />
        <TourFitView />
        <SelectedNodeFitView />
      </ReactFlow>
    </div>
  );
}

export default function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphViewInner />
    </ReactFlowProvider>
  );
}
