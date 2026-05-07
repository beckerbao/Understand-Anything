#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORE_DIST = resolve(__dirname, "../../../packages/core/dist/index.js");

if (!existsSync(CORE_DIST)) {
  console.error("Missing core build at packages/core/dist/index.js");
  process.exit(1);
}

const { validateGraph } = await import(CORE_DIST);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_CACHE = new Map();

function usage() {
  console.error("Usage: node build-callgraph-overlay.mjs <project-root>");
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function toPosixPath(input) {
  return input.split("\\").join("/");
}

function normalizeRelativePath(filePath, projectRoot) {
  const rawPath = isAbsolute(filePath) ? (filePath.startsWith(projectRoot) ? relative(projectRoot, filePath) : null) : filePath;
  if (rawPath === null) return null;
  const normalized = toPosixPath(rawPath);
  if (!normalized || normalized === "." || normalized.includes("\0") || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

function loadGraph(projectRoot) {
  const graphPath = resolve(projectRoot, ".understand-anything/knowledge-graph.json");
  if (!existsSync(graphPath)) {
    throw new Error(`Missing knowledge graph at ${graphPath}`);
  }

  const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
  const validation = validateGraph(graph);
  if (!validation.success || !validation.data) {
    throw new Error(validation.fatal ?? "Invalid knowledge graph");
  }
  return validation.data;
}

function resolveSourceFile(projectRoot, importerRelativePath, moduleSpecifier) {
  let base;
  if (moduleSpecifier.startsWith("@/")) {
    base = resolve(projectRoot, "src", moduleSpecifier.slice(2));
  } else if (moduleSpecifier.startsWith(".")) {
    const importerAbs = resolve(projectRoot, importerRelativePath);
    base = resolve(dirname(importerAbs), moduleSpecifier);
  } else {
    return null;
  }
  const candidates = new Set();

  const addCandidate = (candidate) => {
    const normalized = resolve(candidate);
    candidates.add(normalized);
  };

  if (extname(base)) {
    addCandidate(base);
  } else {
    for (const ext of SOURCE_EXTENSIONS) addCandidate(`${base}${ext}`);
    for (const ext of SOURCE_EXTENSIONS) addCandidate(join(base, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const rel = normalizeRelativePath(candidate, projectRoot);
    if (rel) return rel;
  }
  return null;
}

function getSourceKind(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function getLineRange(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return [start, end];
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function getNodeName(node, className = null) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    if (!name) return null;
    return className ? `${className}.${name}` : name;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return null;
  return null;
}

function collectFileAnalysis(projectRoot, graph, filePath) {
  const cacheKey = filePath;
  const cached = IMPORT_CACHE.get(cacheKey);
  if (cached) return cached;

  const absPath = resolve(projectRoot, filePath);
  const content = readFileSync(absPath, "utf-8");
  const sourceFile = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, getSourceKind(filePath));

  const importBindings = new Map();
  const namespaceImports = new Map();
  const functionDefs = new Map();

  const graphFunctionNodes = graph.nodes.filter(
    (node) => node.type === "function" && node.filePath === filePath,
  );
  const graphFunctionByName = new Map(graphFunctionNodes.map((node) => [node.name, node]));

  function recordFunction(name, node, className = null) {
    const graphNode = graphFunctionByName.get(className ? `${className}.${name}` : name) ?? graphFunctionByName.get(name);
    if (!graphNode) return;
    functionDefs.set(graphNode.id, {
      node: graphNode,
      astNode: node,
      name: graphNode.name,
      range: getLineRange(sourceFile, node),
      className,
    });
  }

  function visitTopLevel(node, currentClass = null) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      recordFunction(node.name.text, node);
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          recordFunction(decl.name.text, decl.initializer);
        }
      }
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          recordFunction(member.name.text, member, node.name.text);
        }
      }
      return;
    }

    ts.forEachChild(node, (child) => visitTopLevel(child, currentClass));
  }

  function collectImports(node) {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const moduleSpecifier = node.moduleSpecifier.text;
    const resolvedFilePath = resolveSourceFile(projectRoot, filePath, moduleSpecifier);
    if (!resolvedFilePath) return;

    const clause = node.importClause;
    if (clause.name) {
      importBindings.set(clause.name.text, {
        localName: clause.name.text,
        importedName: "default",
        sourceFilePath: resolvedFilePath,
        kind: "default",
      });
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaceImports.set(clause.namedBindings.name.text, resolvedFilePath);
      return;
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        importBindings.set(el.name.text, {
          localName: el.name.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
          sourceFilePath: resolvedFilePath,
          kind: "named",
        });
      }
    }
  }

  for (const stmt of sourceFile.statements) {
    collectImports(stmt);
  }
  visitTopLevel(sourceFile);

  const result = {
    sourceFile,
    importBindings,
    namespaceImports,
    functionDefs,
    graphFunctionByName,
  };
  IMPORT_CACHE.set(cacheKey, result);
  return result;
}

