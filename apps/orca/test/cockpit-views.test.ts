import { afterEach, describe, expect, test, vi } from "vitest"
import { FakeEngine, FakeWorld, PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { DiagramCache, EngineLane } from "@miragon/pulse-runtime-view/core"
import {
  ConnectionBuilder,
  type EngineTarget,
  LOCAL_TARGET,
  WriteAudit,
} from "@miragon/pulse-runtime-view/host-kit"
import { CompositionRoot } from "../src/worker/composition-root.js"
import { OrcaSettings } from "../src/worker/orca-settings.js"
import { ConnectionLive } from "./connection-live.js"
import { ViewsFixture } from "./views-fixture.js"

const ENGINE_HANDLE = JSON.stringify({ pulse: 1, engine: "local", view: "engine" })

afterEach(() => {
  vi.useRealTimers()
})

function cliOf(target: EngineTarget) {
  return new ConnectionBuilder(
    CompositionRoot.create(),
    new WriteAudit({ info: () => undefined }),
    OrcaSettings.WRITES_WORDING,
  ).build(target, { kind: "none" }, "local", {
    writes: "localOnly",
    live: undefined,
    lane: new EngineLane(),
  }).cli
}

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

  test.each([
    [
      "the default engine by --url with --auth none, so the CLI takes no profile or login",
      LOCAL_TARGET,
      "--url http://localhost:8080/engine-rest --auth none",
    ],
    [
      "an engine of the project file by its profile with its URL, which beats PULSE_CLI_URL",
      {
        ...LOCAL_TARGET,
        name: "shop-dev",
        endpoint: "http://localhost:8112/engine-rest",
        source: { kind: "file", path: "/shop/.pulse.json" },
      },
      "--profile shop-dev --url http://localhost:8112/engine-rest",
    ],
  ] as const)(
    "an instance behind an event-based gateway names the command of its engine's CLI for %s",
    async (_, target: EngineTarget, options) => {
      const fixture = new ViewsFixture({
        models: {
          modelOf: () => Promise.resolve(undefined),
          elementIn: () => Promise.resolve(undefined),
        },
        code: { locate: () => Promise.resolve(undefined) },
      })
      const { state, world } = FakeWorld.seed()
      const engine = new FakeEngine(state)
      const gateway =
        '<bpmn:eventBasedGateway id="Gateway_Paid" name="Paid?" /><bpmn:sequenceFlow id="Flow_Paid" sourceRef="Gateway_Paid" targetRef="Activity_ReviewOrder" /></bpmn:process>'
      const runtime = new PatchedRuntime(engine, {
        getDiagramXml: async (id) =>
          (await engine.getDiagramXml(id))?.replace("</bpmn:process>", gateway),
        getInstanceDetail: async (id) => {
          const detail = await engine.getInstanceDetail(id)
          return (
            detail && {
              ...detail,
              waitStates: detail.waitStates.map((wait) => ({
                kind: "message",
                messageName: "OrderReviewed",
                instanceId: wait.instanceId,
                elementId: wait.elementId,
              })),
            }
          )
        },
      })
      const cli = cliOf(target)
      fixture.engines.set("local", {
        ...fixture.connection,
        runtime,
        diagrams: new DiagramCache(runtime),
        ...ConnectionLive.of(runtime),
        commands: engine,
        ...(cli === undefined ? {} : { cli }),
      })
      const instanceId = world.instanceIds["ORD-1001"]
      const handle = { pulse: 1, engine: "local", view: "instance", instanceId }

      await fixture.views.attach("frame", JSON.stringify(handle))
      await fixture.views.intent("frame", { type: "ready" })

      const states = fixture.statesFor("frame") as {
        message: { state: { view?: { waitStates?: { moveRefusal?: string }[] } } }
      }[]
      expect(states.at(-1)?.message.state.view?.waitStates?.[0]?.moveRefusal).toBe(
        `The token waits at the gateway Paid? until one of the events after it occurs; Pulse does not move a token away from an event-based gateway. Trigger Review order with the CLI: pulse advance ${instanceId} --activity-id Activity_ReviewOrder ${options}`,
      )
    },
  )

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
