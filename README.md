# Guitar Hole Count

A deliberately tiny ChatGPT MCP App for one job: enter the guitar-wall hole count in the morning, decrement it as guitars are broken out, and recall the current remaining balance later.

## Product behavior

- One current JSON snapshot only; there is no history.
- A new morning count completely replaces the previous snapshot and resets breakout progress.
- Counts cannot go below zero or above their morning starting value.
- One natural-language call can update multiple brands/categories atomically.
- The ChatGPT card has a one-tap `−` control with an immediate optimistic update.
- The card includes a focused morning-count editor.

State is stored in `data/state.json`, or in `$DATA_DIR/state.json` when `DATA_DIR` is set.

## MCP tools

- `show_hole_count` — reads the current snapshot and renders the card.
- `set_morning_count` — replaces the current snapshot.
- `break_out_guitars` — decrements one or more categories in one call.
- `adjust_hole_balance` — applies signed corrections to one or more categories.

Only `show_hole_count` links to the UI resource. Mutations return the same authoritative structured snapshot, allowing the mounted widget to update without remounting.

## Run on this Mac

This checkout includes a project-local Node 22 runtime under the git-ignored `.local/` directory. From the project root:

```bash
./scripts/npm-mac.sh install
./scripts/npm-mac.sh test
./scripts/npm-mac.sh start
```

With any system Node.js 20+ installation, the standard commands work too:

```bash
npm install
npm test
npm start
```

Local URLs:

- MCP endpoint: `http://localhost:8787/mcp`
- Health/current snapshot: `http://localhost:8787/`
- Standalone UI preview: `http://localhost:8787/preview`

## Connect from ChatGPT

ChatGPT needs a public HTTPS endpoint for local development. Start the server, then start the included local Cloudflare Tunnel binary:

```bash
.local/cloudflared tunnel --url http://localhost:8787
```

Copy the generated `https://…trycloudflare.com` URL and append `/mcp`.

In ChatGPT:

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open **ChatGPT Plugins**, click **+**, and create a connection using the public HTTPS `/mcp` URL.
3. Start a new chat, enable Guitar Hole Count from the **+ / More** menu, and prompt: `Open my guitar hole count.`
4. Refresh the plugin connection after changing tool schemas, metadata, or the widget resource.

Useful end-to-end prompts:

- `Open my guitar hole count.`
- `Set today's count to Fender 17, Gibson 9, Ibanez 12.`
- `Break out 3 Fender and 2 Ibanez.`
- `How many holes are left?`
- `Put one Fender hole back; I tapped it by mistake.`

## Architecture

```text
server/
  index.js        process entry point
  http.js         health, preview, and /mcp transport
  mcp.js          tools, schemas, metadata, and widget resource
  store.js        authoritative JSON snapshot and validation
web/
  hole-count-widget.html
tests/
```

The widget uses the MCP Apps JSON-RPC bridge (`ui/initialize`, `ui/notifications/tool-result`, and `tools/call`). `window.openai` is not required for its baseline behavior.

## Official implementation references

- [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [Plugin UI reference](https://developers.openai.com/plugins/reference)
