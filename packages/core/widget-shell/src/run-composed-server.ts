import type { MCPServer } from "mcp-use"
import { bootErrorLine } from "./boot-error.js"
import type { ComposedServer, ListenOptions } from "./composed-server.js"

export interface RunComposedServerOptions {
  /** Handed to `listen()`; `handleSignals` defaults to `true`. */
  listen?: ListenOptions
}

/** Exits only once the line is written: a pipe on macOS writes asynchronously. */
async function exitOnBootError(error: unknown): Promise<never> {
  const line = bootErrorLine(error)
  await new Promise<void>((resolve) => process.stderr.write(`${line}\n`, () => resolve()))
  process.exit(1)
}

/**
 * The server entry's one call (`src/index.ts`): boots `create` (the root's `createApp`, which the
 * tests boot too), then listens with the drain on SIGTERM/SIGINT unless `mcp-use dev` serves the
 * returned app. A failed boot or listen prints ONE line, the server's name and the error's
 * sentence (a ZodError as `path: message`), without a stack, and the process exits 1. Under
 * `mcp-use dev` the error propagates instead: the dev CLI owns the process and keeps the previous
 * server on a failed reload. `createComposedServer` itself still rejects with the error.
 */
export async function runComposedServer(
  create: () => Promise<ComposedServer>,
  options: RunComposedServerOptions = {},
): Promise<MCPServer<unknown>> {
  if (process.env.MCP_USE_DEV_CLI) return (await create()).app
  try {
    const composed = await create()
    await composed.listen({ handleSignals: true, ...options.listen })
    return composed.app
  } catch (error) {
    return exitOnBootError(error)
  }
}
