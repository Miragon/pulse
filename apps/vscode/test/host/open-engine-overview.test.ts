import { FakeEngine, FakeWorld } from "../../src/contract/fake/index.js"
import { DiagramCache } from "../../src/core/index.js"
import { ConnectionLive } from "./support/connection-live.js"
import { describe, expect, test, vi } from "vitest"
import type { ConnectionPicker } from "../../src/host/commands/connection-picker.js"
import { OpenEngineOverviewCommand } from "../../src/host/commands/open-engine-overview-command.js"
import type { Connection } from "../../src/host/connections/connection.js"
import { LOCAL_TARGET } from "../../src/host/connections/engine-target.js"
import { FakeRegistry } from "./support/fake-registry.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

function connection(name: string): Connection {
  const runtime = new FakeEngine(FakeWorld.seed().state)
  return {
    target: { ...LOCAL_TARGET, name },
    badge: { name, environment: "local", host: "localhost:8080" },
    runtime,
    diagrams: new DiagramCache(runtime),
    ...ConnectionLive.of(runtime),
  }
}

function overviewOf(connections: readonly Connection[], picked?: Connection) {
  const pick = vi.fn<ConnectionPicker["pick"]>(() => Promise.resolve(picked))
  const openEngine = vi.fn<(connection: Connection) => void>()
  const command = new OpenEngineOverviewCommand(
    new FakeRegistry(connections).asRegistry(),
    { pick } as unknown as ConnectionPicker,
    { openEngine },
  )
  return { command, pick, openEngine }
}

describe("Open Engine Overview", () => {
  const shopDev = connection("shop-dev")
  const shopTest = connection("shop-test")

  test("opens the engine the tree names, without asking", async () => {
    const { command, pick, openEngine } = overviewOf([shopDev, shopTest])

    await command.run("shop-test")
    await command.run("unknown")

    expect(openEngine.mock.calls).toEqual([[shopTest]])
    expect(pick).not.toHaveBeenCalled()
  })

  test("opens the only engine from the command palette, without asking", async () => {
    const { command, pick, openEngine } = overviewOf([shopDev])

    await command.run()

    expect(openEngine).toHaveBeenCalledWith(shopDev)
    expect(pick).not.toHaveBeenCalled()
  })

  test("lets you pick an engine when there are several, and opens nothing when you cancel", async () => {
    const picking = overviewOf([shopDev, shopTest], shopTest)
    const cancelling = overviewOf([shopDev, shopTest])
    const none = overviewOf([])

    await picking.command.run()
    await cancelling.command.run()
    await none.command.run()

    expect(picking.pick).toHaveBeenCalledWith("Open Engine Overview")
    expect(picking.openEngine).toHaveBeenCalledWith(shopTest)
    expect(cancelling.openEngine).not.toHaveBeenCalled()
    expect(none.pick).not.toHaveBeenCalled()
    expect(none.openEngine).not.toHaveBeenCalled()
  })
})
