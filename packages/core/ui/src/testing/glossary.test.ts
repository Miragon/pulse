import { describe, expect, it } from "vitest"
import { COUNT_TERMS } from "./count-terms.js"
import {
  BARE_PAUSE_RULE_EN,
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
} from "./glossary.js"

describe("PRODUCT_GLOSSARY: the terms every Pulse UI shares", () => {
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
    // Pause and halt stay free where no engine state is meant: the VS Code webview's live updates and bulk runs.
    ["Pause live updates", "en"],
    ["Paused · as of 10:42", "en"],
    ["Live updates are paused while you edit a variable.", "en"],
    ["Live updates are paused while you edit a variable of this instance.", "en"],
    [" · live updates are paused", "en"],
    ["Paused until the engine accepts the login again.", "en"],
    ["The engine keeps the halted operation. Stop again to remove it.", "en"],
    ["Can't be undone; Stop only halts the rest.", "en"],
    ["Suspended instances", "en"],
    // The count terms: instances that have an incident, never another thing that has incidents.
    ["With incident", "en"],
    ["Instances with an incident", "en"],
    ["Activities with incidents", "en"],
    ["Open incidents", "en"],
    ["Mit Incident", "de"],
    ["Aktivitäten mit Incidents", "de"],
    // A refused profile; the engine rejecting the credentials keeps its own words.
    ["ihr Profil ist abgelehnt", "de"],
    ["Profil abgelehnt", "de"],
    ["its profile is refused", "en"],
    ["The engine rejected the credentials", "en"],
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
    ["Paused instances", "en", "suspend, suspended"],
    ["Instance halted", "en", "suspend, suspended"],
    ["3 instances are paused", "en", "suspend, suspended"],
    ["Pause this process instance", "en", "suspend, suspended"],
    ["Pausing the definition stops new instances", "en", "suspend, suspended"],
    ["The job halts", "en", "suspend, suspended"],
    ["With incidents", "en", "With incident"],
    ["12 with incidents", "en", "With incident"],
    ["Instances with incidents", "en", "With incident"],
    ["Mit Incidents", "de", "Mit Incident"],
    ["Instanzen mit Incidents", "de", "Mit Incident"],
    ["Das Profil der Engine ist ungültig", "de", "abgelehnt"],
    ["Ungültiges Profil", "de", "abgelehnt"],
    ["The engine's profile was rejected", "en", "refused"],
    ["Invalid profile", "en", "refused"],
  ] as const)("flags %s", (text, language, use) => {
    expect(glossaryFindings({ text }, PRODUCT_GLOSSARY[language]).map((f) => f.use)).toEqual([use])
  })
})

describe("BARE_PAUSE_RULE_EN: the strict rule for a UI that pauses nothing of its own", () => {
  it("is not blind", () => {
    expect(blindGlossaryRules([BARE_PAUSE_RULE_EN])).toEqual([])
  })

  it.each(["Pause live updates", "Paused", "Can't be undone; Stop only halts the rest."])(
    "flags %s, which PRODUCT_GLOSSARY spares",
    (text) => {
      expect(glossaryFindings({ text }, PRODUCT_GLOSSARY.en)).toEqual([])
      expect(glossaryFindings({ text }, [BARE_PAUSE_RULE_EN]).map((f) => f.use)).toEqual([
        "suspend, suspended",
      ])
    },
  )

  it("speaks of the same suspension as the product rule", () => {
    const uses = PRODUCT_GLOSSARY.en.map((rule) => rule.use)
    expect(uses).toContain(BARE_PAUSE_RULE_EN.use)
  })
})

describe("COUNT_TERMS: one word per count (owner decision E2)", () => {
  const terms = Object.values(COUNT_TERMS)

  it.each(["de", "en"] as const)("%s: no word names two counts", (language) => {
    const words = terms.flatMap((term) =>
      [term[language], ...("long" in term ? [term.long[language]] : [])].map((word) =>
        word.toLowerCase(),
      ),
    )
    expect(new Set(words).size).toBe(words.length)
  })

  it.each(["de", "en"] as const)("%s: a long form names its count, never another", (language) => {
    const { incidents, withIncident } = COUNT_TERMS
    expect(incidents.long[language].toLowerCase()).toContain(incidents[language].toLowerCase())
    expect(
      glossaryFindings({ text: incidents.long[language] }, PRODUCT_GLOSSARY[language]),
    ).toEqual([])
    expect(incidents.long[language]).not.toBe(withIncident[language])
  })

  it.each(["de", "en"] as const)(
    "%s: the glossary holds a count's near miss to its word",
    (language) => {
      const uses = PRODUCT_GLOSSARY[language].map((rule) => rule.use)
      expect(uses).toContain(COUNT_TERMS.withIncident[language])
    },
  )

  it("says what each word counts", () => {
    expect(terms.filter((term) => term.counts.trim() === "")).toEqual([])
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
