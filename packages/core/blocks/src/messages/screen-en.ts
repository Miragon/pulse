import { countOf, type Message } from "./message.js"

/**
 * The English words of the screens' blocks: the process list of an engine, its filter bar and its
 * table. They are the words of the engine tab of Pulse for VS Code and Pulse for Orca, letter for
 * letter. Every key has its German entry in `screen-de.ts`.
 */
export const screenEn = {
  "processes.label": "Processes",
  "processes.scopes": "Show processes",
  "processes.scope.all": "All",
  "processes.scope.withIncident": "With incident",
  "processes.search": "Search by name or BPMN process ID",
  "processes.searchPlaceholder": "Name or key",
  "processes.summary": ({ processes, running, withIncident }) =>
    `${countOf(processes, "process", "processes")} · ${String(running)} running · ${String(withIncident)} with incident · all versions`,
  "processes.none":
    "No processes deployed on {engine}, or you may not have permission to see them.",
  "processes.noMatch": "No processes match this filter.",
  "column.process": "Process",
  "column.latestVersion": "Latest version",
  "column.running": "Running",
  "column.withIncident": "With incident",
  "process.row": "Process {name}",
  "process.id": "BPMN process ID",
  "process.version": "v{version}",
  "process.alarm": "Has open incidents",
} satisfies Readonly<Record<string, Message>>

/** The key of a word of the screens' blocks. */
export type ScreenWordKey = keyof typeof screenEn
