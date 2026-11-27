import { C8_SCREEN_ENGINE, type C8RecordedAnswer } from "@miragon/pulse-c8-core/testing"
import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import { startRecordedEngine, type RecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type {
  EngineScreenData,
  InstanceListData,
  InstanceScreenData,
  ProcessScreenData,
} from "@miragon/pulse-screens"
import {
  EngineScreen,
  InstanceList,
  InstanceScreen,
  ProcessScreen,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
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

type InstanceName = "instance" | "calledInstance"

const ASKED = new Date(C8_SCREEN_ENGINE.asOf)

function runtimeOver(engine: RecordedEngine) {
  return new C8Adapter().runtime({ endpoint: `${engine.origin}/v2`, credentials: { kind: "none" } })
}

async function engineScreen(engine: RecordedEngine): Promise<EngineScreenData> {
  const runtime = runtimeOver(engine)
  return ScreenJson.engine(await EngineScreen.read(C8_SCREEN_ENGINE.engine, runtime, () => ASKED))
}

function expectedInstance(name: InstanceName): InstanceScreenData {
  return C8_SCREEN_ENGINE.expected[name] as InstanceScreenData
}

async function instanceScreen(
  engine: RecordedEngine,
  name: InstanceName,
): Promise<InstanceScreenData | undefined> {
  const id = InstanceId(expectedInstance(name).instance.id)
  const model = await InstanceScreen.read(
    C8_SCREEN_ENGINE.engine,
    id,
    runtimeOver(engine),
    () => ASKED,
  )
  return model === undefined ? undefined : ScreenJson.instance(model)
}

type ProcessName = "process" | "olderVersion" | "callingProcess"

const PROCESSES: readonly ProcessName[] = ["process", "olderVersion", "callingProcess"]

function expectedProcess(name: ProcessName): ProcessScreenData {
  return C8_SCREEN_ENGINE.expected[name] as ProcessScreenData
}

function expectedList(): InstanceListData {
  return C8_SCREEN_ENGINE.expected.instanceList as InstanceListData
}

async function processScreen(
  engine: RecordedEngine,
  name: ProcessName,
): Promise<ProcessScreenData | undefined> {
  const { bpmnProcessId, selected } = expectedProcess(name)
  const model = await ProcessScreen.read(
    C8_SCREEN_ENGINE.engine,
    {
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      ...(name === "olderVersion" && selected !== null
        ? { definitionId: DefinitionId(selected.id) }
        : {}),
    },
    runtimeOver(engine),
    () => ASKED,
  )
  return model === undefined ? undefined : ScreenJson.process(model)
}

async function instanceList(engine: RecordedEngine): Promise<InstanceListData> {
  const model = await InstanceList.read(
    C8_SCREEN_ENGINE.engine,
    { definitionId: DefinitionId(expectedList().definitionId), filter: { scope: "all" } },
    runtimeOver(engine),
    () => ASKED,
  )
  return ScreenJson.instanceList(model)
}

function without(path: string): C8RecordedAnswer[] {
  return C8_SCREEN_ENGINE.answers.filter((answer) => answer.path !== path)
}

function definitionSearches(engine: RecordedEngine): string[] {
  return engine.seen
    .filter(({ target }) => target === "/v2/process-definitions/search")
    .map(({ body }) => JSON.stringify((JSON.parse(body) as { filter: unknown }).filter))
    .sort()
}

const LATEST_LABEL = '{"processDefinitionId":{"$in":["pulse-label"]},"isLatestVersion":true}'

function withoutCallerSearch(callerId: string): C8RecordedAnswer[] {
  return C8_SCREEN_ENGINE.answers.filter(
    (answer) =>
      !(
        answer.path === "/v2/process-instances/search" &&
        JSON.stringify(answer.body).includes(`"processInstanceKey":{"$in":["${callerId}"]}`)
      ),
  )
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

describe("the C8 adapter over c8-core's recorded instance screens", () => {
  test.each(["instance", "calledInstance"] as const)(
    "asks the cluster only what it answered and builds the %s screen the recording expects",
    async (name) => {
      const engine = await recordedEngine()

      const screen = await instanceScreen(engine, name)

      expect(engine.unanswered).toEqual([])
      expect(screen).toEqual(expectedInstance(name))
    },
  )

  test("reads the latest version of the process DSP-3001 calls by its id, never every process", async () => {
    const engine = await recordedEngine()

    await instanceScreen(engine, "instance")

    expect(definitionSearches(engine)).toEqual([LATEST_LABEL])
  })

  test("reads one cluster: each instance screen shows a version the cluster's process list names", async () => {
    const engine = await recordedEngine()

    const listed = await runtimeOver(engine).listDefinitions()

    const latest = listed.map(({ latest }) => latest.id)
    const shown = (["instance", "calledInstance"] as const).map(
      (name) => expectedInstance(name).instance.definition.id,
    )
    expect(shown.filter((id) => !latest.some((listedId) => listedId === id))).toEqual([])
    expect(engine.unanswered).toEqual([])
  })

  test.each(["instance", "calledInstance"] as const)(
    "holds the figures of the %s screen the conformance kit's fixed world and Camunda 7 give",
    (name) => {
      expect(ScreenFigures.instance(expectedInstance(name))).toEqual(
        ScreenFigures.instance(WORLD_SCREENS[name]),
      )
    },
  )

  test("keeps a called instance without its caller where the caller's read fails, and names it", async () => {
    const caller = expectedInstance("instance").instance.id
    const engine = await recordedEngine(withoutCallerSearch(caller))

    const screen = await instanceScreen(engine, "calledInstance")

    expect(screen?.caller).toEqual({ instanceId: caller, found: null })
    expect(screen?.unread).toEqual(["caller"])
    expect(engine.unanswered).toHaveLength(1)
  })

  test("fails as the instance's detail fails, never with an empty screen", async () => {
    const id = expectedInstance("instance").instance.id
    const engine = await recordedEngine(without(`/v2/process-instances/${id}`))

    await expect(instanceScreen(engine, "instance")).rejects.toThrow()
  })
})

describe("the C8 adapter over c8-core's recorded process screens and instance list", () => {
  test.each(PROCESSES)(
    "asks the engine only what it answered and builds the %s screen the recording expects",
    async (name) => {
      const engine = await recordedEngine()

      const screen = await processScreen(engine, name)

      expect(engine.unanswered).toEqual([])
      expect(screen).toEqual(expectedProcess(name))
    },
  )

  test("asks the engine only what it answered and builds the instance list the recording expects", async () => {
    const engine = await recordedEngine()

    const list = await instanceList(engine)

    expect(engine.unanswered).toEqual([])
    expect(list).toEqual(expectedList())
  })

  test.each(PROCESSES)(
    "holds the figures of the %s screen the conformance kit's fixed world gives",
    (name) => {
      expect(ScreenFigures.process(expectedProcess(name))).toEqual(
        ScreenFigures.process(WORLD_SCREENS[name]),
      )
    },
  )

  test("holds the figures of the instance list the conformance kit's fixed world gives", () => {
    expect(ScreenFigures.instanceList(expectedList())).toEqual(
      ScreenFigures.instanceList(WORLD_SCREENS.instanceList),
    )
  })

  test("reads one engine: each process screen's latest version is the one the engine's process list names", async () => {
    const engine = await recordedEngine()

    const listed = await runtimeOver(engine).listDefinitions()

    const latest = new Set<string>(listed.map(({ latest }) => latest.id))
    const shown = PROCESSES.map((name) => expectedProcess(name).versions[0]?.definition.id ?? "")
    expect(shown.filter((id) => !latest.has(id))).toEqual([])
    expect(expectedList().definitionId).toBe(expectedProcess("olderVersion").selected?.id)
  })

  test("reads the latest versions of the processes a version calls by their ids, never every process", async () => {
    const engine = await recordedEngine()

    await processScreen(engine, "callingProcess")

    expect(definitionSearches(engine)).toEqual([
      '{"processDefinitionId":"pulse-dispatch"}',
      LATEST_LABEL,
    ])
  })

  test("keeps a version's screen without its statistics where their read fails, and names them", async () => {
    const engine = await recordedEngine(
      without(
        `/v2/process-definitions/${expectedProcess("olderVersion").selected?.id ?? ""}/statistics/element-instances`,
      ),
    )

    const screen = await processScreen(engine, "olderVersion")

    expect(screen?.badges).toEqual([])
    expect(screen?.unread).toEqual(["statistics"])
    expect(screen?.versions).toEqual(expectedProcess("olderVersion").versions)
  })

  test("fails as the versions fail, never with an empty screen", async () => {
    const engine = await recordedEngine(without("/v2/process-definitions/search"))

    await expect(processScreen(engine, "process")).rejects.toThrow()
  })
})
