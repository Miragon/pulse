import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { BoardParser } from "../../src/core/boards/board-parser.js"
import { BoardVocabulary } from "../../src/core/boards/board-vocabulary.js"
import { APP_ROOT } from "./support/files.js"

interface Node {
  readonly properties?: Readonly<Record<string, Node>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly uniqueItems?: boolean
  readonly minItems?: number
  readonly items?: Node
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly oneOf?: readonly Node[]
  readonly $ref?: string
}

interface Schema extends Node {
  readonly definitions: Readonly<Record<string, Node>>
}

const schema = JSON.parse(
  readFileSync(join(APP_ROOT, "schemas/board.schema.json"), "utf8"),
) as Schema
const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
  readonly contributes: { readonly jsonValidation: readonly { fileMatch: string; url: string }[] }
}

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

describe("the board schema the editor validates with", () => {
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

  test("is the one the extension contributes for board files", () => {
    expect(manifest.contributes.jsonValidation).toEqual([
      { fileMatch: "**/.pulse/boards/*.board.json", url: "./schemas/board.schema.json" },
    ])
  })

  test("reads the board the sandbox ships", () => {
    const content = readFileSync(
      join(APP_ROOT, "sandbox/.pulse/boards/shop-operations.board.json"),
      "utf8",
    )

    expect(BoardParser.parse(content)).toHaveProperty("board.engines", [
      "shop-dev",
      "shop-test",
      "prod-eu",
    ])
  })
})
