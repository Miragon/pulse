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
  "processes.legend.label": "Was die Zahlen sagen",
  "processes.legend.scope": "Jede Zahl zählt über alle Versionen eines Prozesses.",
  "processes.legend.running": "Laufend: die Instanzen, die gerade laufen.",
  "processes.legend.withIncident":
    "Mit Incident: die Instanzen mit einem offenen Incident, auch ein Aufrufer, der auf einen Incident in einer aufgerufenen Instanz wartet.",
  "processes.legend.incidents":
    "Incidents: die offenen Incidents, jeder einmal gezählt, bei dem Prozess, in dem er auftrat, nie bei einem Aufrufer, der auf ihn wartet. Ein Incident außerhalb jeder Instanz, etwa ein gescheiterter Timer-Start, zählt hier, auch wenn ihn keine Instanz hält.",
  "column.process": "Prozess",
  "column.latestVersion": "Neueste Version",
  "column.running": "Laufend",
  "column.withIncident": "Mit Incident",
  "column.incidents": "Incidents",
  "column.tenant": "Mandant",
  "process.row": "Prozess {name}",
  "process.rowInTenant": "Prozess {name} des Mandanten {tenant}",
  "process.id": "BPMN-Prozess-ID",
  "process.version": "v{version}",
  "process.alarm": "Hat offene Incidents",
}
