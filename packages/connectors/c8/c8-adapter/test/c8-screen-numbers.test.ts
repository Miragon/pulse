import { C8_SCREEN_ENGINE, type C8RecordedAnswer } from "@miragon/pulse-c8-core/testing"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { EngineScreenData } from "@miragon/pulse-screens"
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, describe, expect, test } from "vitest"
import { C8Adapter } from "../src/index.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function recordedEngine(
  answers: readonly C8RecordedAnswer[] = C8_SCREEN_ENGINE.answers,
): Promise<RecordedEngine> {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  return engine
}

async function engineScreen(engine: RecordedEngine): Promise<EngineScreenData> {
  const runtime = new C8Adapter().runtime({
    endpoint: `${engine.origin}/v2`,
    credentials: { kind: "none" },
  })
  const asOf = new Date(C8_SCREEN_ENGINE.asOf)
  return ScreenJson.engine(await EngineScreen.read(C8_SCREEN_ENGINE.engine, runtime, () => asOf))
}

function without(path: string): C8RecordedAnswer[] {
  return C8_SCREEN_ENGINE.answers.filter((answer) => answer.path !== path)
}

describe("the C8 adapter over c8-core's recorded screen engine", () => {
  test("asks the cluster only what it answered and builds the engine screen the recording expects", async () => {
    const engine = await recordedEngine()

    const screen = await engineScreen(engine)

    expect(engine.unanswered).toEqual([])
    expect(screen).toEqual(C8_SCREEN_ENGINE.expected.engine)
  })

  test("holds the numbers of the engine screen the conformance kit's fixed world gives", () => {
    const expected = C8_SCREEN_ENGINE.expected.engine as EngineScreenData

    expect(ScreenFigures.engine(expected)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
  })

  test("fails with a cluster that does not say its version, which c8-core checks before it reads", async () => {
    const engine = await recordedEngine(without("/v2/topology"))

    await expect(engineScreen(engine)).rejects.toThrow(/topology/)
  })

  test("fails as the list of processes fails, never with an empty screen", async () => {
    const engine = await recordedEngine(without("/v2/process-definitions/search"))

    await expect(engineScreen(engine)).rejects.toThrow()
  })
})
