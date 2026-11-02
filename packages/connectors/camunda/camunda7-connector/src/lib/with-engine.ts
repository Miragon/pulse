import { z } from "zod"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { Client } from "@miragon/pulse-camunda7-client"
import type { EngineProvider } from "../engine-provider.js"
import { resolveEngine, type EngineCallContext, type EngineRegistry } from "./resolve-engine.js"

/**
 * No description: the routing rule is stated once in `instructions.ts` (per tool it was a fifth of
 * the surface). Narrowed at boot to the configured ids, so the model reads valid ids off the enum.
 */
export const engineParamShape = {
  engine: z.string().optional(),
}

export interface EngineParamShape {
  engine: z.ZodOptional<z.ZodType<string>>
}

/**
 * A single engine still yields an enum, never a dropped property: hand-offs pass `engine` and strict input refuses unknown keys.
 * The enum names the valid ids; the routing rule is the instructions'.
 */
export function engineParamShapeFor(engines: readonly { id: string }[]): EngineParamShape {
  const [first, ...rest] = engines.map((e) => e.id)
  if (first === undefined) return engineParamShape
  return { engine: z.enum([first, ...rest]).optional() }
}

/** Swaps only the exact placeholder; a tool with its own `engine` field keeps it. */
export function withEngineParam(
  register: ToolRegistrar<EngineRegistry>,
  engines: readonly { id: string }[],
): ToolRegistrar<EngineRegistry> {
  const { engine } = engineParamShapeFor(engines)
  return (config) => {
    const shape = config.inputSchema
    if (shape?.engine !== engineParamShape.engine) return register(config)
    // Same field, narrower values: the handler's `engine?: string` holds.
    const narrowedConfig: typeof config = {
      ...config,
      inputSchema: { ...shape, engine },
    }
    return register(narrowedConfig)
  }
}

export interface EngineContext {
  engineId: string
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
}

/**
 * `call.signal` aborts engine READS when the MCP client cancels; writes always run
 * to completion (pinned in `tools/engine-errors.test.ts`).
 */
export function withEngine<TArgs extends { engine?: string }, TResult>(
  fn: (client: Client, args: TArgs, ctx: EngineContext) => Promise<TResult>,
): (registry: EngineRegistry, args: TArgs, call?: EngineCallContext) => Promise<TResult> {
  return async (registry, args, call) => {
    const { client, engineId, baseUrl, cockpitUrl, provider } = resolveEngine(
      args.engine,
      registry,
      call,
    )
    return fn(client, args, { engineId, baseUrl, cockpitUrl, provider })
  }
}
