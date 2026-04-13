import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  StructuralAnalysis,
  DefinitionInfo,
  ServiceInfo,
  EndpointInfo,
  StepInfo,
  ResourceInfo,
  SectionInfo,
} from "../types.js";

interface FileMeta {
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
}

interface FileAnalysisMeta extends FileMeta {
  summaries: Record<string, string>; // function/class name -> summary
  fileSummary: string;
}

interface NonCodeFileMeta extends FileMeta {
  nodeType: GraphNode["type"];
}

interface NonCodeFileAnalysisMeta extends NonCodeFileMeta {
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
  sections?: SectionInfo[];
}

const KIND_TO_NODE_TYPE: Record<string, GraphNode["type"]> = {
  table: "table",
  view: "table",
  index: "table",
  message: "schema",
  type: "schema",
  enum: "schema",
  resource: "resource",
  module: "resource",
  service: "service",
  deployment: "service",
  job: "pipeline",
  stage: "pipeline",
  target: "pipeline",
  route: "endpoint",
  query: "endpoint",
  mutation: "endpoint",
  variable: "config",
  output: "config",
};

const EXTENSION_LANGUAGE: Record<string, string> = {
  // Code languages
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".lua": "lua",
  // Non-code languages
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".md": "markdown",
  ".mdx": "markdown",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".mk": "makefile",
  ".env": "env",
  ".csv": "csv",
  ".tsv": "csv",
  ".rst": "restructuredtext",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  ".bat": "batch",
  ".cmd": "batch",
  ".txt": "plaintext",
  ".svg": "xml",
};

function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "unknown";
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? "unknown";
}

export class GraphBuilder {
  private readonly nodes: GraphNode[] = [];
  private readonly edges: GraphEdge[] = [];
  private readonly languages = new Set<string>();
  private readonly nodeIds = new Set<string>();
  private readonly projectName: string;
  private readonly gitHash: string;

  constructor(projectName: string, gitHash: string) {
    this.projectName = projectName;
    this.gitHash = gitHash;
  }

  private static basename(filePath: string): string {
    return GraphBuilder.basename(filePath);
  }

