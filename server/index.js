import path from "node:path";
import { readFileSync } from "node:fs";
import { createHttpServer } from "./http.js";
import { HoleCountStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const dataDir = process.env.DATA_DIR || path.resolve("data");
const store = new HoleCountStore({ dataDir });
const r1ApiToken = process.env.R1_API_TOKEN_FILE
  ? readFileSync(process.env.R1_API_TOKEN_FILE, "utf8").trim()
  : process.env.R1_API_TOKEN;
const r1PairingPath = process.env.R1_PAIRING_FILE;
const server = createHttpServer({ store, r1ApiToken, r1PairingPath });

server.listen(port, host, () => {
  console.log(`Guitar Hole Count MCP listening on http://${host}:${port}/mcp`);
  console.log(`Persisting the current snapshot in ${store.statePath}`);
});

function shutDown(signal) {
  console.log(`Received ${signal}; closing the MCP server.`);
  server.close((error) => {
    if (error) {
      console.error("Error closing the MCP server:", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutDown("SIGTERM"));
process.once("SIGINT", () => shutDown("SIGINT"));
