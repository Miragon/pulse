import { access, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
      { workspaceId: "shop", path: ".pulse.json" },
    ])
  })

  test("create a project file when the workspace has none", async () => {
    const harness = await started(WorkerHarness.empty())

    await harness.orca.run("pulse.configureEngines")
    const list = (await harness.request("engines.list")) as EngineList

    expect(list.projectFile).toBe(harness.projectFile)
    expect(list.engines.map((row) => row.name)).toEqual(["local"])
  })

  test("open a project file under its former name to rename it and write no second one", async () => {
    const harness = await started(WorkerHarness.withFormerProject())
    await harness.request("engines.list")

    expect(await harness.orca.run("pulse.configureEngines")).toBe(
      `Opened ${harness.formerProjectFile}.`,
    )
    await expect(access(harness.projectFile)).rejects.toThrow()
  })

  test("answer the panel's request to configure with the project file", async () => {
    const harness = await started(WorkerHarness.withProject())

    expect(await harness.request("engines.configure")).toEqual({ path: harness.projectFile })
  })

  test("show the panel the CLI config and open it only where a workspace holds it", async () => {
    const harness = await WorkerHarness.withProject()
    const inside = join(harness.root, "cli.json")
    harness.nameUserConfig(inside)
    await harness.writeUserConfig({ mine: { url: "http://localhost:1/x" } }, inside)
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.userConfig).toEqual({ path: inside, named: true, present: true, openable: true })
    expect(await harness.request("engines.openUserConfig")).toEqual({ opened: true })
    expect(harness.orca.callsOf("editor.open")).toEqual([{ workspaceId: "shop", path: "cli.json" }])
  })

  test("configure the engines in the file PULSE_CLI_CONFIG names, never in the project file", async () => {
    const harness = await WorkerHarness.withProject()
    const inside = join(harness.root, "cli.json")
    harness.nameUserConfig(inside)
    await harness.writeUserConfig({ mine: { url: "http://localhost:1/x" } }, inside)
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.projectFile).toBe("")
    expect(await harness.orca.run("pulse.configureEngines")).toBe(`Opened ${inside}.`)
    expect(harness.orca.callsOf("editor.open")).toEqual([{ workspaceId: "shop", path: "cli.json" }])
  })

  test("open no CLI config outside every workspace, and say where it is", async () => {
    const harness = await started(WorkerHarness.withProject())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.userConfig).toEqual({
      path: harness.userConfigFile,
      named: false,
      present: false,
      openable: false,
    })
    expect(await harness.request("engines.openUserConfig")).toEqual({ opened: false })
    expect(harness.orca.callsOf("editor.open")).toEqual([])
    expect(harness.orca.logs.at(-1)).toContain(`Edit ${harness.userConfigFile} in another editor.`)
  })

  test("open no CLI config it read outside every workspace, and say where it is", async () => {
    const harness = await WorkerHarness.withProject()
    await harness.writeUserConfig({ mine: { url: "http://localhost:1/x" } })
    activate(harness.orca.api())

    const list = (await harness.request("engines.list")) as EngineList

    expect(list.engines.map((row) => row.name)).toContain("mine")
    expect(list.userConfig).toEqual({
      path: harness.userConfigFile,
      named: false,
      present: true,
      openable: false,
    })
    expect(await harness.request("engines.openUserConfig")).toEqual({ opened: false })
    expect(harness.orca.callsOf("editor.open")).toEqual([])
    expect(harness.orca.postsOf("notices.show")).toEqual([
      {
        notice: {
          tone: "neutral",
          text: `Orca opens files of a workspace only, and no workspace holds your CLI config. Edit ${harness.userConfigFile} in another editor.`,
        },
      },
    ])
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

  test("reloads when a project file under its former name is renamed", async () => {
    const harness = await started(WorkerHarness.withFormerProject())
    const before = (await harness.request("engines.list")) as EngineList
    expect(before.engines).toEqual([])

    await rename(harness.formerProjectFile, harness.projectFile)

    await vi.waitFor(
      async () => {
        const list = (await harness.request("engines.list")) as EngineList
        expect(list.engines.map((row) => row.name)).toEqual(["shop-dev", "prod-eu"])
      },
      { timeout: 4000 },
    )
  })

  test("reloads when the CLI's user config appears with its folder, and when it changes", async () => {
    const harness = await started(WorkerHarness.withProject())
    await harness.request("engines.list")
    const names = async () =>
      ((await harness.request("engines.list")) as EngineList).engines.map((row) => row.name)

    await harness.writeUserConfig({ mine: { url: "http://localhost:1/x" } })
    await vi.waitFor(
      async () => {
        expect(await names()).toEqual(["shop-dev", "prod-eu", "mine"])
      },
      { timeout: 4000 },
    )

    await harness.writeUserConfig({ ours: { url: "http://localhost:1/x" } })
    await vi.waitFor(
      async () => {
        expect(await names()).toEqual(["shop-dev", "prod-eu", "ours"])
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
