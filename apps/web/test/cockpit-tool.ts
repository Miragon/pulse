import { engineModule } from "@miragon/pulse-engine-connector"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { COCKPIT_VIEW } from "../src/router/routes.js"

/** A property of the cockpit tool's input, as its JSON Schema names it. */
export interface Property {
  readonly type?: unknown
  readonly enum?: readonly unknown[]
}

/**
 * The cockpit tool's input properties, as the engine module registers the tool, in the JSON Schema
 * a host and the page's server read: what the page's addresses must carry.
 */
export function cockpitProperties(): Readonly<Record<string, Property>> {
  const recording = recordingModuleServer()
  engineModule
    .createPlugin({ engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }] })
    .register(recording.server)
  const schema = recording.tool(COCKPIT_VIEW).config.inputSchema as {
    toJSONSchema(): { properties: Record<string, Property> }
  }
  return schema.toJSONSchema().properties
}
