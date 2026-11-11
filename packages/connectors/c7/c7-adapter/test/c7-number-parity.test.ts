import { InstanceId, RuntimeError, ValueKinds } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { fakeCommands } from "./support/fake-engine.js"

const INSTANCE = InstanceId("63d65e9e-cd7f-11f1-86d2-667bc3771e0d")
const NUMBER_TYPES: readonly string[] = ["Integer", "Long", "Double"]
const LARGEST = "1.7976931348623157e308"
const BEYOND_A_DOUBLE = `${"9".repeat(400)}.5`
const NO_CONTENT = new Response(null, { status: 204 })

const RANGE_EDGES = [
  "0",
  "-0",
  "42",
  "-7",
  "2147483648",
  "9007199254740993",
  "9223372036854775807",
  "-9223372036854775808",
  "9223372036854775808",
  "-9223372036854775809",
  "18446744073709551615",
  `1${"0".repeat(308)}`,
  `1${"0".repeat(309)}`,
  `1${"0".repeat(400)}`,
  `17976931348623157${"0".repeat(292)}`,
  `17976931348623159${"0".repeat(292)}`,
  "0.0",
  "0e0",
  "4.5",
  "1e3",
  "1E+5",
  "-4.5E-3",
  "5e-324",
  "-5e-324",
  "2.2250738585072014e-308",
  "1e-400",
  LARGEST,
  `-${LARGEST}`,
  "1.7976931348623158e308",
  "1.7976931348623159e308",
  "1.8e308",
  "-1.8e308",
  "1e400",
  "-1e400",
  "1E+400",
  BEYOND_A_DOUBLE,
  `-${BEYOND_A_DOUBLE}`,
]

function runtimeViewSendsForANullVariable(valueJson: string): boolean {
  const holdsWholeNumber =
    ValueKinds.ofJson(valueJson) !== "integer" || ValueKinds.isWholeNumber(valueJson)
  return holdsWholeNumber && ValueKinds.isFiniteNumber(valueJson)
}

function setVariableRoute(name: string): string {
  return `PUT /process-instance/${INSTANCE}/variables/${name}`
}

async function outcomeOf(attempt: Promise<void>): Promise<string> {
  return attempt.then(
    () => "sent",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : "raw error"),
  )
}

describe("the C7 adapter's reading of a number, held to engine-core's ValueKinds", () => {
  test("covers numbers the editor hosts send and numbers they refuse", () => {
    expect(RANGE_EDGES.filter(runtimeViewSendsForANullVariable).length).toBeGreaterThan(0)
    expect(
      RANGE_EDGES.filter((edge) => !runtimeViewSendsForANullVariable(edge)).length,
    ).toBeGreaterThan(0)
  })

  test.each(RANGE_EDGES)(
    "types %s without a type as a number exactly when the editor hosts would send it",
    async (valueJson) => {
      const { commands, engine } = fakeCommands([
        { route: setVariableRoute("fresh"), answer: NO_CONTENT },
      ])

      await commands.setVariable(INSTANCE, { name: "fresh", valueJson })

      const sent = JSON.parse(engine.requests[0]?.body ?? "{}") as { value: unknown; type: string }
      const typedAs = NUMBER_TYPES.includes(sent.type) ? "a number" : sent
      expect(typedAs).toEqual(
        runtimeViewSendsForANullVariable(valueJson)
          ? "a number"
          : { value: valueJson, type: "String" },
      )
    },
  )

  test.each(RANGE_EDGES)(
    "sends %s for a Double variable exactly when ValueKinds.isFiniteNumber holds",
    async (valueJson) => {
      const finite = ValueKinds.isFiniteNumber(valueJson)
      const accepting = { route: setVariableRoute("ratio"), answer: NO_CONTENT }
      const { commands, engine } = fakeCommands(finite ? [accepting] : [])

      const outcome = await outcomeOf(
        commands.setVariable(INSTANCE, { name: "ratio", valueJson, type: "Double" }),
      )

      expect(outcome).toBe(finite ? "sent" : "rejected")
      expect(engine.requests).toHaveLength(finite ? 1 : 0)
    },
  )
})
