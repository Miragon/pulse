import { describe, expect, it } from "vitest"
import { engineModule } from "@miragon/pulse-engine-connector"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { COCKPIT_VIEW, routeOf } from "../src/routes.js"

/**
 * The page's query reaches `engine_open_cockpit` one argument per parameter, as text, but for the
 * arguments that take no text (src/routes.ts, `COCKPIT_FLAGS`): those read `true` and `false`. The
 * list copies the tool's input schema, so this holds it to the schema as the tool registers it, in
 * the JSON Schema a host and the page's server read: a boolean the connector adds fails here until
 * the page reads it, and the page reads no other argument as one.
 */

type Property = { readonly type?: unknown }

/** The cockpit tool's input properties, as the engine module registers the tool. */
function cockpitProperties(): Readonly<Record<string, Property>> {
  const recording = recordingModuleServer()
  engineModule
    .createPlugin({ engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }] })
    .register(recording.server)
  const schema = recording.tool(COCKPIT_VIEW).config.inputSchema as {
    toJSONSchema(): { properties: Record<string, Property> }
  }
  return schema.toJSONSchema().properties
}

/** The argument the page makes of `?<key>=<value>` on its cockpit page. */
function argumentOf(key: string, value: string): unknown {
  const route = routeOf({ pathname: "/app/cockpit", search: `?${key}=${value}` })
  return route.kind === "view" ? route.args[key] : undefined
}

describe("the cockpit's flags in the page's query", () => {
  const properties = Object.entries(cockpitProperties())
  const flags = properties.filter(([, property]) => property.type === "boolean")

  it("finds the tool's arguments, a flag among them (the comparison is not vacuous)", () => {
    expect(properties.length).toBeGreaterThanOrEqual(10)
    expect(flags.map(([key]) => key)).toContain("failedOnly")
  })

  it("reads every argument the schema takes as a boolean as true or false", () => {
    for (const [key] of flags) {
      expect(argumentOf(key, "true"), key).toBe(true)
      expect(argumentOf(key, "false"), key).toBe(false)
    }
  })

  it("reads every other argument as the text it is", () => {
    for (const [key, property] of properties) {
      if (property.type === "boolean") continue
      expect(argumentOf(key, "true"), key).toBe("true")
    }
  })
})
