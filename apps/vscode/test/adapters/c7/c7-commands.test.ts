import { IncidentId, InstanceId, RuntimeError } from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { fakeCommands, fakeRuntime, type FakeRoute } from "./support/fake-engine-cli.js"

const INSTANCE = InstanceId("63d65e9e-cd7f-11f1-86d2-667bc3771e0d")
const INCIDENT = IncidentId("993d2801-cd91-11f1-9c88-32e5612dd01b")
const SET_VARIABLE = ["process-instance", "set-variable"]

function failure(exitCode: number, code: string, message: string): Partial<FakeRoute> {
  return { exitCode, stderr: JSON.stringify({ error: { code, exitCode, message } }) }
}

async function failureOf(attempt: Promise<void>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("retrying an incident", () => {
  test("asks the engine CLI for exactly that incident with one retry, without the read-only switch", async () => {
    const { commands, cli } = fakeCommands([
      {
        command: ["retry"],
        stdout: JSON.stringify({ retried: 1, incidents: [{ result: "retried" }] }),
      },
    ])

    await commands.retryIncident(INCIDENT)

    expect(cli.commands()).toEqual([["retry", "--incident", INCIDENT, "--retries", "1"]])
    expect(cli.invocations[0]?.environment).not.toHaveProperty("OPERATE_READ_ONLY")
  })

  test("is rejected when the engine CLI retried nothing", async () => {
    const { commands } = fakeCommands([
      {
        command: ["retry"],
        stdout: JSON.stringify({ retried: 0, incidents: [{ result: "skipped" }] }),
      },
    ])

    await expect(commands.retryIncident(INCIDENT)).rejects.toThrow(/did not retry.*skipped/)
  })

  test.each([
    [5, "NOT_FOUND", "rejected"],
    [6, "HTTP_CLIENT_ERROR", "rejected"],
    [7, "HTTP_SERVER_ERROR", "rejected"],
    [8, "NETWORK", "unreachable"],
    [4, "UNAUTHORIZED", "unauthorized"],
  ])('maps exit code %i (%s) to "%s"', async (exitCode, code, expected) => {
    const { commands } = fakeCommands([
      { command: ["retry"], ...failure(exitCode, code, "refused") },
    ])

    expect(await failureOf(commands.retryIncident(INCIDENT))).toBe(expected)
  })

  test("refuses an incident id that could smuggle more ids into the command", async () => {
    const { commands, cli } = fakeCommands([])

    expect(await failureOf(commands.retryIncident(IncidentId("a,b")))).toBe("rejected")
    expect(await failureOf(commands.retryIncident(IncidentId("--now")))).toBe("rejected")
    expect(cli.invocations).toEqual([])
  })
})

describe("changing a variable", () => {
  const accepting: FakeRoute = { command: SET_VARIABLE, stdout: "Done" }

  test("passes the value on stdin, never on the command line", async () => {
    const { commands, cli } = fakeCommands([accepting])

    await commands.setVariable(INSTANCE, { name: "-amount", valueJson: "43", type: "Integer" })

    expect(cli.commands()).toEqual([[...SET_VARIABLE, "--body", "-", "--", INSTANCE, "-amount"]])
    expect(cli.invocations[0]?.input).toBe('{"value":43,"type":"Integer"}')
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
    const { commands, cli } = fakeCommands([accepting])

    await commands.setVariable(INSTANCE, { name: "value", valueJson, type })

    expect(cli.invocations[0]?.input).toBe(body)
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
    const { commands, cli } = fakeCommands([accepting])

    await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

    expect(JSON.parse(cli.invocations[0]?.input ?? "{}")).toMatchObject({ type })
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
    const { commands, cli } = fakeCommands([])

    expect(
      await failureOf(commands.setVariable(INSTANCE, { name: "value", valueJson, type })),
    ).toBe("rejected")
    expect(cli.invocations).toEqual([])
  })

  test("refuses names with control characters and ids with commas", async () => {
    const { commands, cli } = fakeCommands([])

    const change = { name: "line\nbreak", valueJson: "1", type: "Integer" }
    expect(await failureOf(commands.setVariable(INSTANCE, change))).toBe("rejected")
    expect(
      await failureOf(commands.setVariable(InstanceId("a,b"), { name: "n", valueJson: "1" })),
    ).toBe("rejected")
    expect(cli.invocations).toEqual([])
  })

  test("keeps the value out of the error the engine sends back", async () => {
    const { commands } = fakeCommands([
      {
        command: SET_VARIABLE,
        ...failure(6, "HTTP_CLIENT_ERROR", "Cannot convert value 'DE02 1203 0000' of type 'Date'"),
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
        command: SET_VARIABLE,
        ...failure(6, "HTTP_CLIENT_ERROR", "Cannot store '2026-10-22T10:00:00.000+0000' for due"),
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
  test("keeps the engine CLI read-only", async () => {
    const { runtime, cli } = fakeRuntime([
      {
        command: ["telemetry", "get-data"],
        stdout: '{"product":{"name":"Operaton","version":"2.1.5"}}',
      },
    ])

    await runtime.describeEngine().catch(() => undefined)

    expect(cli.invocations.every((call) => call.environment.OPERATE_READ_ONLY === "1")).toBe(true)
  })
})
