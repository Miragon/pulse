import type { GlossaryLanguage } from "./catalog.js"
import { COUNT_TERMS } from "./count-terms.js"

/**
 * A rule of the glossary gate: one word per thing. Each rule carries a probe so a broken pattern
 * fails instead of passing everything; PRODUCT_GLOSSARY holds the terms every Pulse UI shares (the
 * MCP widgets, the web app, the VS Code webview and a page on the kit), so a user reads one word
 * per thing across them.
 */
export interface GlossaryRule {
  pattern: RegExp
  /** The word to write instead, its forms joined by ", ". */
  use: string
  /** A text with the synonym: the rule is blind if it does not match. */
  probe: string
  /** Keys that may keep the word, each with why. */
  except?: Readonly<Record<string, string>>
  /**
   * The words it replaces as a person writes them, each one a text `pattern` catches
   * (`blindGlossaryRules` holds that): what the glossary's table lists.
   */
  replaces?: readonly string[]
  /** Where the rule stops, in one sentence for the glossary's table: the uses that keep their word. */
  note?: string
}

/** A rule of the product glossary: it always names the words it replaces. */
type ProductRule = GlossaryRule & { readonly replaces: readonly string[] }

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
 * their kits, a page on the kit: no live updates, no runs), where any "pause" or "halt" means the
 * engine's suspension. Such a UI runs it beside {@link PRODUCT_GLOSSARY}, whose rule spares the VS
 * Code webview's live updates and bulk runs.
 */
export const BARE_PAUSE_RULE_EN: ProductRule = {
  pattern: /\b(paus|halt)(e|ed|es|ing|s)?\b/i,
  use: "suspend, suspended",
  probe: "Paused",
  replaces: ["pause", "paused", "halt"],
  note: "For a UI that pauses nothing of its own, beside the product rules: any pause or halt there is the engine's suspension.",
}

/**
 * An instance or a step that ended without completing is cancelled, abgebrochen, in every Pulse
 * UI and in `StateLabel` (the cockpit said "Canceled", the VS Code webview "Terminated"). Only a
 * word a person reads counts: a label in capitals or a phrase; the engine's code values
 * ("terminated", `canceled`) in a source stay free.
 */
const CANCELLED_EN =
  /\b(?:Terminated|Canceled)\b|\b(?:was|were|been|is|are|got)\s+(?:terminated|canceled)\b/
const CANCELLED_DE = /(?<![\p{L}])terminiert/iu
const CANCELLED_NOTE = "The engine's values in code (terminated, canceled) stay free."

/**
 * An instance or a step that runs is running, läuft (the VS Code webview's history said
 * "Active"): a state label alone, so a filter that is active ("3 active") stays free.
 */
const RUNNING_EN = /^\s*Active\s*$/
const RUNNING_DE = /^\s*Aktiv\s*$/
const RUNNING_NOTE = "A state label alone: a filter that is active stays free."

/**
 * An engine profile a surface does not use is refused, abgelehnt (the MCP server's
 * ENGINE_PROFILE_REFUSED, a profile Pulse for VS Code cannot serve); the engine rejecting
 * credentials keeps its own words.
 */
const REFUSED_PROFILE_DE =
  /Profil[\p{L}]*\s+(?:\S+\s+){0,3}?(?:verworfen|zurückgewiesen|abgewiesen|ungültig)|(?:verworfen|zurückgewiesen|abgewiesen|ungültig)\S*\s+(?:\S+\s+){0,3}?Profil/iu
const REFUSED_PROFILE_EN =
  /\bprofile\b\s+(?:\S+\s+){0,3}?(?:rejected|declined|invalid)\b|\b(?:rejected|declined|invalid)\s+(?:\S+\s+){0,3}?profile\b/i
const REFUSED_PROFILE_NOTE =
  "An engine profile a surface does not use; the engine rejecting credentials keeps its own words."

const FAILED_JOBS_NOTE =
  "The jobs whose retries ran out, as a quantity: a single job that failed keeps its words."
const WITH_INCIDENT_NOTE =
  "The count of instances that have an open incident; other things with incidents keep the plural."

/**
 * The product glossary, per language: each rule's word (`use`), the words it replaces
 * (`replaces`, the table at https://miragon.github.io/pulse/glossary) and the pattern that finds
 * them in a catalog (`glossaryFindings`).
 */
