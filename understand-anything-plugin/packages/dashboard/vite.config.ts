import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Generate a one-time token when the server process starts.
// This token is printed to the terminal and must be in the URL
// to fetch knowledge-graph.json or diff-overlay.json.
const ACCESS_TOKEN = crypto.randomBytes(16).toString("hex");

export default defineConfig({
  // FIX 1 — bind only to localhost, not 0.0.0.0
  // This blocks access from any other device on the same LAN / WiFi.
  server: {
    host: "127.0.0.1",
    port: 5173,
  },

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-knowledge-graph",
      configureServer(server) {
        // Print the access URL once so the developer can open it.
        server.httpServer?.once("listening", () => {
          console.log(
            `\n  🔑  Dashboard URL: http://127.0.0.1:5173?token=${ACCESS_TOKEN}\n`
          );
        });

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");
          const pathname = url.pathname;
          const isProtectedEndpoint =
            pathname === "/knowledge-graph.json" ||
            pathname === "/diff-overlay.json" ||
            pathname === "/meta.json";

          if (!isProtectedEndpoint) {
            next();
            return;
          }

          // FIX 3 — require the one-time token on all data endpoints.
          // Requests without a matching ?token= get a 403.
          if (url.searchParams.get("token") !== ACCESS_TOKEN) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Forbidden: missing or invalid token" }));
            return;
          }

          const fileName =
            pathname === "/diff-overlay.json"
              ? "diff-overlay.json"
              : pathname === "/meta.json"
              ? "meta.json"
              : "knowledge-graph.json";

          const graphDir = process.env.GRAPH_DIR;
          const candidates = [
            ...(graphDir
              ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
              : []),
            path.resolve(process.cwd(), `.understand-anything/${fileName}`),
            path.resolve(
              process.cwd(),
              `../../../.understand-anything/${fileName}`
            ),
          ];

          for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;

            // FIX 2 — sanitise absolute file paths before sending the JSON.
            // Nodes can contain filePath values like /Users/alice/company/src/auth.ts.
            // We convert those to relative paths (src/auth.ts) so the developer's
            // home directory and company directory layout are not leaked.
            try {
              const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
                nodes?: Array<Record<string, unknown>>;
                [key: string]: unknown;
              };

              // Derive the project root from the candidate path so we can
              // make file paths relative to it.
              const projectRoot = path.dirname(
                candidate.replace(
                  `${path.sep}.understand-anything${path.sep}${fileName}`,
                  ""
                )
              );

              if (Array.isArray(raw.nodes)) {
                raw.nodes = raw.nodes.map((node) => {
                  if (typeof node.filePath !== "string") return node;
                  const abs = node.filePath;
                  // Only relativise paths that actually sit inside projectRoot.
                  // Leave external or already-relative paths untouched.
                  const rel = abs.startsWith(projectRoot)
                    ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
                    : path.isAbsolute(abs)
                    ? path.basename(abs) // absolute but outside root — use filename only
                    : abs;              // already relative — keep as-is
                  return { ...node, filePath: rel };
                });
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(raw));
            } catch (err) {
              // If we cannot parse or sanitise the file, refuse to serve it
              // rather than accidentally leaking raw content.
              console.error("[understand-anything] Failed to sanitise graph file:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to read graph file" }));
            }
            return;
          }

          // No matching file found on disk.
          res.statusCode = 404;
          if (pathname === "/knowledge-graph.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "No knowledge graph found. Run /understand first." }));
          } else {
            res.end();
          }
        });
      },
    },
  ],
});
