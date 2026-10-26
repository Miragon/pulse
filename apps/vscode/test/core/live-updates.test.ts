import { PatchedRuntime } from "../../src/contract/fake/index.js"
import {
  BpmnProcessId,
  DefinitionId,
  IncidentId,
  RuntimeError,
  type InstanceSummary,
  type Page,
  type ProcessRuntime,
  type VersionSummary,
} from "../../src/contract/index.js"
import { describe, expect, test, vi } from "vitest"
import { DefinitionPanel } from "../../src/core/panels/definition-panel.js"
import { EnginePanel } from "../../src/core/panels/engine-panel.js"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { DefinitionView, LiveUpdates, PanelState } from "../../src/core/protocol/index.js"
import { LocalSourcesFixture } from "./support/local-sources.js"
import { panelFixture, type PanelFixture } from "./support/panel-fixture.js"

const ORDER = BpmnProcessId("pulse-order")
const LOCAL_INSTANCE_MS = 5000
const LOCAL_DEFINITION_MS = 10_000

function liveOf(state: PanelState): LiveUpdates | undefined {
  return state.status === "loading" ? undefined : state.live
}

function definitionView(fixture: PanelFixture): DefinitionView {
  const state = fixture.lastState()
  if (state.status !== "ready" || state.view.kind !== "definition") {
    throw new Error(`expected a ready definition view, got ${state.status}`)
  }
  return state.view
}

async function watchedInstance(
  fixture: PanelFixture,
  alias: "ORD-1001" | "ORD-1002" | "ORD-1003" = "ORD-1001",
) {
  const panel = new InstancePanel(fixture.context, fixture.world.instanceIds[alias])
  await panel.handle({ type: "ready" })
  panel.attend("watched")
  fixture.calls.length = 0
  return panel
}

describe("a watched panel on a local engine", () => {
  test("reads again after its interval without a spinner and moves the stamp", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    await watchedInstance(fixture)
    const published = fixture.states.length

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)

    expect(fixture.calls).toContain("getInstanceDetail")
    const quiet = fixture.states.slice(published)
    expect(quiet.some((state) => state.status === "ready" && state.refreshing)).toBe(false)
    const last = fixture.lastState()
    expect(last.status === "ready" && last.view.asOf).toBe("2026-10-21T09:00:05.000Z")
    expect(liveOf(last)).toEqual({ status: "live", everySeconds: 5 })
  })

  test("reads nothing while hidden or in the background and catches up on return", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)

    panel.attend("background")
    await fixture.scheduler.advance(60_000)
    expect(fixture.calls).toEqual([])
    expect(liveOf(fixture.lastState())).toEqual({ status: "paused", reason: "background" })

    panel.attend("hidden")
    panel.attend("watched")
    await fixture.scheduler.advance(2000)
    expect(fixture.calls).toContain("getInstanceDetail")
  })

  test("pauses on request, never resumes by itself, and reads at once on resume", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)

    await panel.handle({ type: "pauseLiveUpdates" })
    panel.attend("background")
    panel.attend("watched")
    await fixture.scheduler.advance(60_000)
    expect(fixture.calls).toEqual([])
    expect(liveOf(fixture.lastState())).toEqual({ status: "paused", reason: "user" })

    await panel.handle({ type: "resumeLiveUpdates" })
    await fixture.scheduler.advance(0)
    expect(fixture.calls).toContain("getInstanceDetail")
  })

  test("holds while a variable editor is open", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)

    await panel.handle({ type: "holdLiveUpdates", held: true })
    await fixture.scheduler.advance(30_000)
    expect(fixture.calls).toEqual([])
    expect(liveOf(fixture.lastState())).toEqual({ status: "paused", reason: "editing" })

    await panel.handle({ type: "holdLiveUpdates", held: false })
    await fixture.scheduler.advance(2000)
    expect(fixture.calls).toContain("getInstanceDetail")
  })

  test("reads nothing while a write waits for its confirmation", async () => {
    let confirm: (confirmed: boolean) => void = () => undefined
    const fixture = panelFixture((runtime) => runtime, { live: "on", writable: true })
    fixture.effects.confirmWrite.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve
        }),
    )
    const panel = await watchedInstance(fixture, "ORD-1002")
    const row = fixture.lastState()
    const incidentId =
      row.status === "ready" && row.view.kind === "instance" ? row.view.incidents[0]?.id : undefined

    const writing = panel.handle({ type: "retryIncident", incidentId: incidentId ?? "" })
    await fixture.scheduler.advance(30_000)
    expect(fixture.calls).toEqual([])

    confirm(false)
    await writing
    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(fixture.calls).toContain("getInstanceDetail")
  })

  test("stops for an instance that has ended", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    await watchedInstance(fixture, "ORD-1003")

    await fixture.scheduler.advance(60_000)

    expect(fixture.calls).toEqual([])
    expect(liveOf(fixture.lastState())).toEqual({ status: "ended" })
  })

  test("stops reading once it is disposed", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)
    panel.dispose()

    await fixture.scheduler.advance(60_000)

    expect(fixture.calls).toEqual([])
    expect(fixture.scheduler.pending).toEqual([])
  })

  test("restarts its countdown after a user refresh", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)
    await fixture.scheduler.advance(4000)
    await panel.handle({ type: "refresh" })
    fixture.calls.length = 0

    await fixture.scheduler.advance(4000)
    expect(fixture.calls).toEqual([])
    await fixture.scheduler.advance(1000)
    expect(fixture.calls).toContain("getInstanceDetail")
  })

  test("reads no more than two engine calls and no local files per instance tick", async () => {
    const local = LocalSourcesFixture.of({ models: { [ORDER]: "<definitions/>" } })
    const fixture = panelFixture((runtime) => runtime, { live: "on", sources: local.sources })
    await watchedInstance(fixture)
    local.modelOf.mockClear()

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)

    expect(fixture.calls.length).toBeLessThanOrEqual(2)
    expect(local.modelOf).not.toHaveBeenCalled()
  })
})

