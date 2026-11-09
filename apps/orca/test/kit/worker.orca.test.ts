import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { mockHost, mountWorker, type MockHostOptions, type TestWorker } from "orca/testing"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { EngineList } from "../../src/protocol.js"
import * as main from "../../src/worker/main.js"

const UNREACHABLE = "http://127.0.0.1:9/engine-rest"
const PROJECT = {
  profiles: {
    "shop-dev": { url: UNREACHABLE, flavor: "operaton" },
    "shop-test": { url: UNREACHABLE, flavor: "cibseven", auth: { type: "basic" } },
  },
}
const ORDER_BPMN =
  '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
  '<bpmn:process id="order" isExecutable="true" /></bpmn:definitions>'

let root = ""
let projectFile = ""
let worker: TestWorker | undefined

async function started(options: MockHostOptions = {}): Promise<TestWorker> {
  worker = await mountWorker(main, { host: mockHost(options) })
  return worker
}

async function withProject(options: MockHostOptions = {}): Promise<TestWorker> {
  const running = await started({
    ...options,
    results: {
      "workspace.list": {
        workspaces: [
          { id: "w1", kind: "folder", name: "shop", path: root, branch: null, hostId: null },
        ],
        truncated: false,
      },
      "workspace.open": { opened: true },
      "editor.open": { opened: true },
      ...options.results,
    },
  })
  await running.request("engines.setProjectFile", { path: projectFile })
  return running
}

function namesOf(list: EngineList): string[] {
  return list.engines.map((engine) => engine.name)
}

function expectNoRefusals(running: TestWorker): void {
  expect(running.refusals).toEqual([])
  expect(running.host.refusals).toEqual([])
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pulse-orca-kit-"))
  projectFile = join(root, ".pulse.json")
  await writeFile(projectFile, JSON.stringify(PROJECT))
})

afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  await rm(root, { recursive: true, force: true })
})

describe("the engines", () => {
  test("are the local default engine without a project file", async () => {
    const running = await started()

    const list = await running.request("engines.list")

    expect(list.projectFile).toBe("")
    expect(list.problems).toEqual([])
    expect(namesOf(list)).toEqual(["local"])
    expect(list.engines[0]?.active).toBe(true)
    expectNoRefusals(running)
  })

  test("are the profiles of the project file the setting names", async () => {
    const running = await withProject()

    const list = await running.request("engines.list")

    expect(running.host.data().settings.projectFile).toBe(projectFile)
    expect(list.projectFile).toBe(projectFile)
    expect(namesOf(list)).toEqual(["shop-dev", "shop-test"])
    expect(list.engines.map((engine) => engine.needsLogin)).toEqual([false, true])
    expect(list.engines.map((engine) => engine.problem?.title)).toEqual([
      "Can't reach shop-dev.",
      "Can't reach shop-test.",
    ])
    expect(running.posts).toContainEqual({
      event: "engines.changed",
      payload: { reason: "reload" },
    })
    expectNoRefusals(running)
  })

  test("name a project file Pulse can't read as a problem", async () => {
    const running = await started()
    const missing = join(root, "missing", ".pulse.json")

    await running.request("engines.setProjectFile", { path: missing })
    const list = await running.request("engines.list")

    expect(list.problems).toEqual([".pulse.json: Pulse can't read this file"])
    expect(namesOf(list)).toEqual(["local"])
  })

  test("follow the engine the panel activates", async () => {
    const running = await withProject()

    await running.request("engines.activate", { engine: "shop-test" })
    const list = await running.request("engines.list")

    expect(running.host.data().storage.activeEngine).toBe("shop-test")
    expect(list.engines.find((engine) => engine.active)?.name).toBe("shop-test")
  })

  test("save a login in the OS key store", async () => {
    const running = await withProject({
      results: { "secrets.protection": { status: "os-keyring" } },
    })

    const saved = await running.request("engines.setCredentials", {
      engine: "shop-test",
      username: "demo",
      password: "s3cret",
    })

    expect(saved).toEqual({ ok: true })
    expect(Object.values(running.host.data().secrets).join(" ")).toContain("s3cret")
    expect(running.posts).toContainEqual({ event: "engines.changed", payload: { reason: "login" } })
    expectNoRefusals(running)
  })

  test("save no login without an OS key store", async () => {
    const running = await withProject({
      results: { "secrets.protection": { status: "unavailable" } },
    })

    const saved = await running.request("engines.setCredentials", {
      engine: "shop-test",
      username: "demo",
      password: "s3cret",
    })

    expect(saved).toEqual({ ok: false })
    expect(running.host.data().secrets).toEqual({})
    expect(running.logs).toContain(
      "Logins are not saved: this machine offers no OS key store to Orca.",
    )
  })
})

