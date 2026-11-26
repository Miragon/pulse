import { countOf, isOne, type Message } from "./message.js"
import type { ProcessWordKey } from "./process-en.js"

/** „1 Instanz läuft“, „3 Instanzen laufen“: das Verb folgt der Zahl. */
function stillRun(running: unknown): string {
  return isOne(running)
    ? `${String(running)} Instanz läuft noch auf älteren Versionen`
    : `${String(running)} Instanzen laufen noch auf älteren Versionen`
}

const NO_HISTORY = "Eine Engine ohne Variablenhistorie findet keine."

/** The German words of a process's blocks, one entry for every English key (brand-tone: du). */
export const processDe: Readonly<Record<ProcessWordKey, Message>> = {
  "version.label": "Version",
  "version.option": "v{version} · {running} laufend",
  "version.optionWithIncident": "v{version} · {running} laufend · {withIncident} mit Incident",
  "older.title": ({ running }) => `${stillRun(running)}.`,
  "older.titleWithIncident": ({ running, withIncident }) =>
    `${stillRun(running)}, ${String(withIncident)} davon mit Incident.`,
  "older.show": "v{version} zeigen",
  "scopes.label": "Instanzen zeigen",
  "scope.running": "Laufend",
  "scope.withIncident": "Mit Incident",
  "scope.ended": "Beendet",
  "scope.all": "Alle",
  "element.prefix": "An",
  "element.clear": "Elementfilter entfernen",
  "businessKey.search": "Nach Geschäftsschlüssel suchen",
  "businessKey.placeholder": "Geschäftsschlüssel",
  "variables.filter": "Nach Variablen filtern",
  "variables.filterCount": ({ count }) =>
    `Nach Variablen filtern, ${countOf(count, "Bedingung", "Bedingungen")}`,
  "condition.edit": "Bedingung {label} bearbeiten",
  "condition.remove": "Bedingung {label} entfernen",
  "dialog.add": "Nach Variable filtern",
  "dialog.edit": "Variablenbedingung bearbeiten",
  "dialog.description": "Eine Instanz passt, wenn alle Bedingungen gelten.",
  "dialog.name": "Name",
  "dialog.nameHint": "Groß- und Kleinschreibung zählt.",
  "dialog.compareAs": "Vergleichen als",
  "dialog.compareAsHint": "JSON- und Objektvariablen lassen sich nicht durchsuchen.",
  "dialog.operator": "Operator",
  "dialog.value": "Wert",
  "dialog.autoHint":
    "Automatisch vergleicht 42 als Zahl, true als wahr oder falsch und alles andere als Text.",
  "dialog.likeHint": "Nutze * als Platzhalter, zum Beispiel ORD-*",
  "dialog.cancel": "Abbrechen",
  "dialog.apply": "Anwenden",
  "compareAs.auto": "Automatisch",
  "compareAs.text": "Text",
  "compareAs.number": "Zahl",
  "compareAs.boolean": "Wahr oder falsch",
  "compareAs.date": "Datum und Uhrzeit",
  "compareAs.null": "Null",
  "operator.equals": "ist",
  "operator.notEquals": "ist nicht",
  "operator.like": "passt zu",
  "operator.greaterThan": "ist größer als",
  "operator.lessThan": "ist kleiner als",
  "operator.date.greaterThan": "ist nach",
  "operator.date.lessThan": "ist vor",
  "operator.null.equals": "ist null",
  "operator.null.notEquals": "ist nicht null",
  "error.name": "Gib einen Variablennamen ein.",
  "error.number": "Gib eine Zahl ein, zum Beispiel 42 oder 9.5.",
  "error.date": "Wähle Datum und Uhrzeit.",
  "error.count": ({ max }) => `Nutze höchstens ${countOf(max, "Bedingung", "Bedingungen")}.`,
  "refused.date": "Diese Engine vergleicht keine Datumswerte.",
  "refused.ordering": "Diese Engine sucht nicht nach größer oder kleiner als.",
  "instances.label": "Instanzen",
  "column.id": "ID",
  "column.businessKey": "Geschäftsschlüssel",
  "column.state": "Status",
  "column.started": "Gestartet",
  "instance.row": "Instanz {name}",
  "instance.id": "Instanz-ID",
  "incident.flag": "Incident",
  "incident.flagTitle": "Hat einen offenen Incident",
  "instances.noMatch": "Keine Instanz passt zu diesem Filter.",
  "instances.noVariableMatch.running": `Keine laufende Instanz passt zu diesen Variablenbedingungen. ${NO_HISTORY}`,
  "instances.noVariableMatch.withIncident": `Keine Instanz mit Incident passt zu diesen Variablenbedingungen. ${NO_HISTORY}`,
  "instances.noVariableMatch.ended": `Keine beendete Instanz passt zu diesen Variablenbedingungen. ${NO_HISTORY}`,
  "instances.noVariableMatch.all": `Keine Instanz passt zu diesen Variablenbedingungen. ${NO_HISTORY}`,
  "instances.clearVariables": "Variablenbedingungen entfernen",
  "more.load": "Mehr laden",
  "more.wait": "Warte, bis die Aktualisierung fertig ist",
  "badge.running": ({ element, count }) =>
    `${String(element)}: ${isOne(count) ? `${String(count)} Instanz läuft` : `${String(count)} Instanzen laufen`}. Zeig die laufenden Instanzen an diesem Element.`,
  "badge.incidents": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "Incident", "Incidents")}. Zeig die Instanzen mit Incident an diesem Element.`,
  "badge.incidentsInCalledInstances": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "Incident", "Incidents")} in aufgerufenen Instanzen. Zeig die Instanzen mit Incident an diesem Element.`,
  "badge.named": "{shown}, {description}",
  "legend.label": "Legende",
  "legend.scope": "Die Badges zählen laufende Instanzen von v{version}.",
  "legend.running": "wartet hier",
  "legend.incidents": "Incident hier",
  "legend.incidentsInCalledInstances": "Incident in einer aufgerufenen Instanz",
  "call.definition": "Aufgerufenen Prozess {name} öffnen",
  "call.instance": "Aufgerufene Instanz {process} {id} öffnen",
  "call.instances": "Wähle eine von {count} aufgerufenen Instanzen",
  "call.missing": "{process} ist auf {engine} nicht bereitgestellt, oder du darfst ihn nicht sehen",
}
