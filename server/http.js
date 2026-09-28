import { createServer as createNodeHttpServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
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
  "/r1/icon.svg": ["icon.svg", "image/svg+xml; charset=utf-8"],
  "/r1/icon.png": ["icon.png", "image/png", true],
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

function pairingClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function recordPairingAttempt(attempts, key) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length;
}

async function handlePairing(
  req,
  res,
  store,
  pairingPath,
  deviceTokenState,
  pairingAttempts
) {
  if (!pairingPath || !deviceTokenState.path) {
    sendJson(res, 503, { error: "R1 pairing is not configured." });
    return;
  }

  const attemptCount = recordPairingAttempt(pairingAttempts, pairingClientKey(req));
  if (attemptCount > 5) {
    sendJson(res, 429, { error: "Too many pairing attempts. Wait one minute and try again." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const suppliedCode = String(body.code ?? "").trim();
    const pairing = JSON.parse(await readFile(pairingPath, "utf8"));
    if (!Number.isFinite(pairing.expiresAt) || pairing.expiresAt < Date.now()) {
      await unlink(pairingPath).catch(() => undefined);
      sendJson(res, 410, { error: "That pairing code expired. Generate a new one." });
      return;
    }
    if (!/^\d{6}$/.test(suppliedCode) || !tokensMatch(String(pairing.code), suppliedCode)) {
      sendJson(res, 401, { error: "That pairing code is not valid." });
      return;
    }

    if (!deviceTokenState.value) {
      deviceTokenState.value = randomBytes(32).toString("base64url");
      await writeFile(deviceTokenState.path, `${deviceTokenState.value}\n`, { mode: 0o600 });
    }
    await unlink(pairingPath);
    sendJson(res, 200, {
      token: deviceTokenState.value,
      snapshot: await store.snapshot(),
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(res, 410, { error: "Generate a new pairing code on the Mac mini." });
      return;
    }
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Unable to pair this R1.",
    });
  }
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

function requestCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function handleR1Api(
  req,
  res,
  url,
  store,
  apiToken,
  pairingPath,
  deviceTokenState,
  pairingAttempts
) {
  setR1Cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/pair") {
    await handlePairing(
      req,
      res,
      store,
      pairingPath,
      deviceTokenState,
      pairingAttempts
    );
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
  const sessionToken = requestCookie(req, "ghc_device");
  const isAuthorized =
    tokensMatch(apiToken, suppliedToken) ||
    tokensMatch(deviceTokenState.value, suppliedToken) ||
    tokensMatch(deviceTokenState.value, sessionToken);
  if (!isAuthorized) {
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
  r1PairingPath = process.env.R1_PAIRING_FILE,
  r1DeviceTokenPath = process.env.R1_DEVICE_TOKEN_FILE,
} = {}) {
  if (!store) throw new Error("createHttpServer requires a store.");
  const widgetHtml = readFileSync(widgetPath, "utf8");
  const r1Assets = Object.fromEntries(
    Object.entries(R1_ASSETS).map(([route, [fileName, contentType, binary = false]]) => [
      route,
      {
        fileName,
        body: readFileSync(path.join(r1Dir, fileName), binary ? undefined : "utf8"),
        contentType,
      },
    ])
  );
  const r1Files = Object.fromEntries(
    Object.values(r1Assets).map((asset) => [asset.fileName, asset])
  );
  const pairingAttempts = new Map();
  const deviceTokenState = {
    path: r1DeviceTokenPath,
    value: r1DeviceTokenPath
      ? (() => {
          try {
            return readFileSync(r1DeviceTokenPath, "utf8").trim();
          } catch {
            return "";
          }
        })()
      : "",
  };

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

    const provisionedMatch = url.pathname.match(
      /^\/r1\/device\/([A-Za-z0-9_-]{43})\/(.*)$/
    );
    if (
      req.method === "GET" &&
      provisionedMatch &&
      tokensMatch(deviceTokenState.value, provisionedMatch[1])
    ) {
      const fileName = provisionedMatch[2] || "index.html";
      const asset = r1Files[fileName];
      if (asset) {
        const headers = {
          "content-type": asset.contentType,
          "cache-control": "no-store",
        };
        if (fileName === "index.html") {
          headers["set-cookie"] =
            `ghc_device=${deviceTokenState.value}; Path=/api/v1/; ` +
            "Max-Age=31536000; HttpOnly; Secure; SameSite=Strict";
        }
        res.writeHead(200, headers).end(asset.body);
        return;
      }
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
      await handleR1Api(
        req,
        res,
        url,
        store,
        r1ApiToken,
        r1PairingPath,
        deviceTokenState,
        pairingAttempts
      );
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
