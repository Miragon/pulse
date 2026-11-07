#!/usr/bin/env node

import type { McpHttpApp } from "@miragon/pulse-widget-shell/server"
import { runComposedServer } from "@miragon/pulse-widget-shell/server"
import { createApp } from "./app.js"

// The whole boot (module selection, the MCP server with its
// middleware, the Host/Origin guard and the operational routes) is
// `createApp`, which the tests boot too. `runComposedServer` runs it: the
// server serves through the shared body-capped listener and drains on
// SIGTERM/SIGINT, under `node dist/index.js` and under `pnpm dev` alike
// (`tsx watch` restarts it when a source or the view bundle changes). A
// setting the boot refuses prints as one line, then exit 1.
//
// Explicit annotation: the inferred type reaches into hono internals TS
// cannot name portably (TS2742).
const app: McpHttpApp = await runComposedServer(createApp)
export default app
