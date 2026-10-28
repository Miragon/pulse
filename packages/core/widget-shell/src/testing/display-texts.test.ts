import { describe, expect, it } from "vitest"
import type { AppDefinition } from "@miragon/mcp-toolkit-core"
import { shellDefinition } from "../shell-catalogue.js"
import { catalogTextFindings } from "./catalog-text.js"
import {
  displayTextCatalog,
  displayTextsSentToModel,
  missingDisplayTexts,
} from "./display-texts.js"
import { glossaryFindings, PRODUCT_GLOSSARY } from "./glossary.js"

const both = (en: string, de: string) => ({ en, de })

const APP: AppDefinition = {
  name: "probe",
  title: both("Probe", "Probe"),
  steps: [
    {
      id: "probe:load",
      dataType: "probe:data",
      requires: [],
      produces: [],
      execute: () => Promise.resolve({ data: null, keys: {}, _app: "probe", _step: "load" }),
    },
  ],
  widgets: [
    {
      id: "probe:table",
      title: both("Table", "Tabelle"),
      summary: "Only one language",
      requires: [],
      size: "full",
      propsSchema: {
        type: "object",
        properties: {
          dataKey: {
            type: "string",
            "x-display": { title: both("Data key", "Datenschlüssel"), summary: both("", " ") },
          },
          columns: {
            type: "array",
            items: { type: "object", properties: { key: { type: "string" } } },
          },
          options: { type: "object", properties: { dense: { type: "boolean" } } },
        },
      },
    },
  ],
}

const display = { title: both("Field", "Feld"), summary: both("A field.", "Ein Feld.") }

const LEAKY_SCHEMA = {
  type: "object",
  properties: {
    anything: true,
    dataKey: { type: "string", "x-display": { title: both("Data key", "Datenschlüssel") } },
    columns: {
      type: "array",
      items: { type: "object", properties: { key: { type: "string", "x-display": display } } },
    },
    options: { type: "object", properties: { dense: { type: "boolean", "x-display": display } } },
    mode: { anyOf: [{ const: "a" }, { const: "b", "x-display": display }], default: null },
  },
}

const NESTED: AppDefinition = {
  ...APP,
  widgets: [
    { ...APP.widgets[0], propsSchema: LEAKY_SCHEMA },
    {
      id: "probe:plain",
      title: both("Plain", "Schlicht"),
      summary: both("A plain widget.", "Ein schlichtes Widget."),
      requires: [],
      size: "half",
    },
  ],
}

const unnamed = (where: string) =>
  ["en title", "de title", "en summary", "de summary"].map((what) => {
    const [language, field] = what.split(" ")
    return `${where}: no ${language} ${field}`
  })

describe("missingDisplayTexts", () => {
  it("names every piece the builder would show by id, per language and field", () => {
    expect(missingDisplayTexts(APP)).toEqual([
      // A plain string serves every language.
      "prop probe:table.dataKey: no en summary",
      "prop probe:table.dataKey: no de summary",
      "prop probe:table.columns: no en title",
      "prop probe:table.columns: no de title",
      "prop probe:table.columns: no en summary",
      "prop probe:table.columns: no de summary",
      // The props sheet edits nested objects and arrays as JSON, so their fields are never named.
      "prop probe:table.options: no en title",
      "prop probe:table.options: no de title",
      "prop probe:table.options: no en summary",
      "prop probe:table.options: no de summary",
      "step probe:load: no en title",
      "step probe:load: no de title",
      "step probe:load: no en summary",
      "step probe:load: no de summary",
    ])
  })

  it("names only top-level fields, and nothing for a boolean schema or a widget without props", () => {
    expect(missingDisplayTexts(NESTED)).toEqual([
      "prop probe:table.dataKey: no en summary",
      "prop probe:table.dataKey: no de summary",
      ...unnamed("prop probe:table.columns"),
      ...unnamed("prop probe:table.options"),
      ...unnamed("prop probe:table.mode"),
      ...unnamed("step probe:load"),
    ])
  })

  it("checks only the languages asked for, and the app's title", () => {
    const untitled: AppDefinition = { ...APP, title: both("Probe", ""), steps: [], widgets: [] }
    expect(missingDisplayTexts(untitled, ["de"])).toEqual(["app: no de title"])
    expect(missingDisplayTexts(untitled, ["en"])).toEqual([])
    expect(missingDisplayTexts({ ...untitled, title: { en: "Probe" } })).toEqual([
      "app: no de title",
    ])
  })
})

describe("displayTextCatalog", () => {
  it("lists the texts of one language by where they show, skipping blanks", () => {
    expect(displayTextCatalog(APP, "de")).toEqual({
      "app.title": "Probe",
      "widget probe:table.title": "Tabelle",
      "widget probe:table.summary": "Only one language",
      "prop probe:table.dataKey.title": "Datenschlüssel",
    })
  })

  it("names no nested field, even one that carries a text", () => {
    expect(Object.keys(displayTextCatalog(NESTED, "en"))).toEqual([
      "app.title",
      "widget probe:table.title",
      "widget probe:table.summary",
      "prop probe:table.dataKey.title",
      "widget probe:plain.title",
      "widget probe:plain.summary",
    ])
  })
})

describe("displayTextsSentToModel", () => {
  it("names every builder text the model's manifest still carries, by widget and path", () => {
    // The toolkit strips the top-level `dataKey` text; everything below it reaches the model.
    expect(displayTextsSentToModel(NESTED)).toEqual([
      "widget probe:table: properties.columns.items.properties.key",
      "widget probe:table: properties.options.properties.dense",
      "widget probe:table: properties.mode.anyOf[1]",
    ])
  })

  it("passes a definition whose texts sit on top-level fields only", () => {
    expect(displayTextsSentToModel(APP)).toEqual([])
  })
})

describe("the shell:* widgets are named for people in en and de", () => {
  it("every widget and props field carries a title and a summary", () => {
    expect(missingDisplayTexts(shellDefinition)).toEqual([])
  })

  it("none of those names reaches the model", () => {
    expect(displayTextsSentToModel(shellDefinition)).toEqual([])
  })

  it.each(["en", "de"] as const)("%s: in the brand voice and the product glossary", (language) => {
    const catalog = displayTextCatalog(shellDefinition, language)
    expect(catalogTextFindings(catalog, { language })).toEqual([])
    expect(glossaryFindings(catalog, PRODUCT_GLOSSARY[language])).toEqual([])
  })
})
