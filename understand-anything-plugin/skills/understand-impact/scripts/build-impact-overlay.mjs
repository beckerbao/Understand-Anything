#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORE_DIST = resolve(__dirname, "../../../packages/core/dist/index.js");

if (!existsSync(CORE_DIST)) {
  console.error("Missing core build at packages/core/dist/index.js");
  process.exit(1);
}

const { validateGraph } = await import(CORE_DIST);

const ALLOWED_EDGE_TYPES = new Set([
  "calls",
  "depends_on",
  "imports",
  "contains",
  "routes",
  "serves",
  "implements",
  "configures",
]);
const FILE_SEED_TYPES = new Set([
  "file",
  "config",
  "document",
  "service",
  "table",
  "schema",
  "resource",
  "pipeline",
]);
const DEFAULT_MAX_HOPS = 3;
const DEFAULT_DIRECTION = "both";

function usage() {
  console.error(
    "Usage: node build-impact-overlay.mjs <project-root> <seed-node-or-file> [--max-hops N] [--upstream|--downstream|--both]",
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    projectRoot: "",
    seed: "",
    maxHops: DEFAULT_MAX_HOPS,
    direction: DEFAULT_DIRECTION,
  };

  if (args.length < 2) {
    return out;
  }

  out.projectRoot = resolve(args[0]);
  out.seed = args[1];

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--max-hops") {
      const value = Number.parseInt(args[i + 1] ?? "", 10);
      if (Number.isFinite(value) && value >= 0) {
        out.maxHops = value;
        i++;
      }
      continue;
    }
    if (arg === "--upstream" || arg === "--downstream" || arg === "--both") {
      out.direction = arg.slice(2);
      continue;
    }
  }

  return out;
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function edgeKey(edge) {
  return `${edge.source}|${edge.target}|${edge.type}|${edge.direction}`;
}

function loadCallgraphOverlay(projectRoot) {
  const overlayPath = resolve(projectRoot, ".understand-anything/callgraph-overlay.json");
  if (!existsSync(overlayPath)) return [];

  try {
    const raw = JSON.parse(readFileSync(overlayPath, "utf-8"));
    const functionCalls = raw?.edges?.functionCalls;
    if (!Array.isArray(functionCalls)) return [];

    return functionCalls
      .filter(
        (edge) =>
          typeof edge === "object" &&
          edge !== null &&
          typeof edge.source === "string" &&
          typeof edge.target === "string" &&
          typeof edge.type === "string" &&
          typeof edge.direction === "string",
      )
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        direction: edge.direction,
      }));
  } catch {
    return [];
  }
}

function loadEndpointGraphOverlay(projectRoot) {
  const graphPath = resolve(projectRoot, ".understand-anything/endpoint-graph.json");
  if (!existsSync(graphPath)) return { nodes: [], edges: [] };
  try {
    const raw = JSON.parse(readFileSync(graphPath, "utf-8"));
    const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    const edges = Array.isArray(raw?.edges) ? raw.edges : [];
    return {
      nodes: nodes.filter(
        (node) =>
          node &&
          typeof node === "object" &&
          typeof node.id === "string" &&
          typeof node.type === "string",
      ),
      edges: edges
        .filter(
          (edge) =>
            edge &&
            typeof edge === "object" &&
            typeof edge.source === "string" &&
            typeof edge.target === "string" &&
            typeof edge.type === "string",
        )
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          type: edge.type,
          direction: typeof edge.direction === "string" ? edge.direction : "forward",
        })),
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function buildIndexes(graph, extraEdges = []) {
  const nodesById = new Map();
  for (const node of graph.nodes) nodesById.set(node.id, node);

  const forward = new Map();
  const reverse = new Map();
  const allowedEdges = [];
  const seen = new Set();

  for (const edge of [...graph.edges, ...extraEdges]) {
    if (!ALLOWED_EDGE_TYPES.has(edge.type)) continue;
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    allowedEdges.push(edge);

    if (!forward.has(edge.source)) forward.set(edge.source, []);
    forward.get(edge.source).push({ edge, neighbor: edge.target });

    if (!reverse.has(edge.target)) reverse.set(edge.target, []);
    reverse.get(edge.target).push({ edge, neighbor: edge.source });

    if (edge.direction === "bidirectional") {
      if (!forward.has(edge.target)) forward.set(edge.target, []);
      forward.get(edge.target).push({ edge, neighbor: edge.source });

      if (!reverse.has(edge.source)) reverse.set(edge.source, []);
      reverse.get(edge.source).push({ edge, neighbor: edge.target });
    }
  }

  for (const list of forward.values()) {
    list.sort((a, b) => {
      const ak = `${a.neighbor}|${a.edge.type}|${a.edge.source}|${a.edge.target}`;
      const bk = `${b.neighbor}|${b.edge.type}|${b.edge.source}|${b.edge.target}`;
      return ak.localeCompare(bk);
    });
  }
  for (const list of reverse.values()) {
    list.sort((a, b) => {
      const ak = `${a.neighbor}|${a.edge.type}|${a.edge.source}|${a.edge.target}`;
      const bk = `${b.neighbor}|${b.edge.type}|${b.edge.source}|${b.edge.target}`;
      return ak.localeCompare(bk);
    });
  }

  return { nodesById, forward, reverse, allowedEdges };
}

