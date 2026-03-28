import { useDashboardStore } from "../store";

export default function ProjectOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const startTour = useDashboardStore((s) => s.startTour);

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading project...</p>
      </div>
    );
  }

  const { project, nodes, edges, layers } = graph;
  const hasTour = graph.tour.length > 0;

  // Count node types
  const typeCounts: Record<string, number> = {};
  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
  }

  // Category breakdowns
  const categoryBreakdown = [
    { label: "Code", color: "var(--color-node-file)", count: (typeCounts["file"] ?? 0) + (typeCounts["function"] ?? 0) + (typeCounts["class"] ?? 0) },
    { label: "Config", color: "var(--color-node-config)", count: typeCounts["config"] ?? 0 },
    { label: "Docs", color: "var(--color-node-document)", count: typeCounts["document"] ?? 0 },
    { label: "Infra", color: "var(--color-node-service)", count: (typeCounts["service"] ?? 0) + (typeCounts["resource"] ?? 0) + (typeCounts["pipeline"] ?? 0) },
    { label: "Data", color: "var(--color-node-table)", count: (typeCounts["table"] ?? 0) + (typeCounts["endpoint"] ?? 0) + (typeCounts["schema"] ?? 0) },
  ];
  const hasNonCodeNodes = categoryBreakdown.some((c) => c.label !== "Code" && c.count > 0);

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Project name */}
      <h2 className="font-serif text-2xl text-text-primary mb-1">{project.name}</h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-6">{project.description}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{nodes.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Nodes</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{edges.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Edges</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{layers.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Layers</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{Object.keys(typeCounts).length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">Types</div>
        </div>
      </div>

      {/* File Types breakdown */}
      {hasNonCodeNodes && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">File Types</h3>
          <div className="space-y-1.5">
            {categoryBreakdown.filter((c) => c.count > 0).map((cat) => (
              <div key={cat.label} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-xs text-text-secondary flex-1">{cat.label}</span>
                <span className="text-xs font-mono text-text-muted">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Languages */}
      {project.languages.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">Languages</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.languages.map((lang) => (
              <span key={lang} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Frameworks */}
      {project.frameworks.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">Frameworks</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.frameworks.map((fw) => (
              <span key={fw} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {fw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Analyzed at */}
      <div className="text-[11px] text-text-muted mb-6">
        Analyzed: {new Date(project.analyzedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>

      {/* Start Tour button */}
      {hasTour && (
        <button
          onClick={startTour}
          className="w-full bg-accent/10 border border-accent/30 text-accent text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-accent/20 transition-all duration-200"
        >
          Start Guided Tour
        </button>
      )}
    </div>
  );
}
