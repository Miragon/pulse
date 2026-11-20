import { countOf, type Message } from "./message.js"
import type { HistoryWordKey } from "./history-en.js"

/** The German words of the history notice, one entry for every English key (brand-tone: du). */
export const historyDe: Readonly<Record<HistoryWordKey, Message>> = {
  "history.title": "Der Historie fehlen laufende Instanzen",
  "history.detail": ({ counted, running }) =>
    `Die Historie der Engine kennt ${String(counted)} von ${countOf(running, "laufenden Instanz", "laufenden Instanzen")} auf dieser Version. Die Liste zeigt nur die Instanzen aus der Historie.`,
}
