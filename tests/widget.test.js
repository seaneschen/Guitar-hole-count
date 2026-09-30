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
  assert.match(html, /morningEditorRows\(snapshot\.rows\)/);
  assert.match(html, /first: "Boutique"/);
  assert.match(html, /last: "Misc\. Acoustic"/);
  assert.match(html, /id="morning-form"/);
  assert.match(html, /Enter new morning count/);
});

test("mobile count fields request a numeric keypad and replace selected values", async () => {
  const html = await readFile(widgetPath, "utf8");
  assert.match(html, /input\.inputMode = "numeric"/);
  assert.match(html, /input\.pattern = "\[0-9\]\*"/);
  assert.match(html, /input\.setSelectionRange\(0, input\.value\.length\)/);
  assert.match(html, /configureNumericInput\(remaining, \{ selectAll: true \}\)/);
  assert.match(html, /querySelector\("\.entry-count"\)\?\.focus\(\)/);
  assert.match(html, /class="entry-count" type="text" inputmode="numeric"/);
  assert.doesNotMatch(html, /class="entry-count" type="number"/);
});
