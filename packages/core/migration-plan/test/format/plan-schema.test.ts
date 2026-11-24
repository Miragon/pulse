import { Ajv } from "ajv"
import { describe, expect, test } from "vitest"
import manifest from "../../package.json" with { type: "json" }
import document from "../../schema/migration-plan.schema.json" with { type: "json" }
import {
  MigrationPlanParser,
  MigrationPlanRules,
  MigrationPlanVocabulary,
} from "../../src/index.js"
import { MIGRATION_PLAN_FIXTURES, type MigrationPlanFixture } from "../../src/testing/index.js"

interface Node {
  readonly type?: string
  readonly $ref?: string
  readonly properties?: Readonly<Record<string, Node>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly maxLength?: number
  readonly maxItems?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly items?: Node
  readonly const?: unknown
}

interface Schema extends Node {
  readonly definitions: Readonly<Record<string, Node>>
}

const schema: Schema = document
const SCHEMA_PATH = "./schema/migration-plan.schema.json"
const validate = new Ajv({ strict: true, allErrors: true }).compile(document)
const LONGEST = `a${"b".repeat(254)}`
const MINIMAL = {
  schemaVersion: 1,
  bpmnProcessId: "invoice",
  source: { version: 1 },
  target: { version: 2 },
  mappings: [{ sourceElementId: "approve", targetElementId: "approve" }],
}

function keysOf(node: Node | undefined): readonly string[] {
  return Object.keys(node?.properties ?? {})
}

function definitionOf(name: string): Node {
  const definition = schema.definitions[name]
  if (definition === undefined) {
    throw new Error(`the schema has no definition ${name}`)
  }
  return definition
}

function schemaTakes(text: string): boolean {
  try {
    return validate(JSON.parse(text))
  } catch {
    return false
  }
}

function parserTakes(text: string): boolean {
  return "plan" in MigrationPlanParser.parse(text)
}

function readsInFull({ verdict }: MigrationPlanFixture): boolean {
  return "plan" in verdict && verdict.notes.length === 0
}

function named(names: readonly string[]): readonly MigrationPlanFixture[] {
  return MIGRATION_PLAN_FIXTURES.filter((fixture) => names.includes(fixture.name))
}

function planWith(bpmnProcessId: string, elementId: string): string {
  const mappings = [{ sourceElementId: elementId, targetElementId: elementId }]
  return JSON.stringify({ ...MINIMAL, bpmnProcessId, mappings })
}

describe("the migration plan schema", () => {
  test("compiles in the strict mode of Ajv", () => {
    expect(() => new Ajv({ strict: true }).compile(document)).not.toThrow()
  })

  test("allows exactly the root keys, the version and the limits the parser reads", () => {
    const { schemaVersion, bpmnProcessId, mappings } = schema.properties ?? {}

    expect(keysOf(schema)).toStrictEqual(MigrationPlanVocabulary.ROOT_KEYS)
    expect(schema.additionalProperties).toBe(false)
    expect(schemaVersion?.const).toBe(MigrationPlanVocabulary.SCHEMA_VERSION)
    expect(bpmnProcessId?.maxLength).toBe(MigrationPlanRules.MAX_ID_LENGTH)
    expect(mappings?.maxItems).toBe(MigrationPlanVocabulary.MAX_MAPPINGS)
  })

  test("allows a side exactly its version, a whole number in the range of the parser", () => {
    const side = definitionOf("side")

    expect(keysOf(side)).toStrictEqual(MigrationPlanVocabulary.SIDE_KEYS)
    expect(side.required).toStrictEqual(MigrationPlanVocabulary.SIDE_KEYS)
    expect(side.additionalProperties).toBe(false)
    expect(side.properties?.version).toStrictEqual({
      type: "integer",
      minimum: 1,
      maximum: MigrationPlanRules.MAX_VERSION,
    })
  })

  test("allows a mapping exactly its two element ids, each two parts long at most", () => {
    const mapping = definitionOf("mapping")

    expect(keysOf(mapping)).toStrictEqual(MigrationPlanVocabulary.MAPPING_KEYS)
    expect(mapping.required).toStrictEqual(MigrationPlanVocabulary.MAPPING_KEYS)
    expect(mapping.additionalProperties).toBe(false)
    expect(definitionOf("elementId").maxLength).toBe(2 * MigrationPlanRules.MAX_ID_LENGTH + 1)
  })

  test("takes a $schema of any text, as the parser reads one without a note", () => {
    expect(schema.properties?.$schema).toStrictEqual({ type: "string" })
  })

  test.each(MigrationPlanVocabulary.ROOT_KEYS)(
    "requires %s exactly when the parser refuses a plan without it",
    (key) => {
      const parsed = MigrationPlanParser.parse(JSON.stringify({ ...MINIMAL, [key]: undefined }))
      const refused = "problems" in parsed && parsed.problems.some((p) => p.code === "missing")

      expect(schema.required?.includes(key)).toBe(refused)
    },
  )

  test.each(MIGRATION_PLAN_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: says what the fixture pins, and takes every plan the parser reads in full",
    (_name, fixture) => {
      const takes = schemaTakes(fixture.text)

      expect(takes, JSON.stringify(validate.errors)).toBe(fixture.schema)
      if (readsInFull(fixture)) {
        expect(takes, "the parser reads it without a note").toBe(true)
      }
    },
  )

  test("refuses the root keys the parser only notes", () => {
    for (const fixture of named(["title-key", "schema-not-text"])) {
      expect(fixture.schema, fixture.name).toBe(false)
      expect(parserTakes(fixture.text), fixture.name).toBe(true)
    }
  })

  test("is blind to what only the parser sees: one version twice, one source twice, the first character of an id", () => {
    const blind = MIGRATION_PLAN_FIXTURES.filter(
      (fixture) => fixture.schema && !readsInFull(fixture),
    )

    expect(blind.map((fixture) => fixture.name).sort()).toStrictEqual([
      "digit-first-process",
      "same-version",
      "source-twice",
    ])
    expect(MIGRATION_PLAN_FIXTURES.filter((fixture) => !fixture.schema).length).toBeGreaterThan(10)
  })

  test("is blind to the cap on the text, the letters of an id and the length of each part", () => {
    const text = JSON.stringify(MINIMAL)
    const padded = `${text}${" ".repeat(MigrationPlanVocabulary.MAX_PLAN_CHARACTERS)}`

    for (const blind of [
      padded,
      planWith("order+fulfillment", "approve"),
      planWith("invoice", "Task€"),
      planWith("invoice", `${LONGEST}c#b`),
    ]) {
      expect(schemaTakes(blind)).toBe(true)
      expect(parserTakes(blind)).toBe(false)
    }
  })

  test.each([
    ["order-fulfillment", "Activity_Pack#multiInstanceBody"],
    ["Rechnung.prüfen", "Prüfung_1"],
    ["_invoice", "a·b"],
    [LONGEST, `${LONGEST}#${LONGEST}`],
  ])("is never stricter on the ids than the parser: %s, %s", (bpmnProcessId, elementId) => {
    const text = planWith(bpmnProcessId, elementId)

    expect(parserTakes(text)).toBe(true)
    expect(schemaTakes(text)).toBe(true)
  })

  test("is published at one export, listed literally, and in the files", () => {
    expect(manifest.exports[SCHEMA_PATH]).toBe(SCHEMA_PATH)
    expect(Object.keys(manifest.exports).filter((key) => key.includes("*"))).toStrictEqual([])
    expect(manifest.files).toContain("schema")
  })
})
