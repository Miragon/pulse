import { afterEach, describe, expect, test, vi } from "vitest"
import { ViewsFixture } from "./views-fixture.js"

const ENGINE_HANDLE = JSON.stringify({ pulse: 1, engine: "local", view: "engine" })

afterEach(() => {
  vi.useRealTimers()
})

describe("cockpit views in editor tabs", () => {
  test("a handle naming an unknown engine shows a problem instead of a view", async () => {
    const fixture = new ViewsFixture()

    const answer = await fixture.views.attach(
      "frame",
      JSON.stringify({ pulse: 1, engine: "gone", view: "engine" }),
    )

    expect(answer).toEqual({
      attached: false,
      problem: "Pulse has no engine named gone. Check your project file.",
    })
  })

  test("an attached frame gets the state of its view", async () => {
    const fixture = new ViewsFixture()
    await fixture.views.attach("frame", ENGINE_HANDLE)

    await fixture.views.intent("frame", { type: "ready" })

    const states = fixture.statesFor("frame") as { message: { state: { status: string } } }[]
    expect(states.at(-1)?.message.state.status).toBe("ready")
  })

  test("two tabs on one handle share the view", async () => {
    const fixture = new ViewsFixture()
    await fixture.views.attach("left", ENGINE_HANDLE)
    await fixture.views.attach("right", ENGINE_HANDLE)

    await fixture.views.intent("left", { type: "ready" })

    expect(fixture.statesFor("right").length).toBeGreaterThan(0)
  })

  test("a frame the worker does not know is told to reload", async () => {
    const fixture = new ViewsFixture()

    expect(await fixture.views.intent("stranger", { type: "ready" })).toEqual({
      known: false,
      actions: [],
    })
  })

  test("opening the engine's web app returns the URL to the frame that was clicked", async () => {
    const fixture = new ViewsFixture()
    await fixture.views.attach("frame", ENGINE_HANDLE)
    await fixture.views.intent("frame", { type: "ready" })

    const answer = await fixture.views.intent("frame", { type: "openWebUi" })

    expect(answer.actions).toEqual([{ kind: "openExternal", url: "http://localhost:8080/cockpit" }])
  })

  test("closing the last tab of a view ends its session", async () => {
    vi.useFakeTimers()
    const fixture = new ViewsFixture()
    await fixture.views.attach("frame", ENGINE_HANDLE)
    const closing = new AbortController()
    void fixture.views.surfaces.watch("frame", true, closing.signal)

    closing.abort()
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.closed).toEqual(["frame"])
    expect(await fixture.views.intent("frame", { type: "ready" })).toEqual({
      known: false,
      actions: [],
    })
  })

  test("a view opened from another one links back to it", async () => {
    const fixture = new ViewsFixture()
    await fixture.views.attach("frame", ENGINE_HANDLE)
    await fixture.views.open(
      { engine: "local", view: "definition", bpmnProcessId: "order" },
      "local/local processes.pulse-view",
    )
    fixture.views.goBack("local/order.pulse-view")

    expect(fixture.opened).toEqual([
      { engine: "local", view: "definition", bpmnProcessId: "order" },
      { pulse: 1, engine: "local", view: "engine" },
    ])
  })
})
