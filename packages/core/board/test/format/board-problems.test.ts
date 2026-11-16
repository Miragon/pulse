import { describe, expect, test } from "vitest"
import { BoardProblems, type BoardProblem, type BoardProblemCode } from "../../src/index.js"

const SENTENCES: readonly (readonly [BoardProblem, string])[] = [
  [{ path: "(file)", code: "notJson" }, "is not valid JSON"],
  [{ path: "(file)", code: "notAnObject" }, "must be an object"],
  [{ path: "rows", code: "notAList" }, "must be a list"],
  [{ path: "title", code: "missing" }, "is missing"],
  [
    { path: "layout", code: "ignoredKey" },
    "is not a key this version of Pulse knows; Pulse shows the board without it",
  ],
  [{ path: "title", code: "blankText" }, "must be a text that is not empty"],
  [
    { path: "engines", code: "engineNames" },
    "must be a list of different engine names that is not empty",
  ],
  [
    { path: "tenants", code: "tenantIds" },
    "must be a list of different tenant ids that is not empty",
  ],
  [
    { path: "rows[0].row[0].props.engines", code: "diagramOnOneEngine" },
    "must name one engine, because a diagram shows the deployment of one engine",
  ],
  [
    { path: "rows[0].row[0].props.warnAbove", code: "notWholeNumber" },
    "must be a whole number of 0 or more",
  ],
  [{ path: "rows[0].row[0].props.columns", code: "noColumns" }, "must name at least one column"],
  [
    { path: "rows[0].row[0].props.filter.withIncident", code: "notBoolean" },
    "must be true or false",
  ],
  [
    { path: "rows[0].row[0].props.filter.activeElement", code: "elementWithoutProcess" },
    "needs a process: element ids are only unique within one process",
  ],
  [
    { path: "rows[0].row[0].props.filter.activeElement", code: "elementOnEnded" },
    'only matches running instances; remove it or use state "running"',
  ],
  [
    { path: "rows[0].row[0].props.filter.withIncident", code: "endedWithIncident" },
    'only matches running instances, since an ended instance has no open incident; remove it or use state "running"',
  ],
  [
    { path: "tenants", code: "tenantsNotRead" },
    "is set, but Pulse has no tenant filter and would read every tenant here; remove tenants to show this widget",
  ],
  [
    { path: "rows[0].cells", code: "unknownKey", values: { choices: ["row"] } },
    "is not a known key; use row",
  ],
  [
    {
      path: "rows[0].row[0].props.groupBy",
      code: "notOneOf",
      values: { choices: ["engine", "process"] },
    },
    "must be one of engine, process",
  ],
  [
    {
      path: "rows[0].row[0].props.columns[0]",
      code: "variableColumn",
      values: { choices: ["engine", "state"] },
    },
    "cannot show a variable; must be one of engine, state",
  ],
  [
    { path: "schemaVersion", code: "unknownVersion", values: { found: '"2"', reads: 1 } },
    'is "2"; this version of Pulse reads version 1',
  ],
  [
    {
      path: "rows[0].row[0].props.engines",
      code: "engineOutsideBoard",
      values: { engines: ["prod-eu", "prod-us"] },
    },
    "may only name engines of the board; prod-eu, prod-us is not in its engines",
  ],
  [
    { path: "rows[2].row[0]", code: "tooManyWidgets", values: { position: 14, max: 12 } },
    "is widget 14; a board shows at most 12, so it stays cheap for the engines",
  ],
]

const EVERY_CODE: Readonly<Record<BoardProblemCode, true>> = {
  notJson: true,
  notAnObject: true,
  notAList: true,
  missing: true,
  ignoredKey: true,
  blankText: true,
  engineNames: true,
  tenantIds: true,
  diagramOnOneEngine: true,
  notWholeNumber: true,
  noColumns: true,
  notBoolean: true,
  elementWithoutProcess: true,
  elementOnEnded: true,
  endedWithIncident: true,
  tenantsNotRead: true,
  unknownKey: true,
  notOneOf: true,
  variableColumn: true,
  unknownVersion: true,
  engineOutsideBoard: true,
  tooManyWidgets: true,
}

describe("the words of a board's problems", () => {
  test.each(SENTENCES.map(([problem, sentence]) => [problem.code, problem, sentence] as const))(
    "%s reads as the sentence the editors show behind its path",
    (_code, problem, sentence) => {
      expect(BoardProblems.describe(problem)).toBe(sentence)
    },
  )

  test("cover every code once, each a sentence to follow its path, without a full stop", () => {
    const codes = SENTENCES.map(([problem]) => problem.code)

    expect([...codes].sort()).toStrictEqual(Object.keys(EVERY_CODE).sort())
    for (const [problem, sentence] of SENTENCES) {
      expect(sentence, problem.code).toMatch(/^[a-z].*[^.]$/)
    }
  })
})
