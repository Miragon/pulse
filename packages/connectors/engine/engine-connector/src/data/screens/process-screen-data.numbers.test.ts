/**
 * The same numbers on both surfaces, the MCP server's half of the process screen and its instance
 * list (D2 per screen): each dialect's recorded screen engine (c7-core's `C7_SCREEN_ENGINE`,
 * recorded from the conformance world on Operaton, and c8-core's `C8_SCREEN_ENGINE`, from the same
 * world on a Camunda 8 cluster) served on loopback by the transport's recorded engine, read through
 * the process screen's feeds over the server's own wire (the module's configuration and plugin,
 * `engine_screen_process_data` and `engine_screen_instances_data`). The feeds give exactly the
 * screens the recording expects (pulse-order at its latest version and at version 1, pulse-dispatch
 * with its call activity, the instance list of pulse-order's version 1), the ones the editors'
 * adapter of the dialect builds from the same answers (the C7 adapter's
 * test/c7-screen-numbers.test.ts, the C8 adapter's test/c8-screen-numbers.test.ts); the web app
 * renders them in apps/web/test/process-screen.test.tsx. The versions are primary; the element
 * statistics and the called processes are enrichments the screen names unread where they fail,
 * never a 0 (the degrade the web app's badges show), and a screen without them is read again on
 * the next call, while a whole one stands on the floor of 30 s per caller.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { C8_SCREEN_ENGINE } from "@miragon/pulse-c8-core/testing"
import {
  type RecordedAnswer,
  type RecordedEngine,
  startRecordedEngine,
} from "@miragon/pulse-http/testing/loopback"
import type { InstanceListData, ProcessScreenData } from "@miragon/pulse-screens"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { engineModule } from "../../module.js"
import { ENGINE_SCREEN_INSTANCES_DATA, ENGINE_SCREEN_PROCESS_DATA } from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import { definitionSearches, LATEST_LABEL } from "./definition-searches.test-support.js"
import type { ProcessScreenFeedData } from "./process-screen-data.js"
import { SCREEN_FLOOR_MS } from "./screen-floor.js"

/** A recorded screen engine of a dialect and the profile the server reads it through. */
interface Recorded {
  readonly screen: typeof C7_SCREEN_ENGINE | typeof C8_SCREEN_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
  /** A version in the engine's web app, as the provider's route names it; none on Camunda 8. */
  readonly webApp: (origin: string, definitionId: string) => ProcessScreenFeedData["webApp"]
  /** The answer whose loss fails a process screen: the process's versions. */
  readonly versions: string
  /**
   * Whether the engine's answer is one the processes a version calls are read from, and what the
   * screen of pulse-dispatch names unread without it: on Camunda 7 the version's diagram, which
   * its call activities are read from too; on Camunda 8 the latest versions of the processes its
   * call activities name, read by their ids, never every process of the cluster.
   */
  readonly calls: (answer: RecordedAnswer) => boolean
  readonly callsUnread: readonly string[]
  /**
   * The answers an engine still gives without the calls' answers: on Camunda 7 a version's element
   * statistics then read every incident of the version, which the engine answers with the rows of
   * its call activity's read, since pulse-dispatch's statistics count its incidents there alone.
   */
  readonly withoutCalls: (answers: readonly RecordedAnswer[]) => RecordedAnswer[]
}

/** A request for a version's element statistics, in either dialect. */
const STATISTICS = /\/process-definitions?\/[^/]+\/statistics/

const C7_CALLS = (answer: RecordedAnswer) =>
  /\/process-definition\/pulse-dispatch:[^/]+\/xml$/.test(answer.path)

/** The read of every incident of pulse-dispatch's version, answered as its call activity's read. */
function everyDispatchIncident(answers: readonly RecordedAnswer[]): RecordedAnswer[] {
  return answers.flatMap((answer) => {
    const { activityId, ...query } = answer.query ?? {}
    return answer.path === "/engine-rest/incident" &&
      activityId !== undefined &&
      query.processDefinitionId?.startsWith("pulse-dispatch:") === true
      ? [{ ...answer, query }]
      : []
  })
}

