import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const widgetPath = new URL("../web/hole-count-widget.html", import.meta.url);

test("widget uses the MCP Apps bridge and the current mutation schemas", async () => {
  const html = await readFile(widgetPath, "utf8");
  assert.match(html, /rpcRequest\("ui\/initialize"/);
  assert.match(html, /rpcRequest\("tools\/call"/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.match(html, /breakouts: \[\{ label, quantity: 1 \}\]/);
  assert.match(html, /callTool\(\s*"correct_hole_count"/);
  assert.match(html, /callTool\("set_morning_count", \{ counts \}/);
});

test("daily corrections, undo, and the zeroed morning editor are present", async () => {
  const html = await readFile(widgetPath, "utf8");
  assert.match(html, /row\.remaining -= 1/);
  assert.match(html, /snapshot\.totals\.remaining -= 1/);
  assert.match(html, /className = "remaining-input"/);
  assert.match(html, /id="undo-action"/);
  assert.match(html, /adjust_hole_balance/);
  assert.match(html, /addEditorRow\(row\.label, 0\)/);
  assert.match(html, /id="morning-form"/);
  assert.match(html, /Enter new morning count/);
});
