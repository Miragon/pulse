import { describe, expect, it } from "vitest"
import {
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
} from "./glossary.js"

describe("PRODUCT_GLOSSARY: the terms every module's views share", () => {
  it.each(["de", "en"] as const)("%s: the gate is not blind, each rule catches its probe", (l) => {
    expect(blindGlossaryRules(PRODUCT_GLOSSARY[l])).toEqual([])
  })

  it.each([
    // The engine's noun stays; only the verb has a glossary word.
    ["Deployment löschen", "de"],
    ["Vor/Nach-Deployment-Vergleich", "de"],
    // A single job that failed is not the quantity "Jobs ohne Versuche".
    ["Erklär, warum dieser Job fehlgeschlagen ist", "de"],
    ["Entwirf ein Ticket für diesen fehlgeschlagenen Job", "de"],
    ["Keine Versuche mehr", "de"],
    ["3 Jobs ohne Versuche", "de"],
    ["Auf dieser Engine nicht bereitgestellt", "de"],
    ["Draft a ticket for this failed job", "en"],
    ["Jobs without retries", "en"],
    ["Retry job", "en"],
    ["Pre/post deployment comparison", "en"],
  ] as const)("spares the glossary words: %s", (text, language) => {
    expect(glossaryFindings({ text }, PRODUCT_GLOSSARY[language])).toEqual([])
  })

  it.each([
    ["Fehlgeschlagene Jobs", "de", "Jobs ohne Versuche"],
    ["{n} fehlgeschlagene(r) Job(s)", "de", "Jobs ohne Versuche"],
    ["auf dieser Engine nicht deployt", "de", "bereitstellen, bereitgestellt"],
    ["Sobald du ein Modell deployst", "de", "bereitstellen, bereitgestellt"],
    ["Failed jobs", "en", "jobs without retries"],
    ["{n} failed job(s)", "en", "jobs without retries"],
  ] as const)("flags %s", (text, language, use) => {
    expect(glossaryFindings({ text }, PRODUCT_GLOSSARY[language]).map((f) => f.use)).toEqual([use])
  })
})

describe("glossaryFindings", () => {
  const rules = [{ pattern: /Vorfall/, use: "Incident", probe: "Vorfall" }]

  it("walks nested catalogs and renders counted entries in both forms", () => {
    const catalog = {
      flat: "Ein Vorfall",
      nested: { deep: "Kein Vorfall" },
      counted: ({ count }: { count: number }) => (count === 1 ? "1 Vorfall" : `${count} Incidents`),
      clean: "Offene Incidents",
      number: 42,
    }
    expect(glossaryFindings(catalog, rules).map((f) => f.key)).toEqual([
      "flat",
      "nested.deep",
      "counted",
    ])
  })

  it("spares a key a rule names, and reports an exception that spares nothing", () => {
    const spared = [{ ...rules[0], except: { a: "the engine's own term" } }]
    expect(glossaryFindings({ a: "Vorfall" }, spared)).toEqual([])
    expect(glossaryFindings({ a: "Incident" }, spared)).toEqual([
      { key: "a", text: "the engine's own term", use: "unused exception" },
    ])
  })

  // An entry that needs a real shape is the catalog text test's render-error.
  it("renders a positional parameter and skips an entry that needs a real shape", () => {
    const catalog = {
      positional: (message: string) => `Vorfall (${message})`,
      shaped: ({ list }: { list: string[] }) => `Vorfall: ${list.join(", ")}`,
    }
    expect(glossaryFindings(catalog, rules).map((f) => f.key)).toEqual(["positional"])
  })

  it("drops {placeholder} names (code, not copy)", () => {
    expect(glossaryFindings({ a: "{Vorfall} offen" }, rules)).toEqual([])
  })

  it("names the glossary words a document leaves out", () => {
    const rules = [{ pattern: /x/, use: "bereitstellen, bereitgestellt", probe: "x" }]
    expect(unnamedGlossaryTerms("| bereitstellen | …", rules)).toEqual(["bereitgestellt"])
    expect(unnamedGlossaryTerms("bereitstellen, bereitgestellt", rules)).toEqual([])
  })

  it("names a rule whose pattern misses its probe", () => {
    expect(blindGlossaryRules([{ pattern: /x/, use: "y", probe: "z" }])).toEqual(["z"])
  })
})
