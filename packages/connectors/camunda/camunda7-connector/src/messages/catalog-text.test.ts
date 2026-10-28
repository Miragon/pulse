import { describe, expect, it } from "vitest"
import { catalogTextFindings } from "@miragon/pulse-widget-shell/testing"
import { en } from "./en.js"
import { de } from "./de.js"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"
import { enBuilder } from "./en.builder.js"
import { deBuilder } from "./de.builder.js"
import { enFeedback } from "./en.feedback.js"
import { deFeedback } from "./de.feedback.js"
import { catalogs } from "./index.js"
import { countOf, isOne } from "./plural.js"

/**
 * brand-lint reads Markdown only, so this test is the gate. Function entries render with 1 and
 * 2, so a missing plural shows up as "1 incidents".
 */
describe("camunda7 copy follows the voice rules", () => {
  it.each([
    ["shell + summaries (en)", en, "en"],
    ["shell + summaries (de)", de, "de"],
    ["widgets (en)", enSweep, "en"],
    ["widgets (de)", deSweep, "de"],
    ["chat hand-offs (en)", enAskAi, "en"],
    ["chat hand-offs (de)", deAskAi, "de"],
    ["view builder names (en)", enBuilder, "en"],
    ["view builder names (de)", deBuilder, "de"],
    ["write toasts (en)", enFeedback, "en"],
    ["write toasts (de)", deFeedback, "de"],
  ] as const)("%s", (_, catalog, language) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })
})

describe("both languages cover every key", () => {
  const enKeys = Object.keys(catalogs.en)
  const deKeys = Object.keys(catalogs.de)

  // The half-English cockpit of #322 U3.
  it("every English key has its German entry", () => {
    expect(enKeys.filter((key) => !deKeys.includes(key))).toEqual([])
  })

  it("every German key has its English entry", () => {
    expect(deKeys.filter((key) => !enKeys.includes(key))).toEqual([])
  })

  it("the merged catalogs keep no plural pair split over two keys", () => {
    const pairs = enKeys.filter((key) => /(One|Singular)$/.test(key))
    expect(pairs).toEqual([])
  })
})

describe("plural helper", () => {
  it("reads one from a number and from a formatted count, never from 1.234", () => {
    expect(isOne(1)).toBe(true)
    expect(isOne("1")).toBe(true)
    expect(isOne(0)).toBe(false)
    expect(isOne("1.234")).toBe(false)
    expect(isOne("1,234")).toBe(false)
  })

  it("puts the noun in the number the count asks for", () => {
    expect(countOf(1, "Prozess", "Prozesse")).toBe("1 Prozess")
    expect(countOf(2, "Prozess", "Prozesse")).toBe("2 Prozesse")
    expect(countOf("1.234", "Instanz", "Instanzen")).toBe("1.234 Instanzen")
    expect(countOf(0, "incident", "incidents")).toBe("0 incidents")
  })
})
