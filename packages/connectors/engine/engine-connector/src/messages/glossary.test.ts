import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  BARE_PAUSE_RULE_EN,
  blindGlossaryRules,
  COUNT_TERMS,
  glossaryFindings,
  PRODUCT_GLOSSARY,
  unnamedGlossaryTerms,
  type GlossaryRule,
} from "@miragon/pulse-ui/testing"
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
  },
  // One word per quantity (D11, D12, X11): a tile, a column and a line call one count alike.
  {
    pattern: /(?<![\p{L}])(Aktivitäten|Prozesse) betroffen/u,
    use: "Betroffene Aktivitäten / Prozesse",
    probe: "Aktivitäten betroffen",
  },
  // No count of new incidents over a day (owner decision 2026-11-20: Camunda 7 counts no root
  // incidents in a window), never a balance with a plus.
  {
    pattern: /[Nn]eu in 24|\+\s*24|Letzte 24/,
    use: "keine Zahl über einen Tag",
    probe: "Neu in 24 Std.",
  },
  { pattern: /24\s?h\b|24 Stunden/, use: "24 Std.", probe: "neu in 24h" },
  {
    // The overview's growth says "neu" as the cluster's tile does.
    pattern: /(?<!neu )in (24 Std\.|der letzten Stunde)/i,
    use: "neu in der letzten Stunde",
    probe: "(3 in der letzten Stunde)",
  },
  { pattern: /Fehlernachricht|Fehlertext/, use: "Fehlermeldung", probe: "Fehlernachricht" },
  {
    // The 30 days' passes are the flow's „Durchlauf“, the day's counts started and completed.
    pattern: /Durchsatz/,
    use: "Gestartet und abgeschlossen (24 Std.) / Durchlauf",
    probe: "Durchsatz (24 Std.):",
  },
  // Camunda 7's own term, never translated.
  {
    pattern: /(?<![\p{L}])[Ee]xterne[nrs]? (Aufgabe|Task)/u,
    use: "External Task",
    probe: "externe Aufgabe",
  },
]

const EN_RULES: readonly GlossaryRule[] = [
  // The cockpit pauses nothing of its own (no live updates, no runs), so any pause or halt here
  // means the engine's suspension; the product rule only flags one next to what it suspends.
  BARE_PAUSE_RULE_EN,
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
  },
  // One word per quantity (D11, D12, X11): a tile, a column and a line call one count alike.
  {
    pattern: /\b(activities|processes) affected\b/i,
    use: "affected activities / processes",
    probe: "Activities affected",
  },
  // No count of new incidents over a day (owner decision 2026-11-20: Camunda 7 counts no root
  // incidents in a window), never a balance with a plus, one spelling of the window.
  { pattern: /\bnew in 24|\+\s*24|\blast 24/i, use: "no count over a day", probe: "New in 24h" },
  { pattern: /\b24 h\b|24 hours/, use: "24h", probe: "Throughput (24 h)" },
  {
    // The overview's growth says "new" as the cluster's tile does.
    pattern: /(?<!new )\bin (24h|the last hour)\b/i,
    use: "new in the last hour",
    probe: "(3 in the last hour)",
  },
  { pattern: /\bfailure message\b/i, use: "error message", probe: "Failure message" },
  {
    // "Throughput" is the flow's 30 days of passes; the day's counts are started and completed.
    pattern: /\bthroughput \(24/i,
    use: "Started and completed (24h)",
    probe: "Throughput (24h):",
  },
]

const LANGUAGES = [
  ["German", catalogs.de, [...PRODUCT_GLOSSARY.de, ...DE_RULES]],
  ["English", catalogs.en, [...PRODUCT_GLOSSARY.en, ...EN_RULES]],
] as const

describe.each(LANGUAGES)("the engine glossary holds in %s", (_language, catalog, rules) => {
  // Shrink-only: an exception that spares nothing comes back as an "unused exception" finding.
  it("uses the glossary terms, never their synonyms", () => {
    expect(glossaryFindings(catalog, rules)).toEqual([])
  })

  it("the gate is not blind: each rule catches its probe", () => {
    expect(blindGlossaryRules(rules)).toEqual([])
  })
})

describe("GLOSSARY.md names every term the gate holds the catalogs to", () => {
  it("the product-wide terms and the engine module's own", () => {
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

/** Owner decision E2 (2026-11-08): the count terms the VS Code webview shares, word for word. */
describe("the count terms", () => {
  it.each([
    ["processInstances.chipWithIncidents", COUNT_TERMS.withIncident],
    ["instanceDetail.tabIncidents", COUNT_TERMS.incidents],
    ["cockpitDefs.colIncidents", COUNT_TERMS.incidents],
    ["incidentsList.colIncidents", COUNT_TERMS.incidents],
    ["fleet.landscape.colIncidents", COUNT_TERMS.incidents],
    ["procIncFlow.modeIncidents", COUNT_TERMS.incidents],
    ["procIncFlow.valuesColIncidents", COUNT_TERMS.incidents],
    // A KPI tile names the same count spelled out, standing alone.
    ["engineHealth.colIncidents", COUNT_TERMS.incidents],
    ["engineHealth.kpiOpenIncidents", COUNT_TERMS.incidents.long],
    ["fleet.landscape.kpiIncidents", COUNT_TERMS.incidents.long],
    ["procIncKpi.openIncidents", COUNT_TERMS.incidents.long],
    ["procIncHeader.allVersions", COUNT_TERMS.allVersions],
    ["processInstances.allVersions", COUNT_TERMS.allVersions],
  ])("%s", (key, term) => {
    expect(catalogs.de[key]).toBe(term.de)
    expect(catalogs.en[key]).toBe(term.en)
  })

  // A process view names the scope of all its counts once, in its bar (`procIncHeader.allVersions`
  // above): its tiles, its flow's caption and its list say no more of it.
  it.each(["cockpitDefs.deployedHint", "fleet.landscape.matrix.hint"])(
    "%s names the version scope of its counts",
    (key) => {
      expect(catalogs.de[key]).toContain(COUNT_TERMS.allVersions.de)
      expect(catalogs.en[key]).toContain(COUNT_TERMS.allVersions.en)
    },
  )
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
    ["fleet.landscape.colFailedJobs", "Jobs ohne Versuche", "Jobs without retries"],
    ["fleet.landscape.colRunning", "Laufend", "Running"],
    // The process flow's mode: what runs at each element now, a count, so "laufend", never "aktiv".
    ["procIncFlow.modeRunning", "Laufend", "Running"],
    ["procIncFlow.valuesColRunning", "Laufend", "Running"],
    // What the last 30 days' instances passed: a cohort read from the history, never "Häufigkeit".
    // The mode reads "Durchlauf · 30 Tage", its window hidden visually in a narrow card.
    ["procIncFlow.modeThroughput", "Durchlauf", "Throughput"],
    ["procIncFlow.modeThroughputWindow", "30 Tage", "30 days"],
    ["procIncFlow.valuesColPassed", "Durchläufe", "Passes"],
    // An engine that refuses the server's login runs (F2): describeError's 401 and 403 in short,
    // never "unreachable".
    ["cockpit.landing.status.unauthorized", "Zugangsdaten abgelehnt", "credentials rejected"],
    ["cockpit.landing.status.forbidden", "Zugriff verweigert", "access denied"],
  ])("%s", (key, german, english) => {
    expect(catalogs.de[key]).toBe(german)
    expect(catalogs.en[key]).toBe(english)
  })
})
