# Guitar Hole Count

A deliberately tiny ChatGPT MCP App for one job: enter the guitar-wall hole count in the morning, decrement it as guitars are broken out, and recall the current remaining balance later.

The repository also contains a rabbit r1 creation optimized for its 240×282
display, scroll wheel, and side button. Both clients use the same authoritative
snapshot on the Mac mini.

## Product behavior

- One current JSON snapshot only; there is no history.
- A new morning count completely replaces the previous snapshot and resets breakout progress.
- Counts cannot go below zero or above their morning starting value.
- One natural-language call can update multiple brands/categories atomically.
- The ChatGPT card has a one-tap `−` control with an immediate optimistic update.
- Remaining counts stay editable; direct corrections preserve legitimate breakout progress.
- The most recent decrement offers a short-lived Undo action.
- The card includes a focused morning-count editor with iPhone numeric-keypad
  inputs; tapping a zeroed count selects the zero so the first digit replaces it.
- `Boutique` and `Misc. Acoustic` remain fixed as the first and last wall
  categories while the saved middle order is preserved.
- The r1 uses its wheel as a focused quantity carousel and retains the same
  one-tap `−` breakout control.
- Revision checks prevent an r1 correction from overwriting a newer ChatGPT
  update.

State is stored in `data/state.json`, or in `$DATA_DIR/state.json` when `DATA_DIR` is set. Each successful mutation also refreshes `state.backup.json`; if the primary file is ever unreadable, the service falls back to that redundant snapshot.

## MCP tools

- `show_hole_count` — reads the current snapshot and renders the card.
- `set_morning_count` — replaces the current snapshot.
- `break_out_guitars` — decrements one or more categories in one call.
- `correct_hole_count` — sets observed remaining counts while preserving breakout progress.
- `adjust_hole_balance` — applies signed corrections to one or more categories.

Only `show_hole_count` links to the UI resource. Mutations return the same authoritative structured snapshot, allowing the mounted widget to update without remounting.
The server keeps the previous widget URI registered as a compatibility alias so
an already-connected ChatGPT client can still resolve the card after an update.

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

The server binds to the loopback interface by default, so it is not directly exposed to other devices on the local network. Local URLs:

- MCP endpoint: `http://localhost:8787/mcp`
- Health/current snapshot: `http://localhost:8787/`
- Standalone UI preview: `http://localhost:8787/preview`
- rabbit r1 creation preview: `http://localhost:8787/r1/`

R1 synchronization is disabled unless `R1_API_TOKEN` or `R1_API_TOKEN_FILE`
is configured. The macOS installer generates a mode-`600` token file on first
deployment and preserves it across later deployments.

## Connect from ChatGPT

This Mac uses OpenAI Secure MCP Tunnel for the permanent connection. The MCP server stays private on `127.0.0.1`; the tunnel client makes an outbound-only connection to OpenAI, so no inbound port or public origin is exposed.

Tunnel ID:

```text
tunnel_6ab97e25d3d88191bfaede0cb6c50c70
```

### Keep the prototype running on this Mac

For day-to-day use, the repository includes project-specific macOS LaunchAgents for both the MCP server and OpenAI tunnel client. The installer copies a runnable bundle to `~/Library/Application Support/GuitarHoleCount`, outside macOS's protected Documents area. Existing live state in that runtime is preserved across redeploys. The agents start at login and macOS restarts either process if it exits:

```bash
./scripts/deploy-macos-launch-agents.sh
```

The installer expects `CONTROL_PLANE_API_KEY` in the git-ignored `.env.local`, writes a mode-`600` runtime copy outside the repository, and never embeds the credential in a plist or YAML profile. Runtime logs are written under `~/Library/Application Support/GuitarHoleCount/data/`. Run the installer again after changing server or widget code.

In ChatGPT:

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open **ChatGPT Plugins**, click **+**, choose **Tunnel**, and select or paste the tunnel ID above.
3. Start a new chat, enable Guitar Hole Count from the **+ / More** menu, and prompt: `Open my guitar hole count.`
4. Refresh the plugin connection after changing tool schemas, metadata, or the widget resource.

Useful end-to-end prompts:

- `Open my guitar hole count.`
- `Set today's count to Fender 17, Gibson 9, Ibanez 12.`
- `Break out 3 Fender and 2 Ibanez.`
- `How many holes are left?`
- `Put one Fender hole back; I tapped it by mistake.`

## Rabbit r1 creation

The static creation lives in [`r1/`](r1/). Its core workflow deliberately does
not invoke the r1 LLM:

Hosted creation: <https://seaneschen.github.io/creations-sdk/guitar-hole-count/>

- Tap a quantity to focus it.
- Briefly press the side button to enter wheel mode.
- Turn the wheel to adjust that quantity.
- Briefly press again to save and return.
- Tap `−` to break out one guitar immediately.
- Start a new morning to retain category names with every count reset to zero.

On first launch, generate a ten-minute pairing code on the Mac mini and enter
its six digits on the r1:

```bash
./scripts/create-r1-pairing-code.sh
```

The one-time code is exchanged for a revocable device token, distinct from the
Mac mini's service credential. Current OS3 builds may clear creation storage
during a full reboot and strip URL fragments during installation, so the
production install QR opens a private tokenized path on the Mac mini's HTTPS
tunnel. Each launch validates that path and restores an HttpOnly API session;
it does not depend on device storage. The private path passes through ngrok and
may appear in ngrok request logs, but its credential is scoped only to this
guitar count and can be rotated. When the Mac mini cannot be reached, mutations
remain unavailable so the r1 and ChatGPT values cannot silently diverge.

Long-press is reserved for a later voice experiment. The currently published
Creations SDK documents long-press events, microphone access, and text messages
to the r1 LLM, but not a dependable creation-level speech-transcription result.
The production counting path therefore does not depend on voice or LLM credits.

The authenticated JSON API is intentionally narrow:

- `GET /api/v1/snapshot`
- `POST /api/v1/pair`
- `PUT /api/v1/morning`
- `POST /api/v1/breakouts`
- `PATCH /api/v1/corrections`
- `POST /api/v1/adjustments`

All requests require `Authorization: Bearer <token>`. Mutations carry the last
observed revision and receive HTTP `409` plus the current snapshot if another
client changed the wall first.

## Architecture

```text
server/
  index.js        process entry point
  http.js         health, preview, and /mcp transport
  mcp.js          tools, schemas, metadata, and widget resource
  store.js        authoritative JSON snapshot and validation
web/
  hole-count-widget.html
r1/
  index.html      r1 creation shell
  styles.css      fixed-screen presentation
  core.js         API client and deterministic count helpers
  app.js          touch, wheel, side-button, storage, and sync behavior
tests/
```

The widget uses the MCP Apps JSON-RPC bridge (`ui/initialize`, `ui/notifications/tool-result`, and `tools/call`). `window.openai` is not required for its baseline behavior.

## Official implementation references

- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Define tools](https://developers.openai.com/plugins/plan/tools)
- [Plugin UI reference](https://developers.openai.com/plugins/reference)