/** Operaton, as recorded, at its REST root: its web app derived from it. */
const RECORDED_C7: Recorded = {
  screen: C7_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
  webApp: (origin, definitionId) => ({
    url: `${origin}/operaton/app/cockpit/default/#/process-definition/${encodeURIComponent(definitionId)}`,
    vendor: "Operaton",
  }),
  versions: "/engine-rest/process-definition/statistics",
  calls: C7_CALLS,
  callsUnread: ["diagram", "calledProcesses"],
  withoutCalls: (answers) => {
    const kept = answers.filter((answer) => !C7_CALLS(answer))
    return [...kept, ...everyDispatchIncident(kept)]
  },
}

/** A Camunda 8 cluster without security, as recorded: no web app without the profile's cockpitUrl. */
const RECORDED_C8: Recorded = {
  screen: C8_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
  webApp: () => null,
  versions: "/v2/process-definitions/statistics/process-instances-by-version",
  calls: (answer) => {
    const filter = (answer.body as { filter?: Record<string, unknown> } | undefined)?.filter
    return filter?.isLatestVersion === true && filter.processDefinitionId !== undefined
  },
  callsUnread: ["calledProcesses"],
  withoutCalls: (answers) => answers.filter((answer) => !RECORDED_C8.calls(answer)),
}

const engines: RecordedEngine[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The server over `recorded`'s engine answering `answers`, and a call of a screen feed. */
async function boot(
  recorded: Recorded,
  answers: readonly RecordedAnswer[] = recorded.screen.answers,
) {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [recorded.screen.engine]: recorded.profile(engine.origin) },
    }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const call = (name: string, args: Record<string, unknown>) => {
    const feed = recording.tool(name)
    const input = { engine: recorded.screen.engine, ...args }
    return feed.call((feed.config.inputSchema as z.ZodObject).parse(input))
  }
  return { engine, call }
}

type ProcessName = "process" | "olderVersion" | "callingProcess"

const PROCESSES: readonly ProcessName[] = ["process", "olderVersion", "callingProcess"]

const expectedProcess = (recorded: Recorded, name: ProcessName): ProcessScreenData =>
  recorded.screen.expected[name] as ProcessScreenData

const expectedList = (recorded: Recorded): InstanceListData =>
  recorded.screen.expected.instanceList as InstanceListData

/** What the feed takes for a process screen of the recording: its process, and a version's number. */
function argsOf(recorded: Recorded, name: ProcessName): Record<string, unknown> {
  const { bpmnProcessId, selected } = expectedProcess(recorded, name)
  return name === "olderVersion"
    ? { process: bpmnProcessId, version: selected?.version }
    : { process: bpmnProcessId }
}

/** A screen as the recording expects it, read at another time. */
const atAnyTime = <T extends { asOf: string }>(screen: T) => ({ ...screen, asOf: undefined })

/** The requests for element statistics the engine saw. */
const statisticsReads = (engine: RecordedEngine) =>
  engine.seen.filter(({ target }) => STATISTICS.test(target)).length

