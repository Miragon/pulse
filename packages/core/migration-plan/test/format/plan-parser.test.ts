import { afterEach, describe, expect, test, vi } from "vitest"
import {
  MigrationPlanParser,
  MigrationPlanVocabulary,
  type MigrationPlanParse,
  type MigrationPlanProblem,
} from "../../src/index.js"
import { MIGRATION_PLAN_FIXTURES } from "../../src/testing/index.js"

const MAX = MigrationPlanVocabulary.MAX_PLAN_CHARACTERS
const APPROVE = { sourceElementId: "approve", targetElementId: "approve" }
const PLAN = { bpmnProcessId: "invoice", source: { version: 1 }, target: { version: 2 } }
const FILE = { schemaVersion: 1, ...PLAN, mappings: [APPROVE] }
const LONGEST = `a${"b".repeat(254)}`

function parse(file: unknown): MigrationPlanParse {
  return MigrationPlanParser.parse(JSON.stringify(file))
}

function problemsOf(file: unknown): readonly MigrationPlanProblem[] {
  const parsed = parse(file)
  return "problems" in parsed ? parsed.problems : []
}

function accepted(overrides: object): MigrationPlanParse {
  return { plan: { ...PLAN, mappings: [APPROVE], ...overrides }, notes: [] }
}

function withMappings(...mappings: readonly unknown[]): object {
  return { ...FILE, mappings }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the whole text", () => {
  test("is refused when it is longer than the cap, before it is read as JSON", () => {
    const read = vi.spyOn(JSON, "parse")

    expect(MigrationPlanParser.parse(`{${" ".repeat(MAX)}`)).toStrictEqual({
      problems: [{ path: "(file)", code: "tooLarge", values: { max: 1_048_576 } }],
    })
    expect(read).not.toHaveBeenCalled()
  })

  test("is read up to exactly the cap", () => {
    const text = JSON.stringify(FILE)
    const padded = `${text}${" ".repeat(MAX - text.length)}`

    expect(padded).toHaveLength(MAX)
    expect(MigrationPlanParser.parse(padded)).toStrictEqual(accepted({}))
    expect(MigrationPlanParser.parse(`${padded} `)).toHaveProperty("problems.0.code", "tooLarge")
  })

  test.each(["", "{", "{ bpmnProcessId: 'invoice' }", "invoice"])("must be JSON: %j", (text) => {
    expect(MigrationPlanParser.parse(text)).toStrictEqual({
      problems: [{ path: "(file)", code: "notJson" }],
    })
  })

  test.each([[], null, "invoice", 1, true])("must hold an object: %j", (document) => {
    expect(parse(document)).toStrictEqual({ problems: [{ path: "(file)", code: "notAnObject" }] })
  })
})

describe("the root keys", () => {
  test.each(MigrationPlanVocabulary.ENGINE_PLAN_KEYS)(
    "%s marks a plan of the engine, which gives that one problem",
    (key) => {
      expect(parse({ ...FILE, [key]: "invoice:1:def-1", engine: "prod" })).toStrictEqual({
        problems: [{ path: key, code: "enginePlan" }],
      })
    },
  )

  test("name the first key of an engine's plan only, before a version Pulse does not read", () => {
    const execution = {
      schemaVersion: 2,
      migrationPlan: { instructions: [] },
      processInstanceIds: ["0e6a3c62"],
      sourceProcessDefinitionId: "invoice:1:def-1",
    }

    expect(parse(execution)).toStrictEqual({
      problems: [{ path: "migrationPlan", code: "enginePlan" }],
    })
  })

  test.each(MigrationPlanVocabulary.FOREIGN_KEYS)(
    "refuse %s at the root, in a side and in a mapping, as no part of a plan and only as that",
    (key) => {
      const values = { key }

      expect(problemsOf({ ...FILE, [key]: "x" })).toStrictEqual([
        { path: key, code: "notInAPlan", values },
      ])
      expect(problemsOf({ ...FILE, target: { version: 2, [key]: "x" } })).toStrictEqual([
        { path: `target.${key}`, code: "notInAPlan", values },
      ])
      expect(problemsOf(withMappings({ ...APPROVE, [key]: "x" }))).toStrictEqual([
        { path: `mappings[0].${key}`, code: "notInAPlan", values },
      ])
    },
  )

  test("note a key Pulse does not know, in the order of the file, and read the plan without it", () => {
    expect(parse({ title: "Approval", ...FILE, note: { tenantId: "north" } })).toStrictEqual({
      plan: { ...PLAN, mappings: [APPROVE] },
      notes: [
        { path: "title", code: "ignoredKey" },
        { path: "note", code: "ignoredKey" },
      ],
    })
  })

  test("take __proto__ as a key it notes, never as the prototype of what it gives", () => {
    const parsed = MigrationPlanParser.parse(
      `{"__proto__":{"bpmnProcessId":"evil"},${JSON.stringify(FILE).slice(1)}`,
    )

    expect(parsed).toStrictEqual({
      plan: { ...PLAN, mappings: [APPROVE] },
      notes: [{ path: "__proto__", code: "ignoredKey" }],
    })
    expect(Object.getPrototypeOf("plan" in parsed ? parsed.plan : undefined)).toBe(Object.prototype)
  })

  test.each([1, null, {}, ["./migration-plan.schema.json"]])(
    "note a $schema that is no text: %j",
    (link) => {
      expect(parse({ $schema: link, ...FILE })).toStrictEqual({
        plan: { ...PLAN, mappings: [APPROVE] },
        notes: [{ path: "$schema", code: "schemaNotText" }],
      })
    },
  )

  test("read a $schema text without a note, and give the plan without it", () => {
    expect(parse({ $schema: "../schema/migration-plan.schema.json", ...FILE })).toStrictEqual(
      accepted({}),
    )
  })
})