describe("a failing engine", () => {
  function flaky(failure: "unreachable" | "unauthorized") {
    let failing = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: (instanceId) =>
            failing
              ? Promise.reject(new RuntimeError(failure, "no"))
              : runtime.getInstanceDetail(instanceId),
        }),
      { live: "on" },
    )
    return {
      fixture,
      fail: (next: boolean) => {
        failing = next
      },
    }
  }

  test("keeps the data, says it reconnects, backs off and returns to live", async () => {
    const { fixture, fail } = flaky("unreachable")
    await watchedInstance(fixture)
    fail(true)

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(fixture.lastState().status).toBe("ready")
    expect(liveOf(fixture.lastState())).toMatchObject({ status: "reconnecting" })
    expect(fixture.scheduler.pending[0]).toBeGreaterThan(LOCAL_INSTANCE_MS)

    fail(false)
    await fixture.scheduler.advance(30_000)
    expect(liveOf(fixture.lastState())).toEqual({ status: "live", everySeconds: 5 })
  })

  test("stops every panel of the engine after a rejected login until a load succeeds", async () => {
    const { fixture, fail } = flaky("unauthorized")
    const first = await watchedInstance(fixture)
    const other = new EnginePanel(fixture.context)
    await other.handle({ type: "ready" })
    other.attend("watched")
    fail(true)

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(fixture.lastState()).toMatchObject({ status: "failed", live: { status: "stopped" } })
    fixture.calls.length = 0
    await fixture.scheduler.advance(120_000)
    expect(fixture.calls).toEqual([])

    fail(false)
    await first.handle({ type: "refresh" })
    expect(fixture.lastState()).toMatchObject({ status: "ready", live: { status: "live" } })
    fixture.calls.length = 0
    await fixture.scheduler.advance(20_000)
    expect(fixture.calls).toContain("listDefinitions")
  })
})

