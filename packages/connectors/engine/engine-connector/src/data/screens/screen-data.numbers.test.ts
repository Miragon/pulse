/**
 * The same numbers on both surfaces, the MCP server's half of the engine screen (D2 per screen):
 * each dialect's recorded screen engine (c7-core's `C7_SCREEN_ENGINE`, recorded from the
 * conformance world on Operaton, and c8-core's `C8_SCREEN_ENGINE`, from the same world on a Camunda
 * 8 cluster) served on loopback by the transport's recorded engine, read through the screen feed
 * over the server's own wire (the module's configuration and plugin, `engine_screen_processes_data`;
 * the generated SDK under C7Runtime, or the Camunda 8 connection under C8Runtime). The feed gives
 * exactly the engine screen the recording expects, the one the editors' adapter of the dialect
 * builds from the same answers over its wire (the C7 adapter's test/c7-screen-numbers.test.ts, the
 * C8 adapter's test/c8-screen-numbers.test.ts), at the time it reads; the web app renders it in
 * apps/web/test/engine-screen.test.tsx. The list of processes is primary, what the engine says it
 * is degrades to null. The process screens and the instance list of the same recordings are built
 * by the screens' builder over the runtime the server resolves for the engine (`runtimeOf`, the
 * diagram through the one XML cache, `diagramXmlOf`), exactly as the editors' adapters build them;
 * their feeds come with the web app's process screen.
 */

import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { C8_SCREEN_ENGINE } from "@miragon/pulse-c8-core/testing"
import {
  type RecordedAnswer,
  type RecordedEngine,
  startRecordedEngine,
} from "@miragon/pulse-http/testing/loopback"
import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import type { EngineScreenData, InstanceListData, ProcessScreenData } from "@miragon/pulse-screens"
import {
  InstanceList,
  ProcessScreen,
  type ProcessScreenReads,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { diagramXmlOf } from "../../lib/engine/diagram-xml.js"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import { type RuntimeEngine, resolveRuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { engineConfigSchema, engineModule } from "../../module.js"
import { createConfiguredEngineRegistry } from "../../plugin.js"
import { ENGINE_SCREEN_PROCESSES_DATA } from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import type { EngineScreenFeedData } from "./engine-screen-data.js"

/** A recorded screen engine of a dialect, the profile the server reads it through and its web app. */
interface Recorded {
  readonly screen: typeof C7_SCREEN_ENGINE | typeof C8_SCREEN_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
  readonly webApp: (origin: string) => EngineScreenFeedData["webApp"]
  /** The answer whose loss leaves the screen without what the engine says it is, if any. */
  readonly about: string | null
  /** The answer whose loss fails the screen: the list of processes. */
  readonly processes: string
  /** The answer whose loss fails a process screen: the process's versions. */
  readonly versions: string
}

/** Operaton, as recorded, at its REST root: its web app derived from it. */
const RECORDED_C7: Recorded = {
  screen: C7_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
  webApp: (origin) => ({ url: `${origin}/operaton/app/cockpit/default`, vendor: "Operaton" }),
  about: "/engine-rest/telemetry/data",
  processes: "/engine-rest/process-definition/statistics",
  versions: "/engine-rest/process-definition/statistics",
}

/** A Camunda 8 cluster without security, as recorded: no web app without the profile's cockpitUrl. */
const RECORDED_C8: Recorded = {
  screen: C8_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
  webApp: () => null,
  about: null,
  processes: "/v2/process-definitions/search",
  versions: "/v2/process-definitions/search",
}

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The server over `recorded`'s engine answering `answers`, and its screen feed's call. */
async function boot(
  recorded: Recorded,
  answers: readonly RecordedAnswer[] = recorded.screen.answers,
  profile: Record<string, unknown> = {},
) {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [recorded.screen.engine]: { ...recorded.profile(engine.origin), ...profile } },
    }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const feed = recording.tool(ENGINE_SCREEN_PROCESSES_DATA)
  const call = () =>
    feed.call((feed.config.inputSchema as z.ZodObject).parse({ engine: recorded.screen.engine }))
  return { engine, call }
}

const without = (recorded: Recorded, path: string): RecordedAnswer[] =>
  recorded.screen.answers.filter((answer) => answer.path !== path)

/** The screen as the recording expects it, read at another time. */
const expectedOf = (recorded: Recorded): Partial<EngineScreenData> => ({
  ...(recorded.screen.expected.engine as EngineScreenData),
  asOf: undefined,
})