function resolveSeeds(graph, seedInput, projectRoot) {
  const normalizedInput = seedInput.trim();
  const nodes = graph.nodes;

  const exactNode = nodes.find((node) => node.id === normalizedInput);
  if (exactNode) return [exactNode.id];

  const normalizedFile = isAbsolute(normalizedInput)
    ? relative(projectRoot, resolve(normalizedInput))
    : normalizedInput;

  const fileMatches = nodes
    .filter(
      (node) =>
        FILE_SEED_TYPES.has(node.type) &&
        (node.filePath === normalizedFile || node.id === `${node.type}:${normalizedFile}`),
    )
    .map((node) => node.id);
  if (fileMatches.length > 0) return sortUnique(fileMatches);

  const nameMatches = nodes
    .filter((node) => {
      const q = normalizedInput.toLowerCase();
      return (
        node.name.toLowerCase().includes(q) ||
        node.summary.toLowerCase().includes(q) ||
        (node.filePath ?? "").toLowerCase().includes(q)
      );
    })
    .map((node) => node.id);

  return sortUnique(nameMatches);
}

function bfsFromSeeds(seeds, adjacency, maxHops, traversalDirection) {
  const queue = [];
  const bestDepth = new Map();
  const bestPath = new Map();
  const bestEdgeRefs = new Map();
  const frontierEdges = new Map();

  for (const seed of seeds) {
    queue.push({ nodeId: seed, depth: 0, path: [seed], edges: [] });
    bestDepth.set(seed, 0);
    bestPath.set(seed, [seed]);
    bestEdgeRefs.set(seed, []);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= maxHops) continue;

    const neighbors = adjacency.get(current.nodeId) ?? [];
    for (const { edge, neighbor } of neighbors) {
      const nextDepth = current.depth + 1;
      const existingDepth = bestDepth.get(neighbor);
      if (existingDepth !== undefined && existingDepth <= nextDepth) {
        continue;
      }

      const edgeRef = {
        source: edge.source,
        target: edge.target,
        type: edge.type,
        direction: edge.direction,
        traversalDirection,
      };

      const nextPath = [...current.path, neighbor];
      const nextEdges = [...current.edges, edgeRef];
      bestDepth.set(neighbor, nextDepth);
      bestPath.set(neighbor, nextPath);
      bestEdgeRefs.set(neighbor, nextEdges);
      frontierEdges.set(edgeKey(edge), edgeRef);
      queue.push({
        nodeId: neighbor,
        depth: nextDepth,
        path: nextPath,
        edges: nextEdges,
      });
    }
  }

  return { bestDepth, bestPath, bestEdgeRefs, frontierEdges };
}

function affectedLayers(graph, nodeIds) {
  const set = new Set(nodeIds);
  return sortUnique(
    graph.layers
      .filter((layer) => layer.nodeIds.some((id) => set.has(id)))
      .map((layer) => layer.id),
  );
}

