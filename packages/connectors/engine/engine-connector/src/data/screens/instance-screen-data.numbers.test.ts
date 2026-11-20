/**
 * The same numbers on both surfaces, the MCP server's half of the instance screen (D2 per screen):
 * each dialect's recorded screen engine (c7-core's `C7_SCREEN_ENGINE`, recorded from the
 * conformance world on Operaton, and c8-core's `C8_SCREEN_ENGINE`, from the same world on a Camunda
 * 8 cluster) served on loopback by the transport's recorded engine, read through the instance
 * screen's feed over the server's own wire (the module's configuration and plugin,
 * `engine_screen_instance_data`). The feed gives exactly the instance screens the recording
 * expects (DSP-3001, which waits at its call activity for the root incident of the instance it
 * called, and that instance with its caller), the ones the editors' adapter of the dialect builds
 * from the same answers (the C7 adapter's test/c7-screen-numbers.test.ts, the C8 adapter's
 * test/c8-screen-numbers.test.ts); the web app renders them in apps/web/test/instance-screen.test.tsx.
 * The instance's detail is primary, its caller an enrichment the screen names unread where it
 * fails. The text feed (`engine_screen_incident_text_data`) reads a root incident's text with the
 * line its root cause stands on, the cause the card names.
 */

import http from "node:http"
import type { AddressInfo } from "node:net"
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
import type { InstanceScreenData } from "@miragon/pulse-screens"
import { ScreenFigures, WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { engineModule } from "../../module.js"
import { ENGINE_SCREEN_INCIDENT_TEXT_DATA, ENGINE_SCREEN_INSTANCE_DATA } from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import type { IncidentTextFeedData } from "./incident-text-data.js"
import type { InstanceScreenFeedData } from "./instance-screen-data.js"

type InstanceName = "instance" | "calledInstance"

/** A recorded screen engine of a dialect and the profile the server reads it through. */
interface Recorded {
  readonly screen: typeof C7_SCREEN_ENGINE | typeof C8_SCREEN_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
  /** The instance in the engine's web app, as the provider's route names it; none on Camunda 8. */
  readonly webApp: (origin: string, instanceId: string) => InstanceScreenFeedData["webApp"]
  /** The answer of the detail of `instanceId`, whose loss fails the screen. */
  readonly detail: (instanceId: string) => string
  /**
   * The incident's own read, which the text feed sends: the row the recording's incident search
   * answered, as the engine answers it by its id (the recording reads no incident by its id).
   */
  readonly incidentRead: (answers: readonly RecordedAnswer[], incidentId: string) => RecordedAnswer
}

/** The JSON a recorded answer holds. */
const jsonOf = (answer: RecordedAnswer): unknown => ("answer" in answer ? answer.answer : undefined)

/** The rows of every recorded answer of `path`, `rowsOf` reading each answer's rows. */
function rowsAt(
  answers: readonly RecordedAnswer[],
  path: string,
  rowsOf: (json: unknown) => unknown,
): Record<string, unknown>[] {
  return answers
    .filter((answer) => answer.path === path)
    .flatMap((answer) => rowsOf(jsonOf(answer)) as Record<string, unknown>[])
}

/** Operaton, as recorded, at its REST root: its web app derived from it. */
const RECORDED_C7: Recorded = {
  screen: C7_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
  webApp: (origin, instanceId) => ({
    url: `${origin}/operaton/app/cockpit/default/#/process-instance/${instanceId}`,
    vendor: "Operaton",
  }),
  detail: (instanceId) => `/engine-rest/process-instance/${instanceId}`,
  incidentRead: (answers, incidentId) => {
    const row = rowsAt(answers, "/engine-rest/incident", (json) => json).find(
      (incident) => incident.id === incidentId,
    )
    return { method: "GET", path: `/engine-rest/incident/${incidentId}`, answer: row }
  },
}

/** A Camunda 8 cluster without security, as recorded: no web app without the profile's cockpitUrl. */
const RECORDED_C8: Recorded = {
  screen: C8_SCREEN_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
  webApp: () => null,
  detail: (instanceId) => `/v2/process-instances/${instanceId}`,
  incidentRead: (answers, incidentId) => {
    const row = rowsAt(
      answers,
      "/v2/incidents/search",
      (json) => (json as { items: unknown }).items,
    ).find((incident) => incident.incidentKey === incidentId)
    return { method: "GET", path: `/v2/incidents/${incidentId}`, answer: row }
  },
}

const engines: RecordedEngine[] = []
const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

/** The server over `recorded`'s engine answering `answers`, and a call of a screen feed. */
async function boot(recorded: Recorded, answers: readonly RecordedAnswer[]) {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [recorded.screen.engine]: recorded.profile(engine.origin) },
    }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const call = (name: string, args: Record<string, unknown>) => {
    const feed = recording.tool(name)
    const input = { engine: recorded.screen.engine, ...args }
    return feed.call((feed.config.inputSchema as z.ZodObject).parse(input))
  }
  return { engine, call }
}

