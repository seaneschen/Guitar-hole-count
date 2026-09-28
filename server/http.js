import { createServer as createNodeHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHoleCountMcpServer } from "./mcp.js";
import { RevisionConflictError } from "./store.js";

const defaultWidgetPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/hole-count-widget.html"
);
const defaultR1Dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../r1"
);

const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

const R1_ASSETS = Object.freeze({
  "/r1/": ["index.html", "text/html; charset=utf-8"],
  "/r1/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/r1/core.js": ["core.js", "text/javascript; charset=utf-8"],
  "/r1/app.js": ["app.js", "text/javascript; charset=utf-8"],
});

function sendJson(res, status, value) {
  res
    .writeHead(status, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify(value));
}

function setR1Cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, ngrok-skip-browser-warning"
  );
  res.setHeader("Cache-Control", "no-store");
}

function tokensMatch(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function handleR1Api(req, res, url, store, apiToken) {
  setR1Cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (!apiToken) {
    sendJson(res, 503, { error: "R1 synchronization is not configured." });
    return;
  }

  const authorization = req.headers.authorization ?? "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!tokensMatch(apiToken, suppliedToken)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    sendJson(res, 401, { error: "Invalid R1 synchronization credential." });
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/v1/snapshot") {
      sendJson(res, 200, { snapshot: await store.snapshot() });
      return;
    }

    const body = await readJsonBody(req);
    const options = { expectedRevision: body.expectedRevision };
    if (req.method === "PUT" && url.pathname === "/api/v1/morning") {
      await store.setMorningCount(body.counts, options);
    } else if (req.method === "POST" && url.pathname === "/api/v1/breakouts") {
      await store.breakOut(body.breakouts, options);
    } else if (req.method === "PATCH" && url.pathname === "/api/v1/corrections") {
      await store.correctCount(body.corrections, options);
    } else if (req.method === "POST" && url.pathname === "/api/v1/adjustments") {
      await store.adjustBalance(body.adjustments, options);
    } else {
      sendJson(res, 404, { error: "Not Found" });
      return;
    }

    sendJson(res, 200, { snapshot: await store.snapshot() });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      sendJson(res, 409, {
        error: error.message,
        snapshot: await store.snapshot(),
      });
      return;
    }
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Unable to update the count.",
      snapshot: await store.snapshot(),
    });
  }
}

export function createHttpServer({
  store,
  widgetPath = defaultWidgetPath,
  r1Dir = defaultR1Dir,
  r1ApiToken = process.env.R1_API_TOKEN,
} = {}) {
  if (!store) throw new Error("createHttpServer requires a store.");
  const widgetHtml = readFileSync(widgetPath, "utf8");
  const r1Assets = Object.fromEntries(
    Object.entries(R1_ASSETS).map(([route, [fileName, contentType]]) => [
      route,
      {
        body: readFileSync(path.join(r1Dir, fileName), "utf8"),
        contentType,
      },
    ])
  );

  return createNodeHttpServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/r1") {
      res.writeHead(308, { location: "/r1/" }).end();
      return;
    }

    const r1Asset = r1Assets[url.pathname];
    if (req.method === "GET" && r1Asset) {
      res
        .writeHead(200, {
          "content-type": r1Asset.contentType,
          "cache-control": "no-cache",
        })
        .end(r1Asset.body);
      return;
    }

    if (url.pathname.startsWith("/api/v1/")) {
      await handleR1Api(req, res, url, store, r1ApiToken);
      return;
    }

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
