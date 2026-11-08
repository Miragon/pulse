import { sampleParams, type CatalogLanguage } from "./catalog-text.js"
import { COUNT_TERMS } from "./count-terms.js"

/** The glossary gate: one word per thing. Each rule carries a probe so a broken pattern fails instead of passing everything; PRODUCT_GLOSSARY holds the terms every Pulse UI shares (the MCP widgets and the VS Code webview), so a user reads one word per thing across them. */
export interface GlossaryRule {
  pattern: RegExp
  use: string
  /** A text with the synonym: the rule is blind if it does not match. */
  probe: string
  /** Keys that may keep the word, each with why. */
  except?: Readonly<Record<string, string>>
}

export interface GlossaryFinding {
  key: string
  text: string
  /** The glossary term to write instead. */
  use: string
}

/** The verb only: "Deployment" stays the engine's noun. */
const DEPLOY_VERB_DE = /(?<![\p{L}])(ge)?deploy(e|en|st|t|te|ten)?(?![\p{L}])/iu

/** What the engine suspends, as the noun a text names it by. */
const SUSPENDABLE = String.raw`(?:instances?|process(?:es)?|definitions?|versions?|jobs?)`
const PAUSE_WORD = String.raw`(?:paus|halt)(?:e|ed|es|ing|s)?`
/**
 * Pause and halt name the engine's suspension only within three words of what it suspends
 * ("Paused instances", "Instance halted"): the VS Code webview pauses its live updates and halts
 * a bulk run, and those keep their words.
 */
const PAUSED_ENGINE_STATE_EN = new RegExp(
  String.raw`\b${PAUSE_WORD}\b(?:\s+\S+){0,3}?\s+${SUSPENDABLE}\b|\b${SUSPENDABLE}\b(?:\s+\S+){0,3}?\s+${PAUSE_WORD}\b`,
  "i",
)

/**
 * The strict English pause rule, for a UI that pauses nothing of its own (the MCP widgets and
 * their kits: no live updates, no runs), where any "pause" or "halt" means the engine's
 * suspension. Such a UI runs it beside {@link PRODUCT_GLOSSARY}, whose rule spares the VS Code
 * webview's live updates and bulk runs.
 */
export const BARE_PAUSE_RULE_EN: GlossaryRule = {
  pattern: /\b(paus|halt)(e|ed|es|ing|s)?\b/i,
  use: "suspend, suspended",
  probe: "Paused",
}

export const PRODUCT_GLOSSARY: Readonly<Record<CatalogLanguage, readonly GlossaryRule[]>> = {
  de: [
    { pattern: /Vorf[aä]ll/i, use: "Incident", probe: "Offene Vorfälle" },
    { pattern: /(?<![\p{L}])störung/iu, use: "Incident", probe: "Störungen je Prozess" },
    {
      // The jobs whose retries ran out; a single failed job ("dieser Job ist fehlgeschlagen") stays free.
      pattern: /(?<![\p{L}])fehlgeschlagene(n|r|\(r\))?\s+Job(s(?![\p{L}])|\(s\))/iu,
      use: "Jobs ohne Versuche",
      probe: "Häufungen fehlgeschlagener Jobs",
    },
    { pattern: /(?<![\p{L}])tote\s+Jobs/iu, use: "Jobs ohne Versuche", probe: "Tote Jobs" },
    {
      pattern: DEPLOY_VERB_DE,
      use: "bereitstellen, bereitgestellt",
      probe: "auf dieser Engine nicht deployt",
    },
    { pattern: /(?<![\p{L}])GK(?![\p{L}])/u, use: "Geschäftsschlüssel", probe: "GK: 42" },
    { pattern: /Business[ -]?Key/i, use: "Geschäftsschlüssel", probe: "Business Key" },
    {
      pattern: /(?<![\p{L}])[Aa]n(gehalten|halten)/u,
      use: "aussetzen, ausgesetzt",
      probe: "Instanz angehalten",
    },
    { pattern: /pausier/i, use: "aussetzen, ausgesetzt", probe: "Pausiert" },
    { pattern: /[Ww]iederhol/, use: "Versuche, neu versuchen", probe: "Job wiederholen" },
    { pattern: /(?<![\p{L}])retr(y|ies)(?![\p{L}])/iu, use: "Versuche", probe: "3 Retries" },
    { pattern: /Flotte/, use: "alle Engines, Engine-übergreifend", probe: "Flotten-Analyse" },
    {
      // Instances that have an incident; "Aktivitäten mit Incidents" stays free.
      pattern: /(?:^|\d\s+|(?<![\p{L}])Instanzen?\s+)mit\s+Incidents(?![\p{L}])/iu,
      use: COUNT_TERMS.withIncident.de,
      probe: "Mit Incidents",
    },
  ],
  en: [
    {
      pattern: /\bfailed\s+job(s\b|\(s\))/i,
      use: "jobs without retries",
      probe: "Failed jobs",
    },
    { pattern: /\bdead\s+jobs\b/i, use: "jobs without retries", probe: "3 dead jobs" },
    { pattern: /\boccurrences?\b/i, use: "incident", probe: "Occurrences per process" },
    { pattern: /\bBK\b/, use: "business key", probe: "BK: 42" },
    { pattern: PAUSED_ENGINE_STATE_EN, use: "suspend, suspended", probe: "Paused instances" },
    { pattern: /\bfleet\b/i, use: "all engines, cross-engine", probe: "Fleet analysis" },
    {
      // Instances that have an incident; "Activities with incidents" stays free.
      pattern: /(?:^|\d\s+|\binstances?\s+)with\s+incidents\b/i,
      use: COUNT_TERMS.withIncident.en,
      probe: "With incidents",
    },
  ],
}

