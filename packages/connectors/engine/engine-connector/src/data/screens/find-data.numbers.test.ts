/**
 * The same hits on every surface, the MCP server's half of the search (D2 per screen): each
 * dialect's recorded screen engine (c7-core's `C7_SCREEN_ENGINE`, recorded from the conformance
 * world on Operaton, and c8-core's `C8_SCREEN_ENGINE`, from the same world on a Camunda 8 cluster)
 * served on loopback by the transport's recorded engine, read through the search's feed over the
 * server's own wire (the module's configuration and plugin, `engine_screen_find_data`). The feed
 * gives exactly what the recording expects the finder to find (the ended ORD-1003 by its business
 * key, the instance DSP-3001 called by its id), what the editors' adapter of the dialect finds from
 * the same answers (the C7 adapter's test/c7-find-numbers.test.ts, the C8 adapter's
 * test/c8-find-numbers.test.ts). The hits are primary; the history's gap is an enrichment a failed
 * read leaves out, never a guess; a search stands on the floor of 30 s per caller and text, the
 * history's gap on one per caller and engine, which every text shares and a failed read never holds.
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
import type { FindScreenData, InstanceScreenData } from "@miragon/pulse-screens"
import { Finder } from "@miragon/pulse-screens/builder"
import { engineModule } from "../../module.js"
import { ENGINE_SCREEN_FIND_DATA } from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import { SCREEN_FLOOR_MS } from "./screen-floor.js"

/** A recorded screen engine of a dialect, the profile the server reads it through, its reads. */
interface Recorded {
  readonly screen: typeof C7_SCREEN_ENGINE | typeof C8_SCREEN_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
  /** The path the history's gap reads first: the engine's processes and their running instances. */
  readonly definitions: string
  /** The field of a search by a business key, in its request's body. */
  readonly byBusinessKey: string
}

const bodyOf = (answer: RecordedAnswer) => JSON.stringify(answer.body ?? null)

/** How often `engine` was asked for `path`, whatever the query. */
const askedFor = (engine: RecordedEngine, path: string) =>
  engine.seen.filter(({ target }) => target.split("?")[0] === path).length

const RECORDED_C7: Recorded = {
  screen: C7_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
  definitions: "/engine-rest/process-definition/statistics",
  byBusinessKey: '"processInstanceBusinessKey"',
}

const RECORDED_C8: Recorded = {
  screen: C8_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
  definitions: "/v2/process-definitions/statistics/process-instances",
  byBusinessKey: '"businessId"',
}

const engines: RecordedEngine[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

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
  const find = async (text: string) => {
    const feed = recording.tool(ENGINE_SCREEN_FIND_DATA)
    const input = { engine: recorded.screen.engine, text }
    return feed.call((feed.config.inputSchema as z.ZodObject).parse(input))
  }
  return { engine, find }
}

type FindName = "find" | "findById"

/** The text the recording found with: ORD-1003, or the id of the instance DSP-3001 called. */
function textOf(recorded: Recorded, name: FindName): string {
  const called = recorded.screen.expected.calledInstance as InstanceScreenData
  return name === "find" ? "ORD-1003" : called.instance.id
}

const expected = (recorded: Recorded, name: FindName) =>
  recorded.screen.expected[name] as FindScreenData

/** A screen as the recording expects it, read at another time. */
const atAnyTime = (screen: FindScreenData) => ({ ...screen, asOf: undefined })

describe.each([
  ["c7-core's recorded screen engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded screen engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the search's feed over %s", (_name, recorded) => {
  it.each(["find", "findById"] as const)(
    "asks the engine only what it answered and finds what the recording's %s expects",
    async (name) => {
      const { engine, find } = await boot(recorded)

      const screen = feedPayload<FindScreenData>(await find(textOf(recorded, name)))

      expect(engine.unanswered).toEqual([])
      expect(Date.parse(screen.asOf)).not.toBeNaN()
      expect(atAnyTime(screen)).toEqual(atAnyTime(expected(recorded, name)))
    },
  )

  it("keeps the hits without the history's gap where the engine's processes fail", async () => {
    const answers = recorded.screen.answers.filter((answer) => answer.path !== recorded.definitions)
    const { find } = await boot(recorded, answers)

    const screen = feedPayload<FindScreenData>(await find("ORD-1003"))

    expect(screen.historyGap).toBeNull()
    expect(screen.hits).toEqual(expected(recorded, "find").hits)
  })

  it("fails as a search fails, never with no hits", async () => {
    const answers = recorded.screen.answers.filter(
      (answer) => !bodyOf(answer).includes(recorded.byBusinessKey),
    )
    const { find } = await boot(recorded, answers)

    const result = (await find("ORD-1003")) as { isError?: boolean }

    expect(result.isError).toBe(true)
  })

  it("answers a caller's search again within 30 s without a read, and reads anew after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { engine, find } = await boot(recorded)

    const first = feedPayload<FindScreenData>(await find("ORD-1003"))
    const seen = engine.seen.length
    const again = feedPayload<FindScreenData>(await find("ORD-1003"))
    expect(engine.seen.length).toBe(seen)
    expect(again).toEqual(first)

    vi.setSystemTime(Date.now() + SCREEN_FLOOR_MS + 1)
    await find("ORD-1003")
    expect(engine.seen.length).toBeGreaterThan(seen)
  })

  it("reads the history's gap once for a caller's searches of two texts within 30 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { engine, find } = await boot(recorded)

    await find(textOf(recorded, "find"))
    const searches = engine.seen.length
    const byId = feedPayload<FindScreenData>(await find(textOf(recorded, "findById")))

    expect(askedFor(engine, recorded.definitions)).toBe(1)
    expect(engine.seen.length).toBeGreaterThan(searches)
    expect(atAnyTime(byId)).toEqual(atAnyTime(expected(recorded, "findById")))
    vi.setSystemTime(Date.now() + SCREEN_FLOOR_MS + 1)
    await find(textOf(recorded, "find"))
    expect(askedFor(engine, recorded.definitions)).toBe(2)
  })

  it("reads the history's gap again within 30 s where its read failed, the searches kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const failed = vi
      .spyOn(Finder, "historyGap")
      .mockRejectedValueOnce(new Error("the history's count failed"))
    const { engine, find } = await boot(recorded)

    const first = feedPayload<FindScreenData>(await find("ORD-1003"))
    const again = feedPayload<FindScreenData>(await find("ORD-1003"))

    expect(first.historyGap).toBeNull()
    expect(failed).toHaveBeenCalledTimes(2)
    expect(askedFor(engine, recorded.definitions)).toBe(1)
    const byBusinessKey = engine.seen.filter(({ body }) => body.includes(recorded.byBusinessKey))
    expect(byBusinessKey).toHaveLength(1)
    expect(again.asOf).toBe(first.asOf)
    expect(atAnyTime(again)).toEqual(atAnyTime(expected(recorded, "find")))
  })
})

describe("the search's feed input", () => {
  it("takes the text trimmed, and refuses one that names nothing", async () => {
    const { find } = await boot(RECORDED_C7)

    const trimmed = feedPayload<FindScreenData>(await find("  ORD-1003\n"))
    expect(atAnyTime(trimmed)).toEqual(atAnyTime(expected(RECORDED_C7, "find")))
    await expect(find("   ")).rejects.toThrow()
    await expect(find("x".repeat(257))).rejects.toThrow()
  })
})