describe("a live definition panel", () => {
  const NEWER: DefinitionId = DefinitionId("pulse-order:3")

  function deploying() {
    let deployed = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          listVersions: async (bpmnProcessId): Promise<readonly VersionSummary[]> => {
            const versions = await runtime.listVersions(bpmnProcessId)
            const newest = versions[0]
            if (!deployed || newest === undefined) {
              return versions
            }
            const definition = { ...newest.definition, id: NEWER, version: 3 }
            return [{ ...newest, definition, running: 0, withIncident: 0 }, ...versions]
          },
        }),
      { live: "on" },
    )
    return {
      fixture,
      deploy: () => {
        deployed = true
      },
    }
  }

  test("stays on the version it shows and offers the one that was deployed", async () => {
    const { fixture, deploy } = deploying()
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    const shown = definitionView(fixture).selectedDefinitionId
    deploy()

    await fixture.scheduler.advance(LOCAL_DEFINITION_MS)
    await fixture.scheduler.advance(LOCAL_DEFINITION_MS)

    const view = definitionView(fixture)
    expect(view.selectedDefinitionId).toBe(shown)
    expect(view.notices).toContainEqual({
      tone: "info",
      title: "v3 was deployed.",
      actions: [{ kind: "selectVersion", label: "Show v3", definitionId: NEWER }],
    })
  })

  test("keeps the rows loaded with Load more and reads no page on a tick", async () => {
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          searchInstances: (filter, page): Promise<Page<InstanceSummary>> =>
            runtime.searchInstances(filter, { ...page, limit: 1 }),
        }),
      { live: "on" },
    )
    const definitionId = fixture.world.definitionIds["order@1"]
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId })
    await panel.handle({ type: "ready" })
    await panel.handle({ type: "loadMoreInstances" })
    panel.attend("watched")
    const rows = definitionView(fixture).instances.map((row) => row.id)
    fixture.calls.length = 0

    await fixture.scheduler.advance(LOCAL_DEFINITION_MS)

    expect(rows).toHaveLength(2)
    expect(definitionView(fixture).instances.map((row) => row.id)).toEqual(rows)
    expect(fixture.calls).not.toContain("searchInstances")
  })

  test("stays within seven engine calls a tick and reads the ended count every fourth tick", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    const perTick: number[] = []

    for (let tick = 1; tick <= 4; tick += 1) {
      fixture.calls.length = 0
      await fixture.scheduler.advance(LOCAL_DEFINITION_MS)
      perTick.push(fixture.calls.filter((call) => call === "countInstances").length)
      expect(fixture.calls.length).toBeLessThanOrEqual(7)
      expect(fixture.calls).not.toContain("getDiagramXml")
      expect(fixture.calls).not.toContain("getCalledProcesses")
    }

    expect(perTick).toEqual([2, 2, 2, 3])
  })

  test("does not read the ended count on production at all", async () => {
    const fixture = panelFixture((runtime) => runtime, {
      live: "on",
      engine: { name: "prod", environment: "production", host: "prod.example" },
    })
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    fixture.calls.length = 0

    for (let tick = 1; tick <= 4; tick += 1) {
      await fixture.scheduler.advance(60_000)
    }

    expect(fixture.calls.filter((call) => call === "countInstances")).toHaveLength(8)
  })
})

describe("the engine overview", () => {
  test("keeps its row order on a tick and sorts again on a user refresh", async () => {
    let swapped = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          listDefinitions: async () => {
            const summaries = await runtime.listDefinitions()
            return swapped
              ? summaries.map((summary) => ({ ...summary, withIncident: 0, running: 0 }))
              : summaries
          },
        }),
      { live: "on" },
    )
    const panel = new EnginePanel(fixture.context)
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    const orderOf = () => {
      const state = fixture.lastState()
      return state.status === "ready" && state.view.kind === "engine"
        ? state.view.processes.map((row) => row.bpmnProcessId)
        : []
    }
    const before = orderOf()
    swapped = true

    await fixture.scheduler.advance(15_000)
    expect(orderOf()).toEqual(before)

    await panel.handle({ type: "refresh" })
    expect(orderOf()).not.toEqual(before)
    expect(orderOf()).toEqual(["pulse-dispatch", "pulse-order", "pulse-label"])
  })
})

