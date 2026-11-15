import { Ajv } from "ajv"
import { describe, expect, test } from "vitest"
import manifest from "../../package.json" with { type: "json" }
import document from "../../schema/board.schema.json" with { type: "json" }
import { BoardVocabulary } from "../../src/index.js"
import { BOARD_FIXTURES } from "../../src/testing/index.js"

interface Node {
  readonly type?: string
  readonly description?: string
  readonly $ref?: string
  readonly properties?: Readonly<Record<string, Node>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly uniqueItems?: boolean
  readonly minItems?: number
  readonly items?: Node
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly oneOf?: readonly Node[]
}

interface Schema extends Node {
  readonly definitions: Readonly<Record<string, Node>>
}

const schema: Schema = document
const SCHEMA_PATH = "./schema/board.schema.json"
const validate = new Ajv({ strict: true, allErrors: true }).compile(document)

function keysOf(node: Node | undefined): readonly string[] {
  return Object.keys(node?.properties ?? {})
}

function widgetNamed(name: string): Node {
  const widget = schema.definitions.widget?.oneOf?.find(
    (candidate) => candidate.properties?.widget?.const === name,
  )
  if (widget === undefined) {
    throw new Error(`the schema has no widget ${name}`)
  }
  return widget
}

function expectWidgetLikeTheParser(widget: (typeof BoardVocabulary.WIDGETS)[number]): void {
  const node = widgetNamed(widget)
  const props = node.properties?.props
  expect(keysOf(node)).toEqual(BoardVocabulary.WIDGET_KEYS)
  expect(node.additionalProperties).toBe(false)
  const required = BoardVocabulary.REQUIRED_PROPS[widget]
  expect(node.required).toEqual(required.length === 0 ? ["widget"] : ["widget", "props"])
  expect(props?.required ?? []).toEqual(required)
  expect(keysOf(props)).toEqual(BoardVocabulary.PROPS[widget])
  expect(props?.additionalProperties).toBe(false)
  expect(props?.properties?.engines?.uniqueItems).toBe(true)
}

function propOf(widget: string, prop: string): Node | undefined {
  return widgetNamed(widget).properties?.props?.properties?.[prop]
}

function schemaTakes(text: string): boolean {
  try {
    return validate(JSON.parse(text))
  } catch {
    return false
  }
}

describe("the board schema", () => {
  test("allows exactly the keys and versions the parser reads", () => {
    expect(keysOf(schema)).toEqual(BoardVocabulary.DOCUMENT_KEYS)
    expect(schema.required).toEqual(BoardVocabulary.REQUIRED)
    expect(schema.properties?.rows?.items?.required).toEqual(BoardVocabulary.ROW_KEYS)
    expect(schema.properties?.engines?.uniqueItems).toBe(true)
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties?.schemaVersion?.const).toBe(BoardVocabulary.SCHEMA_VERSION)
    expect(keysOf(schema.properties?.rows?.items)).toEqual(BoardVocabulary.ROW_KEYS)
  })

  test("knows every widget with exactly its props", () => {
    const named = schema.definitions.widget?.oneOf?.map(
      (widget) => widget.properties?.widget?.const,
    )
    expect(named).toEqual(BoardVocabulary.WIDGETS)
    for (const widget of BoardVocabulary.WIDGETS) {
      expectWidgetLikeTheParser(widget)
    }
  })

  test("offers the filter keys, states, groupings and columns the parser accepts", () => {
    const filter = schema.definitions.filter
    expect(keysOf(filter)).toEqual(BoardVocabulary.FILTER_KEYS)
    expect(filter?.additionalProperties).toBe(false)
    expect(filter?.properties?.state?.enum).toEqual(BoardVocabulary.STATES)
    expect(propOf("incidentSummary", "groupBy")?.enum).toEqual(BoardVocabulary.GROUPINGS)
    expect(propOf("instanceList", "columns")?.items?.enum).toEqual(BoardVocabulary.COLUMNS)
    expect(propOf("instanceList", "columns")?.minItems).toBe(1)
  })

  test.each(BOARD_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: says what the fixture pins, and takes every board the parser takes",
    (_name, fixture) => {
      const takes = schemaTakes(fixture.text)
      expect(takes, JSON.stringify(validate.errors)).toBe(fixture.schema)
      if ("board" in fixture.verdict) {
        expect(takes, "the parser takes it").toBe(true)
      }
    },
  )

  test("refuses some fixtures and is blind to what only the parser sees in others", () => {
    const blind = BOARD_FIXTURES.filter(
      (fixture) => fixture.schema && "problems" in fixture.verdict,
    )
    expect(BOARD_FIXTURES.filter((fixture) => !fixture.schema).length).toBeGreaterThan(10)
    expect(blind.map((fixture) => fixture.name)).toEqual(
      expect.arrayContaining(["thirteen-widgets", "blank-title", "engine-outside-the-board"]),
    )
  })

  test("is published at one export, listed literally, and in the files", () => {
    expect(manifest.exports[SCHEMA_PATH]).toBe(SCHEMA_PATH)
    expect(Object.keys(manifest.exports).filter((key) => key.includes("*"))).toEqual([])
    expect(manifest.files).toContain("schema")
  })
})
