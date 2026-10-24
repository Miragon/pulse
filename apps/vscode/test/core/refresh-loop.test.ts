import { RuntimeError, type DefinitionSummary } from "../../src/contract/index.js"
import { describe, expect, test, vi } from "vitest"
import { DefinitionsLoop } from "../../src/core/refresh/definitions-loop.js"
import { EngineLane } from "../../src/core/refresh/engine-lane.js"
import type { LiveSetting } from "../../src/core/refresh/live-switch.js"
import { LiveSwitch } from "../../src/core/refresh/live-switch.js"
import { LiveFailures } from "../../src/core/refresh/live-failures.js"
import { RefreshLoop, type TickOutcome } from "../../src/core/refresh/refresh-loop.js"
import { SharedDefinitions } from "../../src/core/refresh/shared-definitions.js"
import { ManualScheduler } from "./support/manual-scheduler.js"

const INTERVAL_MS = 5000

interface LoopOptions {
  readonly setting?: LiveSetting
  readonly outcomes?: TickOutcome[]
  readonly loadMs?: number
  readonly neverAnswers?: true
}

function loopOf(options: LoopOptions = {}) {
  const scheduler = new ManualScheduler(0)
  const lane = new EngineLane()
  const log: string[] = []
  const ticks: number[] = []
  const outcomes = [...(options.outcomes ?? [])]
  let held = false
  let ended = false
  const showLive = vi.fn()
  const liveSwitch = new LiveSwitch(options.setting ?? "on")
  const target = {
    refreshQuietly: async (tick: number): Promise<TickOutcome> => {
      ticks.push(tick)
      if (options.neverAnswers === true) {
        await new Promise(() => undefined)
      }
      if (options.loadMs !== undefined) {
        await scheduler.advanceClock(options.loadMs)
      }
      return outcomes.shift() ?? "done"
    },
    isBusy: () => held,
    hasEnded: () => ended,
    showLive,
  }
  const loop = new RefreshLoop(
    {
      switch: liveSwitch,
      scheduler,
      lane,
      random: () => 0.5,
      log: (line) => log.push(line),
    },
    target,
    { view: "instance", environment: "local", now: () => scheduler.now() },
  )
  return {
    loop,
    liveSwitch,
    scheduler,
    lane,
    log,
    ticks,
    showLive,
    hold: (next: boolean) => {
      held = next
    },
    end: () => {
      ended = true
    },
  }
}