describe("live updates that are off", () => {
  test("offer to turn them on for production and never schedule a read", async () => {
    const fixture = panelFixture((runtime) => runtime, {
      live: "off",
      engine: { name: "prod", environment: "production", host: "prod.example" },
    })
    const panel = await watchedInstance(fixture)

    await fixture.scheduler.advance(120_000)
    await panel.handle({ type: "turnOnLiveUpdates" })

    expect(fixture.calls).toEqual([])
    expect(liveOf(fixture.lastState())).toEqual({
      status: "off",
      environment: "production",
      everySeconds: 30,
    })
    expect(fixture.effects.turnOnLiveUpdates).toHaveBeenCalledWith("production")
  })

  test("publish no live state without a live context", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    await panel.handle({ type: "pauseLiveUpdates" })
    await panel.handle({ type: "resumeLiveUpdates" })
    await panel.handle({ type: "holdLiveUpdates", held: true })
    panel.nudge()
    panel.dispose()

    expect(liveOf(fixture.lastState())).toBeUndefined()
  })
})

describe("the edges of a live panel", () => {
  test("reads soon after a nudge from the dev loop", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    panel.attend("watched")
    fixture.calls.length = 0

    panel.nudge()
    await fixture.scheduler.advance(2000)

    expect(fixture.calls).toContain("getElementStatistics")
    panel.dispose()
    expect(fixture.scheduler.pending).toEqual([])
  })

  test("a nudged engine overview reads its engine again and stops when disposed", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = new EnginePanel(fixture.context)
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    fixture.calls.length = 0

    panel.nudge()
    await fixture.scheduler.advance(2000)
    expect(fixture.calls).toEqual(["listDefinitions"])

    panel.dispose()
    expect(fixture.scheduler.pending).toEqual([])
  })

  test("stops and says so when the version it shows was removed", async () => {
    let removed = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          listVersions: async (bpmnProcessId) =>
            removed ? [] : runtime.listVersions(bpmnProcessId),
        }),
      { live: "on" },
    )
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    removed = true

    await fixture.scheduler.advance(LOCAL_DEFINITION_MS)

    const state = fixture.lastState()
    expect(state).toMatchObject({ status: "failed", live: { status: "stopped" } })
    expect(state.status === "failed" && state.problem.title).toMatch(
      /^Version v\d+ was not found\.$/,
    )
  })

  test("links the incidents of an instance again only when they change", async () => {
    let extra = false
    const local = LocalSourcesFixture.of({ models: { [ORDER]: "<definitions/>" } })
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId) => {
            const detail = await runtime.getInstanceDetail(instanceId)
            const first = detail?.incidents[0]
            return detail === undefined || first === undefined || !extra
              ? detail
              : {
                  ...detail,
                  incidents: [...detail.incidents, { ...first, id: IncidentId("new") }],
                }
          },
        }),
      { live: "on", sources: local.sources },
    )
    await watchedInstance(fixture, "ORD-1002")
    local.modelOf.mockClear()

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(local.modelOf).not.toHaveBeenCalled()
    extra = true
    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(local.modelOf).toHaveBeenCalled()
  })

  test("skips a tick while the user reloads and drops a tick a newer load overtook", async () => {
    let slow: (() => void) | undefined
    let calls = 0
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId) => {
            calls += 1
            if (calls === 2) {
              await new Promise<void>((resolve) => {
                slow = resolve
              })
            }
            return runtime.getInstanceDetail(instanceId)
          },
        }),
      { live: "on" },
    )
    const panel = await watchedInstance(fixture)

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    expect(slow).toBeDefined()
    const reload = panel.handle({ type: "refresh" })
    slow?.()
    await reload
    await fixture.scheduler.settle()

    expect(fixture.lastState()).toMatchObject({ status: "ready", refreshing: false })
    expect(calls).toBe(3)
  })

  test("loads on its own when nothing was loaded yet, after its interval", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])
    panel.attend("watched")

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS - 1)
    expect(fixture.calls).toEqual([])
    await fixture.scheduler.advance(1)

    expect(fixture.calls).toContain("getInstanceDetail")
    expect(fixture.lastState()).toMatchObject({ status: "ready", refreshing: false })
  })

  test("retries a first load that failed on its own and shows the failure meanwhile", async () => {
    let failing = true
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: (instanceId) =>
            failing
              ? Promise.reject(new RuntimeError("unreachable", "down"))
              : runtime.getInstanceDetail(instanceId),
        }),
      { live: "on" },
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    expect(fixture.lastState().status).toBe("failed")

    failing = false
    await fixture.scheduler.advance(30_000)

    expect(fixture.lastState()).toMatchObject({ status: "ready" })
  })
})

