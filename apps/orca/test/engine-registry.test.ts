import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { WriteAudit } from "@miragon/pulse-runtime-view/host-kit"
import { EngineRegistry } from "../src/worker/engine-registry.js"
import { OrcaSettings } from "../src/worker/orca-settings.js"
import { OrcaWorkspaces } from "../src/worker/orca-workspaces.js"
import { StatusBar } from "../src/worker/status-bar.js"
import { LOCAL_ENDPOINT, WorkerHarness } from "./worker-harness.js"

class RegistryHarness {
  readonly registry: EngineRegistry
  readonly statusBar: StatusBar

  constructor(readonly worker: WorkerHarness) {
    const api = worker.orca.api()
    this.registry = new EngineRegistry(
      api,
      new OrcaSettings(api),
      new OrcaWorkspaces(api),
      new WriteAudit({ info: () => undefined }),
    )
    this.statusBar = new StatusBar(api, this.registry)
  }

  static async loaded(
    prepare: (worker: WorkerHarness) => Promise<void> = () => Promise.resolve(),
    project: Promise<WorkerHarness> = WorkerHarness.withProject(),
  ) {
    const worker = await project
    await prepare(worker)
    const harness = new RegistryHarness(worker)
    await harness.registry.reload()
    return harness
  }

  environmentOf(name: string): string | undefined {
    return this.registry.byName(name)?.badge.environment
  }

  async lastItem(): Promise<Record<string, unknown> | undefined> {
    await this.statusBar.render()
    return this.worker.orca.callsOf("statusBar.update").at(-1) as Record<string, unknown>
  }
}

describe("the engine registry", () => {
  test("classifies engines by the workspace settings next to the project file", async () => {
    const harness = await RegistryHarness.loaded(async (worker) => {
      await mkdir(join(worker.root, ".vscode"))
      await writeFile(
        join(worker.root, ".vscode", "settings.json"),
        JSON.stringify({ "pulse.environments": { "prod-eu": "production" } }),
      )
    })

    expect(harness.environmentOf("prod-eu")).toBe("production")
    expect(harness.environmentOf("shop-dev")).toBe("local")
  })

  test("reads user environments written as JSON and ignores what does not parse", async () => {
    const harness = await RegistryHarness.loaded(async (worker) => {
      worker.orca.settings.set("environments", '{"prod-eu":"test"}')
      await mkdir(join(worker.root, ".vscode"))
      await writeFile(join(worker.root, ".vscode", "settings.json"), "{ not json")
    })

    expect(harness.environmentOf("prod-eu")).toBe("test")
    expect(harness.registry.environmentSettings().workspace).toEqual([undefined])
  })

  test("ignores user environments that are no object", async () => {
    const harness = await RegistryHarness.loaded((worker) => {
      worker.orca.settings.set("environments", "[unclosed")
      return Promise.resolve()
    })

    expect(harness.registry.environmentSettings().user).toBeUndefined()
  })

  test("applies changed live update settings to the running connections", async () => {
    const harness = await RegistryHarness.loaded()
    harness.worker.orca.settings.set("liveUpdates.local", "off")
    harness.worker.orca.settings.set("liveUpdates.test", "sometimes")

    await harness.registry.applyLiveSettings()

    expect(harness.registry.byName("shop-dev")?.live.setting).toBe("off")
  })

  test("tells who listens about a write until they leave", async () => {
    const harness = await RegistryHarness.loaded()
    const written = vi.fn()
    const leave = harness.registry.onDidWrite(written)

    harness.registry.noteWrite()
    leave()
    harness.registry.noteWrite()

    expect(written).toHaveBeenCalledOnce()
  })

  test("falls back to the first engine when the stored one is gone", async () => {
    const harness = await RegistryHarness.loaded((worker) => {
      worker.orca.storage.set("activeEngine", "gone")
      return Promise.resolve()
    })

    expect(harness.registry.active()?.target.name).toBe("shop-dev")
  })

  test("finds no project file without a workspace", async () => {
    const harness = await RegistryHarness.loaded((worker) => {
      worker.orca.hostAnswers = { "workspace.list": { workspaces: [] } }
      return Promise.resolve()
    })

    expect(harness.registry.projectFiles()).toEqual([])
    expect(harness.registry.all().map((connection) => connection.target.name)).toEqual(["local"])
  })

  test("asks to rename a project file under its former name and lists none of its engines, nor the local one", async () => {
    const harness = await RegistryHarness.loaded(undefined, WorkerHarness.withFormerProject())
    const former = harness.worker.formerProjectFile

    expect(harness.registry.projectFiles()).toEqual([])
    expect(harness.registry.formerProjectFiles()).toEqual([former])
    expect(harness.registry.configurationProblems().map((problem) => problem.label())).toEqual([
      ".pulse-cli.json: Pulse reads .pulse.json now. Rename this file to .pulse.json; its content stays.",
    ])
    expect(harness.registry.all()).toEqual([])
  })

  test("reads .pulse.json and leaves a former file beside it alone", async () => {
    const harness = await RegistryHarness.loaded(async (worker) => {
      await writeFile(
        worker.formerProjectFile,
        JSON.stringify({ profiles: { old: { url: LOCAL_ENDPOINT } } }),
      )
    })

    expect(harness.registry.projectFiles()).toEqual([harness.worker.projectFile])
    expect(harness.registry.configurationProblems()).toEqual([])
    expect(harness.registry.all().map((connection) => connection.target.name)).toEqual([
      "shop-dev",
      "prod-eu",
    ])
  })

  test("names a project file it finds but cannot read and lists no engine, nor the local one", async () => {
    const harness = await RegistryHarness.loaded(async (worker) => {
      await mkdir(worker.projectFile)
      await writeFile(
        worker.formerProjectFile,
        JSON.stringify({ profiles: { old: { url: LOCAL_ENDPOINT } } }),
      )
    }, WorkerHarness.empty())

    expect(harness.registry.projectFiles()).toEqual([])
    expect(harness.registry.formerProjectFiles()).toEqual([])
    expect(harness.registry.configurationProblems().map((problem) => problem.label())).toEqual([
      ".pulse.json: Pulse can't read this file",
    ])
    expect(harness.registry.all()).toEqual([])
  })

  test("names a configured project file it cannot read and lists no engine in its place", async () => {
    const harness = await RegistryHarness.loaded(async (worker) => {
      const configured = join(worker.root, "engines")
      await mkdir(configured)
      worker.orca.settings.set("projectFile", configured)
    }, WorkerHarness.empty())

    expect(harness.registry.configurationProblems().map((problem) => problem.label())).toEqual([
      "engines: Pulse can't read this file",
    ])
    expect(harness.registry.all()).toEqual([])
  })

  test("reads a configured file whatever its name", async () => {
    const harness = await RegistryHarness.loaded((worker) => {
      worker.orca.settings.set("projectFile", worker.formerProjectFile)
      return Promise.resolve()
    }, WorkerHarness.withFormerProject())

    expect(harness.registry.projectFiles()).toEqual([harness.worker.formerProjectFile])
    expect(harness.registry.formerProjectFiles()).toEqual([])
  })
})