/** An id each dialect could have assigned, which the engine below knows nothing of. */
const UNKNOWN_ID = "2251799813689999"

/** What an engine answers for a resource it does not hold, in its dialect's words. */
const NOT_FOUND = {
  c7: {
    type: "application/json",
    body: { type: "InvalidRequestException", message: "No such resource" },
  },
  c8: {
    type: "application/problem+json",
    body: { type: "about:blank", title: "NOT_FOUND", status: 404, detail: "No such resource" },
  },
} as const

/** The cluster's version, which the Camunda 8 runtime reads before any other (its version floor). */
const topologyOf = (recorded: Recorded): RecordedAnswer | undefined =>
  recorded.screen.answers.find((answer) => answer.path === "/v2/topology")

/**
 * The server over an engine that holds nothing: every resource it is asked for is not there, but
 * for a cluster's version.
 */
async function bootUnknowing(recorded: Recorded) {
  const notFound = NOT_FOUND[recorded === RECORDED_C7 ? "c7" : "c8"]
  const topology = topologyOf(recorded)
  const server = http.createServer((req, res) => {
    if (topology !== undefined && req.url === topology.path) {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(jsonOf(topology)))
      return
    }
    res.writeHead(404, { "content-type": notFound.type }).end(JSON.stringify(notFound.body))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: { [recorded.screen.engine]: recorded.profile(`http://127.0.0.1:${port}`) },
    }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const call = (name: string, args: Record<string, unknown>) => {
    const feed = recording.tool(name)
    const input = { engine: recorded.screen.engine, ...args }
    return feed.call((feed.config.inputSchema as z.ZodObject).parse(input))
  }
  return { call }
}

const expectedOf = (recorded: Recorded, name: InstanceName) =>
  recorded.screen.expected[name] as InstanceScreenData

/** The screen as the recording expects it, read at another time. */
const atAnyTime = (screen: InstanceScreenData) => ({ ...screen, asOf: undefined })

const readInstance = (call: Awaited<ReturnType<typeof boot>>["call"], instance: string) =>
  call(ENGINE_SCREEN_INSTANCE_DATA, { instance })

