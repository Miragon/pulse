import path from "node:path"
import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client"
import type { ComposedServer, RunningServer } from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import { stubNeutralEnv } from "./neutral-env.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

/** One booted composition and a client connected to it; close it with {@link closeComposition}. */
export interface BootedComposition {
  composed: ComposedServer
  app: RunningServer
  client: Client
  origin: string
  tools: Tool[]
}

/**
 * Boots the REAL composition in-process (`createApp`, exactly what `src/index.ts` runs, with a
 * stand-in widget bundle) and lists its tools. The env is neutral (`stubNeutralEnv`): no OAuth,
 * edge override or toolset from the developer's shell, and a dead engine URL: tools register
 * fine; only actual calls would fail. Undo the env with `vi.unstubAllEnvs()`.
 */
export async function bootComposition(
  env: Record<string, string | undefined> = {},
): Promise<BootedComposition> {
  stubNeutralEnv(env)
  const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
  const app = await composed.listen({ port: 0, host: "127.0.0.1" })
  const origin = `http://127.0.0.1:${app.port}`
  const client = new Client({ name: "guard-test", version: "0.0.0" })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)))
    return { composed, app, client, origin, tools: (await client.listTools()).tools }
  } catch (error) {
    await app.shutdown()
    throw error
  }
}

export async function closeComposition(booted: BootedComposition | undefined): Promise<void> {
  await booted?.client.close()
  await booted?.app.shutdown()
}

/**
 * One `MCP_ACTIVE_MODULES` selection per toolset DEPTH: boot `i` runs every composed module on
 * its `i`-th declared toolset (its last one once it has no more; a module without toolsets by
 * its bare name). Together the boots register every tool any toolset registers; the default
 * boot puts every module on its read-only floor, which hides every tool above it. Derived from
 * `MODULES`, not hand-listed: your module's toolsets are covered the moment it declares them.
 */
export function toolsetSelections(): string[] {
  const depth = Math.max(1, ...MODULES.map((module) => module.toolsets?.names.length ?? 1))
  return Array.from({ length: depth }, (_, i) =>
    MODULES.map(({ name, toolsets }) =>
      toolsets ? `${name}:${toolsets.names[Math.min(i, toolsets.names.length - 1)]}` : name,
    ).join(","),
  )
}

/** Whether `name` is among the modules this server composes (`MODULES` in `src/setup.ts`). */
export const isComposed = (name: string): boolean => MODULES.some((module) => module.name === name)

/** The tool's `_meta.ui` block, which mcp-use emits from its `view`/`visibility` binding. */
export function uiOf(tool: Tool): Record<string, unknown> {
  return (tool._meta?.ui ?? {}) as Record<string, unknown>
}

/** A tool that opens a view: it binds its own `ui://views/<name>.html` resource. */
export const isViewBound = (tool: Tool): boolean => typeof uiOf(tool).resourceUri === "string"

/** An app-only tool: a `*_data` feed only the view calls, hidden from the model. */
export function isAppOnly(tool: Tool): boolean {
  const { visibility } = uiOf(tool)
  return Array.isArray(visibility) && visibility.includes("app")
}