describe.each([
  ["c7-core's recorded screen engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded screen engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the process screen's feeds over %s", (_name, recorded) => {
  it.each(PROCESSES)(
    "ask the engine only what it answered and give the %s screen the recording expects",
    async (name) => {
      const expected = expectedProcess(recorded, name)
      const { engine, call } = await boot(recorded)

      const { webApp, ...screen } = feedPayload<ProcessScreenFeedData>(
        await call(ENGINE_SCREEN_PROCESS_DATA, argsOf(recorded, name)),
      )

      expect(engine.unanswered).toEqual([])
      expect(Date.parse(screen.asOf)).not.toBeNaN()
      expect(atAnyTime(screen)).toEqual(atAnyTime(expected))
      expect(webApp).toEqual(
        recorded.webApp(engine.origin, expected.selected?.id ?? "no version selected"),
      )
      expect(ScreenFigures.process(screen)).toEqual(ScreenFigures.process(WORLD_SCREENS[name]))
    },
  )

  it("asks the engine only what it answered and gives the instance list the recording expects", async () => {
    const expected = expectedList(recorded)
    const { engine, call } = await boot(recorded)

    const list = feedPayload<InstanceListData>(
      await call(ENGINE_SCREEN_INSTANCES_DATA, {
        definitionId: expected.definitionId,
        scope: "all",
      }),
    )

    expect(engine.unanswered).toEqual([])
    expect(atAnyTime(list)).toEqual(atAnyTime(expected))
    expect(ScreenFigures.instanceList(list)).toEqual(
      ScreenFigures.instanceList(WORLD_SCREENS.instanceList),
    )
  })

  it("keeps a version without its badges where its statistics fail: unread, never a 0", async () => {
    const answers = recorded.screen.answers.filter((answer) => !STATISTICS.test(answer.path))
    const { call } = await boot(recorded, answers)

    const screen = feedPayload<ProcessScreenFeedData>(
      await call(ENGINE_SCREEN_PROCESS_DATA, argsOf(recorded, "process")),
    )

    expect(screen.badges).toEqual([])
    expect(screen.unread).toEqual(["statistics"])
    expect(screen.versions).toEqual(expectedProcess(recorded, "process").versions)
  })

  it("keeps a calling version without its call targets where the called processes fail", async () => {
    const { call } = await boot(recorded, recorded.withoutCalls(recorded.screen.answers))

    const screen = feedPayload<ProcessScreenFeedData>(
      await call(ENGINE_SCREEN_PROCESS_DATA, argsOf(recorded, "callingProcess")),
    )

    expect(screen.calls).toEqual([])
    expect(screen.unread).toEqual(recorded.callsUnread)
    expect(screen.versions).toEqual(expectedProcess(recorded, "callingProcess").versions)
  })

  it("fails as the versions fail, never with an empty screen", async () => {
    const answers = recorded.screen.answers.filter((answer) => answer.path !== recorded.versions)
    const { call } = await boot(recorded, answers)

    const result = (await call(ENGINE_SCREEN_PROCESS_DATA, argsOf(recorded, "process"))) as {
      isError?: boolean
    }

    expect(result.isError).toBe(true)
  })

  it("answers a caller's read again within 30 s from its last read, and reads anew after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { engine, call } = await boot(recorded)
    const args = argsOf(recorded, "process")

    const first = feedPayload<ProcessScreenFeedData>(await call(ENGINE_SCREEN_PROCESS_DATA, args))
    const read = statisticsReads(engine)
    vi.advanceTimersByTime(SCREEN_FLOOR_MS - 1)
    const again = feedPayload<ProcessScreenFeedData>(await call(ENGINE_SCREEN_PROCESS_DATA, args))

    expect(read).toBe(1)
    expect(statisticsReads(engine)).toBe(1)
    expect(again.asOf).toBe(first.asOf)

    vi.advanceTimersByTime(1)
    await call(ENGINE_SCREEN_PROCESS_DATA, args)
    expect(statisticsReads(engine)).toBe(2)
  })

  it("reads a version again on the next call where an enrichment was missing", async () => {
    const answers = recorded.screen.answers.filter((answer) => !STATISTICS.test(answer.path))
    const { engine, call } = await boot(recorded, answers)
    const args = argsOf(recorded, "process")

    await call(ENGINE_SCREEN_PROCESS_DATA, args)
    await call(ENGINE_SCREEN_PROCESS_DATA, args)

    expect(engine.unanswered.filter(({ target }) => STATISTICS.test(target))).toHaveLength(2)
  })

  it("answers an instance list again within 30 s without reading the engine", async () => {
    const expected = expectedList(recorded)
    const { engine, call } = await boot(recorded)
    const args = { definitionId: expected.definitionId, scope: "all" }

    await call(ENGINE_SCREEN_INSTANCES_DATA, args)
    const seen = engine.seen.length
    await call(ENGINE_SCREEN_INSTANCES_DATA, args)

    expect(engine.seen).toHaveLength(seen)
  })
})

describe("the process screen's feeds over c8-core's recorded screen engine", () => {
  it("read the latest versions of the processes a version calls by their ids, never every process", async () => {
    const { engine, call } = await boot(RECORDED_C8)

    await call(ENGINE_SCREEN_PROCESS_DATA, argsOf(RECORDED_C8, "callingProcess"))

    expect(definitionSearches(engine)).toEqual([
      '{"processDefinitionId":"pulse-dispatch"}',
      LATEST_LABEL,
    ])
  })
})
