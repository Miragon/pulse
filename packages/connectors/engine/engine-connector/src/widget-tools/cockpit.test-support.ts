import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { z } from "zod"
import { DEFAULT_VERDICT_THRESHOLDS, type VerdictThresholds } from "@miragon/pulse-c7-core"
import type { EngineEntry } from "../engine-provider.js"
import { createEngineRegistry } from "../lib/engine/resolve-engine.js"
import { providerForEntry } from "../providers/index.js"
import { ENGINE_OPEN_COCKPIT } from "../tool-names.js"
import { startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import { worldReply } from "../tools/test-support/engine-world.js"
import type { BoardFiles } from "../board-files.js"
import { registerCockpitWidgetTools } from "./cockpit.js"

/** What the cockpit tests share: `engine_open_cockpit` registered over fake engines. */

interface CockpitResult {
  isError?: boolean
  structuredContent?: Record<string, unknown>
  content: Array<{ type: string; text: string }>
}

type Handler = (args: Record<string, unknown>) => Promise<CockpitResult>

interface Definition {
  name: string
  inputSchema: z.ZodType
}

/** The cockpit tool as `registerCockpitWidgetTools` registered it on `recording`. */
export function cockpitOf(recording: ReturnType<typeof recordingModuleServer>) {
  const tool = recording.tool(ENGINE_OPEN_COCKPIT)
  const definition = { name: tool.name, ...tool.config } as Definition
  const handler: Handler = (args) => tool.call(args)
  return { definition, handler }
}

const engines: FakeEngine[] = []

/** Closes the fake engines the tests started: each test file's `afterEach`. */
export async function closeFakeEngines(): Promise<void> {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
}

/** Each engine without a `baseUrl` answers from the fake engine world; `requests` records the reads. */
export async function cockpitOn(
  ids: Array<Pick<EngineEntry, "id" | "environment"> & { baseUrl?: string }>,
  options: {
    defaultEngineId?: string
    healthThresholds?: VerdictThresholds
    boards?: BoardFiles
  } = {},
) {
  const engine = await startFakeEngine({}, worldReply)
  engines.push(engine)
  const entries = ids.map((e) => ({ ...e, baseUrl: e.baseUrl ?? engine.baseUrl }))
  const recording = recordingModuleServer()
  registerCockpitWidgetTools({
    server: recording.server,
    registry: createEngineRegistry(
      entries,
      (e) => providerForEntry(e).createClient(e, { type: "none" }),
      { defaultEngineId: options.defaultEngineId },
    ),
    healthThresholds: options.healthThresholds ?? DEFAULT_VERDICT_THRESHOLDS,
    toolset: "read-only",
    registered: new Set(),
    ...(options.boards ? { boards: options.boards } : {}),
  })
  return { ...cockpitOf(recording), requests: engine.requests, baseUrl: engine.baseUrl }
}

/** One engine whose every read fails. */
export async function cockpitDown(): Promise<Handler> {
  const engine = await startFakeEngine({}, { status: 503, body: { message: "unavailable" } })
  engines.push(engine)
  const recording = recordingModuleServer()
  registerCockpitWidgetTools({
    server: recording.server,
    registry: createEngineRegistry([{ id: "solo", baseUrl: engine.baseUrl }], (e) =>
      providerForEntry(e).createClient(e, { type: "none" }),
    ),
    healthThresholds: DEFAULT_VERDICT_THRESHOLDS,
    toolset: "read-only",
    registered: new Set(),
  })
  return cockpitOf(recording).handler
}

export const dataOf = (result: CockpitResult) => result.structuredContent!
export const textOf = (result: CockpitResult) => result.content.map((c) => c.text).join("\n")
export const factsOf = (result: CockpitResult) =>
  JSON.parse(textOf(result)) as Record<string, unknown>

export const THREE = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }]
export const ALL = THREE.map((e) => ({ id: e.id, environment: "default", dialect: "c7" }))