export const PRODUCT_GLOSSARY: Readonly<Record<GlossaryLanguage, readonly ProductRule[]>> = {
  de: [
    {
      pattern: /Vorf[aä]ll/i,
      use: "Incident",
      probe: "Offene Vorfälle",
      replaces: ["Vorfall", "Vorfälle"],
    },
    {
      pattern: /(?<![\p{L}])störung/iu,
      use: "Incident",
      probe: "Störungen je Prozess",
      replaces: ["Störung"],
    },
    {
      // The jobs whose retries ran out; a single failed job ("dieser Job ist fehlgeschlagen") stays free.
      pattern: /(?<![\p{L}])fehlgeschlagene(n|r|\(r\))?\s+Job(s(?![\p{L}])|\(s\))/iu,
      use: "Jobs ohne Versuche",
      probe: "Häufungen fehlgeschlagener Jobs",
      replaces: ["fehlgeschlagene Jobs"],
      note: FAILED_JOBS_NOTE,
    },
    {
      pattern: /(?<![\p{L}])tote\s+Jobs/iu,
      use: "Jobs ohne Versuche",
      probe: "Tote Jobs",
      replaces: ["tote Jobs"],
    },
    {
      pattern: DEPLOY_VERB_DE,
      use: "bereitstellen, bereitgestellt",
      probe: "auf dieser Engine nicht deployt",
      replaces: ["deployen", "deployt"],
      note: "The verb only: the result stays a Deployment, the engine's noun.",
    },
    {
      pattern: /(?<![\p{L}])GK(?![\p{L}])/u,
      use: "Geschäftsschlüssel",
      probe: "GK: 42",
      replaces: ["GK"],
    },
    {
      pattern: /Business[ -]?Key/i,
      use: "Geschäftsschlüssel",
      probe: "Business Key",
      replaces: ["Business Key"],
    },
    {
      pattern: /(?<![\p{L}])[Aa]n(gehalten|halten)/u,
      use: "aussetzen, ausgesetzt",
      probe: "Instanz angehalten",
      replaces: ["anhalten", "angehalten"],
    },
    {
      pattern: /pausier/i,
      use: "aussetzen, ausgesetzt",
      probe: "Pausiert",
      replaces: ["pausieren", "pausiert"],
    },
    {
      pattern: /[Ww]iederhol/,
      use: "Versuche, neu versuchen",
      probe: "Job wiederholen",
      replaces: ["wiederholen", "Wiederholungen"],
    },
    {
      pattern: /(?<![\p{L}])retr(y|ies)(?![\p{L}])/iu,
      use: "Versuche",
      probe: "3 Retries",
      replaces: ["Retry", "Retries"],
    },
    {
      pattern: /Flotte/,
      use: "alle Engines, Engine-übergreifend",
      probe: "Flotten-Analyse",
      replaces: ["Flotte"],
    },
    {
      // Instances that have an incident; "Aktivitäten mit Incidents" stays free.
      pattern: /(?:^|\d\s+|(?<![\p{L}])Instanzen?\s+)mit\s+Incidents(?![\p{L}])/iu,
      use: COUNT_TERMS.withIncident.de,
      probe: "Mit Incidents",
      replaces: ["Mit Incidents", "Instanzen mit Incidents"],
      note: WITH_INCIDENT_NOTE,
    },
    {
      pattern: REFUSED_PROFILE_DE,
      use: "abgelehnt",
      probe: "Ihr Profil wurde verworfen",
      replaces: ["Profil verworfen", "ungültiges Profil"],
      note: REFUSED_PROFILE_NOTE,
    },
    {
      pattern: CANCELLED_DE,
      use: "abgebrochen",
      probe: "Instanz terminiert",
      replaces: ["terminiert"],
      note: CANCELLED_NOTE,
    },
    {
      pattern: RUNNING_DE,
      use: "läuft",
      probe: "Aktiv",
      replaces: ["Aktiv"],
      note: RUNNING_NOTE,
    },
  ],
  en: [
    {
      pattern: /\bfailed\s+job(s\b|\(s\))/i,
      use: "jobs without retries",
      probe: "Failed jobs",
      replaces: ["failed jobs"],
      note: FAILED_JOBS_NOTE,
    },
    {
      pattern: /\bdead\s+jobs\b/i,
      use: "jobs without retries",
      probe: "3 dead jobs",
      replaces: ["dead jobs"],
    },
    {
      pattern: /\boccurrences?\b/i,
      use: "incident",
      probe: "Occurrences per process",
      replaces: ["occurrence"],
    },
    { pattern: /\bBK\b/, use: "business key", probe: "BK: 42", replaces: ["BK"] },
    {
      pattern: PAUSED_ENGINE_STATE_EN,
      use: "suspend, suspended",
      probe: "Paused instances",
      replaces: ["paused instances", "halt a job"],
      note: "Next to what the engine suspends (an instance, a process, a definition, a version, a job): live updates and bulk runs keep pause and halt.",
    },
    {
      pattern: /\bfleet\b/i,
      use: "all engines, cross-engine",
      probe: "Fleet analysis",
      replaces: ["fleet"],
    },
    {
      // Instances that have an incident; "Activities with incidents" stays free.
      pattern: /(?:^|\d\s+|\binstances?\s+)with\s+incidents\b/i,
      use: COUNT_TERMS.withIncident.en,
      probe: "With incidents",
      replaces: ["With incidents", "instances with incidents"],
      note: WITH_INCIDENT_NOTE,
    },
    {
      pattern: REFUSED_PROFILE_EN,
      use: "refused",
      probe: "Its profile was rejected",
      replaces: ["rejected profile", "invalid profile"],
      note: REFUSED_PROFILE_NOTE,
    },
    {
      pattern: CANCELLED_EN,
      use: "cancelled",
      probe: "Terminated",
      replaces: ["Terminated", "Canceled"],
      note: CANCELLED_NOTE,
    },
    {
      pattern: RUNNING_EN,
      use: "running",
      probe: "Active",
      replaces: ["Active"],
      note: RUNNING_NOTE,
    },
  ],
}
