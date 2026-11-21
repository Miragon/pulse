import type { Message } from "./message.js"
import type { EnginesWordKey } from "./engines-en.js"

/** The German words of the tables across engines, one entry for every English key (brand-tone: du). */
export const enginesDe: Readonly<Record<EnginesWordKey, Message>> = {
  "engines.label": "Engines",
  "engines.column.engine": "Engine",
  "engines.column.product": "Produkt",
  "engines.column.processes": "Prozesse",
  "engines.column.running": "Laufend",
  "engines.column.withIncident": "Mit Incident",
  "engines.column.incidents": "Incidents",
  "engines.row": "Engine {engine}",
  "engines.id": "Engine-ID",
  "engines.state.loading": "lädt…",
  "engines.state.failed": "nicht gelesen",
  "engines.state.refused": "Profil abgelehnt",
  "engines.state.unread": "nicht gelesen",
  "engines.productUnknown": "Die Engine hat nicht gesagt, was sie ist",
  "engines.alarm": "Hat offene Incidents",
  "engines.none": "Auf diesem Server ist keine Engine eingerichtet.",
  "matrix.label": "Prozesse je Engine",
  "matrix.column.process": "Prozess",
  "matrix.column.withIncident": "Mit Incident",
  "matrix.processId": "BPMN-Prozess-ID",
  "matrix.notDeployed": "auf {engine} nicht bereitgestellt",
  "matrix.note":
    "Engines führen verschiedene Prozesse, darum zeigt diese Ansicht Zahlen, nie Raten.",
  "matrix.none": "Auf diesen Engines ist kein Prozess bereitgestellt.",
  "matrix.unread": "Nicht gelesen, darum nicht in dieser Ansicht: {engines}",
}
