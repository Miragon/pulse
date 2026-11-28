import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { Client } from "@miragon/pulse-c7-client"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { type RecordedConfig, recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { EngineEntry } from "./engine-provider.js"
import { CAMUNDA_8_TOOLS, camunda8Views } from "./lib/shared/camunda8-scope.js"
import { createEngineRegistry, EngineDialectNotServedError } from "./lib/engine/resolve-engine.js"
import { engineModule } from "./module.js"
import { createPlugin } from "./plugin.js"
import { ENGINE_LIST_ENGINES, ENGINE_OPEN_COCKPIT } from "./tool-names.js"
import type { CockpitSection } from "./view-models.js"

/**
 * Every text that states what the server reads a Camunda 8 engine with derives it from the marks
 * (#694, F76): the module instructions, the refusal ENGINE_DIALECT_NOT_SERVED, the boot's warning
 * about a default and the table of docs/mcp/camunda8.md name exactly the tools, feeds and cockpit
 * views a server of Camunda 8 engines alone lists, as the boot registers them by their marks,
 * wherever a mark is declared (a registrar tool's, a feed's, a route's, a widget tool's own). A
 * tool, feed or route that comes to serve the dialect fails here until each text names it, and one
 * that stops fails until each text drops it. The cockpit's model context of such an engine names
 * its views by `camunda8Views`, held here too; what each hand-written sentence claims of the
 * scope, scripts/camunda8-scope.test.mjs holds.
 */

const C7 = { id: "prod", baseUrl: "http://prod.example/engine-rest" }
const C8 = { id: "c8", baseUrl: "https://c8.example/v2", flavor: "camunda8" as const }

/** A registry over `engines`, where `boards` name the cluster. */
function registryOver(engines: EngineEntry[], boards: readonly string[] = []) {
  return createEngineRegistry(engines, () => ({}) as unknown as Client, {
    contractRuntime: () => () => new FakeEngine(FakeWorld.seed().state),
    boardsNaming: (id) => (id === C8.id ? boards : []),
  })
}

/** An app-only feed: its `ui.visibility` leaves the model out. */
function isAppOnly({ _meta }: RecordedConfig): boolean {
  const visibility = (_meta?.ui as { visibility?: unknown } | undefined)?.visibility
  return Array.isArray(visibility) && !visibility.includes("model")
}

/**
 * What the module lists on a server of Camunda 8 engines alone, with every toolset and option on:
 * its model tools, its app-only feeds and the views `engine_open_cockpit` offers.
 */
function servedOnCamunda8() {
  const recording = recordingModuleServer()
  const config = {
    engines: [C8],
    toolset: "admin",
    allowDeployments: true,
    incidentIssueRepository: "acme/ops",
  }
  createPlugin(config, registryOver([C8])).register(recording.server)
  const registered = [...recording.tools.values()]
  const names = (appOnly: boolean) =>
    registered
      .filter(({ config }) => isAppOnly(config) === appOnly)
      .map(({ name }) => name)
      .sort()
  const cockpit = recording.tools.get(ENGINE_OPEN_COCKPIT)?.config.inputSchema as
    z.ZodObject | undefined
  const view = cockpit?.shape.view as z.ZodType | undefined
  const views = view === undefined ? [] : (z.toJSONSchema(view) as { enum: string[] }).enum
  return { tools: names(false), feeds: names(true), views: [...views].sort() }
}

const namesIn = (text: string) => [...new Set(text.match(/\bengine_[a-z_]+/g))].sort()

/** The views a text names after "(view": "board or landing". */
function viewsIn(text: string): string[] {
  const named = /\(view ([a-z-]+(?: or [a-z-]+)*)\)/.exec(text)?.[1]
  return named === undefined ? [] : named.split(" or ")
}

/** The one line of `instructions` that starts with `head`. */
function lineOf(instructions: string, head: string): string {
  const lines = instructions.split("\n").filter((line) => line.startsWith(head))
  expect(lines).toHaveLength(1)
  return lines[0] ?? ""
}

/** The refusal of a Camunda 7 call to the cluster, where `boards` name it. */
function refusalText(boards: readonly string[]): string {
  const registry = registryOver([C7, C8], boards)
  const backend = registry.backends.get(C8.id) ?? expect.fail("no backend for c8")
  return new EngineDialectNotServedError(C8.id, backend, ["c7"]).message
}

describe("the Camunda 8 scope, as the marks serve it", () => {
  const served = servedOnCamunda8()
  const reading = [ENGINE_OPEN_COCKPIT, ...CAMUNDA_8_TOOLS].sort()
  const scoped = [ENGINE_LIST_ENGINES, ...reading].sort()
  const views: readonly CockpitSection[] = camunda8Views()

  it("names every tool and view a server of Camunda 8 engines alone offers, and no other", () => {
    expect(scoped).toEqual(served.tools)
    // The views the texts name, and those the cockpit's model context of such an engine sends.
    expect([...views].sort()).toEqual(served.views)
    expect(views.length).toBeGreaterThan(0)
  })

  it("is what the instructions say beside a Camunda 7 engine and alone", () => {
    for (const toolset of ["read-only", "operations", "admin"]) {
      const mixed = lineOf(
        engineModule.instructions({ engines: [C7, C8], toolset }),
        "- Camunda 8 engines ",
      )
      const alone = lineOf(engineModule.instructions({ engines: [C8], toolset }), "- Its engines ")
      for (const line of [mixed, alone]) {
        expect(namesIn(line)).toEqual(scoped)
        expect(viewsIn(line)).toEqual(views)
        expect(line).not.toMatch(/boards only/)
      }
    }
  })

  it("is what a refusal says, with the boards that name the engine or without", () => {
    for (const boards of [["orders"], []]) {
      const text = refusalText(boards)
      expect(namesIn(text).filter((name) => name !== ENGINE_LIST_ENGINES)).toEqual(reading)
      expect(viewsIn(text)).toEqual(views)
      expect(text).not.toMatch(/boards only/)
    }
  })

  it("is what the boot says of a Camunda 8 default beside a Camunda 7 engine", () => {
    const profiles = { prod: { url: C7.baseUrl }, c8: { url: C8.baseUrl, flavor: "camunda8" } }
    const [warning] = engineModule
      .bootWarnings({ ENGINES_JSON: JSON.stringify({ defaultProfile: "c8", profiles }) })
      .filter((text) => text.includes("ENGINE_DIALECT_NOT_SERVED"))
    expect(namesIn(warning ?? "")).toEqual(reading)
    expect(viewsIn(warning ?? "")).toEqual(views)
  })

  // The page of the docs site that states the scope: its table lists each tool, feed and cockpit
  // view a Camunda 8 cluster is served by, one view per row of engine_open_cockpit.
  it("is what the table of docs/mcp/camunda8.md lists", () => {
    const page = fs.readFileSync(
      path.join(import.meta.dirname, "../../../../../docs/mcp/camunda8.md"),
      "utf8",
    )
    const table = page
      .slice(page.indexOf("## What a server offers"))
      .split("\n")
      .filter((line) => line.startsWith("| `"))
    const first = (row: string) => row.split("|")[1] ?? ""
    expect(namesIn(table.map(first).join(" "))).toEqual([...served.tools, ...served.feeds].sort())
    const cockpitViews = table
      .map(first)
      .flatMap((cell) => /`engine_open_cockpit` with `view` `([a-z-]+)`/.exec(cell)?.[1] ?? [])
    expect([...cockpitViews].sort()).toEqual(served.views)
  })
})
