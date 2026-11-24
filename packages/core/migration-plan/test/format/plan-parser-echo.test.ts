import { describe, expect, test } from "vitest"
import {
  MigrationPlanParser,
  MigrationPlanProblems,
  type MigrationPlanNote,
  type MigrationPlanParse,
  type MigrationPlanProblem,
} from "../../src/index.js"

const APPROVE = { sourceElementId: "approve", targetElementId: "approve" }
const PLAN = { bpmnProcessId: "invoice", source: { version: 1 }, target: { version: 2 } }
const FILE = { schemaVersion: 1, ...PLAN, mappings: [APPROVE] }
const DEEP = 10_000
const LONG = 900_000
const SHOWN = 40
const LONG_KEY = "k".repeat(LONG)
const CUT_KEY = `${"k".repeat(SHOWN)}…`
const MOST = 120

function withVersion(version: string): MigrationPlanParse {
  const rest = JSON.stringify({ ...PLAN, mappings: [APPROVE] }).slice(1)
  return MigrationPlanParser.parse(`{"schemaVersion":${version},${rest}`)
}

function refusal(found: string): MigrationPlanParse {
  return {
    problems: [{ path: "schemaVersion", code: "unknownVersion", values: { found, reads: 1 } }],
  }
}

function sentencesOf(parsed: MigrationPlanParse): readonly string[] {
  const found: readonly (MigrationPlanProblem | MigrationPlanNote)[] =
    "problems" in parsed ? parsed.problems : parsed.notes
  return found.map((problem) => `${problem.path} ${MigrationPlanProblems.describe(problem)}`)
}

describe("a schemaVersion Pulse does not read", () => {
  test.each([
    ["a list", "[".repeat(DEEP), "]".repeat(DEEP)],
    ["an object", '{"v":'.repeat(DEEP), `1${"}".repeat(DEEP)}`],
  ])(
    "is named %s when it is nested 10000 deep, and the parse never throws",
    (kind, open, close) => {
      expect(() => withVersion(`${open}${close}`)).not.toThrow()
      expect(withVersion(`${open}${close}`)).toStrictEqual(refusal(kind))
    },
  )

  test.each([
    ["[]", "a list"],
    ["[2]", "a list"],
    ["{}", "an object"],
    ['{"major":2}', "an object"],
    ["true", "true"],
    ["false", "false"],
    ["null", "null"],
    ["-2", "-2"],
  ])("words %s by its kind, or as written", (version, found) => {
    expect(withVersion(version)).toStrictEqual(refusal(found))
  })

  test("writes a text up to 40 characters whole, in quotes", () => {
    const text = "v".repeat(SHOWN)

    expect(withVersion(JSON.stringify(text))).toStrictEqual(refusal(JSON.stringify(text)))
  })

  test("writes the first 40 characters of a longer text, so a sentence on it stays short", () => {
    const parsed = withVersion(JSON.stringify("v".repeat(LONG)))

    expect(parsed).toStrictEqual(refusal(`"${"v".repeat(SHOWN)}"…`))
    expect(sentencesOf(parsed)[0]?.length).toBeLessThan(MOST)
  })

  test("cuts a text between characters, never inside one", () => {
    const parsed = withVersion(JSON.stringify("🙂".repeat(SHOWN + 1)))

    expect(parsed).toStrictEqual(refusal(`"${"🙂".repeat(SHOWN)}"…`))
  })
})

describe("a key of the file in a path", () => {
  test("is written whole up to 40 characters", () => {
    const key = "k".repeat(SHOWN)

    expect(MigrationPlanParser.parse(JSON.stringify({ ...FILE, [key]: 1 }))).toStrictEqual({
      plan: { ...PLAN, mappings: [APPROVE] },
      notes: [{ path: key, code: "ignoredKey" }],
    })
  })

  test("names the first 40 characters of a longer root key Pulse only notes", () => {
    const parsed = MigrationPlanParser.parse(JSON.stringify({ ...FILE, [LONG_KEY]: 1 }))

    expect(parsed).toStrictEqual({
      plan: { ...PLAN, mappings: [APPROVE] },
      notes: [{ path: CUT_KEY, code: "ignoredKey" }],
    })
    expect(sentencesOf(parsed)[0]?.length).toBeLessThan(MOST)
  })

  test("names the first 40 characters of a longer key a side does not know", () => {
    const file = { ...FILE, target: { version: 2, [LONG_KEY]: 1 } }
    const parsed = MigrationPlanParser.parse(JSON.stringify(file))

    expect(parsed).toStrictEqual({
      problems: [
        { path: `target.${CUT_KEY}`, code: "unknownKey", values: { choices: ["version"] } },
      ],
    })
    expect(sentencesOf(parsed)[0]?.length).toBeLessThan(MOST)
  })

  test("names the first 40 characters of a longer key a mapping does not know", () => {
    const file = { ...FILE, mappings: [{ ...APPROVE, [LONG_KEY]: 1 }] }
    const parsed = MigrationPlanParser.parse(JSON.stringify(file))
    const choices = ["sourceElementId", "targetElementId"]

    expect(parsed).toStrictEqual({
      problems: [{ path: `mappings[0].${CUT_KEY}`, code: "unknownKey", values: { choices } }],
    })
    expect(sentencesOf(parsed)[0]?.length).toBeLessThan(MOST)
  })
})
