import { writeFile } from "node:fs/promises"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { EngineList } from "../src/protocol.js"
import activate, { deactivate } from "../src/worker/main.js"
import { WorkerHarness } from "./worker-harness.js"

afterEach(() => {
  deactivate()
})

async function started(harness: Promise<WorkerHarness>): Promise<WorkerHarness> {
  const ready = await harness
  activate(ready.orca.api())
  return ready
}

function reloads(harness: WorkerHarness): number {
  return harness.orca.postsOf("engines.changed").filter((post) => {
    return (post as { reason: string }).reason === "reload"
  }).length
}

describe("the commands of the worker", () => {
  test("reload the engines", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.orca.run("pulse.refresh")).toBe("Pulse reloaded its engines.")
    expect(reloads(harness)).toBe(2)
  })

  test("open the processes of the active engine in a tab", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.orca.run("pulse.openEngineOverview")).toBe("Opening shop-dev.")

    await vi.waitFor(() => {
      expect(harness.orca.callsOf("editor.open")).toEqual([
        { workspaceId: "shop", path: ".pulse/views/shop-dev/shop-dev processes.pulse-view" },
      ])
    })
  })

  test("log a view that cannot open", async () => {
    const harness = await started(WorkerHarness.withProject())
    harness.orca.failingHostCalls.add("workspace.open")

    await harness.orca.run("pulse.openEngineOverview")

    await vi.waitFor(() => {
      expect(harness.orca.logs).toContain("open engine failed: Error: workspace.open failed")
    })
  })

  test("switch to the next engine and round again", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.orca.run("pulse.switchEngine")).toBe("Pulse now works with prod-eu.")
    expect(await harness.orca.run("pulse.switchEngine")).toBe("Pulse now works with shop-dev.")
  })

  test("open the project file to configure the engines", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.orca.run("pulse.configureEngines")).toBe(`Opened ${harness.projectFile}.`)
    expect(harness.orca.callsOf("editor.open")).toEqual([
      { workspaceId: "shop", path: ".pulse-cli.json" },
    ])
  })

  test("create a project file when the workspace has none", async () => {
    const harness = await started(WorkerHarness.empty())

    await harness.orca.run("pulse.configureEngines")
    const list = (await harness.request("engines.list")) as EngineList

    expect(list.projectFile).toBe(harness.projectFile)
    expect(list.engines.map((row) => row.name)).toEqual(["local"])
  })

  test("answer the panel's request to configure with the project file", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.request("engines.configure")).toEqual({ path: harness.projectFile })
  })
})

describe("what the worker follows", () => {
  test("reloads soon after the focused workspace changed", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")

    harness.orca.emit("workspace.changed", { context: { branch: "main", displayName: "shop" } })

    await vi.waitFor(() => {
      expect(reloads(harness)).toBe(2)
    })
  })

  test("keeps a configured project file when the focus changes", async () => {
    const harness = await WorkerHarness.withProject()
    harness.orca.settings.set("projectFile", harness.projectFile)
    activate(harness.orca.api())
    await harness.request("engines.list")

    harness.orca.emit("workspace.changed", { context: null })
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(reloads(harness)).toBe(1)
  })

  test("reloads after a setting changed and applies live updates at once", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")

    harness.orca.changeSetting("liveUpdates.local", "off")
    harness.orca.changeSetting("writes", "disabled")

    await vi.waitFor(async () => {
      const list = (await harness.request("engines.list")) as EngineList
      expect(list.engines[0]?.writable).toBe(false)
    })
  })

  test("logs a reload that fails", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")
    vi.spyOn(harness.orca.storage, "get").mockRejectedValue(new Error("storage is gone"))

    harness.orca.changeSetting("writes", "enabled")

    await vi.waitFor(() => {
      expect(harness.orca.logs).toContain("reload failed: Error: storage is gone")
    })
  })

  test("reloads when the project file changes on disk", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")

    await writeFile(
      harness.projectFile,
      JSON.stringify({ profiles: { only: { url: "http://localhost:1/x" } } }),
    )

    await vi.waitFor(
      async () => {
        const list = (await harness.request("engines.list")) as EngineList
        expect(list.engines.map((row) => row.name)).toEqual(["only"])
      },
      { timeout: 4000 },
    )
  })

  test("lets every save go on and refreshes local engines after a saved model", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")

    const model = harness.orca.hook("editor.save.before", { path: "order.bpmn" })
    const other = harness.orca.hook("editor.save.before", { path: "notes.md" })
    harness.orca.hook("editor.save.before", { path: "again.bpmn" })

    expect(model).toEqual({ continued: { path: "order.bpmn" } })
    expect(other).toEqual({ continued: { path: "notes.md" } })
  })
})