function resolveTargetNode(graph, filePath, targetName) {
  const exactId = `function:${filePath}:${targetName}`;
  const exact = graph.nodes.find((node) => node.id === exactId);
  if (exact) return exact;

  const byName = graph.nodes.find(
    (node) => node.type === "function" && node.filePath === filePath && node.name === targetName,
  );
  return byName ?? null;
}

function collectCallEdgesForFunction(projectRoot, graph, analysis, callerNode) {
  const results = [];
  const callerDef = analysis.functionDefs.get(callerNode.id);
  if (!callerDef) return results;

  const sourceFile = analysis.sourceFile;
  const callerRange = callerDef.range;
  const callerClassName = callerDef.className;
  const localFunctions = new Map(
    [...analysis.functionDefs.values()].map((def) => [def.name, def.node.id]),
  );

  function resolveIdentifier(name) {
    if (localFunctions.has(name)) {
      return { targetNode: graph.nodes.find((node) => node.id === localFunctions.get(name)), confidence: 0.98, callKind: "direct", resolvedFrom: "Identifier" };
    }
    const binding = analysis.importBindings.get(name);
    if (!binding) return null;
    const targetNode = resolveTargetNode(graph, binding.sourceFilePath, binding.importedName);
    if (!targetNode) return null;
    return {
      targetNode,
      confidence: binding.kind === "default" ? 0.8 : 0.95,
      callKind: binding.kind === "default" ? "imported" : "imported",
      resolvedFrom: binding.kind === "default" ? "DefaultImport" : "NamedImport",
    };
  }

  function resolveMember(objectName, propertyName) {
    if (analysis.namespaceImports.has(objectName)) {
      const targetFilePath = analysis.namespaceImports.get(objectName);
      const targetNode = resolveTargetNode(graph, targetFilePath, propertyName);
      if (!targetNode) return null;
      return {
        targetNode,
        confidence: 0.93,
        callKind: "member",
        resolvedFrom: "NamespaceImport",
      };
    }

    if (objectName === "this" && callerClassName) {
      const targetNode = resolveTargetNode(graph, callerNode.filePath, propertyName);
      if (!targetNode) return null;
      return {
        targetNode,
        confidence: 0.82,
        callKind: "member",
        resolvedFrom: "ThisKeyword",
      };
    }

    return null;
  }

  function visit(node, insideNestedFunction = false) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let resolution = null;
      if (ts.isIdentifier(expr)) {
        resolution = resolveIdentifier(expr.text);
      } else if (ts.isPropertyAccessExpression(expr)) {
        const obj = expr.expression;
        if (ts.isIdentifier(obj)) {
          resolution = resolveMember(obj.text, expr.name.text);
        }
      }

      if (resolution && resolution.targetNode && resolution.targetNode.id !== callerNode.id) {
        const targetAnalysis = collectFileAnalysis(projectRoot, graph, resolution.targetNode.filePath);
        const targetDef = targetAnalysis.functionDefs.get(resolution.targetNode.id);
        if (targetDef) {
          results.push({
            source: callerNode.id,
            target: resolution.targetNode.id,
            type: "calls",
            direction: "forward",
            confidence: resolution.confidence,
            callKind: resolution.callKind,
            resolvedFrom: resolution.resolvedFrom,
            sourceFilePath: callerNode.filePath,
            targetFilePath: resolution.targetNode.filePath,
            sourceRange: getLineRange(sourceFile, node),
            targetRange: targetDef.range,
          });
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, insideNestedFunction));
  }

  if (callerDef.astNode.body) {
    visit(callerDef.astNode.body);
  }

  return results;
}

