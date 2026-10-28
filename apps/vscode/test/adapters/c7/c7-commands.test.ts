import {
  IncidentId,
  InstanceId,
  RuntimeError,
  type ProcessCommands,
} from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { fakeCommands, fakeRuntime } from "./support/fake-engine.js"
import { engineFailure, REST_URL, type RestRoute } from "./support/fake-engine-rest.js"

const INSTANCE = InstanceId("63d65e9e-cd7f-11f1-86d2-667bc3771e0d")
const INCIDENT = IncidentId("993d2801-cd91-11f1-9c88-32e5612dd01b")
const JOB = "993d2800-cd91-11f1-9c88-32e5612dd01b"
const GET_INCIDENT = `GET /incident/${INCIDENT}`
const RETRY_JOB = `PUT /job/${JOB}/retries`
const NO_CONTENT = new Response(null, { status: 204 })
const CONNECTION = { endpoint: REST_URL, credentials: { kind: "none" } } as const

function incidentOf(incidentType: string): RestRoute {
  return {
    route: GET_INCIDENT,
    answer: { id: INCIDENT, rootCauseIncidentId: INCIDENT, incidentType, configuration: JOB },
  }
}

function setVariableRoute(name: string): string {
  return `PUT /process-instance/${INSTANCE}/variables/${encodeURIComponent(name)}`
}

function accepting(name: string): RestRoute {
  return { route: setVariableRoute(name), answer: NO_CONTENT }
}

function commandsFailingWith(answer: Response): ProcessCommands {
  return fakeCommands([{ route: GET_INCIDENT, answer }]).commands
}

function unreachableCommands(): ProcessCommands {
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  })
  return new C7Adapter(() => Promise.reject(refused)).commands(CONNECTION)
}

