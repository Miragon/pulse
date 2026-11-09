import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test, vi } from "vitest"
import { InstanceId } from "@miragon/pulse-runtime-view/contract"
import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import type { EngineRegistry } from "../src/worker/engine-registry.js"
import { OrcaSettings } from "../src/worker/orca-settings.js"
import { OrcaWorkspaces } from "../src/worker/orca-workspaces.js"
import { Prompts } from "../src/worker/prompts.js"
import { WorkerServices } from "../src/worker/worker-services.js"
import type { WriteConfirmation } from "../src/worker/write-confirmation.js"
import { FakeOrca } from "./fake-orca.js"

class Harness {
  readonly orca = new FakeOrca()
  readonly prompts = new Prompts(() => undefined)
  readonly files: string[] = []
  readonly registry = {
    projectFiles: () => this.files,
    reload: vi.fn(() => Promise.resolve()),
    applyLiveSettings: vi.fn(() => Promise.resolve()),
    noteWrite: vi.fn(),
  }
  readonly services: WorkerServices

  constructor(readonly root: string | undefined) {
    const workspaces =
      root === undefined
        ? []
        : [{ id: "shop", name: "shop", path: root, branch: null, hostId: null }]
    this.orca.hostAnswers = { "workspace.list": { workspaces } }
    const api = this.orca.api()
    this.services = new WorkerServices(
      api,
      this.registry as unknown as EngineRegistry,
      new OrcaWorkspaces(api),
      {
        settings: new OrcaSettings(api),
        prompts: this.prompts,
        confirmation: {} as WriteConfirmation,
      },
    )
  }

  static async inWorkspace(): Promise<Harness> {
    return new Harness(await mkdtemp(join(tmpdir(), "pulse-services-")))
  }

  opened(): unknown[] {
    return this.orca.callsOf("editor.open").map((call) => (call as { path: string }).path)
  }
}

describe("the services of the worker", () => {
  test("ask the Pulse panel to pick an instance", async () => {
    const harness = new Harness(undefined)
    const choice = { instanceId: InstanceId("i-1"), label: "ORD-1", description: "order v1" }

    const picking = harness.services.pick("Which instance?", [choice])
    const [prompt] = harness.prompts.list()
    harness.prompts.answer(prompt?.id ?? "", { kind: "pick", key: "i-1" })

    expect(prompt).toMatchObject({
      kind: "pick",
      choices: [{ key: "i-1", label: "ORD-1", description: "order v1" }],
    })
    expect(await picking).toBe("i-1")
  })

  test("log a notice and show it in the panel", () => {
    const harness = new Harness(undefined)

    harness.services.notice({ tone: "success", text: "Retried." })

    expect(harness.orca.logs).toEqual(["Retried."])
    expect(harness.orca.postsOf("notices.show")).toEqual([
      { notice: { tone: "success", text: "Retried." } },
    ])
  })

  test("write incident details to a file and open it", async () => {
    const harness = await Harness.inWorkspace()

    harness.services.showIncident("shop", "Charge failed…", {
      kind: "stacktrace",
      text: "at x",
      truncated: false,
    })
    harness.services.showIncident("shop", "Message", {
      kind: "errorMessage",
      text: "boom",
      truncated: false,
    })

    await vi.waitFor(() => {
      expect(harness.opened().sort()).toEqual([
        ".pulse/views/shop/Charge failed.log",
        ".pulse/views/shop/Message.txt",
      ])
    })
    const file = join(harness.root ?? "", ".pulse", "views", "shop", "Charge failed.log")
    expect(await readFile(file, "utf8")).toBe("at x")
  })

  test("log incident details it has no workspace for", async () => {
    const harness = new Harness(undefined)

    harness.services.showIncident("shop", "Failed", {
      kind: "stacktrace",
      text: "at x",
      truncated: false,
    })

    await vi.waitFor(() => {
      expect(harness.orca.logs).toEqual([
        "incident details: Error: Open a local workspace in Orca first.",
      ])
    })
  })

  test("open a source location and log one outside every workspace", async () => {
    const harness = await Harness.inWorkspace()
    const inside = pathToFileURL(join(harness.root ?? "", "src", "Worker.java")).toString()

    harness.services.openLocation({ uri: inside } as never)
    harness.services.openLocation({ uri: "file:///elsewhere/Worker.java" } as never)

    await vi.waitFor(() => {
      expect(harness.opened()).toEqual(["src/Worker.java"])
      expect(harness.orca.logs).toEqual([
        "open file:///elsewhere/Worker.java: Error: No local Orca workspace holds /elsewhere/Worker.java.",
      ])
    })
  })

  test("create the configured project file and read it", async () => {
    const harness = await Harness.inWorkspace()
    const configured = join(harness.root ?? "", "engines.json")
    harness.orca.settings.set("projectFile", configured)

    expect(await harness.services.configure()).toBe(configured)
    expect(await readFile(configured, "utf8")).toContain("http://localhost:8080/engine-rest")
    expect(harness.registry.reload).toHaveBeenCalledOnce()
  })

  test("say when it cannot open the project file", async () => {
    const harness = new Harness(undefined)
    const notice = vi.spyOn(harness.services, "notice")

    harness.services.editConnection()

    await vi.waitFor(() => {
      expect(notice).toHaveBeenCalledWith({
        tone: "danger",
        text: "Pulse can't open the project file: Error: Open a local workspace in Orca first.",
      })
    })
  })

  test("ask for a login in the panel and with a notification", () => {
    const harness = new Harness(undefined)

    harness.services.askForLogin({ target: { name: "prod-eu" } } as Connection)

    expect(harness.orca.postsOf("engines.login")).toEqual([{ engine: "prod-eu" }])
    expect(harness.orca.callsOf("notifications.show")).toEqual([
      { title: "Sign in to prod-eu", body: "Open the Pulse panel to enter the login." },
    ])
  })

  test("turn on live updates of an environment", async () => {
    const harness = new Harness(undefined)

    harness.services.turnOnLiveUpdates("test")

    await vi.waitFor(() => {
      expect(harness.registry.applyLiveSettings).toHaveBeenCalled()
    })
    expect(harness.orca.settings.get("liveUpdates.test")).toBe("on")
  })

  test("say when live updates do not turn on", async () => {
    const harness = new Harness(undefined)
    harness.registry.applyLiveSettings.mockRejectedValueOnce(new Error("no"))

    harness.services.turnOnLiveUpdates("test")

    await vi.waitFor(() => {
      expect(harness.orca.postsOf("notices.show")).toEqual([
        { notice: { tone: "danger", text: "Pulse could not turn on live updates: Error: no" } },
      ])
    })
  })

  test("tell the registry about a write", () => {
    const harness = new Harness(undefined)

    harness.services.noteWrite()

    expect(harness.registry.noteWrite).toHaveBeenCalled()
  })

  test("search the folders of the project files, else the focused workspace", async () => {
    const harness = await Harness.inWorkspace()

    expect(harness.services.roots()).toEqual([])
    await harness.services.learnRoots()
    expect(harness.services.roots()).toEqual([harness.root])
    harness.files.push("/a/.pulse-cli.json", "/b/.pulse-cli.json")
    expect(harness.services.roots()).toEqual(["/a", "/b"])
    expect(await harness.services.root()).toBe("/a")
  })
})
