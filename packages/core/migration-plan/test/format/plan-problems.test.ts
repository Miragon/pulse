import { describe, expect, test } from "vitest"
import {
  MigrationPlanProblems,
  type MigrationPlanNote,
  type MigrationPlanProblem,
  type MigrationPlanProblemCode,
} from "../../src/index.js"

const SENTENCES: readonly (readonly [MigrationPlanProblem | MigrationPlanNote, string])[] = [
  [{ path: "(file)", code: "notJson" }, "is not valid JSON"],
  [
    { path: "(file)", code: "tooLarge", values: { max: 1_048_576 } },
    "is longer than 1048576 characters",
  ],
  [{ path: "(file)", code: "notAnObject" }, "must be an object"],
  [{ path: "mappings", code: "notAList" }, "must be a list"],
  [{ path: "bpmnProcessId", code: "missing" }, "is missing"],
  [
    { path: "source.versionTag", code: "unknownKey", values: { choices: ["version"] } },
    "is not a known key; use version",
  ],
  [
    {
      path: "mappings[0].note",
      code: "unknownKey",
      values: { choices: ["sourceElementId", "targetElementId"] },
    },
    "is not a known key; use sourceElementId, targetElementId",
  ],
  [
    { path: "schemaVersion", code: "unknownVersion", values: { found: "2", reads: 1 } },
    "is 2; this version of Pulse reads version 1",
  ],
  [
    { path: "bpmnProcessId", code: "notAProcessId" },
    "must be a BPMN process id: letters, digits, _, . or -, starting with a letter or _, at most 255 characters",
  ],
  [
    { path: "source.version", code: "notAVersion" },
    "must be a version number from 1 to 2147483647",
  ],
  [
    { path: "target.version", code: "sameVersion" },
    "must name another version than source.version",
  ],
  [
    { path: "mappings[0].sourceElementId", code: "notAnElementId" },
    "must be a BPMN element id, or an element id with one # part for its scope",
  ],
  [
    { path: "mappings", code: "tooManyMappings", values: { max: 1000 } },
    "has more than 1000 mappings",
  ],
  [
    { path: "mappings[2].sourceElementId", code: "sourceTwice", values: { first: 0 } },
    "maps an element that mappings[0] maps already; a plan maps each element once",
  ],
  [
    { path: "sourceProcessDefinitionId", code: "enginePlan" },
    "is a key of the engine's own plan, which names definition ids; a Pulse plan names the process and its version numbers: write one with pulse plan-migration",
  ],
  [
    { path: "source.tenantId", code: "notInAPlan", values: { key: "tenantId" } },
    "has no place in a plan, which names no instance, engine, tenant, definition id or engine option; remove it",
  ],
  [
    { path: "title", code: "ignoredKey" },
    "is not a key this version of Pulse knows; Pulse reads the plan without it",
  ],
  [
    { path: "$schema", code: "schemaNotText" },
    "must be a text, the path or URL of the plan schema; Pulse reads the plan without it",
  ],
]

const EVERY_CODE: Readonly<Record<MigrationPlanProblemCode | MigrationPlanNote["code"], true>> = {
  notJson: true,
  tooLarge: true,
  notAnObject: true,
  notAList: true,
  missing: true,
  unknownKey: true,
  unknownVersion: true,
  notAProcessId: true,
  notAVersion: true,
  sameVersion: true,
  notAnElementId: true,
  tooManyMappings: true,
  sourceTwice: true,
  enginePlan: true,
  notInAPlan: true,
  ignoredKey: true,
  schemaNotText: true,
}

const PROMISE_WORDS = /\b(?:yet|later|soon|future|upcoming|planned|coming|currently|follows?)\b/i

describe("the words of a plan's problems and notes", () => {
  test.each(SENTENCES.map(([problem, sentence]) => [problem.code, problem, sentence] as const))(
    "%s reads as the sentence the surfaces show behind its path",
    (_code, problem, sentence) => {
      expect(MigrationPlanProblems.describe(problem)).toBe(sentence)
    },
  )

  test("write the values they name as they are, a found version as the file holds it", () => {
    expect(
      MigrationPlanProblems.describe({
        path: "schemaVersion",
        code: "unknownVersion",
        values: { found: '"1"', reads: 1 },
      }),
    ).toBe('is "1"; this version of Pulse reads version 1')
    expect(
      MigrationPlanProblems.describe({
        path: "mappings[7].sourceElementId",
        code: "sourceTwice",
        values: { first: 12 },
      }),
    ).toBe("maps an element that mappings[12] maps already; a plan maps each element once")
  })

  test("cover every code, each a sentence to follow its path, without a full stop or a promise", () => {
    const codes = new Set(SENTENCES.map(([problem]) => problem.code))

    expect([...codes].sort()).toStrictEqual(Object.keys(EVERY_CODE).sort())
    for (const [problem, sentence] of SENTENCES) {
      expect(sentence, problem.code).toMatch(/^[a-z].*[^.]$/)
      expect(sentence, problem.code).not.toMatch(PROMISE_WORDS)
    }
  })
})