describe("the status bar", () => {
  test("warns about an engine with incidents and calls production out", async () => {
    const local = await RegistryHarness.loaded()
    const production = await RegistryHarness.loaded((worker) => {
      worker.orca.settings.set("environments", { "shop-dev": "production" })
      return Promise.resolve()
    })

    expect(await local.lastItem()).toMatchObject({ tone: "warning", icon: "edit" })
    expect(await production.lastItem()).toMatchObject({
      tone: "danger",
      text: expect.stringMatching(/^shop-dev · PROD · /) as unknown,
    })
  })

  test("leaves the incidents out when the engine does not answer", async () => {
    const harness = await RegistryHarness.loaded((worker) => {
      worker.adapter.unreachable.add(LOCAL_ENDPOINT)
      return Promise.resolve()
    })

    expect(await harness.lastItem()).toMatchObject({ text: "shop-dev · LOCAL", tone: "neutral" })
  })

  test("names a read-only engine and logs an update Orca refused", async () => {
    const harness = await RegistryHarness.loaded()
    await harness.registry.activate("prod-eu")
    harness.worker.orca.failingHostCalls.add("statusBar.update")

    await harness.statusBar.render()

    const item = harness.worker.orca.callsOf("statusBar.update").at(-1)
    expect(item).toMatchObject({ icon: "database" })
    expect(harness.worker.orca.logs).toContain("status bar: Error: statusBar.update failed")
  })

  test("renders again when the active engine's processes change", async () => {
    const harness = await RegistryHarness.loaded()
    await harness.statusBar.render()
    const before = harness.worker.orca.callsOf("statusBar.update").length

    harness.registry.active()?.definitions.forget()
    await harness.registry.active()?.definitions.read(0)

    await vi.waitFor(() => {
      expect(harness.worker.orca.callsOf("statusBar.update").length).toBeGreaterThan(before)
    })
  })
})
