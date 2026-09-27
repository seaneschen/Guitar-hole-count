import { createServer as createNodeHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHoleCountMcpServer } from "./mcp.js";

const defaultWidgetPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/hole-count-widget.html"
);

const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

export function createHttpServer({ store, widgetPath = defaultWidgetPath } = {}) {
  if (!store) throw new Error("createHttpServer requires a store.");
  const widgetHtml = readFileSync(widgetPath, "utf8");

  return createNodeHttpServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS" && url.pathname === "/mcp") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res
        .writeHead(200, { "content-type": "application/json; charset=utf-8" })
        .end(
          JSON.stringify({
            service: "guitar-hole-count",
            status: "ok",
            snapshot: await store.snapshot(),
          })
        );
      return;
    }

    if (req.method === "GET" && url.pathname === "/preview") {
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(widgetHtml);
      return;
    }

    if (url.pathname === "/mcp" && req.method && MCP_METHODS.has(req.method)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      const server = createHoleCountMcpServer({ store, widgetPath });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) res.writeHead(500).end("Internal server error");
      }
      return;
    }

    res.writeHead(404).end("Not Found");
  });
}
