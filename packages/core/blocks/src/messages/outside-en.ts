import { countOf, isOne, type Message } from "./message.js"

/**
 * The English words of the line of an engine's open root incidents outside any process
 * (`OutsideAnyProcessNotice`), a catalog of their own, so a surface that shows no verdict (the
 * editors) bundles none of them. Every key has its German entry in `outside-de.ts`.
 */
export const outsideEn = {
  "outside.title": ({ count }) => `${countOf(count, "incident", "incidents")} outside any process`,
  "outside.titleOf": ({ engine, count }) =>
    `${String(engine)}: ${countOf(count, "incident", "incidents")} outside any process`,
  "outside.detail": ({ count }) =>
    isOne(count)
      ? "A batch or the history cleanup raised it. No process counts it, the engine's state does."
      : "Batches or the history cleanup raised them. No process counts them, the engine's state does.",
  "outside.more": "There may be more: Pulse reads only the newest open incidents.",
} satisfies Readonly<Record<string, Message>>

/** A key of the words of the line outside any process. */
export type OutsideWordKey = keyof typeof outsideEn
