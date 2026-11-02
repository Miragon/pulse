#!/usr/bin/env node

import type { MCPServer } from "mcp-use"
import { createApp } from "./app.js"

// The whole boot — selection, the mcp-use server with its
// middleware, the Host/Origin guard and the operational routes — is
// `createApp`, which the e2e suites boot too.
const composed = await createApp()

// Explicit annotation: default-exporting the instance makes its type public
// API, and the inferred type reaches into hono internals TS cannot name
// portably (TS2742).
const app: MCPServer<unknown> = composed.app
export default app

// `mcp-use dev` imports this entry, takes the default export, and owns the
// socket + process lifecycle itself (no body cap, no drain); production
// (`node dist/index.js`) serves through the shared body-capped listener and
// drains on SIGTERM/SIGINT (Docker stop, Fly scale-to-zero, Ctrl-C).
if (!process.env.MCP_USE_DEV_CLI) {
  await composed.listen({ handleSignals: true })
}