async function failureOf(attempt: Promise<void>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("retrying an incident", () => {
  test("asks the engine for exactly that incident with one retry, over a writing connection", async () => {
    const { commands, engine } = fakeCommands([
      incidentOf("failedJob"),
      { route: RETRY_JOB, answer: NO_CONTENT },
    ])

    await commands.retryIncident(INCIDENT)

    expect(engine.requests.map((request) => request.route)).toEqual([GET_INCIDENT, RETRY_JOB])
    expect(engine.requests[1]?.body).toBe('{"retries":1}')
  })

  test("is rejected when the engine retried nothing", async () => {
    const { commands } = fakeCommands([incidentOf("failedStartEvent")])

    await expect(commands.retryIncident(INCIDENT)).rejects.toThrow(/did not retry.*skipped/)
  })

  test.each([
    [
      "404 InvalidRequestException",
      () => commandsFailingWith(engineFailure(404, "InvalidRequestException", "refused")),
      "rejected",
    ],
    [
      "400 InvalidRequestException",
      () => commandsFailingWith(engineFailure(400, "InvalidRequestException", "refused")),
      "rejected",
    ],
    [
      "500 ProcessEngineException",
      () => commandsFailingWith(engineFailure(500, "ProcessEngineException", "refused")),
      "rejected",
    ],
    ["refused connection", unreachableCommands, "unreachable"],
    [
      "401 AuthenticationException",
      () => commandsFailingWith(engineFailure(401, "AuthenticationException", "refused")),
      "unauthorized",
    ],
  ])('maps a %s to "%s"', async (_answer, commandsOf, expected) => {
    expect(await failureOf(commandsOf().retryIncident(INCIDENT))).toBe(expected)
  })

  test("refuses an incident id that could smuggle more ids into the request", async () => {
    const { commands, engine } = fakeCommands([])

    expect(await failureOf(commands.retryIncident(IncidentId("a,b")))).toBe("rejected")
    expect(await failureOf(commands.retryIncident(IncidentId("--now")))).toBe("rejected")
    expect(engine.requests).toEqual([])
  })
})

describe("changing a variable", () => {
  test("passes the value in the body, never in the request line", async () => {
    const { commands, engine } = fakeCommands([accepting("-amount")])

    await commands.setVariable(INSTANCE, { name: "-amount", valueJson: "43", type: "Integer" })

    expect(engine.requests.map((request) => request.route)).toEqual([setVariableRoute("-amount")])
    expect(engine.requests[0]?.query).toEqual({})
    expect(engine.requests[0]?.body).toBe('{"value":43,"type":"Integer"}')
  })

  test.each([
    ["String", '"IBAN DE02 1203"', '{"value":"IBAN DE02 1203","type":"String"}'],
    ["Long", "9007199254740993", '{"value":9007199254740993,"type":"Long"}'],
    ["Double", "107.65", '{"value":107.65,"type":"Double"}'],
    ["Boolean", "false", '{"value":false,"type":"Boolean"}'],
    [
      "Date",
      '"2026-10-22T12:00:00+02:00"',
      '{"value":"2026-10-22T10:00:00.000+0000","type":"Date"}',
    ],
    ["Json", '{"big":9007199254740993}', '{"value":"{\\"big\\":9007199254740993}","type":"Json"}'],
    ["String", "null", '{"value":null,"type":"String"}'],
  ])("writes a %s losslessly", async (type, valueJson, body) => {
    const { commands, engine } = fakeCommands([accepting("value")])

    await commands.setVariable(INSTANCE, { name: "value", valueJson, type })

    expect(engine.requests[0]?.body).toBe(body)
  })

  test.each([
    ['"text"', "String"],
    ["42", "Integer"],
    ["2147483648", "Long"],
    ["1.5", "Double"],
    ["true", "Boolean"],
    ["null", "Null"],
    ['{"city":"Munich"}', "Json"],
  ])("infers the type of a new variable from %s", async (valueJson, type) => {
    const { commands, engine } = fakeCommands([accepting("fresh")])

    await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

    expect(JSON.parse(engine.requests[0]?.body ?? "{}")).toMatchObject({ type })
  })

  test.each([
    ["Integer", "4.5"],
    ["Boolean", "yes"],
    ["Date", '"tomorrow"'],
    ["String", "4117"],
    ["Json", "{broken"],
    ["Object", '"rO0AB"'],
    ["Bytes", '"AAAA"'],
    ["constructor", "5"],
    ["toString", "5"],
    ["__proto__", "5"],
  ])("rejects a %s from %s before calling the engine", async (type, valueJson) => {
    const { commands, engine } = fakeCommands([])

    expect(
      await failureOf(commands.setVariable(INSTANCE, { name: "value", valueJson, type })),
    ).toBe("rejected")
    expect(engine.requests).toEqual([])
  })

  test("refuses names with control characters and ids with commas", async () => {
    const { commands, engine } = fakeCommands([])

    const change = { name: "line\nbreak", valueJson: "1", type: "Integer" }
    expect(await failureOf(commands.setVariable(INSTANCE, change))).toBe("rejected")
    expect(
      await failureOf(commands.setVariable(InstanceId("a,b"), { name: "n", valueJson: "1" })),
    ).toBe("rejected")
    expect(engine.requests).toEqual([])
  })

  test("keeps the value out of the error the engine sends back", async () => {
    const { commands } = fakeCommands([
      {
        route: setVariableRoute("iban"),
        answer: engineFailure(
          400,
          "InvalidRequestException",
          "Cannot convert value 'DE02 1203 0000' of type 'Date'",
        ),
      },
    ])

    const attempt = commands.setVariable(INSTANCE, {
      name: "iban",
      valueJson: '"DE02 1203 0000"',
      type: "String",
    })

    await expect(attempt).rejects.toThrow("Cannot convert value '‹value›' of type 'Date'")
  })
})

describe("redacting a date", () => {
  test("removes the form the engine echoes back too", async () => {
    const { commands } = fakeCommands([
      {
        route: setVariableRoute("due"),
        answer: engineFailure(
          400,
          "InvalidRequestException",
          "Cannot store '2026-10-22T10:00:00.000+0000' for due",
        ),
      },
    ])

    const attempt = commands.setVariable(INSTANCE, {
      name: "due",
      valueJson: '"2026-10-22T12:00:00+02:00"',
      type: "Date",
    })

    await expect(attempt).rejects.toThrow("Cannot store '‹value›' for due")
  })
})

describe("the read path", () => {
  test("keeps the engine read-only", async () => {
    const { runtime, engine } = fakeRuntime([
      {
        route: "GET /telemetry/data",
        answer: { product: { name: "Operaton", version: "2.1.5" } },
      },
    ])

    await runtime.describeEngine().catch(() => undefined)

    expect(engine.requests).not.toEqual([])
    expect(engine.requests.every((request) => request.route.startsWith("GET "))).toBe(true)
  })
})
