import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { FindScreenData, InstanceScreenData } from "@miragon/pulse-screens"
import { Finder, ScreenJson } from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

type FindName = "find" | "findById"

function textOf(name: FindName): string {
  const called = C7_SCREEN_ENGINE.expected.calledInstance as InstanceScreenData
  return name === "find" ? "ORD-1003" : called.instance.id
}

async function found(name: FindName): Promise<{ screen: FindScreenData; unanswered: unknown[] }> {
  const engine = await startRecordedEngine(C7_SCREEN_ENGINE.answers)
  engines.push(engine)
  const runtime = new C7Adapter().runtime({
    endpoint: `${engine.origin}/engine-rest`,
    credentials: { kind: "none" },
  })
  const model = await Finder.read(
    C7_SCREEN_ENGINE.engine,
    textOf(name),
    runtime,
    () => new Date(C7_SCREEN_ENGINE.asOf),
  )
  return { screen: ScreenJson.find(model), unanswered: [...engine.unanswered] }
}

describe("the C7 adapter's finder over c7-core's recorded screen engine", () => {
  test.each(["find", "findById"] as const)(
    "asks the engine only what it answered and finds what the recording's %s expects",
    async (name) => {
      const { screen, unanswered } = await found(name)

      expect(unanswered).toEqual([])
      expect(screen).toEqual(C7_SCREEN_ENGINE.expected[name])
    },
  )

  test.each(["find", "findById"] as const)(
    "holds the figures the conformance kit's fixed world gives for %s",
    (name) => {
      const recorded = C7_SCREEN_ENGINE.expected[name] as FindScreenData

      expect(ScreenFigures.find(recorded)).toEqual(ScreenFigures.find(WORLD_SCREENS[name]))
    },
  )
})
