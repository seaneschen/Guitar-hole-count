import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WIDGET_URI } from "../server/mcp.js";

const endpoint = new URL(process.env.MCP_ENDPOINT || "http://127.0.0.1:8787/mcp");
const client = new Client({ name: "guitar-hole-count-smoke-test", version: "1.0.0" });

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name),
    [
      "show_hole_count",
      "set_morning_count",
      "break_out_guitars",
      "adjust_hole_balance",
    ]
  );

  const widget = await client.readResource({ uri: WIDGET_URI });
  assert.equal(widget.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(widget.contents[0].text, /ui\/notifications\/tool-result/);

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

  const multiBreakout = await client.callTool({
    name: "break_out_guitars",
    arguments: {
      breakouts: [
        { label: "Fender", quantity: 3 },
        { label: "Ibanez", quantity: 2 },
      ],
    },
  });
  assert.equal(multiBreakout.structuredContent.snapshot.totals.remaining, 33);

  const correction = await client.callTool({
    name: "adjust_hole_balance",
    arguments: { adjustments: [{ label: "Fender", delta: 1 }] },
  });
  assert.equal(correction.structuredContent.snapshot.totals.remaining, 34);

  // Verify that a fresh morning replaces all progress, then leave a useful
  // demo snapshot matching the product card in the project brief.
  const reset = await client.callTool({
    name: "set_morning_count",
    arguments: {
      counts: [
        { label: "Fender", count: 17 },
        { label: "Gibson", count: 9 },
        { label: "Ibanez", count: 12 },
      ],
    },
  });
  assert.equal(reset.structuredContent.snapshot.totals.brokenOut, 0);

  await client.callTool({
    name: "break_out_guitars",
    arguments: {
      breakouts: [
        { label: "Fender", quantity: 6 },
        { label: "Gibson", quantity: 2 },
        { label: "Ibanez", quantity: 5 },
      ],
    },
  });

  const shown = await client.callTool({ name: "show_hole_count", arguments: {} });
  const snapshot = shown.structuredContent.snapshot;
  assert.equal(snapshot.totals.remaining, 25);
  assert.equal(snapshot.totals.brokenOut, 13);

  console.log(
    JSON.stringify(
      {
        endpoint: endpoint.href,
        tools: tools.tools.map((tool) => tool.name),
        widget: { uri: WIDGET_URI, mimeType: widget.contents[0].mimeType },
        snapshot,
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}
