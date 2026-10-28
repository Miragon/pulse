import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  blindGlossaryRules,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
  type GlossaryRule,
} from "@miragon/pulse-widget-shell/testing"
import { catalogs } from "./index.js"

/** Each rule carries a probe it must catch, so a broken pattern fails instead of passing everything. */

const DE_RULES: readonly GlossaryRule[] = [
  { pattern: /[Ff]ortsetz|[Ff]ortgesetzt/, use: "aktivieren", probe: "Instanz fortsetzen" },
  { pattern: /[Aa]uflös|aufgelöst/, use: "als gelöst markieren", probe: "Incident auflösen" },
  { pattern: /(?<![\p{L}])Behoben(?![\p{L}])/u, use: "Als gelöst markiert", probe: "Behoben" },
  { pattern: /^Laden…$/, use: "Wird geladen…", probe: "Laden…" },
  { pattern: /(?<![\p{L}])Bearbeiter/u, use: "zugewiesen an", probe: "Bearbeiter: demo" },
  { pattern: /Health-Check/, use: "Zustand prüfen", probe: "Health-Check" },
  { pattern: /Triagier/, use: "nach Dringlichkeit ordnen", probe: "Triagiere die Jobs" },
  { pattern: /Diagnostizier/, use: "die Ursache finden", probe: "Diagnostiziere den Fehler" },
  {
    // „aktivieren“ (a suspended instance) and „Aktivität“ stay free.
    pattern: /(?<![\p{L}])[Aa]ktiv(e|em|en|er|es)?(?![\p{L}])/u,
    use: "läuft (Instanz)",
    probe: "Aktive Instanzen",
    except: {
      "processList.statusActive": "a deployed definition is active or suspended, it does not run",
    },
  },
]

const EN_RULES: readonly GlossaryRule[] = [
  { pattern: /\bresum(e|ed|es|ing)\b/i, use: "activate", probe: "Resume instance" },
  {
    pattern: /^(Resolved|Resolve|Retried|Fix)$/,
    use: "Marked as resolved / Retry scheduled",
    probe: "Resolve",
  },
  { pattern: /\bassignee:/i, use: "assigned to", probe: "assignee: demo" },
  { pattern: /^Health check$/i, use: "check health", probe: "Health check" },
  {
    pattern: /\bactive\b/i,
    use: "running (instance)",
    probe: "3 active instances",
    except: {
      "processList.statusActive": "a deployed definition is active or suspended, it does not run",
    },
  },
]

const LANGUAGES = [
  ["German", catalogs.de, [...PRODUCT_GLOSSARY.de, ...DE_RULES]],
  ["English", catalogs.en, [...PRODUCT_GLOSSARY.en, ...EN_RULES]],
] as const

describe.each(LANGUAGES)("the camunda7 glossary holds in %s", (_language, catalog, rules) => {
  // Shrink-only: an exception that spares nothing comes back as an "unused exception" finding.
  it("uses the glossary terms, never their synonyms", () => {
    expect(glossaryFindings(catalog, rules)).toEqual([])
  })

  it("the gate is not blind: each rule catches its probe", () => {
    expect(blindGlossaryRules(rules)).toEqual([])
  })
})

describe("GLOSSARY.md names every term the gate holds the catalogs to", () => {
  it("the product-wide terms and camunda7's own", () => {
    const doc = readFileSync(new URL("./GLOSSARY.md", import.meta.url), "utf8")
    expect(unnamedGlossaryTerms(doc, [...PRODUCT_GLOSSARY.de, ...PRODUCT_GLOSSARY.en])).toEqual([])
  })
})

describe("the glossary rules spare the glossary terms", () => {
  it.each([
    // aktivieren is the glossary verb for a suspended instance; Aktivität the BPMN element.
    ["Instanz aktivieren", LANGUAGES[0][2]],
    ["Aktivitäten mit Incidents", LANGUAGES[0][2]],
    // Deployment is the engine's noun, not the verb.
    ["Deployment löschen", LANGUAGES[0][2]],
    ["Activate instance", LANGUAGES[1][2]],
    ["Activities with incidents", LANGUAGES[1][2]],
  ])("%s", (text, rules) => {
    expect(rules.filter((rule) => rule.pattern.test(text)).map((r) => r.use)).toEqual([])
  })
})

/** Owner decision (#322 U5): marking an incident resolved never claims a fix. */
describe("the decided wording", () => {
  it.each([
    ["incidentDetail.resolved", "Als gelöst markiert", "Marked as resolved"],
    ["procIncTable.resolved", "Als gelöst markiert", "Marked as resolved"],
    ["procIncTable.resolve", "Als gelöst markieren", "Mark as resolved"],
    ["incidentFailure.resolveButton", "Als gelöst markieren", "Mark as resolved"],
    ["confirmDialog.resolveConfirm", "Als gelöst markieren", "Mark as resolved"],
    ["value.yes", "Ja", "Yes"],
    ["value.no", "Nein", "No"],
    // Same name as the metric camunda_jobs_failed in analytics' landscape.
    ["fleet.failedJobs", "Jobs ohne Versuche", "Jobs without retries"],
  ])("%s", (key, german, english) => {
    expect(catalogs.de[key]).toBe(german)
    expect(catalogs.en[key]).toBe(english)
  })
})
