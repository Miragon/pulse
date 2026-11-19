import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { StarterBoard } from "@miragon/pulse-board"
import type { FileRow, FoundInstance, ModelRow } from "../src/protocol.js"
import activate, { deactivate } from "../src/worker/main.js"
import { EDITOR_FRAME } from "./fake-orca.js"
import { WorkerHarness } from "./worker-harness.js"

const FIXTURES = join(
  import.meta.dirname,
  "../../../packages/core/runtime-view/dev/webview/fixtures",
)

afterEach(() => {
  deactivate()
})

async function started(): Promise<WorkerHarness> {
  const harness = await WorkerHarness.withProject()
  activate(harness.orca.api())
  return harness
}

describe("boards in the workspace", () => {
  test("are created from the template once and listed by their folder", async () => {
    const harness = await started()

    const created = (await harness.request("boards.create", { title: "Shop · Q4!" })) as {
      path: string
    }
    await writeFile(created.path, "edited")
    await harness.request("boards.create", { title: "Shop · Q4!" })
    const { boards } = (await harness.request("boards.list")) as { boards: FileRow[] }

    expect(created.path).toBe(join(harness.root, ".pulse", "boards", "shop-q4.board.json"))
    expect(await readFile(created.path, "utf8")).toBe("edited")
    expect(boards).toEqual([
      { path: created.path, label: "shop-q4", description: basename(harness.root) },
    ])
    expect(harness.orca.callsOf("editor.open")).toContainEqual({
      workspaceId: "shop",
      path: ".pulse/boards/shop-q4.board.json",
    })
  })

  test("name a board without a usable title after its kind and write the starter board", async () => {
    const harness = await started()

    const created = (await harness.request("boards.create", { title: "!!!" })) as { path: string }

    expect(created.path).toMatch(/board\.board\.json$/)
    expect(await readFile(created.path, "utf8")).toBe(
      StarterBoard.of("!!!", ["shop-dev", "prod-eu"]),
    )
  })

  test.each([
    ["without the separators a title starts with", " · Shop · Q4", "shop-q4"],
    [
      "within the 64 characters of a board id, without the dash the cut leaves",
      `${"Order fulfillment ".repeat(3)}warehouse and payment`,
      "order-fulfillment-order-fulfillment-order-fulfillment-warehouse",
    ],
    [
      "within the 64 characters of a board id, cut inside a word",
      `${"Order fulfillment ".repeat(3)}warehousing`,
      "order-fulfillment-order-fulfillment-order-fulfillment-warehousin",
    ],
  ])("name their file %s", async (_, title, name) => {
    const harness = await started()

    const created = (await harness.request("boards.create", { title })) as { path: string }

    expect(basename(created.path)).toBe(`${name}.board.json`)
    expect(await readFile(created.path, "utf8")).toBe(
      StarterBoard.of(title, ["shop-dev", "prod-eu"]),
    )
  })

  test("in a nested folder show their folder relative to the workspace", async () => {
    const harness = await started()
    const folder = join(harness.root, "team", ".pulse", "boards")
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, "ops.board.json"), "{}")
    await mkdir(join(harness.root, "node_modules", ".pulse", "boards"), { recursive: true })
    await writeFile(join(harness.root, "node_modules", ".pulse", "boards", "x.board.json"), "{}")

    const { boards } = (await harness.request("boards.list")) as { boards: FileRow[] }

    expect(boards.map((row) => [row.label, row.description])).toEqual([["ops", "team"]])
  })

  test("open in Orca", async () => {
    const harness = await started()

    const answer = await harness.request("boards.open", {
      path: join(harness.root, "a.board.json"),
    })

    expect(answer).toEqual({ ok: true })
    expect(harness.orca.callsOf("editor.open")).toEqual([
      { workspaceId: "shop", path: "a.board.json" },
    ])
  })
})

describe("models in the workspace", () => {
  test("list every process of every BPMN file", async () => {
    const harness = await started()
    await copyFile(join(FIXTURES, "order-fulfillment.bpmn"), join(harness.root, "order.bpmn"))
    await writeFile(join(harness.root, "broken.bpmn"), "not xml")

    const { models } = (await harness.request("models.list")) as { models: ModelRow[] }

    expect(models).toEqual([
      {
        path: join(harness.root, "order.bpmn"),
        bpmnProcessId: "order-fulfillment",
        label: "order.bpmn",
        description: "order-fulfillment",
      },
    ])
  })

  test("open as a runtime view of their process", async () => {
    const harness = await started()
    const modelPath = join(harness.root, "order.bpmn")
    await copyFile(join(FIXTURES, "order-fulfillment.bpmn"), modelPath)
    const handle = {
      pulse: 1,
      engine: "shop-dev",
      view: "model",
      bpmnProcessId: "order",
      modelPath,
    }

    const answer = await harness.request(
      "cockpit.attach",
      { handle: JSON.stringify(handle) },
      EDITOR_FRAME,
    )

    expect(answer).toEqual({ attached: true })
  })

  test("that went away name the file instead of a view", async () => {
    const harness = await started()
    const modelPath = join(harness.root, "gone.bpmn")
    const handle = {
      pulse: 1,
      engine: "shop-dev",
      view: "model",
      bpmnProcessId: "order",
      modelPath,
    }

    const answer = await harness.request(
      "cockpit.attach",
      { handle: JSON.stringify(handle) },
      EDITOR_FRAME,
    )

    expect(answer).toEqual({ attached: false, problem: `Pulse can't read ${modelPath}.` })
  })
})

describe("finding an instance", () => {
  test("by its id", async () => {
    const harness = await started()
    const [instance] = (await harness.adapter.engine.searchInstances({}, { limit: 1 })).items

    const { found } = (await harness.request("instances.find", {
      query: ` ${instance?.id ?? ""} `,
    })) as { found: FoundInstance[] }

    expect(found).toEqual([
      expect.objectContaining({ instanceId: instance?.id, label: instance?.businessKey }),
    ])
  })

  test("by its business key", async () => {
    const harness = await started()

    const { found } = (await harness.request("instances.find", { query: "ORD-1001" })) as {
      found: FoundInstance[]
    }

    expect(found.map((row) => row.label)).toEqual(["ORD-1001"])
    expect(found[0]?.description).toMatch(/^.+ v1 · \w+$/)
  })

  test("finds nothing for an empty query", async () => {
    const harness = await started()

    expect(await harness.request("instances.find", { query: "  " })).toEqual({ found: [] })
  })
})
