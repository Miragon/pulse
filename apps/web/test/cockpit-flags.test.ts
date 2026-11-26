import { describe, expect, it } from "vitest"
import { routeOf } from "../src/router/routes.js"
import { cockpitProperties } from "./cockpit-tool.js"

/**
 * The cockpit's query (the address of every view before the page's own addresses, which the page
 * still reads) reaches `engine_open_cockpit` one argument per parameter, as text, but for the
 * arguments that take no text (src/router/routes.ts, `COCKPIT_FLAGS`): those read `true` and
 * `false`. The list copies the tool's input schema, so this holds it to the schema as the tool
 * registers it: a boolean the connector adds fails here until the page reads it, and the page reads
 * no other argument as one.
 */

/** The argument the page makes of `?<key>=<value>` on the cockpit's old page, beside a view. */
function argumentOf(key: string, value: string): unknown {
  const search = key === "view" ? `?view=${value}` : `?view=overview&${key}=${value}`
  const route = routeOf({ pathname: "/app/cockpit", search })
  return route.kind === "view" ? route.place[key] : undefined
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
