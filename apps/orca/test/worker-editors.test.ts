import { afterEach, describe, expect, test, vi } from "vitest"
import type { Prompt } from "../src/protocol.js"
import activate, { deactivate } from "../src/worker/main.js"
import { BoardTemplate } from "../src/worker/board-template.js"
import { EDITOR_FRAME, PULSE_PANEL } from "./fake-orca.js"
import { REMOTE_ENDPOINT, WorkerHarness } from "./worker-harness.js"

const ENGINE_VIEW = JSON.stringify({ pulse: 1, engine: "shop-dev", view: "engine" })

afterEach(() => {
  deactivate()
})

async function started(): Promise<WorkerHarness> {
  const harness = await WorkerHarness.withProject()
  activate(harness.orca.api())
  return harness
}

function statesOf(harness: WorkerHarness, frame: string): { status?: string }[] {
  return harness.orca.posted
    .filter((post) => post.event === "cockpit.state" && post.panel === frame)
    .map((post) => (post.payload as { message: { state: { status?: string } } }).message.state)
}

describe("views in editor tabs", () => {
  test("attach a tab to its view and render it", async () => {
    const harness = await started()

    expect(await harness.request("cockpit.attach", { handle: ENGINE_VIEW }, EDITOR_FRAME)).toEqual({
      attached: true,
    })
    await harness.request("cockpit.intent", { intent: { type: "ready" } }, EDITOR_FRAME)

    expect(statesOf(harness, EDITOR_FRAME.id).at(-1)?.status).toBe("ready")
  })

  test("refuse a file that is no Pulse view", async () => {
    const harness = await started()

    expect(await harness.request("cockpit.attach", { handle: "{}" }, EDITOR_FRAME)).toEqual({
      attached: false,
      problem: "This file is not a Pulse view.",
    })
  })

  test("focus the engine of a visible tab in the Pulse panel", async () => {
    const harness = await started()
    await harness.request("views.open", { engine: "shop-dev", view: "engine" })
    await harness.request("cockpit.attach", { handle: ENGINE_VIEW }, EDITOR_FRAME)

    void harness.request("cockpit.watch", { visible: true }, EDITOR_FRAME)
    void harness.request("cockpit.watch", { visible: false }, EDITOR_FRAME)

    expect(harness.orca.postsOf("engines.focus")).toEqual([{ key: "engine|shop-dev" }])
  })

  test("open a view the panel asks for as a handle file", async () => {
    const harness = await started()

    const answer = (await harness.request("views.open", {
      engine: "shop-dev",
      view: "definition",
      bpmnProcessId: "order",
    })) as { path: string }

    expect(answer.path).toBe(`${harness.root}/.pulse/views/shop-dev/order.pulse-view`)
  })
})

describe("a write in a tab", () => {
  test("waits in the Pulse panel, notifies once and settles with the panel's answer", async () => {
    const harness = await WorkerHarness.withProject()
    harness.orca.settings.set("environments", { "shop-dev": "production" })
    activate(harness.orca.api())
    const incidents = await harness.adapter.engine.searchIncidents({}, { limit: 50 })
    const incident = incidents.items.find((item) => item.retriesLeft === 0) ?? incidents.items[0]
    const handle = {
      pulse: 1,
      engine: "shop-dev",
      view: "instance",
      instanceId: incident?.instanceId,
    }
    await harness.request("cockpit.attach", { handle: JSON.stringify(handle) }, EDITOR_FRAME)
    await harness.request("cockpit.intent", { intent: { type: "ready" } }, EDITOR_FRAME)

    const retry = { type: "retryIncident", incidentId: incident?.id }
    const writing = harness.request("cockpit.intent", { intent: retry }, EDITOR_FRAME)
    await vi.waitFor(async () => {
      const listed = (await harness.request("prompts.list")) as { prompts: Prompt[] }
      expect(listed.prompts).toHaveLength(1)
    })
    const { prompts } = (await harness.request("prompts.list")) as { prompts: Prompt[] }
    const answer = { id: prompts[0]?.id, answer: { kind: "confirm", confirmed: false } }
    expect(await harness.request("prompts.answer", answer, PULSE_PANEL)).toEqual({ ok: true })
    await writing

    expect(harness.orca.postsOf("prompts.changed")).toEqual([{ count: 1 }, { count: 0 }])
    expect(harness.orca.callsOf("notifications.show")).toEqual([
      {
        title: "Pulse waits for your answer",
        body: "Confirm or cancel the write in the Pulse panel.",
      },
    ])
    const items = harness.orca.callsOf("statusBar.update") as { text?: string }[]
    expect(items.map((item) => item.text)).toContain("Confirm in the Pulse panel")
  })
})