describe("the commands of the manifest", () => {
  test("reload the engines", async () => {
    const running = await withProject()

    expect(await running.command("pulse.refresh")).toBe("Pulse reloaded its engines.")
    expectNoRefusals(running)
  })

  test("switch to the next engine", async () => {
    const running = await withProject()

    expect(await running.command("pulse.switchEngine")).toBe("Pulse now works with shop-test.")
    expect(await running.command("pulse.switchEngine")).toBe("Pulse now works with shop-dev.")
    expectNoRefusals(running)
  })

  test("open the overview of the active engine", async () => {
    const running = await withProject()

    expect(await running.command("pulse.openEngineOverview")).toBe("Opening shop-dev.")
    expectNoRefusals(running)
  })

  test("open the project file to configure the engines", async () => {
    const running = await withProject()

    expect(await running.command("pulse.configureEngines")).toBe(`Opened ${projectFile}.`)
    expect(running.host.callsOf("editor.open")).toEqual([
      { workspaceId: "w1", path: ".pulse.json" },
    ])
    expectNoRefusals(running)
  })
})

describe("the panel's requests", () => {
  test("open a view as a handle file in the project", async () => {
    const running = await withProject()

    const { path } = await running.request("views.open", { engine: "shop-dev", view: "engine" })

    expect(path.startsWith(join(root, ".pulse"))).toBe(true)
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      pulse: 1,
      engine: "shop-dev",
      view: "engine",
    })
    expect(running.host.callsOf("editor.open")).toEqual([
      { workspaceId: "w1", path: relative(root, path) },
    ])
    expectNoRefusals(running)
  })

  test("create a board in the project and list it", async () => {
    const running = await withProject()

    const { path } = await running.request("boards.create", { title: "Order review!" })
    const { boards } = await running.request("boards.list")

    expect(path).toBe(join(root, ".pulse", "boards", "order-review.board.json"))
    expect(boards.map((board) => board.path)).toEqual([path])
    expect(running.host.callsOf("editor.open")).toEqual([
      { workspaceId: "w1", path: ".pulse/boards/order-review.board.json" },
    ])
    expectNoRefusals(running)
  })

  test("list the processes of the project's .bpmn files", async () => {
    await writeFile(join(root, "order.bpmn"), ORDER_BPMN)
    const running = await withProject()

    const { models } = await running.request("models.list")

    expect(models).toEqual([
      {
        path: join(root, "order.bpmn"),
        bpmnProcessId: "order",
        label: "order.bpmn",
        description: "order",
      },
    ])
  })

  test("refuse a prompt answer from a panel other than Pulse's", async () => {
    const running = await started()

    const answered = await running.request(
      "prompts.answer",
      { id: "p1", answer: { kind: "pick" } },
      { panel: "other" },
    )

    expect(answered).toEqual({ ok: false })
    expect(running.logs).toContain("prompt answer refused from panel other")
  })

  test("take a prompt answer from Pulse's panel", async () => {
    const running = await started()

    const answered = await running.request(
      "prompts.answer",
      { id: "p1", answer: { kind: "pick" } },
      { panel: "engines" },
    )

    expect(answered).toEqual({ ok: false })
    expect(running.logs.filter((line) => line.startsWith("prompt answer refused"))).toEqual([])
    expect(await running.request("prompts.list")).toEqual({ prompts: [] })
  })
})

describe("the save hook", () => {
  test("lets every save through", async () => {
    const running = await withProject()
    const event = { workspaceId: "w1", path: join(root, "order.bpmn"), text: ORDER_BPMN }

    expect(await running.hooks.fire("editor.save.before", event)).toEqual({
      kind: "continue",
      event,
    })
    expect(
      await running.hooks.fire("editor.save.before", { ...event, path: join(root, "a.txt") }),
    ).toEqual({ kind: "continue", event: { ...event, path: join(root, "a.txt") } })
    expectNoRefusals(running)
  })
})
