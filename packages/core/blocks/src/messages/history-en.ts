import { countOf, type Message } from "./message.js"

/**
 * The English words of the notice that a version's history misses running instances
 * (`MissingHistoryNotice`), a catalog of their own, so a surface that does not render the notice
 * (the editors' definition view) bundles none of them. Every key has its German entry in
 * `history-de.ts`.
 */
export const historyEn = {
  "history.title": "The history misses running instances",
  "history.detail": ({ counted, running }) =>
    `The engine's history holds ${String(counted)} of ${countOf(running, "running instance", "running instances")} on this version. The list shows only the instances in the history.`,
} satisfies Readonly<Record<string, Message>>

/** A key of the history notice's words. */
export type HistoryWordKey = keyof typeof historyEn