describe("a refresh loop", () => {
  test("starts hidden and logs when it runs or pauses", async () => {
    const { loop, scheduler, log, ticks } = loopOf()
    await scheduler.advance(60_000)
    expect(ticks).toEqual([])

    loop.attend("watched")
    loop.attend("watched")
    loop.attend("background")

    expect(log).toEqual([
      "instance live updates running (watched)",
      "instance live updates paused (background)",
    ])
  })

  test("counts its ticks and waits the full interval before the first read", async () => {
    const { loop, scheduler, ticks } = loopOf()
    loop.attend("watched")

    await scheduler.advance(INTERVAL_MS - 1)
    expect(ticks).toEqual([])
    await scheduler.advance(1)
    await scheduler.advance(INTERVAL_MS)
    await scheduler.advance(INTERVAL_MS)

    expect(ticks).toEqual([1, 2, 3])
  })

  test("waits only the rest of the interval after a recent user load", async () => {
    const { loop, scheduler } = loopOf()
    loop.attend("watched")
    await scheduler.advance(2000)
    loop.settled({ startedAt: scheduler.now(), succeeded: true })
    await scheduler.advance(1000)

    loop.attend("hidden")
    loop.attend("watched")

    expect(scheduler.pending).toEqual([INTERVAL_MS - 1000])
  })

  test("catches up within two seconds once the data is exactly one interval old", async () => {
    const { loop, scheduler } = loopOf()
    loop.settled({ startedAt: scheduler.now(), succeeded: true })
    await scheduler.advance(INTERVAL_MS)

    loop.attend("watched")

    expect(scheduler.pending).toEqual([1000])
  })

  test("reads a slow engine less often and says so in its status", async () => {
    const { loop, scheduler } = loopOf({ loadMs: 3000 })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)
    await scheduler.settle()

    expect(loop.status()).toEqual({ status: "live", everySeconds: 12 })
    expect(scheduler.pending).toEqual([9000])
  })

  test("never runs two reads at once", async () => {
    const { loop, scheduler, ticks } = loopOf({ neverAnswers: true })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)
    loop.attend("hidden")
    loop.attend("watched")
    loop.nudge()
    await scheduler.advance(2000)

    expect(ticks).toEqual([1])
  })

  test("backs off after a failure, logs it, and returns to live after a success", async () => {
    const { loop, scheduler, log, showLive } = loopOf({ outcomes: ["failed", "failed"] })
    loop.attend("watched")
    showLive.mockClear()

    await scheduler.advance(INTERVAL_MS)
    expect(log.at(-1)).toBe("instance live updates failed 1 in a row, next try in 8 s")
    expect(loop.status()).toEqual({
      status: "reconnecting",
      retryAt: new Date(INTERVAL_MS + 7500).toISOString(),
    })
    expect(showLive).toHaveBeenCalled()
    await scheduler.advance(7500)
    expect(log.at(-1)).toBe("instance live updates failed 2 in a row, next try in 15 s")
    expect(scheduler.pending).toEqual([15_000])

    await scheduler.advance(15_000)
    expect(loop.status()).toEqual({ status: "live", everySeconds: 5 })
  })

  test("plans again after a skipped tick", async () => {
    const { loop, scheduler, ticks } = loopOf({ outcomes: ["skipped"] })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)
    await scheduler.advance(INTERVAL_MS)

    expect(ticks).toEqual([1, 1])
  })

  test("stops for good after a stopping outcome, until a user load succeeds", async () => {
    const { loop, scheduler, log, ticks } = loopOf({ outcomes: ["stopped"] })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)

    expect(log.at(-1)).toBe("instance live updates stopped: it is gone")
    expect(loop.status()).toEqual({ status: "stopped", reason: "gone" })
    expect(scheduler.pending).toEqual([])

    loop.settled({ startedAt: scheduler.now(), succeeded: true })
    await scheduler.advance(INTERVAL_MS)
    expect(ticks).toEqual([1, 1])
  })

  test("says stopped while its engine lane is blocked and reads after it opens", async () => {
    const { loop, scheduler, lane, ticks } = loopOf()
    loop.attend("watched")
    lane.block()

    await scheduler.advance(INTERVAL_MS * 3)
    expect(ticks).toEqual([])
    expect(loop.status()).toEqual({ status: "stopped", reason: "refused" })

    lane.unblock()
    await scheduler.advance(INTERVAL_MS)
    expect(ticks).toEqual([1])
  })

  test("waits a full interval while its panel holds", async () => {
    const { loop, scheduler, ticks, hold } = loopOf()
    loop.attend("watched")
    hold(true)
    await scheduler.advance(INTERVAL_MS)
    hold(false)
    await scheduler.advance(INTERVAL_MS - 1)
    expect(ticks).toEqual([])
    await scheduler.advance(1)
    expect(ticks).toEqual([1])
  })

  test("shows every pause and resume, and ends for an ended subject", async () => {
    const { loop, scheduler, showLive, end, ticks } = loopOf()
    loop.attend("watched")
    showLive.mockClear()
    loop.pause()
    loop.resume()
    loop.holdForEditor(true)
    expect(showLive).toHaveBeenCalledTimes(3)
    expect(loop.status()).toEqual({ status: "paused", reason: "editing" })
    loop.holdForEditor(false)
    loop.attend("idle")
    expect(loop.status()).toEqual({ status: "paused", reason: "idle" })

    loop.attend("watched")
    end()
    expect(loop.status()).toEqual({ status: "ended" })
    loop.nudge()
    await scheduler.advance(60_000)
    expect(ticks).toEqual([])
  })

  test("is off with the cadence it would have, and starts at once when switched on", async () => {
    const { loop, liveSwitch, scheduler, ticks, showLive } = loopOf({ setting: "off" })
    loop.attend("watched")
    expect(loop.status()).toEqual({ status: "off", environment: "local", everySeconds: 5 })
    await scheduler.advance(60_000)
    expect(ticks).toEqual([])

    liveSwitch.set("on")
    liveSwitch.set("on")
    await scheduler.advance(0)

    expect(ticks).toEqual([1])
    expect(showLive).toHaveBeenCalled()
    loop.dispose()
    liveSwitch.set("off")
    liveSwitch.set("on")
    expect(scheduler.pending).toEqual([])
  })

  test("numbers only the reads that succeeded and reads again soon after a skipped nudge", async () => {
    const { loop, scheduler, ticks } = loopOf({ outcomes: ["failed", "skipped", "done"] })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)
    loop.nudge()
    await scheduler.advance(1000)
    await scheduler.advance(1000)

    expect(ticks).toEqual([1, 1, 1])
  })

  test("clears the editor hold when its panel is hidden", () => {
    const { loop } = loopOf()
    loop.attend("watched")
    loop.holdForEditor(true)
    loop.attend("hidden")
    loop.attend("watched")

    expect(loop.status()).toEqual({ status: "live", everySeconds: 5 })
  })

  test("catches up no sooner than four times its last load after a slow read", async () => {
    const { loop, scheduler } = loopOf({ loadMs: 7000 })
    loop.attend("watched")
    await scheduler.advance(INTERVAL_MS)

    expect(scheduler.pending).toEqual([21_000])
  })
})

describe("the failures that stop live updates", () => {
  test("are a rejected login, a forbidden request and a broken connection", () => {
    for (const failure of ["unauthorized", "forbidden", "misconfigured"] as const) {
      expect(LiveFailures.stopsLiveUpdates(new RuntimeError(failure, "no"))).toBe(true)
    }
    expect(LiveFailures.stopsLiveUpdates(new RuntimeError("unreachable", "no"))).toBe(false)
    expect(LiveFailures.stopsLiveUpdates(new Error("no"))).toBe(false)
  })
})