describe.each([
  ["c7-core's recorded screen engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded screen engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the engine screen feed over %s", (_name, recorded) => {
  it("asks the engine only what it answered and gives the screen the recording expects", async () => {
    const { engine, call } = await boot(recorded)
    const { webApp, ...screen } = feedPayload<EngineScreenFeedData>(await call())
    expect(engine.unanswered).toEqual([])
    expect(Date.parse(screen.asOf)).not.toBeNaN()
    expect({ ...screen, asOf: undefined }).toEqual(expectedOf(recorded))
    expect(webApp).toEqual(recorded.webApp(engine.origin))
  })

  it("holds the numbers of the engine screen the conformance kit's fixed world gives", () => {
    const expected = recorded.screen.expected.engine as EngineScreenData
    expect(ScreenFigures.engine(expected)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
  })

  it("fails as the list of processes fails, never with an empty screen", async () => {
    const { call } = await boot(recorded, without(recorded, recorded.processes))
    const result = (await call()) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it("names the engine's own web app where the profile names it", async () => {
    const { call } = await boot(recorded, undefined, { cockpitUrl: "https://ops.example/app/" })
    const { webApp } = feedPayload<EngineScreenFeedData>(await call())
    expect(webApp?.url).toBe(
      recorded === RECORDED_C7 ? "https://ops.example/app" : "https://ops.example/app/",
    )
  })
})

describe("an engine that does not say what it is (Camunda 7's telemetry)", () => {
  it("keeps its processes and their numbers, and says nothing of its product: null, never a guess", async () => {
    const about = RECORDED_C7.about as string
    const { call } = await boot(RECORDED_C7, without(RECORDED_C7, about))
    const screen = feedPayload<EngineScreenFeedData>(await call())
    expect(screen.info).toBeNull()
    expect(ScreenFigures.engine(screen)).toEqual(ScreenFigures.engine(WORLD_SCREENS.engine))
  })
})

type ProcessName = "process" | "olderVersion" | "callingProcess"

const PROCESSES: readonly ProcessName[] = ["process", "olderVersion", "callingProcess"]

/** The engine the server resolves over `recorded`'s engine answering `answers`. */
async function resolved(
  recorded: Recorded,
  answers: readonly RecordedAnswer[] = recorded.screen.answers,
): Promise<{ readonly engine: RecordedEngine; readonly resolved: RuntimeEngine }> {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [recorded.screen.engine]: recorded.profile(engine.origin) },
    }),
  })
  const registry = createConfiguredEngineRegistry(engineConfigSchema.parse(config))
  return { engine, resolved: resolveRuntimeEngine(recorded.screen.engine, registry) }
}

/** The reads of a process screen on `engine`: its runtime's, the diagram through the XML cache. */
function processReads(engine: RuntimeEngine): ProcessScreenReads {
  const runtime = runtimeOf(engine)
  return {
    listVersions: (id) => runtime.listVersions(id),
    getElementStatistics: (id) => runtime.getElementStatistics(id),
    getCalledProcesses: (id) => runtime.getCalledProcesses(id),
    getDiagramXml: async (id) => (await diagramXmlOf(engine, id)) ?? undefined,
  }
}

const expectedProcess = (recorded: Recorded, name: ProcessName): ProcessScreenData =>
  recorded.screen.expected[name] as ProcessScreenData

const expectedList = (recorded: Recorded): InstanceListData =>
  recorded.screen.expected.instanceList as InstanceListData

describe.each([
  ["c7-core's recorded screen engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded screen engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the process screens and the instance list over %s", (_name, recorded) => {
  const asOf = () => new Date(recorded.screen.asOf)

  it.each(PROCESSES)(
    "ask the engine only what it answered and give the %s screen the recording expects",
    async (name) => {
      const { engine, resolved: on } = await resolved(recorded)
      const { bpmnProcessId, selected } = expectedProcess(recorded, name)

      const model = await ProcessScreen.read(
        recorded.screen.engine,
        {
          bpmnProcessId: BpmnProcessId(bpmnProcessId),
          ...(name === "olderVersion" && selected !== null
            ? { definitionId: DefinitionId(selected.id) }
            : {}),
        },
        processReads(on),
        asOf,
      )

      expect(engine.unanswered).toEqual([])
      expect(model === undefined ? undefined : ScreenJson.process(model)).toEqual(
        expectedProcess(recorded, name),
      )
      expect(ScreenFigures.process(expectedProcess(recorded, name))).toEqual(
        ScreenFigures.process(WORLD_SCREENS[name]),
      )
    },
  )

  it("asks the engine only what it answered and gives the instance list the recording expects", async () => {
    const { engine, resolved: on } = await resolved(recorded)

    const model = await InstanceList.read(
      recorded.screen.engine,
      { definitionId: DefinitionId(expectedList(recorded).definitionId), filter: { scope: "all" } },
      runtimeOf(on),
      asOf,
    )

    expect(engine.unanswered).toEqual([])
    expect(ScreenJson.instanceList(model)).toEqual(expectedList(recorded))
    expect(ScreenFigures.instanceList(expectedList(recorded))).toEqual(
      ScreenFigures.instanceList(WORLD_SCREENS.instanceList),
    )
  })

  it("fails as the versions fail, never with an empty screen", async () => {
    const { resolved: on } = await resolved(recorded, without(recorded, recorded.versions))

    await expect(
      ProcessScreen.read(
        recorded.screen.engine,
        { bpmnProcessId: BpmnProcessId("pulse-order") },
        processReads(on),
        asOf,
      ),
    ).rejects.toThrow()
  })
})