function main() {
  const { projectRoot, seed, maxHops, direction } = parseArgs(process.argv);
  if (!projectRoot || !seed) {
    usage();
    process.exit(1);
  }

  const graphPath = resolve(projectRoot, ".understand-anything/knowledge-graph.json");
  if (!existsSync(graphPath)) {
    console.error(`Missing knowledge graph at ${graphPath}`);
    process.exit(1);
  }

  const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
  const validation = validateGraph(graph);
  if (!validation.success || !validation.data) {
    console.error("Invalid knowledge graph:");
    console.error(validation.fatal ?? "unknown validation error");
    process.exit(1);
  }

  const resolvedGraph = validation.data;
  const endpointOverlay = loadEndpointGraphOverlay(projectRoot);
  const mergedGraph = {
    ...resolvedGraph,
    nodes: [
      ...resolvedGraph.nodes,
      ...endpointOverlay.nodes.filter((n) => !resolvedGraph.nodes.some((gn) => gn.id === n.id)),
    ],
  };

  const seedNodeIds = resolveSeeds(mergedGraph, seed, projectRoot);
  if (seedNodeIds.length === 0) {
    console.error(`No graph nodes matched seed "${seed}"`);
    process.exit(1);
  }

  const callgraphEdges = loadCallgraphOverlay(projectRoot);
  const { forward, reverse } = buildIndexes(mergedGraph, [...callgraphEdges, ...endpointOverlay.edges]);
  const runUpstream = direction === "upstream" || direction === "both";
  const runDownstream = direction === "downstream" || direction === "both";

  const upstream = runUpstream
    ? bfsFromSeeds(seedNodeIds, reverse, maxHops, "upstream")
    : { bestDepth: new Map(), bestPath: new Map(), bestEdgeRefs: new Map(), frontierEdges: new Map() };
  const downstream = runDownstream
    ? bfsFromSeeds(seedNodeIds, forward, maxHops, "downstream")
    : { bestDepth: new Map(), bestPath: new Map(), bestEdgeRefs: new Map(), frontierEdges: new Map() };

  const upstreamNodeIds = sortUnique([...upstream.bestDepth.keys()].filter((id) => !seedNodeIds.includes(id)));
  const downstreamNodeIds = sortUnique([...downstream.bestDepth.keys()].filter((id) => !seedNodeIds.includes(id)));
  const impactNodeIds = sortUnique([...seedNodeIds, ...upstreamNodeIds, ...downstreamNodeIds]);

  const impactEdges = new Map();
  const addEdgeRefs = (map, pathDirection) => {
    for (const [nodeId, refs] of map.entries()) {
      if (seedNodeIds.includes(nodeId)) continue;
      for (const ref of refs) {
        const key = edgeKey(ref);
        const existing = impactEdges.get(key);
        if (existing) {
          if (!existing.traversalDirections.includes(ref.traversalDirection)) {
            existing.traversalDirections.push(ref.traversalDirection);
          }
          if (!existing.pathDirections.includes(pathDirection)) {
            existing.pathDirections.push(pathDirection);
          }
        } else {
          impactEdges.set(key, {
            source: ref.source,
            target: ref.target,
            type: ref.type,
            direction: ref.direction,
            traversalDirections: [ref.traversalDirection],
            pathDirections: [pathDirection],
          });
        }
      }
    }
  };

  addEdgeRefs(upstream.bestEdgeRefs, "upstream");
  addEdgeRefs(downstream.bestEdgeRefs, "downstream");

  const paths = [];
  const addPaths = (bestPath, traversalDirection, pathDirection) => {
    for (const [nodeId, nodePath] of bestPath.entries()) {
      if (seedNodeIds.includes(nodeId)) continue;
      const fromSeed = nodePath[0];
      paths.push({
        direction: pathDirection,
        traversalDirection,
        from: fromSeed,
        to: nodeId,
        nodeIds: nodePath,
        hopCount: nodePath.length - 1,
        reason: `${pathDirection} closure via ${traversalDirection === "upstream" ? "reverse" : "forward"} structural edges`,
      });
    }
  };

  addPaths(upstream.bestPath, "upstream", "upstream");
  addPaths(downstream.bestPath, "downstream", "downstream");

  paths.sort((a, b) => {
    const ak = `${a.direction}|${a.from}|${a.to}|${a.hopCount}`;
    const bk = `${b.direction}|${b.from}|${b.to}|${b.hopCount}`;
    return ak.localeCompare(bk);
  });

  const impactOverlay = {
    version: "1.0.0",
    kind: "impact",
    generatedAt: new Date().toISOString(),
    project: {
      name: mergedGraph.project.name,
      gitCommitHash: mergedGraph.project.gitCommitHash,
    },
    baseGraph: {
      kind: mergedGraph.kind ?? "codebase",
      gitCommitHash: mergedGraph.project.gitCommitHash,
    },
    scope: {
      seedNodeIds: seedNodeIds.slice().sort((a, b) => a.localeCompare(b)),
      seedFilePaths: seedNodeIds
        .map((id) => mergedGraph.nodes.find((node) => node.id === id)?.filePath)
        .filter((value) => typeof value === "string"),
      maxHops,
      direction,
    },
    nodes: {
      seedNodeIds: seedNodeIds.slice().sort((a, b) => a.localeCompare(b)),
      upstreamNodeIds,
      downstreamNodeIds,
      impactNodeIds,
    },
    edges: {
      impactEdgeRefs: [...impactEdges.values()].sort((a, b) => {
        const ak = `${a.source}|${a.target}|${a.type}|${a.direction}`;
        const bk = `${b.source}|${b.target}|${b.type}|${b.direction}`;
        return ak.localeCompare(bk);
      }),
    },
    paths,
    layers: {
      affectedLayerIds: affectedLayers(mergedGraph, impactNodeIds),
    },
    stats: {
      seedCount: seedNodeIds.length,
      upstreamCount: upstreamNodeIds.length,
      downstreamCount: downstreamNodeIds.length,
      impactCount: impactNodeIds.length,
      maxDepthReached: Math.max(
        0,
        ...[...upstream.bestDepth.values(), ...downstream.bestDepth.values()],
      ),
    },
    notes: [
      "impactNodeIds is the computed closure",
      "paths are deterministic shortest paths from the seed to impacted nodes",
      "impactEdgeRefs preserve the original graph edge orientation",
      "when endpoint-graph.json is present, API mapping edges are included in traversal",
    ],
  };

  const outDir = resolve(projectRoot, ".understand-anything");
  ensureDir(outDir);
  const outPath = resolve(outDir, "impact-overlay.json");
  writeFileSync(outPath, JSON.stringify(impactOverlay, null, 2), "utf-8");

  console.log(`Wrote ${outPath}`);
  console.log(
    JSON.stringify(
      {
        seedNodeIds,
        upstreamCount: upstreamNodeIds.length,
        downstreamCount: downstreamNodeIds.length,
        impactCount: impactNodeIds.length,
        affectedLayerIds: impactOverlay.layers.affectedLayerIds,
      },
      null,
      2,
    ),
  );
}

main();
