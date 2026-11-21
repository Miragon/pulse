import { countOf, type Message } from "./message.js"

/**
 * The English words of what the search finds (`FindResults`, `FindHistoryNotice`), a catalog of
 * their own, so a surface without a search (the editors) bundles none of them. Every key has its
 * German entry in `find-de.ts`.
 */
export const findEn = {
  "find.label": "Found instances",
  "find.column.instance": "Instance",
  "find.column.businessKey": "Business key",
  "find.column.process": "Process",
  "find.column.engine": "Engine",
  "find.column.state": "State",
  "find.column.started": "Started",
  "find.version": "{process} v{version}",
  "find.row": "Instance {name} on {engine}",
  "find.instanceId": "instance ID",
  "find.none": ({ text }) =>
    `No instance has the ID or the business key "${String(text)}". Pulse finds the whole ID or the exact business key, never a part of one.`,
  "find.noneSearched": ({ text }) =>
    `No engine that could be searched has an instance with the ID or the business key "${String(text)}". Pulse finds the whole ID or the exact business key, never a part of one.`,
  "find.cut": ({ engine, most }) =>
    `${String(engine)} has more instances with this business key. The list shows the newest ${String(most)}.`,
  "find.history.title": "Running instances are missing from the history of {engine}",
  "find.history.detail": ({ counted, running }) =>
    `The engine's history holds ${String(counted)} of ${countOf(running, "running instance", "running instances")}. The search finds only the instances in the history.`,
} satisfies Readonly<Record<string, Message>>

/** A key of the search's words. */
export type FindWordKey = keyof typeof findEn
