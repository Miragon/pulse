import { BoardParser, type BoardData } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson } from "@miragon/pulse-board/builder"
import { C7_STATUS_SCREENS } from "@miragon/pulse-c7-core/testing"
import { BpmnProcessId, InstanceId } from "@miragon/pulse-engine-core"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { InstanceScreenData, ProcessScreenData } from "@miragon/pulse-screens"
import { InstanceScreen, ProcessScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { afterEach, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const ASKED = new Date(C7_STATUS_SCREENS.asOf)

async function recordedRuntime() {
  const engine = await startRecordedEngine(C7_STATUS_SCREENS.answers)
  engines.push(engine)
  const runtime = new C7Adapter().runtime({
    endpoint: `${engine.origin}/engine-rest`,
    credentials: { kind: "none" },
  })
  return { engine, runtime }
}

const expectedProcess = () => C7_STATUS_SCREENS.expected.process as ProcessScreenData

const expectedInstance = () => C7_STATUS_SCREENS.expected.instance as InstanceScreenData

describe("the C7 adapter over c7-core's recorded status screens, the multi-instance body's root incident on its element", () => {
  test("asks the engine only what it answered and builds the process screen the recording expects", async () => {
    const { engine, runtime } = await recordedRuntime()

    const model = await ProcessScreen.read(
      C7_STATUS_SCREENS.engine,
      { bpmnProcessId: BpmnProcessId(expectedProcess().bpmnProcessId) },
      runtime,
      () => ASKED,
    )

    expect(engine.unanswered).toEqual([])
    expect(model === undefined ? undefined : ScreenJson.process(model)).toEqual(expectedProcess())
  })

  test("asks the engine only what it answered and builds the instance screen the recording expects", async () => {
    const { engine, runtime } = await recordedRuntime()

    const model = await InstanceScreen.read(
      C7_STATUS_SCREENS.engine,
      InstanceId(expectedInstance().instance.id),
      runtime,
      () => ASKED,
    )

    expect(engine.unanswered).toEqual([])
    expect(model === undefined ? undefined : ScreenJson.instance(model)).toEqual(expectedInstance())
  })

  test("asks the engine only what it answered and builds the board the recording expects", async () => {
    const { engine, runtime } = await recordedRuntime()
    const parsed = BoardParser.parse(C7_STATUS_SCREENS.text)
    if (!("board" in parsed)) throw new Error(JSON.stringify(parsed.problems))

    const model = await BoardBuilder.build(parsed.board, [
      { name: C7_STATUS_SCREENS.engine, reads: runtime },
    ])
    const board: BoardData = BoardJson.of(model, {
      failureOf: () => ({ code: "unknown" }),
      notes: parsed.notes,
    })

    expect(engine.unanswered).toEqual([])
    expect(board).toEqual(C7_STATUS_SCREENS.expected.board)
  })
})
