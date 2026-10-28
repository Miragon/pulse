import {
  PROPS_SCHEMA_DISPLAY_KEYWORD,
  type Catalogs,
  type DisplayText,
  type LocalizedText,
} from "@miragon/mcp-toolkit-core"

export interface BuilderTexts {
  /** The heading of its group in the builder's palette. */
  appTitle: () => LocalizedText
  text: (key: string) => Required<Pick<DisplayText, "title" | "summary">>
  /** Zod metadata putting the toolkit's `x-display` keyword on the field's JSON schema. */
  field: (key: string) => Record<string, unknown>
}

/**
 * People's texts for the view builder, from the module's own catalogs so voice, glossary and en/de
 * gates hold them; `description`s stay the model's. A missing entry throws as definitions load.
 */
export function createBuilderTexts(catalogs: Catalogs, module: string): BuilderTexts {
  const localized = (key: string): LocalizedText => {
    const en = catalogs.en?.[key]
    const de = catalogs.de?.[key]
    if (typeof en !== "string" || typeof de !== "string") {
      throw new Error(`${module} builder text "${key}" is missing in the en or de catalog`)
    }
    return { en, de }
  }
  const text = (key: string) => ({
    title: localized(`builder.${key}.title`),
    summary: localized(`builder.${key}.summary`),
  })
  return {
    appTitle: () => localized("builder.app.title"),
    text,
    field: (key) => ({ [PROPS_SCHEMA_DISPLAY_KEYWORD]: text(`field.${key}`) }),
  }
}
