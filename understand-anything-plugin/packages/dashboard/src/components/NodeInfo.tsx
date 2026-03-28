import { useState } from "react";
import { useDashboardStore } from "../store";

const typeBadgeColors: Record<string, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
};

const complexityBadgeColors: Record<string, string> = {
  simple: "text-node-function border border-node-function/30 bg-node-function/10",
  moderate: "text-accent-dim border border-accent-dim/30 bg-accent-dim/10",
  complex: "text-[#c97070] border border-[#c97070]/30 bg-[#c97070]/10",
};

/**
 * Human-readable directional labels for edge types.
 * Returns different text depending on whether the selected node is
 * the source or target of the edge.
 */
function getDirectionalLabel(edgeType: string, isSource: boolean): string {
  switch (edgeType) {
    case "imports":
      return isSource ? "imports" : "imported by";
    case "exports":
      return isSource ? "exports to" : "exported by";
    case "contains":
      return isSource ? "contains" : "contained in";
    case "inherits":
      return isSource ? "inherits from" : "inherited by";
    case "implements":
      return isSource ? "implements" : "implemented by";
    case "calls":
      return isSource ? "calls" : "called by";
    case "subscribes":
      return isSource ? "subscribes to" : "subscribed by";
    case "publishes":
      return isSource ? "publishes to" : "consumed by";
    case "middleware":
      return isSource ? "middleware for" : "uses middleware";
    case "reads_from":
      return isSource ? "reads from" : "read by";
    case "writes_to":
      return isSource ? "writes to" : "written by";
    case "transforms":
      return isSource ? "transforms" : "transformed by";
    case "validates":
      return isSource ? "validates" : "validated by";
    case "depends_on":
      return isSource ? "depends on" : "depended on by";
    case "tested_by":
      return isSource ? "tested by" : "tests";
    case "configures":
      return isSource ? "configures" : "configured by";
    case "related":
      return "related to";
    case "similar_to":
      return "similar to";
    default:
      return isSource ? edgeType : `${edgeType} (reverse)`;
  }
}

