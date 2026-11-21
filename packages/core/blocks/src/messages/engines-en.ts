import type { Message } from "./message.js"

/**
 * The English words of the tables across engines (`EngineTable`, `ProcessesByEngine`), a catalog of
 * their own, so a surface that shows no engines side by side (the editors) bundles none of them.
 * Every key has its German entry in `engines-de.ts`.
 */
export const enginesEn = {
  "engines.label": "Engines",
  "engines.column.engine": "Engine",
  "engines.column.product": "Product",
  "engines.column.processes": "Processes",
  "engines.column.running": "Running",
  "engines.column.withIncident": "With incident",
  "engines.column.incidents": "Incidents",
  "engines.row": "Engine {engine}",
  "engines.id": "engine ID",
  "engines.state.loading": "loading…",
  "engines.state.failed": "not read",
  "engines.state.refused": "profile refused",
  "engines.state.unread": "not read",
  "engines.productUnknown": "The engine didn't say what it is",
  "engines.alarm": "Has open incidents",
  "engines.none": "No engine is configured on this server.",
  "matrix.label": "Processes by engine",
  "matrix.column.process": "Process",
  "matrix.column.withIncident": "With incident",
  "matrix.processId": "BPMN process ID",
  "matrix.notDeployed": "not deployed on {engine}",
  "matrix.note": "Engines run different processes, so this view shows counts, never rates.",
  "matrix.none": "No process is deployed on these engines.",
  "matrix.unread": "Not read, so not in this view: {engines}",
} satisfies Readonly<Record<string, Message>>

/** A key of the words of the tables across engines. */
export type EnginesWordKey = keyof typeof enginesEn
