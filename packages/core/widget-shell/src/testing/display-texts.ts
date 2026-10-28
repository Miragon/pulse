import {
  getFrameworkManifest,
  PROPS_SCHEMA_DISPLAY_KEYWORD,
  StepRegistry,
  WidgetRegistry,
  type AppConfig,
  type AppDefinition,
  type DisplayText,
  type LocalizedText,
} from "@miragon/mcp-toolkit-core"
import type { CatalogLanguage } from "./catalog-text.js"

/**
 * The view builder falls back to the technical id without a title, so every widget, step
 * and top-level prop carries en and de texts, and none reaches the model.
 */

interface DisplayEntry {
  /** `app`, `widget <id>`, `step <id>` or `prop <widget id>.<path>`. */
  where: string
  field: "title" | "summary"
  text: LocalizedText | undefined
}

type JsonSchema = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Top-level only: the toolkit strips `x-display` at that level only, so a nested one would reach the model. */
function sheetFields(schema: unknown): [name: string, node: JsonSchema][] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return []
  return Object.entries(schema.properties).filter((entry): entry is [string, JsonSchema] =>
    isRecord(entry[1]),
  )
}

function displayEntries(where: string, text: DisplayText | undefined): DisplayEntry[] {
  return [
    { where, field: "title", text: text?.title },
    { where, field: "summary", text: text?.summary },
  ]
}

function entriesOf(definition: AppDefinition): DisplayEntry[] {
  return [
    { where: "app", field: "title", text: definition.title },
    ...definition.widgets.flatMap((widget) => [
      ...displayEntries(`widget ${widget.id}`, widget),
      ...sheetFields(widget.propsSchema).flatMap(([name, node]) =>
        displayEntries(
          `prop ${widget.id}.${name}`,
          node[PROPS_SCHEMA_DISPLAY_KEYWORD] as DisplayText | undefined,
        ),
      ),
    ]),
    ...definition.steps.flatMap((step) => displayEntries(`step ${step.id}`, step)),
  ]
}

function textIn(text: LocalizedText | undefined, language: string): string | undefined {
  if (text === undefined) return undefined
  const value = typeof text === "string" ? text : text[language]
  return value?.trim() ? value : undefined
}

export function missingDisplayTexts(
  definition: AppDefinition,
  languages: readonly CatalogLanguage[] = ["en", "de"],
): string[] {
  return entriesOf(definition).flatMap((entry) =>
    languages
      .filter((language) => textIn(entry.text, language) === undefined)
      .map((language) => `${entry.where}: no ${language} ${entry.field}`),
  )
}

/** For the voice and glossary gates. */
export function displayTextCatalog(
  definition: AppDefinition,
  language: CatalogLanguage,
): Record<string, string> {
  const catalog: Record<string, string> = {}
  for (const entry of entriesOf(definition)) {
    const text = textIn(entry.text, language)
    if (text !== undefined) catalog[`${entry.where}.${entry.field}`] = text
  }
  return catalog
}

function displayKeywordPaths(node: unknown, path: string): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => displayKeywordPaths(item, `${path}[${String(i)}]`))
  }
  if (!isRecord(node)) return []
  return Object.entries(node).flatMap(([key, value]) =>
    key === PROPS_SCHEMA_DISPLAY_KEYWORD
      ? [path]
      : displayKeywordPaths(value, path ? `${path}.${key}` : key),
  )
}

/** `getFrameworkManifest` strips the keyword from top-level properties only. */
export function displayTextsSentToModel(definition: AppDefinition): string[] {
  const widgets = new WidgetRegistry()
  for (const widget of definition.widgets) widgets.register(widget)
  const config: AppConfig = { activeApps: [], pipelines: {} }
  return getFrameworkManifest(new StepRegistry(), widgets, config).widgets.flatMap((widget) =>
    displayKeywordPaths(widget.propsSchema, "").map((path) => `widget ${widget.id}: ${path}`),
  )
}
