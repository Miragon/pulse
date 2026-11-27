import {
  catalogTextFindings,
  COUNT_TERMS,
  glossaryFindings,
  PRODUCT_GLOSSARY,
} from "@miragon/pulse-ui/testing"
import { describe, expect, it } from "vitest"
import { outsideDe } from "./outside-de.js"
import { outsideEn } from "./outside-en.js"
import { outsideTranslate } from "./outside-words.js"

/** The words of the line of an engine's open root incidents outside any process. */
describe("the words outside any process", () => {
  it("follow the glossary and the voice rules in both languages (du, no dash as a connector, the plural)", () => {
    expect(glossaryFindings(outsideEn, PRODUCT_GLOSSARY.en)).toEqual([])
    expect(glossaryFindings(outsideDe, PRODUCT_GLOSSARY.de)).toEqual([])
    expect(catalogTextFindings(outsideEn, { language: "en" })).toEqual([])
    expect(catalogTextFindings(outsideDe, { language: "de" })).toEqual([])
  })

  it("have a German entry for every English key and no other", () => {
    expect(Object.keys(outsideDe).sort()).toEqual(Object.keys(outsideEn).sort())
  })

  it("name the count with the count term every Pulse UI uses, the noun in its count's number", () => {
    const words = (locale: string, key: string, params: Record<string, unknown>) =>
      outsideTranslate(locale, key, params)
    expect([
      words("en", "outside.title", { count: "1" }),
      words("en", "outside.title", { count: "≥ 2,000" }),
      words("en", "outside.titleOf", { engine: "prod", count: "2" }),
    ]).toEqual([
      `1 incident ${COUNT_TERMS.outsideAnyProcess.en}`,
      `≥ 2,000 incidents ${COUNT_TERMS.outsideAnyProcess.en}`,
      `prod: 2 incidents ${COUNT_TERMS.outsideAnyProcess.en}`,
    ])
    expect([
      words("de", "outside.title", { count: "1" }),
      words("de", "outside.titleOf", { engine: "prod", count: "≥ 2.000" }),
    ]).toEqual([
      `1 Incident ${COUNT_TERMS.outsideAnyProcess.de}`,
      `prod: ≥ 2.000 Incidents ${COUNT_TERMS.outsideAnyProcess.de}`,
    ])
    expect(words("en", "outside.detail", { count: "1" })).toContain("raised it")
    expect(words("en", "outside.detail", { count: "3" })).toContain("raised them")
    expect(words("de", "outside.detail", { count: "1" })).toContain("zählt ihn")
    expect(words("de", "outside.detail", { count: "3" })).toContain("zählt sie")
  })
})
