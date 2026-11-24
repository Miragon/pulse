import { createUseT } from "@miragon/pulse-ui"
import { COUNT_TERMS } from "./temporary/count-terms.ts"

/**
 * The page's words in English and German, the same keys in both (the brand test runs the catalog
 * gates and the product glossary over them). A count reaches an entry formatted, and the entry
 * puts its noun in the right number (`countOf`).
 */

/** A text with `{name}` placeholders, or a function of the values (plurals, conditions). */
export type Message = string | ((params: Readonly<Record<string, unknown>>) => string)

/** A count reaches an entry formatted ("1,234"), so one is decided on its text: exactly "1". */
const isOne = (count: unknown) => String(count) === "1"

/** The count and its noun in the right number: "1 instance", "2 instances". */
export function countOf(count: unknown, one: string, other: string): string {
  return `${String(count)} ${isOne(count) ? one : other}`
}

export const EN = {
  "page.refresh": "Refresh",
  "page.engine": "Engine",
  "page.version": "Latest version",
  "page.missing": "The engine has no process {key}",
  "page.missingDetail": "Check the process key the page reads, or deploy the process.",
  "scope.allVersions": COUNT_TERMS.allVersions.en,
  "section.cut": ({ count }) =>
    `${isOne(count) ? "Only the first row was" : `Only the first ${String(count)} rows were`} read, so the counts here may be too low.`,
  "section.changed":
    "The list changed while the page read it, so the counts here may be too low. Refresh reads it again.",
  "section.sameFailure": "Not read, for the same reason as above.",
  "section.sameFailureKept":
    "The refresh failed for the same reason as above, so this shows the numbers read before.",
  "kpi.now": "Now",
  "kpi.last24h": "Last 24 hours",
  "kpi.running": "Running instances",
  "kpi.incidents": COUNT_TERMS.incidents.long.en,
  "kpi.incidentsWhy": "Open incidents",
  "kpi.withIncident": COUNT_TERMS.withIncident.en,
  "kpi.withIncidentWhy": "Instances with an open incident",
  "kpi.failedJobs": "Jobs without retries",
  "kpi.failedJobsWhy": "No retries left",
  "kpi.openTasks": "Open tasks",
  "kpi.started": "Started",
  "kpi.ended": "Ended",
  "diagram.title": "Diagram",
  "diagram.scope": ({ version }) => `Every version's counts on v${String(version)}`,
  "diagram.label": ({ process, version }) => `${String(process)}, version ${String(version)}`,
  "diagram.drawFailed": "The diagram couldn't be drawn.",
  "diagram.noXml": "The engine has no diagram for this version.",
  "diagram.runningNote":
    "Running counts come from the history: a token that waits before an asynchronous step isn't counted yet.",
  "badge.running": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "instance", "instances")} running`,
  "badge.incidents": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "incident", "incidents")}`,
  "badge.incidentsInCalledInstances": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "incident", "incidents")} in called instances`,
  "legend.label": "Legend",
  "legend.scope": ({ version }) => `Badges count every version, drawn on v${String(version)}.`,
  "legend.running": "waiting here",
  "legend.incidents": "incident here",
  "legend.incidentsInCalledInstances": "incident in a called instance",
  "perDay.title": "Started and ended per day",
  "perDay.scope": "last 14 days",
  "perDay.started": "Started",
  "perDay.ended": "Ended",
  "perDay.chart": "Instances started and ended per day, last 14 days",
  "perDay.day": ({ day, started, ended }) =>
    `${String(day)}: ${String(started)} started, ${String(ended)} ended`,
  "perDay.median": "Median",
  "perDay.p90": "P90",
  "perDay.durationScope": "Duration of the instances that ended in these days",
  "perDay.durationScopeRead": ({ count }) =>
    `Duration of the ${countOf(count, "instance", "instances")} read that ended in these days`,
  "perDay.empty": "No instance started or ended in the last 14 days.",
  "outcomes.title": "End events reached",
  "outcomes.scope": "last 14 days",
  "outcomes.label": "End events reached in the last 14 days, each with its share",
  "outcomes.share": "{count} ({percent})",
  "outcomes.shareOf": ({ count }) =>
    `${isOne(count) ? "The share is of the one end event" : `The shares are of all ${String(count)} end events`} reached. An instance can reach more than one.`,
  "outcomes.empty": "No end event was reached in the last 14 days.",
  "outcomes.emptyHint": "The page counts plain end events only.",
  "incidents.title": "Open incidents by activity",
  "incidents.label": "Activities with open incidents",
  "incidents.activity": "Activity",
  "incidents.count": COUNT_TERMS.incidents.en,
  "incidents.message": "Latest message",
  "incidents.latest": "Latest",
  "incidents.why": "Open incidents",
  "incidents.empty": "No open incidents",
  "incidents.called": ({ activity, count }) =>
    `${String(activity)}: ${countOf(count, "incident", "incidents")} in called instances, counted in the called process.`,
  "tasks.title": "Open tasks",
  "tasks.label": "Open tasks by task",
  "tasks.task": "Task",
  "tasks.count": "Open",
  "tasks.oldest": "Oldest",
  "tasks.empty": "No open tasks",
} satisfies Readonly<Record<string, Message>>

export type MessageKey = keyof typeof EN

export const DE: Readonly<Record<MessageKey, Message>> = {
  "page.refresh": "Aktualisieren",
  "page.engine": "Engine",
  "page.version": "Neueste Version",
  "page.missing": "Die Engine hat keinen Prozess {key}",
  "page.missingDetail":
    "Prüf den Prozessschlüssel, den die Seite liest, oder stell den Prozess bereit.",
  "scope.allVersions": COUNT_TERMS.allVersions.de,
  "section.cut": ({ count }) =>
    `Nur ${isOne(count) ? "die erste Zeile wurde" : `die ersten ${String(count)} Zeilen wurden`} gelesen, die Zahlen hier können also zu niedrig sein.`,
  "section.changed":
    "Die Liste hat sich geändert, während die Seite sie gelesen hat, die Zahlen hier können also zu niedrig sein. Mit Aktualisieren liest die Seite sie neu.",
  "section.sameFailure": "Nicht gelesen, aus demselben Grund wie oben.",
  "section.sameFailureKept":
    "Die Aktualisierung ist aus demselben Grund wie oben fehlgeschlagen, hier stehen die zuvor gelesenen Zahlen.",
  "kpi.now": "Jetzt",
  "kpi.last24h": "Letzte 24 Stunden",
  "kpi.running": "Laufende Instanzen",
  "kpi.incidents": COUNT_TERMS.incidents.long.de,
  "kpi.incidentsWhy": "Offene Incidents",
  "kpi.withIncident": COUNT_TERMS.withIncident.de,
  "kpi.withIncidentWhy": "Instanzen mit offenem Incident",
  "kpi.failedJobs": "Jobs ohne Versuche",
  "kpi.failedJobsWhy": "Keine Versuche mehr",
  "kpi.openTasks": "Offene Aufgaben",
  "kpi.started": "Gestartet",
  "kpi.ended": "Beendet",
  "diagram.title": "Diagramm",
  "diagram.scope": ({ version }) => `Zahlen aller Versionen auf v${String(version)}`,
  "diagram.label": ({ process, version }) => `${String(process)}, Version ${String(version)}`,
  "diagram.drawFailed": "Das Diagramm ließ sich nicht zeichnen.",
  "diagram.noXml": "Die Engine hat kein Diagramm zu dieser Version.",
  "diagram.runningNote":
    "Die laufenden Zahlen kommen aus der Historie: Ein Token, das vor einem asynchronen Schritt wartet, zählt noch nicht.",
  "badge.running": ({ element, count }) =>
    `${String(element)}: ${isOne(count) ? `${String(count)} Instanz läuft` : `${String(count)} Instanzen laufen`}`,
  "badge.incidents": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "Incident", "Incidents")}`,
  "badge.incidentsInCalledInstances": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "Incident", "Incidents")} in aufgerufenen Instanzen`,
  "legend.label": "Legende",
  "legend.scope": ({ version }) =>
    `Die Badges zählen alle Versionen, gezeichnet auf v${String(version)}.`,
  "legend.running": "wartet hier",
  "legend.incidents": "Incident hier",
  "legend.incidentsInCalledInstances": "Incident in einer aufgerufenen Instanz",
  "perDay.title": "Gestartet und beendet pro Tag",
  "perDay.scope": "letzte 14 Tage",
  "perDay.started": "Gestartet",
  "perDay.ended": "Beendet",
  "perDay.chart": "Gestartete und beendete Instanzen pro Tag, letzte 14 Tage",
  "perDay.day": ({ day, started, ended }) =>
    `${String(day)}: ${String(started)} gestartet, ${String(ended)} beendet`,
  "perDay.median": "Median",
  "perDay.p90": "P90",
  "perDay.durationScope": "Dauer der Instanzen, die in diesen Tagen beendet wurden",
  "perDay.durationScopeRead": ({ count }) =>
    `Dauer ${isOne(count) ? "der einen gelesenen Instanz, die" : `der ${String(count)} gelesenen Instanzen, die`} in diesen Tagen beendet ${isOne(count) ? "wurde" : "wurden"}`,
  "perDay.empty": "In den letzten 14 Tagen wurde keine Instanz gestartet oder beendet.",
  "outcomes.title": "Erreichte Endereignisse",
  "outcomes.scope": "letzte 14 Tage",
  "outcomes.label": "Erreichte Endereignisse der letzten 14 Tage, jedes mit seinem Anteil",
  "outcomes.share": "{count} ({percent})",
  "outcomes.shareOf": ({ count }) =>
    `${isOne(count) ? "Der Anteil bezieht sich auf das eine erreichte Endereignis" : `Die Anteile beziehen sich auf alle ${String(count)} erreichten Endereignisse`}. Eine Instanz kann mehr als eines erreichen.`,
  "outcomes.empty": "In den letzten 14 Tagen wurde kein Endereignis erreicht.",
  "outcomes.emptyHint": "Die Seite zählt nur einfache Endereignisse.",
  "incidents.title": "Offene Incidents nach Aktivität",
  "incidents.label": "Aktivitäten mit offenen Incidents",
  "incidents.activity": "Aktivität",
  "incidents.count": COUNT_TERMS.incidents.de,
  "incidents.message": "Letzte Meldung",
  "incidents.latest": "Zuletzt",
  "incidents.why": "Offene Incidents",
  "incidents.empty": "Keine offenen Incidents",
  "incidents.called": ({ activity, count }) =>
    `${String(activity)}: ${countOf(count, "Incident", "Incidents")} in aufgerufenen Instanzen, gezählt im aufgerufenen Prozess.`,
  "tasks.title": "Offene Aufgaben",
  "tasks.label": "Offene Aufgaben nach Aufgabe",
  "tasks.task": "Aufgabe",
  "tasks.count": "Offen",
  "tasks.oldest": "Älteste",
  "tasks.empty": "Keine offenen Aufgaben",
}

export const CATALOGS = { en: EN, de: DE } as const

/** German for a German locale tag (`de`, `de-AT`), English for every other. */
export function translate(
  locale: string,
  key: string,
  params: Record<string, unknown> = {},
): string {
  const catalog: Readonly<Record<string, Message>> = locale.toLowerCase().startsWith("de") ? DE : EN
  const message = catalog[key]
  if (message === undefined) return key
  if (typeof message === "function") return message(params)
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** The page's words in the language of the nearest `LocaleProvider`. */
export const useT: () => (key: MessageKey, params?: Record<string, unknown>) => string =
  createUseT(translate)
