/**
 * The screens and boards as JSON for any page (#666): each dialect's recorded screen and board
 * engine (c7-core's `C7_SCREEN_ENGINE` and `C7_BOARD_ENGINE`, c8-core's `C8_SCREEN_ENGINE` and
 * `C8_BOARD_ENGINE`) served on loopback, read through the model tools `engine_get_screen` and
 * `engine_get_board` over the server's own wire (the module's configuration and plugin). Each
 * gives exactly the form the recording expects, the one the web app's screen feeds and the board
 * feed give from the same answers (data/screens/*.numbers.test.ts, data/board-data.numbers.test.ts),
 * held to the strict JSON forms of version 1 (test-support/screen-forms.ts, board-form.ts), which
 * the conformance kit's own screens hold too, with the version a page checks beside it. The tools
 * stand on the feeds' floors: a page and the web app asking alike cost the engine one read.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { BoardVocabulary } from "@miragon/pulse-board"
import { C7_BOARD_ENGINE, C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { C8_BOARD_ENGINE, C8_SCREEN_ENGINE } from "@miragon/pulse-c8-core/testing"
import { type RecordedEngine, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import {
  type InstanceScreenData,
  type ProcessScreenData,
  ScreenFormat,
} from "@miragon/pulse-screens"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { engineModule } from "../module.js"
import {
  ENGINE_BOARD_DATA,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
  ENGINE_SCREEN_PROCESSES_DATA,
} from "../tool-names.js"
import type { BoardFormData, ScreenFormData } from "../data/json-forms.js"
import { feedPayload } from "./test-support/feed-payload.js"
import { BOARD_FORM } from "./test-support/board-form.js"
import {
  ENGINE_SCREEN_FORM,
  INSTANCE_SCREEN_FORM,
  PROCESS_SCREEN_FORM,
} from "./test-support/screen-forms.js"

/** A dialect's recorded screen and board engines and the profile the server reads them through. */
interface Recorded {
  readonly screen: typeof C7_SCREEN_ENGINE | typeof C8_SCREEN_ENGINE
  readonly board: typeof C7_BOARD_ENGINE | typeof C8_BOARD_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
}

/** Operaton, as recorded, at its REST root. */
const RECORDED_C7: Recorded = {
  screen: C7_SCREEN_ENGINE,
  board: C7_BOARD_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
}

/** A Camunda 8 cluster without security, as recorded, at its REST root. */
const RECORDED_C8: Recorded = {
  screen: C8_SCREEN_ENGINE,
  board: C8_BOARD_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
}

