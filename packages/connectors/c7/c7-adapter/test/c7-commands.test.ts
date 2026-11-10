import {
  IncidentId,
  InstanceId,
  RuntimeError,
  type ProcessCommands,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import { fakeCommands, fakeRuntime } from "./support/fake-engine.js"
import { engineFailure, REST_URL, type RestRoute } from "./support/fake-engine-rest.js"

const INSTANCE = InstanceId("63d65e9e-cd7f-11f1-86d2-667bc3771e0d")
const INCIDENT = IncidentId("993d2801-cd91-11f1-9c88-32e5612dd01b")
const JOB = "993d2800-cd91-11f1-9c88-32e5612dd01b"
const GET_INCIDENT = `GET /incident/${INCIDENT}`
const RETRY_JOB = `PUT /job/${JOB}/retries`
const NO_CONTENT = new Response(null, { status: 204 })
const CONNECTION = { endpoint: REST_URL, credentials: { kind: "none" } } as const

function incidentOf(incidentType: string, configuration: string | null = JOB): RestRoute {
  return {
    route: GET_INCIDENT,
    answer: { id: INCIDENT, rootCauseIncidentId: INCIDENT, incidentType, configuration },
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

  test("gives the external task of a failed external task its retry", async () => {
    const retryTask = `PUT /external-task/${JOB}/retries`
    const { commands, engine } = fakeCommands([
      incidentOf("failedExternalTask"),
      { route: retryTask, answer: NO_CONTENT },
    ])

    await commands.retryIncident(INCIDENT)

    expect(engine.requests.map((request) => request.route)).toEqual([GET_INCIDENT, retryTask])
  })

  test.each([
    ["an empty", ""],
    ["no", null],
  ])(
    "skips a built-in incident with %s configuration, by c7-core's incident recovery, and writes nothing",
    async (_kind, configuration) => {
      const { commands, engine } = fakeCommands([incidentOf("failedJob", configuration)])

      await expect(commands.retryIncident(INCIDENT)).rejects.toThrow(/did not retry.*skipped/)
      expect(engine.requests.map((request) => request.route)).toEqual([GET_INCIDENT])
    },
  )

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
    ["Short", "-7", '{"value":-7,"type":"Short"}'],
    ["Long", "9007199254740993", '{"value":9007199254740993,"type":"Long"}'],
    ["Double", "107.65", '{"value":107.65,"type":"Double"}'],
    ["Double", "1e3", '{"value":1000,"type":"Double"}'],
    ["Boolean", "false", '{"value":false,"type":"Boolean"}'],
    [
      "Date",
      '"2026-10-22T12:00:00+02:00"',
      '{"value":"2026-10-22T12:00:00.000+0200","type":"Date"}',
    ],
    ["Date", '"2026-10-22"', '{"value":"2026-10-22T00:00:00.000+0000","type":"Date"}'],
    ["Json", '{"big":9007199254740993}', '{"value":"{\\"big\\":9007199254740993}","type":"Json"}'],
    ["String", "null", '{"value":null,"type":"String"}'],
    ["Null", "null", '{"value":null,"type":"Null"}'],
  ])("writes a %s losslessly", async (type, valueJson, body) => {
    const { commands, engine } = fakeCommands([accepting("value")])

    await commands.setVariable(INSTANCE, { name: "value", valueJson, type })

    expect(engine.requests[0]?.body).toBe(body)
  })

  test.each([
    ['"text"', '{"value":"text","type":"String"}'],
    ['"42"', '{"value":"42","type":"String"}'],
    ["42", '{"value":42,"type":"Integer"}'],
    ["-2147483648", '{"value":-2147483648,"type":"Integer"}'],
    ["2147483648", '{"value":2147483648,"type":"Long"}'],
    ["9007199254740993", '{"value":9007199254740993,"type":"Long"}'],
    ["-9223372036854775808", '{"value":-9223372036854775808,"type":"Long"}'],
    ["1.5", '{"value":1.5,"type":"Double"}'],
    ["true", '{"value":true,"type":"Boolean"}'],
    ["null", '{"value":null,"type":"Null"}'],
    ['{"city":"Munich"}', '{"value":"{\\"city\\":\\"Munich\\"}","type":"Json"}'],
    ["[1, 2]", '{"value":"[1, 2]","type":"Json"}'],
  ])("types a new variable from %s by c7-core's autoTypedValue", async (valueJson, body) => {
    const { commands, engine } = fakeCommands([accepting("fresh")])

    await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

    expect(engine.requests[0]?.body).toBe(body)
  })

  test.each([
    ["9223372036854775808", '{"value":"9223372036854775808","type":"String"}'],
    ["-9223372036854775809", '{"value":"-9223372036854775809","type":"String"}'],
  ])(
    "writes a new variable from %s as a String, as c7-core types an integer beyond int64",
    async (valueJson, body) => {
      const { commands, engine } = fakeCommands([accepting("fresh")])

      await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

      expect(engine.requests[0]?.body).toBe(body)
    },
  )

  test.each([
    ["1e3", '{"value":1000,"type":"Double"}'],
    ["-1.5E-3", '{"value":-0.0015,"type":"Double"}'],
  ])(
    "writes a new variable from %s, a JSON number in exponent form, as a Double",
    async (valueJson, body) => {
      const { commands, engine } = fakeCommands([accepting("fresh")])

      await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

      expect(engine.requests[0]?.body).toBe(body)
    },
  )

  test.each([
    ["a Double", "Double", "1e400", "Double"],
    ["a negative Double", "Double", "-1e400", "Double"],
    ["a Long", "Long", `1${"0".repeat(400)}`, "Long"],
    ["an Integer", "Integer", `1${"0".repeat(400)}`, "Integer"],
    ["a Short", "Short", `-1${"0".repeat(400)}`, "Short"],
    ["a decimal without a type", undefined, `1${"0".repeat(400)}.5`, "Double"],
    ["an exponent without a type", undefined, "1e400", "Double"],
  ])(
    "rejects %s beyond the range of a double, which JSON would send as null, before calling the engine",
    async (_label, type, valueJson, named) => {
      const { commands, engine } = fakeCommands([])

      await expect(
        commands.setVariable(INSTANCE, { name: "amount", valueJson, ...(type ? { type } : {}) }),
      ).rejects.toThrow(`The new value of amount is not a valid ${named}.`)
      expect(engine.requests).toEqual([])
    },
  )

  test.each([
    ["Integer", "4.5"],
    ["Integer", "007"],
    ["Short", "1.5"],
    ["Long", '"9"'],
    ["Double", "01.5"],
    ["Boolean", "yes"],
    ["Date", '"tomorrow"'],
    ["Date", '"2026-10-22T12:00:00"'],
    ["Date", '"2026-02-30T10:00:00Z"'],
    ["Date", '"2026-10-22T24:00:00Z"'],
    ["Date", "1792663200000"],
    ["String", "4117"],
    ["Json", "{broken"],
    ["Null", "0"],
    ["Object", '"rO0AB"'],
    ["Bytes", '"AAAA"'],
    ["Xml", '"<a/>"'],
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

  test.each(["{broken", "text", "007", "1."])(
    "rejects a new variable from %s, which is no JSON, before calling the engine",
    async (valueJson) => {
      const { commands, engine } = fakeCommands([])

      await expect(commands.setVariable(INSTANCE, { name: "fresh", valueJson })).rejects.toThrow(
        "The new value of fresh is not valid JSON.",
      )
      expect(engine.requests).toEqual([])
    },
  )

  test("names the variable and its type when c7-core refuses a date", async () => {
    const { commands } = fakeCommands([])

    await expect(
      commands.setVariable(INSTANCE, {
        name: "due",
        valueJson: '"2026-10-22T12:00:00"',
        type: "Date",
      }),
    ).rejects.toThrow("The new value of due is not a valid Date.")
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

  test("names the REST root when a write meets a container's 404 instead of the engine", async () => {
    const { commands } = fakeCommands([
      {
        route: setVariableRoute("amount"),
        answer: new Response("<html><body><h1>HTTP Status 404 – Not Found</h1></body></html>", {
          status: 404,
          headers: { "Content-Type": "text/html;charset=utf-8" },
        }),
      },
    ])

    const attempt = commands.setVariable(INSTANCE, { name: "amount", valueJson: "43" })

    await expect(attempt).rejects.toMatchObject({
      failure: "rejected",
      message: "HTTP 404 Not Found",
      hint: "Check that the engine URL points at the REST API root itself, such as http://localhost:8080/engine-rest.",
    })
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
          "Cannot store '2026-10-22T12:00:00.000+0200' for due",
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

describe("redacting a number", () => {
  test.each([
    ["a Double", "Double", "107.650", "107.65"],
    ["a number without a type", undefined, "1e3", "1000"],
  ])("removes the form %s is sent in too", async (_label, type, valueJson, sent) => {
    const { commands } = fakeCommands([
      {
        route: setVariableRoute("amount"),
        answer: engineFailure(400, "InvalidRequestException", `Cannot store '${sent}' for amount`),
      },
    ])

    const attempt = commands.setVariable(INSTANCE, {
      name: "amount",
      valueJson,
      ...(type ? { type } : {}),
    })

    await expect(attempt).rejects.toThrow("Cannot store '‹value›' for amount")
  })

  test("leaves the message of a value it rejects before sending whole", async () => {
    const { commands } = fakeCommands([])

    await expect(
      commands.setVariable(INSTANCE, { name: "nullable", valueJson: "1e400", type: "Double" }),
    ).rejects.toThrow("The new value of nullable is not a valid Double.")
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
