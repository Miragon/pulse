import { afterEach, describe, expect, test, vi } from "vitest"
import type { EngineList } from "../src/protocol.js"
import activate, { deactivate } from "../src/worker/main.js"
import { REMOTE_ENDPOINT, WorkerHarness } from "./worker-harness.js"

afterEach(() => {
  deactivate()
})

async function started(harness: Promise<WorkerHarness>): Promise<WorkerHarness> {
  const ready = await harness
  activate(ready.orca.api())
  return ready
}

describe("the Pulse worker", () => {
  test("lists the engines of the project file in the focused workspace", async () => {
    const harness = await started(WorkerHarness.withProject())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.projectFile).toBe(harness.projectFile)
    expect(list.problems).toEqual([])
    expect(list.engines.map((row) => [row.name, row.active, row.writable, row.needsLogin])).toEqual(
      [
        ["shop-dev", true, true, false],
        ["prod-eu", false, false, true],
      ],
    )
    expect(list.engines[0]?.definitions.length).toBeGreaterThan(0)
  })

  test("shows the active engine in the status bar", async () => {
    const harness = await started(WorkerHarness.withProject())

    await harness.request("engines.list")

    await vi.waitFor(() => {
      const items = harness.orca.callsOf("statusBar.update") as { text?: string }[]
      expect(items.at(-1)?.text).toMatch(/^shop-dev · LOCAL · \d+ with incident$/)
    })
  })

  test("names an engine it cannot reach instead of listing its processes", async () => {
    const harness = await WorkerHarness.withProject()
    harness.adapter.unreachable.add(REMOTE_ENDPOINT)
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList
    const remote = list.engines[1]

    expect(remote?.definitions).toEqual([])
    expect(remote?.problem?.needsCredentials).toBe(false)
    expect(remote?.description).toBe("prod-eu.shop.invalid")
  })

  test("asks for a login when the engine refuses the one it has", async () => {
    const harness = await WorkerHarness.withProject()
    harness.adapter.unauthorized.add(REMOTE_ENDPOINT)
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.engines[1]?.problem?.needsCredentials).toBe(true)
  })

  test("falls back to the local engine without a project file", async () => {
    const harness = await started(WorkerHarness.empty())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.projectFile).toBe("")
    expect(list.engines.map((row) => row.name)).toEqual(["local"])
  })

  test("names a configured project file it cannot read", async () => {
    const harness = await WorkerHarness.empty()
    harness.orca.settings.set("projectFile", `${harness.root}/missing.json`)
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.problems).toEqual([expect.stringContaining("Pulse can't read this file")])
  })

  test("switches the active engine and tells the panel", async () => {
    const harness = await started(WorkerHarness.withProject())

    await harness.request("engines.activate", { engine: "prod-eu" })
    const list = (await harness.request("engines.list")) as EngineList

    expect(list.engines.find((row) => row.active)?.name).toBe("prod-eu")
    expect(harness.orca.storage.get("activeEngine")).toBe("prod-eu")
    expect(harness.orca.postsOf("engines.changed")).toContainEqual({ reason: "reload" })
  })

  test("reads a project file chosen while it still loads the first one", async () => {
    const harness = await WorkerHarness.withProject()
    const other = await WorkerHarness.withProject({ other: { url: "http://localhost:9/x" } })
    activate(harness.orca.api())

    await harness.request("engines.setProjectFile", { path: other.projectFile })
    const list = (await harness.request("engines.list")) as EngineList

    expect(harness.orca.settings.get("projectFile")).toBe(other.projectFile)
    expect(list.engines.map((row) => row.name)).toEqual(["other"])
  })

  test("saves a login in the OS key store and reloads the engines", async () => {
    const harness = await started(WorkerHarness.withProject())

    const answer = await harness.request("engines.setCredentials", {
      engine: "prod-eu",
      username: "demo",
      password: "secret",
    })

    expect(answer).toEqual({ ok: true })
    expect([...harness.orca.secrets.values()]).toEqual(
      expect.arrayContaining(["demo", "secret", "https://prod-eu.shop.invalid"]),
    )
    expect(harness.orca.postsOf("engines.changed")).toContainEqual({ reason: "login" })
  })

  test("refuses a login for an engine it does not know", async () => {
    const harness = await started(WorkerHarness.withProject())

    const answer = await harness.request("engines.setCredentials", {
      engine: "gone",
      username: "demo",
      password: "secret",
    })

    expect(answer).toEqual({ ok: false })
  })

  test("saves no login without an OS key store", async () => {
    const harness = await WorkerHarness.withProject()
    harness.orca.hostAnswers = {
      ...harness.orca.hostAnswers,
      "secrets.protection": { status: "none" },
    }
    activate(harness.orca.api())

    const answer = await harness.request("engines.setCredentials", {
      engine: "prod-eu",
      username: "demo",
      password: "secret",
    })

    expect(answer).toEqual({ ok: false })
    expect(harness.orca.secrets.size).toBe(0)
    expect(harness.orca.logs).toContain(
      "Logins are not saved: this machine offers no OS key store to Orca.",
    )
  })

  test("needs a worker Node with JSON.rawJSON", () => {
    const logs: string[] = []
    const rawJSON = Object.getOwnPropertyDescriptor(JSON, "rawJSON")
    Reflect.deleteProperty(JSON, "rawJSON")
    try {
      activate({ log: (line: string) => logs.push(line) } as never)
    } finally {
      if (rawJSON !== undefined) {
        Object.defineProperty(JSON, "rawJSON", rawJSON)
      }
    }

    expect(logs).toEqual(["Pulse needs a worker Node with JSON.rawJSON (Node 21 or later)."])
  })
})