describe("the schemaVersion", () => {
  test("reads as 1 when it is missing", () => {
    expect(parse({ ...PLAN, mappings: [APPROVE] })).toStrictEqual(accepted({}))
  })

  test.each([
    [2, "2"],
    ["1", '"1"'],
    [null, "null"],
    [1.5, "1.5"],
  ])("refuses %j alone, whatever else the file holds", (version, found) => {
    const file = { schemaVersion: version, source: { version: 1, tenantId: "north" }, mappings: 1 }

    expect(parse(file)).toStrictEqual({
      problems: [{ path: "schemaVersion", code: "unknownVersion", values: { found, reads: 1 } }],
    })
  })
})

describe("the process id", () => {
  test("is required", () => {
    expect(problemsOf({ ...FILE, bpmnProcessId: undefined })).toStrictEqual([
      { path: "bpmnProcessId", code: "missing" },
    ])
  })

  test.each([1, "", "invoice:1:def-1", "1invoice", `${LONGEST}c`, "a#b", null])(
    "is refused when it is no BPMN process id: %j",
    (bpmnProcessId) => {
      expect(problemsOf({ ...FILE, bpmnProcessId })).toStrictEqual([
        { path: "bpmnProcessId", code: "notAProcessId" },
      ])
    },
  )

  test("is read up to 255 characters", () => {
    expect(parse({ ...FILE, bpmnProcessId: LONGEST })).toStrictEqual(
      accepted({ bpmnProcessId: LONGEST }),
    )
  })
})

describe("a side", () => {
  test.each(["source", "target"])("%s is required", (side) => {
    expect(problemsOf({ ...FILE, [side]: undefined })).toStrictEqual([
      { path: side, code: "missing" },
    ])
  })

  test.each([[], 1, null, "v1"])("must be an object: %j", (side) => {
    expect(problemsOf({ ...FILE, source: side })).toStrictEqual([
      { path: "source", code: "notAnObject" },
    ])
  })

  test("refuses a key it does not know, __proto__ among them, and reads the rest", () => {
    const text = JSON.stringify(FILE).replace(
      '"target":{"version":2}',
      '"target":{"versionTag":"2.0","version":2,"__proto__":{}}',
    )
    const choices = ["version"]

    expect(MigrationPlanParser.parse(text)).toStrictEqual({
      problems: [
        { path: "target.versionTag", code: "unknownKey", values: { choices } },
        { path: "target.__proto__", code: "unknownKey", values: { choices } },
      ],
    })
  })

  test("needs its version", () => {
    expect(problemsOf({ ...FILE, target: {} })).toStrictEqual([
      { path: "target.version", code: "missing" },
    ])
  })

  test.each([0, -1, 1.5, "1", 2_147_483_648, null, true])(
    "is refused for a version that is no whole number from 1 to 2147483647: %j",
    (version) => {
      expect(problemsOf({ ...FILE, source: { version } })).toStrictEqual([
        { path: "source.version", code: "notAVersion" },
      ])
    },
  )

  test("is read up to version 2147483647", () => {
    const target = { version: 2_147_483_647 }

    expect(parse({ ...FILE, target })).toStrictEqual(accepted({ target }))
  })
})

describe("the two versions", () => {
  test("must differ", () => {
    expect(problemsOf({ ...FILE, source: { version: 2 } })).toStrictEqual([
      { path: "target.version", code: "sameVersion" },
    ])
  })

  test("may lead back to an older version", () => {
    const back = { source: { version: 4 }, target: { version: 3 } }

    expect(parse({ ...FILE, ...back })).toStrictEqual(accepted(back))
  })

  test("are compared only when both are read", () => {
    expect(problemsOf({ ...FILE, target: { version: 1, tenantId: "north" } })).toStrictEqual([
      { path: "target.tenantId", code: "notInAPlan", values: { key: "tenantId" } },
      { path: "target.version", code: "sameVersion" },
    ])
    expect(problemsOf({ ...FILE, source: undefined, target: { version: 1 } })).toStrictEqual([
      { path: "source", code: "missing" },
    ])
    expect(problemsOf({ ...FILE, target: { version: "1" } })).toStrictEqual([
      { path: "target.version", code: "notAVersion" },
    ])
  })
})

