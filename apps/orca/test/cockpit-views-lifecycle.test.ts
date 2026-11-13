import { afterEach, describe, expect, test, vi } from "vitest"
import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import { ViewsFixture } from "./views-fixture.js"

const ENGINE_HANDLE = JSON.stringify({ pulse: 1, engine: "local", view: "engine" })
const MIGRATION = { pulse: 1, engine: "local", view: "migration", bpmnProcessId: "order" }

afterEach(() => {
  vi.useRealTimers()
})

async function attached(): Promise<ViewsFixture> {
  const fixture = new ViewsFixture()
  await fixture.views.attach("frame", ENGINE_HANDLE)
  await fixture.views.intent("frame", { type: "ready" })
  return fixture
}

describe("the lifecycle of cockpit views", () => {
  test("a migration opens with the target it was started for", async () => {
    const fixture = new ViewsFixture()
    const target = {
      bpmnProcessId: BpmnProcessId("order"),
      sourceDefinitionId: DefinitionId("order:1"),
      instanceIds: [InstanceId("i-1")],
    }

    await fixture.views.openMigration("local", target, "local/local processes.pulse-view")
    const answer = await fixture.views.attach("frame", JSON.stringify(MIGRATION))

    expect(fixture.opened).toEqual([{ engine: "local", view: "migration", bpmnProcessId: "order" }])
    expect(answer).toEqual({ attached: true })
  })

  test("a definition opens at its version with its filter", async () => {
    const fixture = new ViewsFixture()
    const handle = {
      pulse: 1,
      engine: "local",
      view: "definition",
      bpmnProcessId: "pulse-order",
      definitionId: "pulse-order:1",
      filter: { scope: "running" },
    }

    expect(await fixture.views.attach("frame", JSON.stringify(handle))).toEqual({ attached: true })
  })

  test("a migration no longer open asks to start it again", async () => {
    const fixture = new ViewsFixture()

    expect(await fixture.views.attach("frame", JSON.stringify(MIGRATION))).toEqual({
      attached: false,
      problem: "This migration is no longer open. Start it again from the process definition.",
    })
  })

  test("an intent of no known shape changes nothing and activity counts as use", async () => {
    const fixture = await attached()
    const noteActivity = vi.spyOn(fixture.live, "noteActivity")

    expect(await fixture.views.intent("frame", { type: "nonsense" })).toEqual({
      known: true,
      actions: [],
    })
    expect(await fixture.views.intent("frame", { type: "activity" })).toEqual({
      known: true,
      actions: [],
    })
    expect(noteActivity).toHaveBeenCalledOnce()
  })

  test("a process opened from the engine view links back to it", async () => {
    const fixture = await attached()

    await fixture.views.intent("frame", {
      type: "openProcess",
      bpmnProcessId: "pulse-order",
      toSide: false,
    })

    expect(fixture.opened).toEqual([
      { engine: "local", view: "definition", bpmnProcessId: "pulse-order" },
    ])
  })

  test("a view that cannot open is logged", async () => {
    const fixture = await attached()
    fixture.openFails = true

    await fixture.views.intent("frame", {
      type: "openProcess",
      bpmnProcessId: "pulse-order",
      toSide: false,
    })

    await vi.waitFor(() => {
      expect(fixture.orca.logs).toContain("open definition failed: Error: no workspace")
    })
  })

  test("the panel focuses the engine or the process of a tab", async () => {
    const fixture = await attached()
    await fixture.views.open({ engine: "local", view: "definition", bpmnProcessId: "order" })
    await fixture.views.attach(
      "other",
      JSON.stringify({ pulse: 1, engine: "local", view: "definition", bpmnProcessId: "order" }),
    )

    expect(fixture.views.focusOf("frame")).toBe("engine|local")
    expect(fixture.views.focusOf("other")).toBe("definition|local|order")
    expect(fixture.views.focusOf("stranger")).toBeUndefined()
  })

  test("a view whose engine left the project file closes", async () => {
    const fixture = await attached()
    fixture.engines.clear()

    fixture.changeEngines()

    expect(await fixture.views.intent("frame", { type: "ready" })).toEqual({
      known: false,
      actions: [],
    })
  })

  test("a view whose engine changed renders on the new connection", async () => {
    const fixture = await attached()
    const before = fixture.statesFor("frame").length
    fixture.engines.set("local", { ...fixture.connection })

    fixture.changeEngines()

    await vi.waitFor(() => {
      expect(fixture.statesFor("frame").length).toBeGreaterThan(before)
    })
  })

  test("a visible tab and an idle worker change how a view refreshes", async () => {
    vi.useFakeTimers()
    const fixture = await attached()
    void fixture.views.surfaces.watch("frame", true, new AbortController().signal)

    await vi.advanceTimersByTimeAsync(16 * 60_000)
    fixture.views.nudgeLocal()

    expect(fixture.live.of(true)).toBe("idle")
    fixture.views.dispose()
  })
})
