import { useDashboardStore } from "../store";

export default function ImpactToggle() {
  const impactMode = useDashboardStore((s) => s.impactMode);
  const toggleImpactMode = useDashboardStore((s) => s.toggleImpactMode);
  const seedNodeIds = useDashboardStore((s) => s.impactSeedNodeIds);
  const upstreamNodeIds = useDashboardStore((s) => s.impactUpstreamNodeIds);
  const downstreamNodeIds = useDashboardStore((s) => s.impactDownstreamNodeIds);

  const hasImpact = seedNodeIds.size > 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleImpactMode}
        disabled={!hasImpact}
        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          impactMode && hasImpact
            ? "bg-[rgba(92,168,255,0.12)] text-[#8ec5ff]"
            : hasImpact
              ? "bg-elevated text-text-secondary hover:bg-surface"
              : "bg-elevated text-text-muted cursor-not-allowed"
        }`}
        title={
          hasImpact
            ? impactMode
              ? "Hide impact overlay"
              : "Show impact overlay"
            : "No impact data loaded"
        }
      >
        Impact {impactMode && hasImpact ? "ON" : "OFF"}
      </button>

      {impactMode && hasImpact && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent-bright)]" />
            <span className="text-text-secondary text-[11px]">
              Seed
              <span className="text-text-muted ml-0.5">({seedNodeIds.size})</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#5ca8ff]" />
            <span className="text-text-secondary text-[11px]">
              Upstream
              <span className="text-text-muted ml-0.5">({upstreamNodeIds.size})</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#e1a85c]" />
            <span className="text-text-secondary text-[11px]">
              Downstream
              <span className="text-text-muted ml-0.5">({downstreamNodeIds.size})</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
