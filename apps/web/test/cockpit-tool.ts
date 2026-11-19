import { engineModule } from "@miragon/pulse-engine-connector"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { COCKPIT_VIEW } from "../src/router/routes.js"

/** A property of the cockpit tool's input, as its JSON Schema names it. */
export interface Property {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
}

/** An engine as the engine module's configuration names it (its schema parses it). */
export interface EngineEntry {
  readonly id: string
  readonly baseUrl: string
  readonly flavor?: string
}

/** One Camunda 7 engine, the configuration the page's addresses are held to. */
const C7_ENGINE: EngineEntry = { id: "prod", baseUrl: "http://prod.example/engine-rest" }

/**
 * The cockpit tool's input properties, as the engine module registers the tool over `engines`, in
 * the JSON Schema a host and the page's server read: what the page's addresses must carry, and
 * the views (`view`'s enum) the server offers those engines' dialects.
 */
export function cockpitProperties(
  engines: readonly EngineEntry[] = [C7_ENGINE],
): Readonly<Record<string, Property>> {
  const recording = recordingModuleServer()
  engineModule.createPlugin({ engines: [...engines] }).register(recording.server)
  const schema = recording.tool(COCKPIT_VIEW).config.inputSchema as {
    toJSONSchema(): { properties: Record<string, Property> }
  }
  return schema.toJSONSchema().properties
}
