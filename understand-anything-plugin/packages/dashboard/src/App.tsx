import { useEffect, useState, useMemo } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import GraphView from "./components/GraphView";
import CodeViewer from "./components/CodeViewer";
import SearchBar from "./components/SearchBar";
import NodeInfo from "./components/NodeInfo";
import LayerLegend from "./components/LayerLegend";
import DiffToggle from "./components/DiffToggle";
import LearnPanel from "./components/LearnPanel";
import PersonaSelector from "./components/PersonaSelector";
import ProjectOverview from "./components/ProjectOverview";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import WarningBanner from "./components/WarningBanner";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";

// Extract the access token from the URL so protected endpoints can be fetched.
const ACCESS_TOKEN = new URLSearchParams(window.location.search).get("token");

function tokenUrl(path: string): string {
  return ACCESS_TOKEN ? `${path}?token=${ACCESS_TOKEN}` : path;
}

function App() {
  const graph = useDashboardStore((s) => s.graph);
  const setGraph = useDashboardStore((s) => s.setGraph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const persona = useDashboardStore((s) => s.persona);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const closeCodeViewer = useDashboardStore((s) => s.closeCodeViewer);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);

  useEffect(() => {
    fetch(tokenUrl("/meta.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
  }, []);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: "Show keyboard shortcuts",
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: "Close panels and modals",
        action: () => {
          // Read from store at invocation time to avoid stale closures
          const state = useDashboardStore.getState();
          if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.tourActive) {
            state.stopTour();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: "Focus search bar",
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[placeholder*="Search"]'
          );
          searchInput?.focus();
        },
        category: "Navigation",
      },
      // Tour controls
      {
        key: "ArrowRight",
        description: "Next tour step",
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.nextTourStep();
          }
        },
        category: "Tour",
      },
      {
        key: "ArrowLeft",
        description: "Previous tour step",
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.prevTourStep();
          }
        },
        category: "Tour",
      },
      // View toggles
      {
        key: "l",
        description: "Toggle layer visualization",
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleLayers();
        },
        category: "View",
      },
      {
        key: "d",
        description: "Toggle diff mode",
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleDiffMode();
        },
        category: "View",
      },
    ],
    []
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  useEffect(() => {
    fetch(tokenUrl("/knowledge-graph.json"))
      .then((res) => res.json())
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues(result.issues);
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph]);

  useEffect(() => {
    fetch(tokenUrl("/diff-overlay.json"))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as { changedNodeIds: string[]; affectedNodeIds: string[] };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(d.changedNodeIds, d.affectedNodeIds);
          }
        }
      })
      .catch(() => {
        // Silently ignore - diff overlay is optional
      });
  }, [setDiffOverlay]);

  // Determine sidebar content
  // Learn mode shows LearnPanel + NodeInfo when a node is selected
  // Other modes show NodeInfo when selected, ProjectOverview otherwise
  const isLearnMode = tourActive || persona === "junior";
  const sidebarContent = (
    <>
      {isLearnMode && <LearnPanel />}
      {selectedNodeId && <NodeInfo />}
      {!selectedNodeId && !isLearnMode && <ProjectOverview />}
    </>
  );

  return (
    <ThemeProvider metaTheme={metaTheme}>
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-surface border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-5">
          <h1 className="font-serif text-lg text-text-primary tracking-wide">
            {graph?.project.name ?? "Understand Anything"}
          </h1>
          <div className="w-px h-5 bg-border-subtle" />
          <PersonaSelector />
        </div>
        <div className="flex items-center gap-4">
          <DiffToggle />
          <LayerLegend />
          <ThemePicker />
          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="text-text-muted hover:text-accent transition-colors"
            title="Keyboard shortcuts (Shift + ?)"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Search */}
      <SearchBar />

      {/* Validation warning banner */}
      {graphIssues.length > 0 && !loadError && (
        <WarningBanner issues={graphIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main content: Graph + Sidebar */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Graph area */}
        <div className="flex-1 min-w-0 min-h-0 relative">
          <GraphView />
          <div className="absolute top-3 right-3 text-sm text-text-muted/60 pointer-events-none select-none">
            Press <kbd className="kbd">?</kbd> for keyboard shortcuts
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="w-[360px] shrink-0 bg-surface border-l border-border-subtle overflow-auto">
          {sidebarContent}
        </aside>

        {/* Code viewer overlay */}
        {codeViewerOpen && (
          <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-surface border-t border-border-subtle animate-slide-up z-20">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-end px-3 py-1 shrink-0">
                <button
                  onClick={closeCodeViewer}
                  className="text-text-muted hover:text-text-primary text-xs transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <CodeViewer />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <KeyboardShortcutsHelp
          shortcuts={shortcuts}
          onClose={() => setShowKeyboardHelp(false)}
        />
      )}
    </div>
    </ThemeProvider>
  );
}

export default App;
