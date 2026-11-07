#!/usr/bin/env node

import { runComposedServer } from "@miragon/pulse-widget-shell/server"
import { createApp } from "./app.js"

// The whole boot (selection, the plugins, the MCP server, the Host/Origin
// guard and the operational routes) is `createApp`, which the e2e suites boot
// too. `runComposedServer` runs it, in production (`node dist/index.js`) and
// under `pnpm dev` (`tsx watch` restarts this entry) alike: it serves through
// the shared body-capped listener and drains on SIGTERM/SIGINT (Docker stop,
// Fly scale-to-zero, Ctrl-C). A setting the boot refuses prints as one line
// naming it, then exit 1.
await runComposedServer(createApp)
