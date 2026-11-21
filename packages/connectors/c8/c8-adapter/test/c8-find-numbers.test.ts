import { C8_SCREEN_ENGINE } from "@miragon/pulse-c8-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { FindScreenData, InstanceScreenData } from "@miragon/pulse-screens"
import { Finder, ScreenJson } from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS, type FindFiguresData } from "@miragon/pulse-screens/testing"
import { afterEach, describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

type FindName = "find" | "findById"

const CALLER_BUSINESS_ID = "DSP-3001"

function textOf(name: FindName): string {
  const called = C8_SCREEN_ENGINE.expected.calledInstance as InstanceScreenData
  return name === "find" ? "ORD-1003" : called.instance.id
}

function worldFigures(name: FindName): FindFiguresData {
  const figures = ScreenFigures.find(WORLD_SCREENS[name])
  if (name === "find") {
    return figures
  }
  return {
    ...figures,
    hits: figures.hits.map(([, ...rest]) => [CALLER_BUSINESS_ID, ...rest] as const),
  }
}

async function found(name: FindName): Promise<{ screen: FindScreenData; unanswered: unknown[] }> {
  const engine = await startRecordedEngine(C8_SCREEN_ENGINE.answers)
  engines.push(engine)
  const runtime = new C8Adapter().runtime({
    endpoint: `${engine.origin}/v2`,
    credentials: { kind: "none" },
  })
  const model = await Finder.read(
    C8_SCREEN_ENGINE.engine,
    textOf(name),
    runtime,
    () => new Date(C8_SCREEN_ENGINE.asOf),
  )
  return { screen: ScreenJson.find(model), unanswered: [...engine.unanswered] }
}

describe("the C8 adapter's finder over c8-core's recorded screen engine", () => {
  test.each(["find", "findById"] as const)(
    "asks the cluster only what it answered and finds what the recording's %s expects",
    async (name) => {
      const { screen, unanswered } = await found(name)

      expect(unanswered).toEqual([])
      expect(screen).toEqual(C8_SCREEN_ENGINE.expected[name])
    },
  )

  test.each(["find", "findById"] as const)(
    "holds the kit world's figures for %s, a called instance with its caller's business id",
    (name) => {
      const recorded = C8_SCREEN_ENGINE.expected[name] as FindScreenData

      expect(ScreenFigures.find(recorded)).toEqual(worldFigures(name))
    },
  )
})
