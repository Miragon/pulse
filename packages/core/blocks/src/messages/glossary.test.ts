import { readFileSync } from "node:fs"
import {
  blindGlossaryRules,
  catalogTextFindings,
  COUNT_TERMS,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
  type GlossaryRule,
} from "@miragon/pulse-ui/testing"
import { describe, expect, it } from "vitest"
import { de } from "./de.js"
import { en, isOne } from "./en.js"
import { instanceDe } from "./instance-de.js"
import { instanceEn } from "./instance-en.js"
import { instanceTranslate } from "./instance-words.js"
import { humanized } from "./message.js"
import { screenDe } from "./screen-de.js"
import { screenEn } from "./screen-en.js"
import { screenTranslate } from "./screen-words.js"

/**
 * The engine module's own rules that hold for the tiles too, each with a probe it must catch. The
 * tiles pause nothing of their own, so any pause means the engine's suspension.
 */
const DE_RULES: readonly GlossaryRule[] = [
  { pattern: /[Ff]ortsetz|[Ff]ortgesetzt/, use: "aktivieren", probe: "Instanz fortsetzen" },
  { pattern: /^Laden…$/, use: "Wird geladen…", probe: "Laden…" },
  {
    pattern: /(?<![\p{L}])[Aa]ktiv(e|em|en|er|es)?(?![\p{L}])/u,
    use: "läuft (Instanz)",
    probe: "Aktive Instanzen",
  },
]

const EN_RULES: readonly GlossaryRule[] = [
  { pattern: /\bresum(e|ed|es|ing)\b/i, use: "activate", probe: "Resume instance" },
  { pattern: /\bactive\b/i, use: "running (instance)", probe: "3 active instances" },
]

const LANGUAGES = [
  ["the tiles' German", de, [...PRODUCT_GLOSSARY.de, ...DE_RULES]],
  ["the tiles' English", en, [...PRODUCT_GLOSSARY.en, ...EN_RULES]],
  ["the screens' German", screenDe, [...PRODUCT_GLOSSARY.de, ...DE_RULES]],
  ["the screens' English", screenEn, [...PRODUCT_GLOSSARY.en, ...EN_RULES]],
  ["an instance's German", instanceDe, [...PRODUCT_GLOSSARY.de, ...DE_RULES]],
  ["an instance's English", instanceEn, [...PRODUCT_GLOSSARY.en, ...EN_RULES]],
] as const

describe.each(LANGUAGES)("the glossary holds in %s", (_language, catalog, rules) => {
  it("uses the glossary terms, never their synonyms", () => {
    expect(glossaryFindings(catalog, rules)).toEqual([])
  })

  it("the gate is not blind: each rule catches its probe", () => {
    expect(blindGlossaryRules(rules)).toEqual([])
  })
})

describe("the tiles' words", () => {
  it("follow the voice rules in both languages (du, AI, no dash as a connector, the plural)", () => {
    expect(catalogTextFindings(en, { language: "en" })).toEqual([])
    expect(catalogTextFindings(de, { language: "de" })).toEqual([])
  })

  it("have a German entry for every English key and no other", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  })

  it("name the count of instances with an open incident with the count term every Pulse UI uses", () => {
    const inSentence = (term: string) => `${term.charAt(0).toLowerCase()}${term.slice(1)}`
    expect([en["title.instanceSummary"], en.withIncident]).toEqual([
      `Instances ${inSentence(COUNT_TERMS.withIncident.en)}`,
      inSentence(COUNT_TERMS.withIncident.en),
    ])
    expect([de["title.instanceSummary"], de.withIncident]).toEqual([
      `Instanzen ${inSentence(COUNT_TERMS.withIncident.de)}`,
      inSentence(COUNT_TERMS.withIncident.de),
    ])
  })

  it("read one from a formatted count, never from 1,234", () => {
    expect([isOne(1), isOne("1"), isOne("1,234"), isOne("1.234"), isOne(0)]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe("GLOSSARY.md names every term the gate holds the words to", () => {
  it("the product-wide terms", () => {
    const doc = readFileSync(new URL("./GLOSSARY.md", import.meta.url), "utf8")
    expect(unnamedGlossaryTerms(doc, [...PRODUCT_GLOSSARY.de, ...PRODUCT_GLOSSARY.en])).toEqual([])
  })
})

describe("the screens' words", () => {
  it("follow the voice rules in both languages (du, no dash as a connector, the plural)", () => {
    expect(catalogTextFindings(screenEn, { language: "en" })).toEqual([])
    expect(catalogTextFindings(screenDe, { language: "de" })).toEqual([])
  })

  it("have a German entry for every English key and no other", () => {
    expect(Object.keys(screenDe).sort()).toEqual(Object.keys(screenEn).sort())
  })

  it("name the instances with incident and the version scope with the count terms every Pulse UI uses", () => {
    const counts = { processes: "4", running: "1,274", withIncident: "17" }
    expect([screenEn["column.withIncident"], screenEn["processes.scope.withIncident"]]).toEqual([
      COUNT_TERMS.withIncident.en,
      COUNT_TERMS.withIncident.en,
    ])
    expect([screenDe["column.withIncident"], screenDe["processes.scope.withIncident"]]).toEqual([
      COUNT_TERMS.withIncident.de,
      COUNT_TERMS.withIncident.de,
    ])
    expect(screenTranslate("en", "processes.summary", counts)).toMatch(
      new RegExp(` · ${COUNT_TERMS.allVersions.en}$`),
    )
    expect(screenTranslate("de", "processes.summary", counts)).toMatch(
      new RegExp(` · ${COUNT_TERMS.allVersions.de}$`),
    )
  })
})

describe("an instance's words", () => {
  it("follow the voice rules in both languages (du, no dash as a connector, the plural)", () => {
    expect(catalogTextFindings(instanceEn, { language: "en" })).toEqual([])
    expect(catalogTextFindings(instanceDe, { language: "de" })).toEqual([])
  })

  it("have a German entry for every English key and no other", () => {
    expect(Object.keys(instanceDe).sort()).toEqual(Object.keys(instanceEn).sort())
  })

  it("put the noun in the number its count has, in both languages", () => {
    const words = (locale: string, key: string, count: string) =>
      instanceTranslate(locale, key, { count })
    expect([
      words("en", "headline.incidents", "1"),
      words("en", "headline.incidents", "1,204"),
    ]).toEqual(["1 incident", "1,204 incidents"])
    expect([words("de", "wait.retriesLeft", "1"), words("de", "wait.retriesLeft", "0")]).toEqual([
      "1 Versuch übrig",
      "0 Versuche übrig",
    ])
    expect([words("en", "called.menu", "1"), words("de", "called.menu", "2")]).toEqual([
      "1 called instance",
      "2 aufgerufene Instanzen",
    ])
  })

  it("read an engine's code no catalog names in words, as the editors did", () => {
    expect(
      ["failedJob", "JOB_NO_RETRIES", "failed-external_task", "callActivity2Failed"].map(humanized),
    ).toEqual(["Failed job", "Job no retries", "Failed external task", "Call activity2 failed"])
    expect(instanceTranslate("en", "incident.type", { type: "failedExternalTask" })).toBe(
      "Failed external task",
    )
    expect(instanceTranslate("de", "incident.type", { type: "failedExternalTask" })).toBe(
      "Fehlgeschlagene externe Aufgabe",
    )
  })
})
