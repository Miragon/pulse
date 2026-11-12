import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { assertWritable, type EngineRegistry } from "./resolve-engine.js"

/** The `engine` argument of a call, when it names one. */
function engineArg(args: unknown): string | undefined {
  const engine = (args as { engine?: unknown } | undefined)?.engine
  return typeof engine === "string" ? engine : undefined
}

/**
 * `readOnly` per profile: every tool without `readOnlyHint` (a write; MCP reads an absent hint as
 * a write) fails with ENGINE_READ_ONLY before its handler runs when the engine it would go to
 * has a read-only profile. Every write registers through the registrar (invariant 8), so this
 * is the one place; the transport refuses a write on such an engine as well.
 */
export function withReadOnlyEngines(
  register: ToolRegistrar<EngineRegistry>,
): ToolRegistrar<EngineRegistry> {
  return (config) => {
    if (config.annotations?.readOnlyHint === true) {
      register(config)
      return
    }
    const { handler } = config
    register({
      ...config,
      handler: (registry, args, ctx) => {
        assertWritable(engineArg(args), registry)
        return handler(registry, args, ctx)
      },
    })
  }
}
