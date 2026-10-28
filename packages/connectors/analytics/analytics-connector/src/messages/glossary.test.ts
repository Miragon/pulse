import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { MessageCatalog } from "@miragon/mcp-toolkit-core"
import {
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
} from "@miragon/pulse-widget-shell/testing"
import { deAskAi } from "./de.ask-ai.js"
import { deBuilder } from "./de.builder.js"
import { deServer } from "./de.server.js"
import { deSweep } from "./de.sweep.js"
import { enAskAi } from "./en.ask-ai.js"
import { enBuilder } from "./en.builder.js"
import { enServer } from "./en.server.js"
import { enSweep } from "./en.sweep.js"
import { GLOSSARY } from "./glossary.js"

/** Counted entries render for 1 and for 2, so both forms are checked. */
function texts(catalog: MessageCatalog): [key: string, text: string][] {
  return Object.entries(catalog).flatMap(([key, message]): [string, string][] => {
    if (typeof message === "string") return [[key, message]]
    // Every parameter is the count n.
    const params = (n: number): Record<string, unknown> => new Proxy({}, { get: () => n })
    return [
      [key, message(params(1))],
      [key, message(params(2))],
    ]
  })
}

const CATALOGS = {
  de: { ui: [deSweep, deAskAi, deBuilder], model: [deServer] },
  en: { ui: [enSweep, enAskAi, enBuilder], model: [enServer] },
} as const

function offenders(language: "de" | "en"): string[] {
  const found: string[] = []
  for (const term of GLOSSARY) {
    const avoid = language === "de" ? term.avoidDe : term.avoidEn
    const catalogs =
      term.scope === "ui"
        ? CATALOGS[language].ui
        : [...CATALOGS[language].ui, ...CATALOGS[language].model]
    for (const catalog of catalogs) {
      for (const [key, text] of texts(catalog)) {
        for (const pattern of avoid) {
          const hit = pattern.exec(text)
          if (hit) found.push(`${key}: "${hit[0]}" instead of "${term[language]}"`)
        }
      }
    }
  }
  return found
}

describe("the catalogs use the glossary's words", () => {
  it.each(["de", "en"] as const)("%s: no synonym the glossary rules out", (language) => {
    expect(offenders(language)).toEqual([])
  })

  // Widget texts, hand-off intents and model summaries alike.
  it.each(["de", "en"] as const)("%s: the product-wide terms shared with camunda7", (language) => {
    const { ui, model } = CATALOGS[language]
    for (const catalog of [...ui, ...model]) {
      expect(glossaryFindings(catalog, PRODUCT_GLOSSARY[language])).toEqual([])
    }
    expect(blindGlossaryRules(PRODUCT_GLOSSARY[language])).toEqual([])
  })

  it("names every term in GLOSSARY.md, so the document and the check cannot drift", () => {
    const doc = readFileSync(new URL("./GLOSSARY.md", import.meta.url), "utf8")
    for (const term of GLOSSARY) {
      expect(doc, term.de).toContain(term.de)
      expect(doc, term.en).toContain(term.en)
    }
    expect(unnamedGlossaryTerms(doc, [...PRODUCT_GLOSSARY.de, ...PRODUCT_GLOSSARY.en])).toEqual([])
  })

  it("catches a ruled-out synonym (the check is not decoration)", () => {
    const running = GLOSSARY.find((term) => term.de === "laufend")!
    expect(running.avoidDe.some((p) => p.test("Aktiv"))).toBe(true)
    expect(running.avoidDe.some((p) => p.test("Aktivität"))).toBe(false)
    const period = GLOSSARY.find((term) => term.de === "Zeitraum")!
    expect(period.avoidDe.some((p) => p.test("Zeitfenster"))).toBe(true)
  })
})

// The landscape's per-row title names its process, so it must say where the work happens too.
describe("every hand-off title says it goes to the chat", () => {
  it.each([
    ["de", deSweep],
    ["en", enSweep],
  ] as const)("%s", (_language, catalog) => {
    const titles = texts(catalog).filter(([key]) => key === "aLandscape.compareLabel")
    expect(titles.length).toBeGreaterThan(0)
    for (const [key, text] of titles) expect(text, key).toMatch(/chat/i)
  })
})

describe("the German and English catalogs carry the same keys", () => {
  it("sweep and server", () => {
    expect(Object.keys(deSweep).sort()).toEqual(Object.keys(enSweep).sort())
    expect(Object.keys(deServer).sort()).toEqual(Object.keys(enServer).sort())
  })
})
