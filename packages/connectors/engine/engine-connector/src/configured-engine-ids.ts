import { engineConfigSchema } from "./module.js"

/**
 * The engine ids this module's raw config declares, in configuration order:
 * the server's configured fleet. Other modules take it via injection instead
 * of depending on this one: analytics reads exactly these engines from a
 * (possibly shared) Prometheus, joining on the metrics' `engine_id` label.
 */
export function configuredEngineIds(config: Record<string, unknown>): string[] {
  return engineConfigSchema.parse(config).engines.map((engine) => engine.id)
}
