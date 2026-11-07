#!/usr/bin/env node

import type { MCPServer } from "mcp-use"
import { runComposedServer } from "@miragon/pulse-widget-shell/server"
import { createApp } from "./app.js"

// The whole boot (module selection, the mcp-use server with its
// middleware, the Host/Origin guard and the operational routes) is
// `createApp`, which the tests boot too. `runComposedServer` runs it:
// production (`node dist/index.js`) serves through the shared body-capped
// listener and drains on SIGTERM/SIGINT; `mcp-use dev` imports this entry,
// takes the default export and owns the socket itself (no body cap, no
// drain). A setting the boot refuses prints as one line, then exit 1.
//
// Explicit annotation: the inferred type reaches into hono internals TS
// cannot name portably (TS2742).
const app: MCPServer<unknown> = await runComposedServer(createApp)
export default app
