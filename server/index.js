import path from "node:path";
import { createHttpServer } from "./http.js";
import { HoleCountStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR || path.resolve("data");
const store = new HoleCountStore({ dataDir });
const server = createHttpServer({ store });

server.listen(port, "0.0.0.0", () => {
  console.log(`Guitar Hole Count MCP listening on http://localhost:${port}/mcp`);
  console.log(`Persisting the current snapshot in ${store.statePath}`);
});
