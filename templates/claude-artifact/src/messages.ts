import { createUseT } from "@miragon/pulse-ui"
import { COUNT_TERMS } from "@miragon/pulse-ui/glossary"

/**
 * The page's words in English and German, the same keys in both (the brand test runs the catalog
 * gates and the product glossary over them). The count words are the product's (`COUNT_TERMS` of
 * pulse-ui's glossary); the words of the kit's parts (a section's states, the diagram's badges and
 * legend, a refused call) are the kit's own. A count reaches an entry formatted, and the entry puts
 * its noun in the right number (`countOf`).
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
  "scope.allVersions": COUNT_TERMS.allVersions.en,
  "kpi.title": "Key figures",
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
  "diagram.noXml": "The engine has no diagram for this version.",
  "legend.scope": ({ version }) => `Badges count every version, drawn on v${String(version)}.`,
  "perDay.title": "Started and ended per day",
  "perDay.scope": "last 14 days",
  "perDay.started": "Started",
  "perDay.ended": "Ended",
  "perDay.chart": "Instances started and ended per day, last 14 days",
  "perDay.day": "Day",
  "perDay.median": "Median",
  "perDay.p90": "P90",
  "perDay.durationScope": ({ count }) =>
    `Duration of the ${countOf(count, "instance", "instances")} that ended in these days`,
  "perDay.durationSince": ({ count, date }) =>
    `Duration of the ${countOf(count, "instance", "instances")} that ended since ${String(date)}, from when the engine keeps their history`,
  "perDay.durationUnknown": "No duration of these days is known.",
  "perDay.noHistory":
    "The engine writes no history, so how many instances started and ended is not known.",
  "perDay.historyCut": ({ date }) =>
    `The engine keeps history from ${String(date)}, so the days before count at least what it kept.`,
  "perDay.empty": "No instance started or ended in the last 14 days.",
  "outcomes.title": "End events reached",
  "outcomes.scope": "last 14 days",
  "outcomes.label": "End events the instances that ended in the last 14 days reached",
  "outcomes.shareOf": ({ count }) =>
    `Each share is of the ${countOf(count, "instance", "instances")} that ended. An instance can reach more than one end event.`,
  "outcomes.noShare":
    "The engine's history of these days is not whole, so no share is shown: the bars compare the end events.",
  "outcomes.empty": "No instance ended in the last 14 days.",
  "outcomes.noEndEvent":
    "Instances ended in the last 14 days, but none reached an end event: they were cancelled or deleted.",
  "outcomes.noHistory":
    "The engine writes no history, so which end events instances reached is not known.",
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
  "scope.allVersions": COUNT_TERMS.allVersions.de,
  "kpi.title": "Kennzahlen",
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
  "diagram.noXml": "Die Engine hat kein Diagramm zu dieser Version.",
  "legend.scope": ({ version }) =>
    `Die Badges zählen alle Versionen, gezeichnet auf v${String(version)}.`,
  "perDay.title": "Gestartet und beendet pro Tag",
  "perDay.scope": "letzte 14 Tage",
  "perDay.started": "Gestartet",
  "perDay.ended": "Beendet",
  "perDay.chart": "Gestartete und beendete Instanzen pro Tag, letzte 14 Tage",
  "perDay.day": "Tag",
  "perDay.median": "Median",
  "perDay.p90": "P90",
  "perDay.durationScope": ({ count }) =>
    `Dauer ${isOne(count) ? "der einen Instanz, die" : `der ${String(count)} Instanzen, die`} in diesen Tagen beendet ${isOne(count) ? "wurde" : "wurden"}`,
  "perDay.durationSince": ({ count, date }) =>
    `Dauer ${isOne(count) ? "der einen Instanz, die" : `der ${String(count)} Instanzen, die`} seit ${String(date)} beendet ${isOne(count) ? "wurde" : "wurden"}, ab da hält die Engine ihre Historie`,
  "perDay.durationUnknown": "Für diese Tage ist keine Dauer bekannt.",
  "perDay.noHistory":
    "Die Engine schreibt keine Historie, deshalb ist nicht bekannt, wie viele Instanzen gestartet und beendet wurden.",
  "perDay.historyCut": ({ date }) =>
    `Die Engine hält die Historie ab ${String(date)}, die Tage davor zählen also mindestens, was sie behalten hat.`,
  "perDay.empty": "In den letzten 14 Tagen wurde keine Instanz gestartet oder beendet.",
  "outcomes.title": "Erreichte Endereignisse",
  "outcomes.scope": "letzte 14 Tage",
  "outcomes.label":
    "Endereignisse, die die in den letzten 14 Tagen beendeten Instanzen erreicht haben",
  "outcomes.shareOf": ({ count }) =>
    `Jeder Anteil bezieht sich auf ${isOne(count) ? "die eine beendete Instanz" : `die ${String(count)} beendeten Instanzen`}. Eine Instanz kann mehr als ein Endereignis erreichen.`,
  "outcomes.noShare":
    "Die Historie der Engine zu diesen Tagen ist nicht vollständig, deshalb zeigt die Seite keinen Anteil: Die Balken vergleichen die Endereignisse.",
  "outcomes.empty": "In den letzten 14 Tagen wurde keine Instanz beendet.",
  "outcomes.noEndEvent":
    "In den letzten 14 Tagen wurden Instanzen beendet, aber keine hat ein Endereignis erreicht, sie wurden also abgebrochen oder gelöscht.",
  "outcomes.noHistory":
    "Die Engine schreibt keine Historie, deshalb ist nicht bekannt, welche Endereignisse Instanzen erreicht haben.",
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