  addFile(filePath: string, meta: FileMeta): void {
    const lang = detectLanguage(filePath);
    if (lang !== "unknown") {
      this.languages.add(lang);
    }

    const name = GraphBuilder.basename(filePath);

    const id = `file:${filePath}`;
    this.nodeIds.add(id);
    this.nodes.push({
      id,
      type: "file",
      name,
      filePath,
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
  }

  addFileWithAnalysis(
    filePath: string,
    analysis: StructuralAnalysis,
    meta: FileAnalysisMeta,
  ): void {
    const lang = detectLanguage(filePath);
    if (lang !== "unknown") {
      this.languages.add(lang);
    }

    const fileName = GraphBuilder.basename(filePath);
    const fileId = `file:${filePath}`;

    // Create the file node
    this.nodeIds.add(fileId);
    this.nodes.push({
      id: fileId,
      type: "file",
      name: fileName,
      filePath,
      summary: meta.fileSummary,
      tags: meta.tags,
      complexity: meta.complexity,
    });

    // Create function nodes with "contains" edges
    for (const fn of analysis.functions) {
      const funcId = `function:${filePath}:${fn.name}`;
      this.nodeIds.add(funcId);
      this.nodes.push({
        id: funcId,
        type: "function",
        name: fn.name,
        filePath,
        lineRange: fn.lineRange,
        summary: meta.summaries[fn.name] ?? "",
        tags: [],
        complexity: meta.complexity,
      });

      this.edges.push({
        source: fileId,
        target: funcId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }

    // Create class nodes with "contains" edges
    for (const cls of analysis.classes) {
      const classId = `class:${filePath}:${cls.name}`;
      this.nodeIds.add(classId);
      this.nodes.push({
        id: classId,
        type: "class",
        name: cls.name,
        filePath,
        lineRange: cls.lineRange,
        summary: meta.summaries[cls.name] ?? "",
        tags: [],
        complexity: meta.complexity,
      });

      this.edges.push({
        source: fileId,
        target: classId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }
  }

  addImportEdge(fromFile: string, toFile: string): void {
    this.edges.push({
      source: `file:${fromFile}`,
      target: `file:${toFile}`,
      type: "imports",
      direction: "forward",
      weight: 0.7,
    });
  }

  addCallEdge(
    callerFile: string,
    callerFunc: string,
    calleeFile: string,
    calleeFunc: string,
  ): void {
    this.edges.push({
      source: `function:${callerFile}:${callerFunc}`,
      target: `function:${calleeFile}:${calleeFunc}`,
      type: "calls",
      direction: "forward",
      weight: 0.8,
    });
  }

  addNonCodeFile(filePath: string, meta: NonCodeFileMeta): void {
    const lang = detectLanguage(filePath);
    if (lang !== "unknown") this.languages.add(lang);
    const name = GraphBuilder.basename(filePath);
    const id = `${meta.nodeType ?? "file"}:${filePath}`;
    this.nodeIds.add(id);
    this.nodes.push({
      id,
      type: meta.nodeType,
      name,
      filePath,
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
  }

  addNonCodeFileWithAnalysis(filePath: string, meta: NonCodeFileAnalysisMeta): void {
    this.addNonCodeFile(filePath, meta);
    const fileId = `${meta.nodeType ?? "file"}:${filePath}`;

    // Create child nodes for definitions (tables, schemas, etc.)
    for (const def of meta.definitions ?? []) {
      const childId = `${def.kind}:${filePath}:${def.name}`;
      if (this.nodeIds.has(childId)) {
        console.warn(`[GraphBuilder] Duplicate node ID "${childId}" — skipping`);
        continue;
      }
      this.nodeIds.add(childId);
      this.nodes.push({
        id: childId,
        type: this.mapKindToNodeType(def.kind),
        name: def.name,
        filePath,
        lineRange: def.lineRange,
        summary: `${def.kind}: ${def.name} (${def.fields.length} fields)`,
        tags: [],
        complexity: meta.complexity,
      });
      this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
    }

    // Create child nodes for services
    for (const svc of meta.services ?? []) {
      const childId = `service:${filePath}:${svc.name}`;
      if (this.nodeIds.has(childId)) {
        console.warn(`[GraphBuilder] Duplicate node ID "${childId}" — skipping`);
        continue;
      }
      this.nodeIds.add(childId);
      this.nodes.push({
        id: childId,
        type: "service",
        name: svc.name,
        filePath,
        summary: `Service ${svc.name}${svc.image ? ` (image: ${svc.image})` : ""}`,
        tags: [],
        complexity: meta.complexity,
      });
      this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
    }

    // Create child nodes for endpoints
    for (const ep of meta.endpoints ?? []) {
      const childId = `endpoint:${filePath}:${ep.path}`;
      if (this.nodeIds.has(childId)) {
        console.warn(`[GraphBuilder] Duplicate node ID "${childId}" — skipping`);
        continue;
      }
      this.nodeIds.add(childId);
      this.nodes.push({
        id: childId,
        type: "endpoint",
        name: `${ep.method ?? ""} ${ep.path}`.trim(),
        filePath,
        lineRange: ep.lineRange,
        summary: `Endpoint: ${ep.method ?? ""} ${ep.path}`.trim(),
        tags: [],
        complexity: meta.complexity,
      });
      this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
    }

    // Create child nodes for steps (pipeline/makefile targets)
    for (const step of meta.steps ?? []) {
      const childId = `step:${filePath}:${step.name}`;
      if (this.nodeIds.has(childId)) {
        console.warn(`[GraphBuilder] Duplicate node ID "${childId}" — skipping`);
        continue;
      }
      this.nodeIds.add(childId);
      this.nodes.push({
        id: childId,
        type: "pipeline",
        name: step.name,
        filePath,
        lineRange: step.lineRange,
        summary: `Step: ${step.name}`,
        tags: [],
        complexity: meta.complexity,
      });
      this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
    }

    // Create child nodes for resources (Terraform, etc.)
    for (const res of meta.resources ?? []) {
      const childId = `resource:${filePath}:${res.name}`;
      if (this.nodeIds.has(childId)) {
        console.warn(`[GraphBuilder] Duplicate node ID "${childId}" — skipping`);
        continue;
      }
      this.nodeIds.add(childId);
      this.nodes.push({
        id: childId,
        type: "resource",
        name: res.name,
        filePath,
        lineRange: res.lineRange,
        summary: `Resource: ${res.name} (${res.kind})`,
        tags: [],
        complexity: meta.complexity,
      });
      this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
    }
  }

  private mapKindToNodeType(kind: string): GraphNode["type"] {
    const mapped = KIND_TO_NODE_TYPE[kind];
    if (!mapped) {
      console.warn(`[GraphBuilder] Unknown definition kind "${kind}" — falling back to "concept" node type`);
    }
    return mapped ?? "concept";
  }

  build(): KnowledgeGraph {
    return {
      version: "1.0.0",
      project: {
        name: this.projectName,
        languages: [...this.languages].sort(),
        frameworks: [],
        description: "",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: this.gitHash,
      },
      nodes: this.nodes,
      edges: this.edges,
      layers: [],
      tour: [],
    };
  }
}
