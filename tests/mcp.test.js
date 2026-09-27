import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../server/http.js";
import { HoleCountStore } from "../server/store.js";
import { WIDGET_URI } from "../server/mcp.js";

let client;
let dataDir;
let httpServer;
let baseUrl;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "guitar-hole-count-mcp-"));
  httpServer = createHttpServer({ store: new HoleCountStore({ dataDir }) });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  client = new Client({ name: "guitar-hole-count-tests", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => httpServer?.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test("the MCP endpoint advertises the four focused tools and UI only on show", async () => {
  const result = await client.listTools();
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    [
      "show_hole_count",
      "set_morning_count",
      "break_out_guitars",
      "adjust_hole_balance",
    ]
  );

  const show = result.tools.find((tool) => tool.name === "show_hole_count");
  const breakout = result.tools.find((tool) => tool.name === "break_out_guitars");
  assert.equal(show._meta.ui.resourceUri, WIDGET_URI);
  assert.equal(breakout._meta.ui?.resourceUri, undefined);
  assert.ok(breakout.inputSchema.properties.breakouts);
});

test("the widget resource is registered with the MCP Apps MIME type", async () => {
  const result = await client.readResource({ uri: WIDGET_URI });
  assert.equal(result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(result.contents[0].text, /ui\/notifications\/tool-result/);
  assert.match(result.contents[0].text, /tools\/call/);
});

test("tools mutate and return the authoritative structured snapshot", async () => {
  await client.callTool({
    name: "set_morning_count",
    arguments: {
      counts: [
        { label: "Fender", count: 17 },
        { label: "Gibson", count: 9 },
        { label: "Ibanez", count: 12 },
      ],
    },
  });

  const updated = await client.callTool({
    name: "break_out_guitars",
    arguments: {
      breakouts: [
        { label: "Fender", quantity: 3 },
        { label: "Ibanez", quantity: 2 },
      ],
    },
  });

  assert.equal(updated.structuredContent.snapshot.totals.remaining, 33);
  assert.equal(updated.structuredContent.snapshot.totals.brokenOut, 5);

  const shown = await client.callTool({ name: "show_hole_count", arguments: {} });
  assert.equal(shown.structuredContent.snapshot.totals.remaining, 33);
});

test("invalid tool input leaves the current snapshot unchanged", async () => {
  const failed = await client.callTool({
    name: "break_out_guitars",
    arguments: { breakouts: [{ label: "Gibson", quantity: 99 }] },
  });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.snapshot.totals.remaining, 33);
});

test("the health endpoint reports the persisted snapshot", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.snapshot.totals.remaining, 33);
});
