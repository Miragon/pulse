import { C7_SCREEN_ENGINE, type C7RecordedAnswer } from "@miragon/pulse-c7-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { EngineScreenData } from "@miragon/pulse-screens"
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function recordedEngine(
  answers: readonly C7RecordedAnswer[] = C7_SCREEN_ENGINE.answers,
): Promise<RecordedEngine> {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  return engine
}

async function engineScreen(engine: RecordedEngine): Promise<EngineScreenData> {
  const runtime = new C7Adapter().runtime({
    endpoint: `${engine.origin}/engine-rest`,
    credentials: { kind: "none" },
  })
  const asOf = new Date(C7_SCREEN_ENGINE.asOf)
  return ScreenJson.engine(await EngineScreen.read(C7_SCREEN_ENGINE.engine, runtime, () => asOf))
}

function without(path: string): C7RecordedAnswer[] {
  return C7_SCREEN_ENGINE.answers.filter((answer) => answer.path !== path)
}

describe("the C7 adapter over c7-core's recorded screen engine", () => {
  test("asks the engine only what it answered and builds the engine screen the recording expects", async () => {
    const engine = await recordedEngine()

    const screen = await engineScreen(engine)

    expect(engine.unanswered).toEqual([])
    expect(screen).toEqual(C7_SCREEN_ENGINE.expected.engine)
  })

  test("holds the numbers of the engine screen the conformance kit's fixed world gives", () => {
    const expected = C7_SCREEN_ENGINE.expected.engine as EngineScreenData

    expect(ScreenFigures.engine(expected)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
  })

  test("keeps the processes of an engine that does not say what it is, without its product", async () => {
    const engine = await recordedEngine(without("/engine-rest/telemetry/data"))

    const screen = await engineScreen(engine)

    expect(screen.info).toBeNull()
    expect(ScreenFigures.engine(screen)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
  })

  test("fails as the list of processes fails, never with an empty screen", async () => {
    const engine = await recordedEngine(without("/engine-rest/process-definition/statistics"))

    await expect(engineScreen(engine)).rejects.toThrow()
  })
})