describe("the review findings on live panels", () => {
  test("another panel of a blocked engine says it stopped at its next tick", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on" })
    const panel = await watchedInstance(fixture)
    fixture.context.live?.lane.block()

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)

    expect(liveOf(fixture.lastState())).toEqual({ status: "stopped", reason: "refused" })
    panel.dispose()
  })

  test("a closed panel stops checking its retry", async () => {
    const fixture = panelFixture((runtime) => runtime, { live: "on", writable: true })
    let release: () => void = () => undefined
    vi.mocked(fixture.context.wait).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const panel = await watchedInstance(fixture, "ORD-1002")
    const state = fixture.lastState()
    const incidentId =
      state.status === "ready" && state.view.kind === "instance" ? state.view.incidents[0]?.id : ""

    const retrying = panel.handle({ type: "retryIncident", incidentId: incidentId ?? "" })
    await fixture.scheduler.settle()
    const reads = fixture.calls.filter((call) => call === "getInstanceDetail").length
    panel.dispose()
    release()
    await retrying

    expect(fixture.calls.filter((call) => call === "getInstanceDetail")).toHaveLength(reads)
  })

  test("a closed panel publishes nothing from a read that was still running", async () => {
    let answer: (() => void) | undefined
    let calls = 0
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId) => {
            calls += 1
            if (calls === 2) {
              await new Promise<void>((resolve) => {
                answer = resolve
              })
            }
            return runtime.getInstanceDetail(instanceId)
          },
        }),
      { live: "on" },
    )
    const panel = await watchedInstance(fixture)
    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    const published = fixture.states.length

    panel.dispose()
    answer?.()
    await fixture.scheduler.settle()

    expect(fixture.states).toHaveLength(published)
  })

  test("an instance that completes between two ticks ends as ended, not as reconnecting", async () => {
    let completed = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId) => {
            const detail = await runtime.getInstanceDetail(instanceId)
            return detail === undefined || !completed
              ? detail
              : { ...detail, instance: { ...detail.instance, state: "completed" } }
          },
        }),
      { live: "on" },
    )
    await watchedInstance(fixture)
    completed = true

    await fixture.scheduler.advance(LOCAL_INSTANCE_MS)
    fixture.calls.length = 0
    await fixture.scheduler.advance(60_000)

    expect(liveOf(fixture.lastState())).toEqual({ status: "ended" })
    expect(fixture.calls).toEqual([])
  })

  test("a definition tick reads no local files either", async () => {
    const local = LocalSourcesFixture.of({ models: { [ORDER]: "<definitions/>" } })
    const fixture = panelFixture((runtime) => runtime, { live: "on", sources: local.sources })
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    local.modelOf.mockClear()

    await fixture.scheduler.advance(LOCAL_DEFINITION_MS)

    expect(local.modelOf).not.toHaveBeenCalled()
  })

  test("reads the versions of a production definition every fourth tick and notes the history", async () => {
    const fixture = panelFixture((runtime) => runtime, {
      live: "on",
      engine: { name: "prod", environment: "production", host: "prod.example" },
    })
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER })
    await panel.handle({ type: "ready" })
    panel.attend("watched")
    fixture.calls.length = 0

    for (let tick = 1; tick <= 4; tick += 1) {
      await fixture.scheduler.advance(60_000)
    }

    expect(fixture.calls.filter((call) => call === "listVersions")).toHaveLength(1)
    expect(definitionView(fixture).historyNote).toBe("Ended and All update when you refresh.")
  })

  test("stops checking a retry once the engine rejected the login", async () => {
    let rejecting = false
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: (instanceId) =>
            rejecting
              ? Promise.reject(new RuntimeError("unauthorized", "no"))
              : runtime.getInstanceDetail(instanceId),
        }),
      { live: "on", writable: true },
    )
    const panel = await watchedInstance(fixture, "ORD-1002")
    const state = fixture.lastState()
    const incidentId =
      state.status === "ready" && state.view.kind === "instance" ? state.view.incidents[0]?.id : ""
    fixture.context.live?.lane.block()
    rejecting = true

    await panel.handle({ type: "retryIncident", incidentId: incidentId ?? "" })

    expect(fixture.calls.filter((call) => call === "getInstanceDetail")).toHaveLength(1)
  })
})