export default function NodeInfo() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const nodeHistory = useDashboardStore((s) => s.nodeHistory);
  const goBackNode = useDashboardStore((s) => s.goBackNode);
  const [languageExpanded, setLanguageExpanded] = useState(true);

  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const node = graph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Resolve history node names for the breadcrumb trail
  const historyNodes = nodeHistory.map((id) => {
    const n = graph?.nodes.find((gn) => gn.id === id);
    return { id, name: n?.name ?? id };
  });

  if (!node) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">Select a node to see details</p>
      </div>
    );
  }

  const allEdges = graph?.edges ?? [];
  const connections = allEdges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );

  // Separate child nodes (contained IN this file) from other connections
  const childEdges = connections.filter(
    (e) => e.type === "contains" && e.source === node.id,
  );
  const otherConnections = connections.filter(
    (e) => !(e.type === "contains" && e.source === node.id),
  );

  // Resolve child nodes
  const childNodes = childEdges
    .map((e) => graph?.nodes.find((n) => n.id === e.target))
    .filter(Boolean);

  const typeBadge = typeBadgeColors[node.type] ?? typeBadgeColors.file;
  const complexityBadge =
    complexityBadgeColors[node.complexity] ?? complexityBadgeColors.simple;

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Navigation history trail */}
      {historyNodes.length > 0 && (
        <div className="mb-3 flex items-center gap-1 flex-wrap">
          <button
            onClick={goBackNode}
            className="text-[10px] font-semibold text-gold hover:text-gold-bright transition-colors flex items-center gap-1"
          >
            <span>←</span>
            <span>Back</span>
          </button>
          <span className="text-text-muted text-[10px]">│</span>
          {historyNodes.slice(-3).map((h, i, arr) => (
            <span key={`${h.id}-${i}`} className="flex items-center gap-1">
              <button
                onClick={() => {
                  // Navigate back to this point in history
                  const fullIdx = historyNodes.length - arr.length + i;
                  // Pop history back to this point and navigate
                  const targetId = historyNodes[fullIdx].id;
                  // Use navigateToNode which will push current to history,
                  // but we want to rewind. Use goBackNode repeatedly would be clunky,
                  // so we directly set state.
                  const newHistory = nodeHistory.slice(0, fullIdx);
                  const layerId = graph
                    ? graph.layers.find((l) => l.nodeIds.includes(targetId))?.id
                    : null;
                  useDashboardStore.setState({
                    selectedNodeId: targetId,
                    zoomToNodeId: targetId,
                    nodeHistory: newHistory,
                    ...(layerId
                      ? { navigationLevel: "layer-detail" as const, activeLayerId: layerId }
                      : {}),
                  });
                }}
                className="text-[10px] text-text-muted hover:text-gold transition-colors truncate max-w-[80px]"
                title={h.name}
              >
                {h.name}
              </button>
              {i < arr.length - 1 && (
                <span className="text-text-muted text-[10px]">›</span>
              )}
            </span>
          ))}
          <span className="text-text-muted text-[10px]">›</span>
          <span className="text-[10px] text-text-primary font-medium truncate max-w-[80px]">
            {node.name}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${typeBadge}`}
        >
          {node.type}
        </span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded ${complexityBadge}`}
        >
          {node.complexity}
        </span>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-serif text-text-primary">{node.name}</h2>
        <button
          onClick={() => setFocusNode(focusNodeId === node.id ? null : node.id)}
          className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
            focusNodeId === node.id
              ? "bg-gold/20 text-gold border border-gold/40"
              : "text-text-muted border border-border-subtle hover:text-gold hover:border-gold/30"
          }`}
        >
          {focusNodeId === node.id ? "Unfocus" : "Focus"}
        </button>
      </div>

      <p className="text-sm text-text-secondary mb-4 leading-relaxed">
        {node.summary}
      </p>

      {node.filePath && (
        <div className="text-xs text-text-secondary mb-2">
          <span className="font-medium text-text-muted">File:</span>{" "}
          {node.filePath}
          {node.lineRange && (
            <span className="ml-2">
              (L{node.lineRange[0]}-{node.lineRange[1]})
            </span>
          )}
        </div>
      )}

      {node.languageNotes && (
        <div className="mb-4">
          <button
            onClick={() => setLanguageExpanded(!languageExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-accent uppercase tracking-wider mb-2 hover:text-accent-bright transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${languageExpanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Language Concepts
          </button>
          {languageExpanded && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
              <p className="text-sm text-text-secondary leading-relaxed">
                {node.languageNotes}
              </p>
            </div>
          )}
        </div>
      )}

      {node.tags.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Child classes/functions within this file */}
      {childNodes.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
            Defined in this file ({childNodes.length})
          </h3>
          <div className="space-y-1">
            {childNodes.map((child) => {
              if (!child) return null;
              const childTypeBadge = typeBadgeColors[child.type] ?? typeBadgeColors.file;
              const childComplexity = complexityBadgeColors[child.complexity] ?? complexityBadgeColors.simple;
              return (
                <div
                  key={child.id}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                  onClick={() => navigateToNode(child.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${childTypeBadge}`}>
                      {child.type}
                    </span>
                    <span className="text-text-primary truncate">{child.name}</span>
                    <span className={`text-[9px] ml-auto ${childComplexity} px-1 py-0.5 rounded`}>
                      {child.complexity}
                    </span>
                  </div>
                  {child.summary && (
                    <p className="text-[11px] text-text-muted mt-1 line-clamp-1 pl-1">
                      {child.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other connections (excluding "contains" children) */}
      {otherConnections.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-wider mb-2">
            Connections ({otherConnections.length})
          </h3>
          <div className="space-y-1.5">
            {otherConnections.map((edge, i) => {
              const isSource = edge.source === node.id;
              const otherId = isSource ? edge.target : edge.source;
              const otherNode = graph?.nodes.find((n) => n.id === otherId);
              const dirLabel = getDirectionalLabel(edge.type, isSource);
              const arrow = isSource ? "\u2192" : "\u2190";

              return (
                <div
                  key={i}
                  className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle flex items-center gap-2 cursor-pointer hover:border-gold/40 hover:bg-gold/5 transition-colors"
                  onClick={() => {
                    navigateToNode(otherId);
                  }}
                >
                  <span className="text-gold font-mono">{arrow}</span>
                  <span className="text-text-muted">{dirLabel}</span>
                  <span className="text-text-primary truncate">
                    {otherNode?.name ?? otherId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
