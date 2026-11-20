import { countOf, type Message } from "./message.js"
import type { ScreenWordKey } from "./screen-en.js"

/** The German words of the screens' blocks, one entry for every English key (brand-tone: du). */
export const screenDe: Readonly<Record<ScreenWordKey, Message>> = {
  "processes.label": "Prozesse",
  "processes.scopes": "Prozesse zeigen",
  "processes.scope.all": "Alle",
  "processes.scope.withIncident": "Mit Incident",
  "processes.search": "Nach Name oder BPMN-Prozess-ID suchen",
  "processes.searchPlaceholder": "Name oder BPMN-ID",
  "processes.summary": ({ processes, running, withIncident }) =>
    `${countOf(processes, "Prozess", "Prozesse")} · ${String(running)} laufend · ${String(withIncident)} mit Incident · alle Versionen`,
  "processes.none":
    "Auf {engine} ist kein Prozess bereitgestellt, oder du darfst die Prozesse nicht sehen.",
  "processes.noMatch": "Kein Prozess passt zu diesem Filter.",
  "column.process": "Prozess",
  "column.latestVersion": "Neueste Version",
  "column.running": "Laufend",
  "column.withIncident": "Mit Incident",
  "process.row": "Prozess {name}",
  "process.id": "BPMN-Prozess-ID",
  "process.version": "v{version}",
  "process.alarm": "Hat offene Incidents",
}