describe("shared definitions in flight", () => {
  test("start a new read when a read in flight was forgotten, and keep a failure for the allowed age", async () => {
    let fail: (error: Error) => void = () => undefined
    let now = 0
    const listDefinitions = vi
      .fn<() => Promise<readonly DefinitionSummary[]>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject
          }),
      )
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValue([])
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => now)

    const first = shared.read(0)
    expect(shared.read(60_000)).toBe(first)
    shared.forget()
    const second = shared.read(60_000)
    expect(second).not.toBe(first)
    fail(new Error("down"))
    await expect(first).rejects.toThrow("down")
    await expect(second).rejects.toThrow("still down")
    now = 10
    await expect(shared.read(60_000)).rejects.toThrow("still down")
    await shared.read(0)

    expect(listDefinitions).toHaveBeenCalledTimes(3)
  })

  test("block the engine lane after a rejected login", async () => {
    const lane = new EngineLane()
    const shared = new SharedDefinitions(
      { listDefinitions: () => Promise.reject(new RuntimeError("unauthorized", "no")) },
      lane,
      () => 0,
    )
    await expect(shared.read(0)).rejects.toThrow("no")
    expect(lane.isBlocked).toBe(true)
  })

  test("open the engine lane again after a read that succeeded", async () => {
    const lane = new EngineLane()
    lane.block()
    const shared = new SharedDefinitions(
      { listDefinitions: () => Promise.resolve([]) },
      lane,
      () => 0,
    )
    await shared.read(0)
    expect(lane.isBlocked).toBe(false)
  })

  test("read again once the allowed age has passed", async () => {
    let now = 100
    const listDefinitions = vi.fn(() => Promise.resolve([] as readonly DefinitionSummary[]))
    const shared = new SharedDefinitions({ listDefinitions }, new EngineLane(), () => now)
    await shared.read(0)
    now = 149
    await shared.read(50)
    now = 150
    await shared.read(50)

    expect(listDefinitions).toHaveBeenCalledTimes(2)
  })
})

describe("the definitions loop of the engines tree", () => {
  function treeLoop(listDefinitions: () => Promise<readonly DefinitionSummary[]>, expanded = true) {
    const scheduler = new ManualScheduler(0)
    const lane = new EngineLane()
    const refreshed = vi.fn()
    const loop = new DefinitionsLoop(
      {
        live: {
          switch: new LiveSwitch("on"),
          scheduler,
          lane,
          random: () => 0.5,
          log: () => undefined,
        },
        definitions: new SharedDefinitions({ listDefinitions }, lane, () =>
          scheduler.now().getTime(),
        ),
        environment: "local",
        now: () => scheduler.now(),
      },
      { isExpanded: () => expanded, refreshed },
    )
    return { loop, scheduler, lane, refreshed }
  }

  test("reads an expanded engine every 30 s on a local engine and tells the tree", async () => {
    const listDefinitions = vi.fn(() => Promise.resolve([] as readonly DefinitionSummary[]))
    const { loop, scheduler, refreshed } = treeLoop(listDefinitions)
    loop.attend("watched")

    await scheduler.advance(29_999)
    expect(listDefinitions).not.toHaveBeenCalled()
    await scheduler.advance(1)
    expect(listDefinitions).toHaveBeenCalledTimes(1)
    expect(refreshed).toHaveBeenCalledTimes(1)

    loop.nudge()
    await scheduler.advance(2000)
    expect(listDefinitions).toHaveBeenCalledTimes(2)
    loop.dispose()
    await scheduler.advance(120_000)
    expect(listDefinitions).toHaveBeenCalledTimes(2)
  })

  test("reads nothing for a collapsed engine", async () => {
    const listDefinitions = vi.fn(() => Promise.resolve([] as readonly DefinitionSummary[]))
    const { loop, scheduler } = treeLoop(listDefinitions, false)
    loop.attend("watched")
    await scheduler.advance(120_000)
    expect(listDefinitions).not.toHaveBeenCalled()
  })

  test("backs off on a failure and waits for the lane after a rejected login", async () => {
    let failure: RuntimeError = new RuntimeError("unreachable", "down")
    const listDefinitions = vi.fn(() => Promise.reject(failure))
    const { loop, scheduler, lane, refreshed } = treeLoop(listDefinitions)
    loop.attend("watched")

    await scheduler.advance(30_000)
    expect(lane.isBlocked).toBe(false)
    expect(scheduler.pending[0]).toBeGreaterThanOrEqual(30_000)

    failure = new RuntimeError("unauthorized", "no")
    await scheduler.advance(60_000)
    expect(lane.isBlocked).toBe(true)
    const calls = listDefinitions.mock.calls.length
    await scheduler.advance(300_000)
    expect(listDefinitions).toHaveBeenCalledTimes(calls)
    expect(refreshed).not.toHaveBeenCalled()
  })
})

describe("a live switch", () => {
  test("tells its listeners only about real changes and forgets those who left", () => {
    const live = new LiveSwitch("off")
    const listener = vi.fn()
    const leave = live.subscribe(listener)

    live.set("off")
    live.set("on")
    leave()
    live.set("off")

    expect(listener).toHaveBeenCalledTimes(1)
    expect(live.setting).toBe("off")
  })
})