describe("the Pulse panel", () => {
  test("watches while it is visible and is told about every write", async () => {
    const harness = await started()
    const incidents = await harness.adapter.engine.searchIncidents({}, { limit: 50 })
    const incident = incidents.items.find((item) => item.retriesLeft === 0) ?? incidents.items[0]
    const handle = {
      pulse: 1,
      engine: "shop-dev",
      view: "instance",
      instanceId: incident?.instanceId,
    }
    void harness.request("engines.watch", { visible: true })
    void harness.request("engines.watch", { visible: false })
    await harness.request("cockpit.attach", { handle: JSON.stringify(handle) }, EDITOR_FRAME)
    await harness.request("cockpit.intent", { intent: { type: "ready" } }, EDITOR_FRAME)

    const retry = { type: "retryIncident", incidentId: incident?.id }
    void harness.request("cockpit.intent", { intent: retry }, EDITOR_FRAME)

    await vi.waitFor(() => {
      expect(harness.orca.postsOf("engines.changed")).toContainEqual({ reason: "write" })
    })
    expect(harness.orca.postsOf("notices.show")).toEqual([
      {
        notice: {
          tone: "success",
          text: expect.stringMatching(/^Retried the incident/) as unknown,
        },
      },
    ])
  })
})

describe("boards in editor tabs", () => {
  test("open engines, the project file and the login from a board", async () => {
    const harness = await WorkerHarness.withProject()
    harness.adapter.unauthorized.add(REMOTE_ENDPOINT)
    activate(harness.orca.api())
    const text = BoardTemplate.of("Shop", ["shop-dev", "prod-eu"])
    await harness.request("board.attach", { text }, EDITOR_FRAME)
    await harness.request("cockpit.intent", { intent: { type: "ready" } }, EDITOR_FRAME)

    for (const intent of [
      { type: "openBoardEngine", engine: "shop-dev", toSide: false },
      { type: "editConnection" },
      { type: "setBoardCredentials", engine: "prod-eu" },
    ]) {
      await harness.request("cockpit.intent", { intent }, EDITOR_FRAME)
    }

    expect(harness.orca.postsOf("engines.login")).toEqual([{ engine: "prod-eu" }])
    await vi.waitFor(() => {
      expect(harness.orca.callsOf("editor.open")).toEqual(
        expect.arrayContaining([
          { workspaceId: "shop", path: ".pulse-cli.json" },
          { workspaceId: "shop", path: ".pulse/views/shop-dev/shop-dev processes.pulse-view" },
        ]),
      )
    })
  })

  test("render the board text and follow its edits", async () => {
    const harness = await started()
    const text = BoardTemplate.of("Shop", ["shop-dev"])

    expect(await harness.request("board.attach", { text }, EDITOR_FRAME)).toEqual({
      attached: true,
    })
    await harness.request("cockpit.intent", { intent: { type: "ready" } }, EDITOR_FRAME)
    expect(statesOf(harness, EDITOR_FRAME.id).at(-1)?.status).toBe("ready")

    expect(await harness.request("board.changed", { text: "{}" }, EDITOR_FRAME)).toEqual({
      known: true,
    })
    expect(await harness.request("board.changed", { text }, PULSE_PANEL)).toEqual({ known: false })
  })

  test("copy from a board within the click", async () => {
    const harness = await started()
    await harness.request("board.attach", { text: BoardTemplate.of("Shop", []) }, EDITOR_FRAME)

    const answer = await harness.request(
      "cockpit.intent",
      { intent: { type: "copy", text: "ORD-1", label: "Business key" } },
      EDITOR_FRAME,
    )

    expect(answer).toEqual({
      known: true,
      actions: [{ kind: "copy", text: "ORD-1", label: "Business key" }],
    })
  })
})
