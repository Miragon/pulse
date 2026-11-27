import { countOf, isOne, type Message } from "./message.js"
import type { OutsideWordKey } from "./outside-en.js"

/** The German words of the line outside any process, one entry for every English key. */
export const outsideDe: Readonly<Record<OutsideWordKey, Message>> = {
  "outside.title": ({ count }) =>
    `${countOf(count, "Incident", "Incidents")} außerhalb von Prozessen`,
  "outside.titleOf": ({ engine, count }) =>
    `${String(engine)}: ${countOf(count, "Incident", "Incidents")} außerhalb von Prozessen`,
  "outside.detail": ({ count }) =>
    isOne(count)
      ? "Ein Batch oder die Bereinigung der Historie hat ihn ausgelöst. Kein Prozess zählt ihn, der Zustand der Engine schon."
      : "Batches oder die Bereinigung der Historie haben sie ausgelöst. Kein Prozess zählt sie, der Zustand der Engine schon.",
  "outside.more": "Es können mehr sein: Pulse liest nur die neuesten offenen Incidents.",
}
