import { countOf, type Message } from "./message.js"
import type { FindWordKey } from "./find-en.js"

/** The German words of the search, one entry for every English key (brand-tone: du). */
export const findDe: Readonly<Record<FindWordKey, Message>> = {
  "find.label": "Gefundene Instanzen",
  "find.column.instance": "Instanz",
  "find.column.businessKey": "Geschäftsschlüssel",
  "find.column.process": "Prozess",
  "find.column.engine": "Engine",
  "find.column.state": "Zustand",
  "find.column.started": "Gestartet",
  "find.version": "{process} v{version}",
  "find.row": "Instanz {name} auf {engine}",
  "find.instanceId": "Instanz-ID",
  "find.none": ({ text }) =>
    `Keine Instanz hat die ID oder den Geschäftsschlüssel „${String(text)}“. Pulse findet die ganze ID oder den genauen Geschäftsschlüssel, nie einen Teil davon.`,
  "find.noneSearched": ({ text }) =>
    `Keine Engine, die sich durchsuchen ließ, hat eine Instanz mit der ID oder dem Geschäftsschlüssel „${String(text)}“. Pulse findet die ganze ID oder den genauen Geschäftsschlüssel, nie einen Teil davon.`,
  "find.cut": ({ engine, most }) =>
    `${String(engine)} hat mehr Instanzen mit diesem Geschäftsschlüssel. Die Liste zeigt die neuesten ${String(most)}.`,
  "find.history.title": "Laufende Instanzen fehlen in der Historie von {engine}",
  "find.history.detail": ({ counted, running }) =>
    `Die Historie der Engine kennt ${String(counted)} von ${countOf(running, "laufenden Instanz", "laufenden Instanzen")}. Die Suche findet nur die Instanzen aus der Historie.`,
}