function edgeKey(edge) {
  return `${edge.source}|${edge.target}|${edge.type}|${edge.direction}`;
}

function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    usage();
    process.exit(1);
  }

  const resolvedProjectRoot = resolve(projectRoot);
  const graph = loadGraph(resolvedProjectRoot);
  const fileNodes = graph.nodes.filter(
    (node) => node.filePath && ["file", "config", "document", "service", "table", "schema", "resource", "pipeline"].includes(node.type),
  );
  const codeFilePaths = sortUnique(
    fileNodes
      .map((node) => node.filePath)
      .filter((filePath) => typeof filePath === "string" && SOURCE_EXTENSIONS.includes(extname(filePath).toLowerCase())),
  );

  const callEdges = [];
  const callerNodeIds = new Set();
  const calleeNodeIds = new Set();
  const functionNodeIds = new Set();
  let candidateCallSites = 0;
  let droppedCalls = 0;

  for (const filePath of codeFilePaths) {
    const absPath = resolve(resolvedProjectRoot, filePath);
    if (!existsSync(absPath)) continue;

    const analysis = collectFileAnalysis(resolvedProjectRoot, graph, filePath);
    for (const callerNode of analysis.functionDefs.values()) {
      const edges = collectCallEdgesForFunction(resolvedProjectRoot, graph, analysis, callerNode.node);
      candidateCallSites += edges.length;
      for (const edge of edges) {
        functionNodeIds.add(edge.source);
        functionNodeIds.add(edge.target);
        callerNodeIds.add(edge.source);
        calleeNodeIds.add(edge.target);
        callEdges.push(edge);
      }
      if (edges.length === 0) {
        droppedCalls += 1;
      }
    }
  }

  const deduped = new Map();
  for (const edge of callEdges) {
    const key = edgeKey(edge);
    const existing = deduped.get(key);
    if (!existing || existing.confidence < edge.confidence) {
      deduped.set(key, edge);
    }
  }

  const functionCalls = [...deduped.values()].sort((a, b) => {
    const ak = `${a.source}|${a.target}|${a.callKind}|${a.sourceRange?.[0] ?? 0}`;
    const bk = `${b.source}|${b.target}|${b.callKind}|${b.sourceRange?.[0] ?? 0}`;
    return ak.localeCompare(bk);
  });

  const overlay = {
    version: "1.0.0",
    kind: "callgraph",
    generatedAt: new Date().toISOString(),
    project: {
      name: graph.project.name,
      gitCommitHash: graph.project.gitCommitHash,
    },
    baseGraph: {
      kind: graph.kind ?? "codebase",
      gitCommitHash: graph.project.gitCommitHash,
    },
    scope: {
      includeNodeTypes: ["function", "class"],
      edgeTypes: ["calls"],
      minConfidence: 0.7,
      maxDepth: 1,
    },
    nodes: {
      functionNodeIds: sortUnique([...functionNodeIds]),
      callerNodeIds: sortUnique([...callerNodeIds]),
      calleeNodeIds: sortUnique([...calleeNodeIds]),
    },
    edges: {
      functionCalls,
    },
    stats: {
      candidateCallSites,
      resolvedCalls: functionCalls.length,
      dedupedCalls: callEdges.length - functionCalls.length,
      droppedCalls,
      maxDepthReached: 1,
    },
    notes: [
      "This overlay contains only internal function-to-function call edges.",
      "Endpoint calls remain in knowledge-graph.json.",
      "The overlay is deterministic for the same input graph.",
    ],
  };

  const outDir = resolve(resolvedProjectRoot, ".understand-anything");
  ensureDir(outDir);
  const outPath = resolve(outDir, "callgraph-overlay.json");
  writeFileSync(outPath, JSON.stringify(overlay, null, 2), "utf-8");

  console.log(`Wrote ${outPath}`);
  console.log(
    JSON.stringify(
      {
        resolvedCalls: functionCalls.length,
        callerNodeCount: overlay.nodes.callerNodeIds.length,
        calleeNodeCount: overlay.nodes.calleeNodeIds.length,
      },
      null,
      2,
    ),
  );
}

main();