describe("the mappings", () => {
  test("are required", () => {
    expect(problemsOf({ ...FILE, mappings: undefined })).toStrictEqual([
      { path: "mappings", code: "missing" },
    ])
  })

  test.each([{}, "approve", null])("must be a list: %j", (mappings) => {
    expect(problemsOf({ ...FILE, mappings })).toStrictEqual([
      { path: "mappings", code: "notAList" },
    ])
  })

  test("may be empty", () => {
    expect(parse(withMappings())).toStrictEqual(accepted({ mappings: [] }))
  })

  test("are read up to 1000, and more are refused without reading one", () => {
    const most = Array.from({ length: 1000 }, (_, index) => ({
      sourceElementId: `Task_${index}`,
      targetElementId: "Task_0",
    }))

    expect(parse(withMappings(...most))).toStrictEqual(accepted({ mappings: most }))
    expect(problemsOf(withMappings(...most, null))).toStrictEqual([
      { path: "mappings", code: "tooManyMappings", values: { max: 1000 } },
    ])
  })

  test.each([null, [], "approve", 1])("each must be an object: %j", (mapping) => {
    expect(problemsOf(withMappings(APPROVE, mapping))).toStrictEqual([
      { path: "mappings[1]", code: "notAnObject" },
    ])
  })

  test("each refuses a key it does not know", () => {
    expect(problemsOf(withMappings({ ...APPROVE, note: "renamed" }))).toStrictEqual([
      {
        path: "mappings[0].note",
        code: "unknownKey",
        values: { choices: ["sourceElementId", "targetElementId"] },
      },
    ])
  })

  test("each needs a source and a target", () => {
    expect(problemsOf(withMappings({ sourceElementId: "approve" }, {}))).toStrictEqual([
      { path: "mappings[0].targetElementId", code: "missing" },
      { path: "mappings[1].sourceElementId", code: "missing" },
      { path: "mappings[1].targetElementId", code: "missing" },
    ])
  })

  test.each([
    "a#b#c",
    "",
    "#b",
    "a#",
    "1a",
    "a:b",
    "a b",
    1,
    null,
    `${LONGEST}c#b`,
    `a#${LONGEST}c`,
  ])("each is refused for an id that is no BPMN element id: %j", (id) => {
    expect(
      problemsOf(withMappings({ sourceElementId: "approve", targetElementId: id })),
    ).toStrictEqual([{ path: "mappings[0].targetElementId", code: "notAnElementId" }])
  })

  test("each takes an element id with one scope part, each part up to 255 characters", () => {
    const mappings = [
      { sourceElementId: "Pack#multiInstanceBody", targetElementId: "Pack#multiInstanceBody" },
      { sourceElementId: `${LONGEST}#${LONGEST}`, targetElementId: LONGEST },
    ]

    expect(parse(withMappings(...mappings))).toStrictEqual(accepted({ mappings }))
  })

  test("map each source once, and name the mapping that maps it first", () => {
    const check = { sourceElementId: "check", targetElementId: "review" }

    expect(problemsOf(withMappings(check, APPROVE, check, check))).toStrictEqual([
      { path: "mappings[2].sourceElementId", code: "sourceTwice", values: { first: 0 } },
      { path: "mappings[3].sourceElementId", code: "sourceTwice", values: { first: 0 } },
    ])
  })

  test("may map two sources onto one target, and keep the order of the file", () => {
    const mappings = [{ sourceElementId: "check", targetElementId: "approve" }, APPROVE]

    expect(parse(withMappings(...mappings))).toStrictEqual(accepted({ mappings }))
  })
})

describe("a parse", () => {
  test("lists every problem of the file, the root keys first, then each key in its place", () => {
    const file = {
      instanceIds: [],
      bpmnProcessId: "1invoice",
      source: { version: 0 },
      target: {},
      mappings: [{ sourceElementId: "a#b#c" }],
      title: "Approval",
    }

    expect(parse(file)).toStrictEqual({
      problems: [
        { path: "instanceIds", code: "notInAPlan", values: { key: "instanceIds" } },
        { path: "bpmnProcessId", code: "notAProcessId" },
        { path: "source.version", code: "notAVersion" },
        { path: "target.version", code: "missing" },
        { path: "mappings[0].sourceElementId", code: "notAnElementId" },
        { path: "mappings[0].targetElementId", code: "missing" },
      ],
    })
  })

  test.each(MIGRATION_PLAN_FIXTURES.map((fixture) => [fixture.name, fixture.text] as const))(
    "%s: gives a plan with its notes or the problems, never both",
    (_name, text) => {
      expect([["notes", "plan"], ["problems"]]).toContainEqual(
        Object.keys(MigrationPlanParser.parse(text)).sort(),
      )
    },
  )
})