/** Undefined when the entry needs a real shape (the catalog text test reports that). */
function renderWith(value: (p: unknown) => unknown, n: number): string | undefined {
  try {
    const text = value(sampleParams(n))
    return typeof text === "string" ? text : undefined
  } catch {
    return undefined
  }
}

/** Functions render with 1 and 2 (both forms of a counted entry); `{placeholder}` names are code and drop out. */
function rendered(catalog: object, prefix = ""): [key: string, text: string][] {
  return Object.entries(catalog as Record<string, unknown>).flatMap(
    ([name, value]): [string, string][] => {
      const key = prefix + name
      if (typeof value === "string") return [[key, value.replace(/\{\w+\}/g, "")]]
      if (typeof value === "function") {
        return [1, 2]
          .map((n) => renderWith(value as (p: unknown) => unknown, n))
          .filter((text): text is string => text !== undefined)
          .map((text) => [key, text])
      }
      if (value !== null && typeof value === "object") return rendered(value, `${key}.`)
      return []
    },
  )
}

/** Also reports exceptions that no longer spare a real use (shrink-only). */
export function glossaryFindings(
  catalog: object,
  rules: readonly GlossaryRule[],
): GlossaryFinding[] {
  const texts = rendered(catalog)
  const findings = new Map<string, GlossaryFinding>()
  for (const rule of rules) {
    for (const [key, text] of texts) {
      if (rule.except && key in rule.except) continue
      if (rule.pattern.test(text))
        findings.set(`${key}\u0000${rule.use}`, { key, text, use: rule.use })
    }
    for (const [key, reason] of Object.entries(rule.except ?? {})) {
      const spared = texts.some(([k, text]) => k === key && rule.pattern.test(text))
      if (!spared)
        findings.set(`${key}\u0000except`, { key, text: reason, use: "unused exception" })
    }
  }
  return [...findings.values()]
}

/** The probes `rules` do not catch: a rule whose pattern misses its own probe guards nothing. */
export function blindGlossaryRules(rules: readonly GlossaryRule[]): string[] {
  return rules.filter((rule) => !rule.pattern.test(rule.probe)).map((rule) => rule.probe)
}

/** Glossary words a glossary document does not name, so the document and the gate cannot drift apart. */
export function unnamedGlossaryTerms(doc: string, rules: readonly GlossaryRule[]): string[] {
  const terms = new Set(rules.flatMap((rule) => rule.use.split(", ")))
  return [...terms].filter((term) => !doc.includes(term))
}