const engines: RecordedEngine[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

interface ToolResultLike {
  readonly isError?: boolean
  readonly content: readonly { readonly text?: string }[]
}

/** The server over `env`, and a call of one of its tools with arguments its schema took. */
function serverOf(env: Record<string, string>) {
  const recording = recordingModuleServer()
  engineModule.createPlugin(engineModule.configFromEnv(env)).register(recording.server)
  const schema = (name: string) => recording.tool(name).config.inputSchema as z.ZodObject
  return {
    schema,
    call: async (name: string, args: Record<string, unknown>) => {
      const tool = recording.tool(name)
      return (await tool.call(schema(name).parse(args))) as ToolResultLike
    },
  }
}

/** The server over `recorded`'s screen engine, with its engine. */
async function bootScreens(recorded: Recorded) {
  const engine = await startRecordedEngine(recorded.screen.answers)
  engines.push(engine)
  const profiles = { [recorded.screen.engine]: recorded.profile(engine.origin) }
  const server = serverOf({ ENGINES_JSON: JSON.stringify({ profiles }) })
  const call = (name: string, args: Record<string, unknown>) =>
    server.call(name, { engine: recorded.screen.engine, ...args })
  return { engine, call }
}

/** The server over `recorded`'s board engine, its board as `orders.board.json`. */
async function bootBoard(recorded: Recorded) {
  const engine = await startRecordedEngine(recorded.board.answers)
  engines.push(engine)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-board-tool-"))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, "orders.board.json"), recorded.board.text)
  const profiles = { [recorded.board.engine]: recorded.profile(engine.origin) }
  return {
    engine,
    ...serverOf({ ENGINES_JSON: JSON.stringify({ profiles }), ENGINE_BOARDS_DIR: dir }),
  }
}

const textOf = (result: ToolResultLike) => result.content.map((part) => part.text ?? "").join("")

/** A form as the recording expects it, read at another time. */
const atAnyTime = <T extends { asOf: string }>(form: T) => ({ ...form, asOf: undefined })

type ProcessName = "process" | "olderVersion" | "callingProcess"

/** What the tool takes for a process screen of the recording: its key, and a version's number. */
function processArgs(recorded: Recorded, name: ProcessName): Record<string, unknown> {
  const { bpmnProcessId, selected } = recorded.screen.expected[name] as ProcessScreenData
  return {
    screen: "process",
    processDefinitionKey: bpmnProcessId,
    ...(name === "olderVersion" ? { version: selected?.version } : {}),
  }
}

describe("the JSON forms of version 1, which the tools' outputs are held to", () => {
  it("hold the screens of the conformance kit's fixed world, each as it is", () => {
    expect(ENGINE_SCREEN_FORM.parse(WORLD_SCREENS.engine)).toEqual(WORLD_SCREENS.engine)
    for (const name of ["process", "olderVersion", "callingProcess"] as const) {
      expect(PROCESS_SCREEN_FORM.parse(WORLD_SCREENS[name])).toEqual(WORLD_SCREENS[name])
    }
    for (const name of ["instance", "calledInstance"] as const) {
      expect(INSTANCE_SCREEN_FORM.parse(WORLD_SCREENS[name])).toEqual(WORLD_SCREENS[name])
    }
  })

  it("refuse a key the form does not name, and a form without one it does", () => {
    expect(ENGINE_SCREEN_FORM.safeParse({ ...WORLD_SCREENS.engine, webApp: null }).success).toBe(
      false,
    )
    const withoutBadges = Object.fromEntries(
      Object.entries(WORLD_SCREENS.process).filter(([key]) => key !== "badges"),
    )
    expect(PROCESS_SCREEN_FORM.safeParse(withoutBadges).success).toBe(false)
  })

  it("are the versions the formats name", () => {
    expect(ScreenFormat.JSON_VERSION).toBe(1)
    expect(BoardVocabulary.JSON_VERSION).toBe(1)
  })
})

describe.each([
  ["c7-core's recorded engines, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded engines, over the server's Camunda 8 wire", RECORDED_C8],
])("engine_get_screen and engine_get_board over %s", (_name, recorded) => {
  it("gives the engine screen the recording expects, in the form of its version", async () => {
    const { engine, call } = await bootScreens(recorded)
    const result = feedPayload<ScreenFormData>(
      await call("engine_get_screen", { screen: "engine" }),
    )
    expect(engine.unanswered).toEqual([])
    expect(Object.keys(result).sort()).toEqual(["data", "formatVersion", "screen"])
    expect(result).toMatchObject({ screen: "engine", formatVersion: ScreenFormat.JSON_VERSION })
    const data = ENGINE_SCREEN_FORM.parse(result.data)
    expect(atAnyTime(data)).toEqual({
      ...(recorded.screen.expected.engine as typeof data),
      asOf: undefined,
    })
  })

  it.each(["process", "olderVersion", "callingProcess"] as const)(
    "gives the %s screen the recording expects, in the form of its version",
    async (name) => {
      const { engine, call } = await bootScreens(recorded)
      const result = feedPayload<ScreenFormData>(
        await call("engine_get_screen", processArgs(recorded, name)),
      )
      expect(engine.unanswered).toEqual([])
      expect(result).toMatchObject({ screen: "process", formatVersion: ScreenFormat.JSON_VERSION })
      const data = PROCESS_SCREEN_FORM.parse(result.data)
      expect(atAnyTime(data)).toEqual(
        atAnyTime(recorded.screen.expected[name] as ProcessScreenData),
      )
      expect(ScreenFigures.process(data)).toEqual(ScreenFigures.process(WORLD_SCREENS[name]))
    },
  )

  it.each(["instance", "calledInstance"] as const)(
    "gives the %s screen the recording expects, in the form of its version",
    async (name) => {
      const expected = recorded.screen.expected[name] as InstanceScreenData
      const { engine, call } = await bootScreens(recorded)
      const result = feedPayload<ScreenFormData>(
        await call("engine_get_screen", {
          screen: "instance",
          processInstanceId: expected.instance.id,
        }),
      )
      expect(engine.unanswered).toEqual([])
      expect(result).toMatchObject({ screen: "instance", formatVersion: ScreenFormat.JSON_VERSION })
      const data = INSTANCE_SCREEN_FORM.parse(result.data)
      expect(atAnyTime(data)).toEqual(atAnyTime(expected))
    },
  )

  it("gives the form the screen feeds give, read once for both within the floor", async () => {
    const { engine, call } = await bootScreens(recorded)
    const { bpmnProcessId } = recorded.screen.expected.process as ProcessScreenData
    const instanceId = (recorded.screen.expected.instance as InstanceScreenData).instance.id
    const engineFeed = feedPayload<Record<string, unknown>>(
      await call(ENGINE_SCREEN_PROCESSES_DATA, {}),
    )
    const processFeed = feedPayload<Record<string, unknown>>(
      await call(ENGINE_SCREEN_PROCESS_DATA, { process: bpmnProcessId }),
    )
    const read = engine.seen.length
    const engineTool = feedPayload<ScreenFormData>(
      await call("engine_get_screen", { screen: "engine" }),
    )
    const processTool = feedPayload<ScreenFormData>(
      await call("engine_get_screen", { screen: "process", processDefinitionKey: bpmnProcessId }),
    )
    // The engine and process screens stand on the feeds' floor: the tool asks the engine nothing.
    expect(engine.seen).toHaveLength(read)
    expect({ ...engineTool.data, webApp: engineFeed.webApp }).toEqual(engineFeed)
    expect({ ...processTool.data, webApp: processFeed.webApp }).toEqual(processFeed)
    // An instance stands on no floor, as its feed does; its form is the feed's without its extras.
    const instanceFeed = feedPayload<Record<string, unknown>>(
      await call(ENGINE_SCREEN_INSTANCE_DATA, { instance: instanceId }),
    )
    const instanceTool = feedPayload<ScreenFormData>(
      await call("engine_get_screen", { screen: "instance", processInstanceId: instanceId }),
    )
    const { webApp, causes } = instanceFeed
    expect(atAnyTime({ ...(instanceTool.data as InstanceScreenData), webApp, causes })).toEqual(
      atAnyTime(instanceFeed as unknown as InstanceScreenData),
    )
  })

  it("gives the board the recording expects, in the form of its version, read once with its feed", async () => {
    const { engine, call } = await bootBoard(recorded)
    const result = feedPayload<BoardFormData>(await call("engine_get_board", { board: "orders" }))
    expect(engine.unanswered).toEqual([])
    expect(Object.keys(result).sort()).toEqual(["asOf", "board", "data", "formatVersion"])
    expect(result).toMatchObject({ board: "orders", formatVersion: BoardVocabulary.JSON_VERSION })
    expect(Date.parse(result.asOf)).not.toBeNaN()
    expect(BOARD_FORM.parse(result.data)).toEqual(recorded.board.expected)
    const read = engine.seen.length
    const feed = feedPayload<Record<string, unknown>>(
      await call(ENGINE_BOARD_DATA, { board: "orders" }),
    )
    expect(engine.seen).toHaveLength(read)
    expect(feed).toEqual({ ...result.data, asOf: result.asOf })
  })
})

describe("what the screen tool refuses, before it reads", () => {
  it.each([
    [{ screen: "engine", processInstanceId: "pi-1" }, "Screen engine takes no processInstanceId."],
    [
      { screen: "engine", processDefinitionKey: "order", version: 2 },
      "Screen engine takes no processDefinitionKey or version.",
    ],
    [{ screen: "process" }, "Screen process needs processDefinitionKey."],
    [{ screen: "process", version: 2 }, "Screen process needs processDefinitionKey."],
    [
      { screen: "process", processDefinitionKey: "order", processInstanceId: "pi-1" },
      "Screen process takes no processInstanceId.",
    ],
    [{ screen: "instance" }, "Screen instance needs processInstanceId."],
    [
      { screen: "instance", processInstanceId: "pi-1", version: 1 },
      "Screen instance takes no version.",
    ],
  ])("%j: %s", async (args, message) => {
    const { engine, call } = await bootScreens(RECORDED_C7)
    const result = await call("engine_get_screen", args)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`[INVALID_SELECTION] ${message}`)
    expect(engine.seen).toEqual([])
  })

  it("names a process the engine has no version of, as a refusal of its own", async () => {
    const { call } = await bootScreens(RECORDED_C7)
    const process = await call("engine_get_screen", {
      screen: "process",
      processDefinitionKey: "no-such-process",
    })
    expect(process.isError).toBe(true)
    expect(textOf(process)).toMatch(/^\[UNKNOWN_PROCESS\] Process "no-such-process" has no version/)
  })

  it("refuses arguments its schema does not take: a screen it does not know, a key, a version 0", () => {
    const { schema } = serverOf({ ENGINE_BASE_URL: "http://localhost:1/engine-rest" })
    const input = schema("engine_get_screen")
    expect(input.safeParse({ screen: "instances" }).success).toBe(false)
    expect(input.safeParse({ screen: "process", process: "order" }).success).toBe(false)
    expect(
      input.safeParse({ screen: "process", processDefinitionKey: "order", version: 0 }).success,
    ).toBe(false)
  })
})

describe("what the board tool refuses", () => {
  it("names the boards a server shows for an id it does not, and says when it shows none", async () => {
    const { call } = await bootBoard(RECORDED_C7)
    const unknown = await call("engine_get_board", { board: "elsewhere" })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toBe('[UNKNOWN_BOARD] Unknown board id "elsewhere". Boards: orders.')
    const { call: callBare } = serverOf({ ENGINE_BASE_URL: "http://localhost:1/engine-rest" })
    expect(textOf(await callBare("engine_get_board", { board: "orders" }))).toBe(
      '[UNKNOWN_BOARD] Unknown board id "orders": this server shows no board.',
    )
  })
})