describe.each([
  ["c7-core's recorded screen engine, over the SDK wire", RECORDED_C7],
  ["c8-core's recorded screen engine, over the server's Camunda 8 wire", RECORDED_C8],
])("the instance screen feed over %s", (_name, recorded) => {
  it.each(["instance", "calledInstance"] as const)(
    "asks the engine only what it answered and gives the %s screen the recording expects",
    async (name) => {
      const expected = expectedOf(recorded, name)
      const { engine, call } = await boot(recorded, recorded.screen.answers)
      const { webApp, causes, ...screen } = feedPayload<InstanceScreenFeedData>(
        await readInstance(call, expected.instance.id),
      )
      expect(engine.unanswered).toEqual([])
      expect(Date.parse(screen.asOf)).not.toBeNaN()
      expect(atAnyTime(screen)).toEqual(atAnyTime(expected))
      expect(webApp).toEqual(recorded.webApp(engine.origin, expected.instance.id))
      expect(causes === null).toBe(recorded === RECORDED_C8)
    },
  )

  it.each(["instance", "calledInstance"] as const)(
    "holds the figures of the %s screen the conformance kit's fixed world gives",
    (name) => {
      expect(ScreenFigures.instance(expectedOf(recorded, name))).toEqual(
        ScreenFigures.instance(WORLD_SCREENS[name]),
      )
    },
  )

  it("keeps a called instance without its caller where the caller's read fails, and names it", async () => {
    const caller = expectedOf(recorded, "instance").instance.id
    const called = expectedOf(recorded, "calledInstance")
    const answers = recorded.screen.answers.filter(
      (answer) => !JSON.stringify(answer.body ?? null).includes(caller),
    )
    const { call } = await boot(recorded, answers)
    const screen = feedPayload<InstanceScreenFeedData>(await readInstance(call, called.instance.id))
    expect(screen.caller).toEqual({ instanceId: caller, found: null })
    expect(screen.unread).toEqual(["caller"])
    expect(ScreenFigures.instance(screen)).toEqual({
      ...ScreenFigures.instance(called),
      caller: null,
    })
  })

  it("fails as the instance's detail fails, never with an empty screen", async () => {
    const id = expectedOf(recorded, "instance").instance.id
    const answers = recorded.screen.answers.filter((answer) => answer.path !== recorded.detail(id))
    const { call } = await boot(recorded, answers)
    const result = (await readInstance(call, id)) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it("refuses an instance the engine does not know, by a code no retry changes", async () => {
    const { call } = await bootUnknowing(recorded)
    const result = (await readInstance(call, UNKNOWN_ID)) as {
      isError?: boolean
      content: { text: string }[]
    }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^\[UNKNOWN_INSTANCE\] Instance "/)
  })

  it("reads a root incident's text, its root cause the card's and marked on its own line", async () => {
    const [card] = expectedOf(recorded, "calledInstance").incidents
    const incidentId = card?.rootIncident.id ?? ""
    const answers = [
      ...recorded.screen.answers,
      recorded.incidentRead(recorded.screen.answers, incidentId),
    ]
    const { engine, call } = await boot(recorded, answers)
    const text = feedPayload<IncidentTextFeedData>(
      await call(ENGINE_SCREEN_INCIDENT_TEXT_DATA, { incident: incidentId }),
    )
    expect(engine.unanswered).toEqual([])
    expect(text).toMatchObject({ incidentId, kind: card?.text, truncated: false })
    expect(text.rootCause).toBe(card?.rootCauseLine)
    const lines = text.text.split(/\r\n|[\n\r]/)
    expect(lines[text.rootCauseLine ?? -1]).toContain(text.rootCause)
  })

  it("refuses the text of an incident the engine gives none for, by a code no retry changes", async () => {
    const { call } = await bootUnknowing(recorded)
    const result = (await call(ENGINE_SCREEN_INCIDENT_TEXT_DATA, { incident: UNKNOWN_ID })) as {
      isError?: boolean
      content: { text: string }[]
    }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^\[UNKNOWN_INCIDENT\]/)
  })
})

describe("the cause of a card on Camunda 7", () => {
  it("is the cause view's key of the root incident: its element, its type, its message's signature", async () => {
    const called = expectedOf(RECORDED_C7, "calledInstance")
    const { call } = await boot(RECORDED_C7, RECORDED_C7.screen.answers)
    const { causes } = feedPayload<InstanceScreenFeedData>(
      await readInstance(call, called.instance.id),
    )
    const [card] = called.incidents
    expect(causes).toEqual([
      {
        incidentId: card?.rootIncident.id,
        activityId: "Activity_RenderLabel",
        incidentType: "failedJob",
        signature:
          "unknown property used in expression: ${labelprinter.print(orderid)}. cause: cannot resolve identifier '<v>'",
      },
    ])
  })
})
