import type { BoardColumn } from "../protocol/index.js"
import type { BoardState, BoardWidgetType, IncidentGrouping } from "./board-definition.js"

export class BoardVocabulary {
  static readonly SCHEMA_VERSION = 1
  static readonly MAX_WIDGETS = 12
  static readonly LIST_LIMIT = 50
  static readonly DOCUMENT_KEYS: readonly string[] = [
    "$schema",
    "schemaVersion",
    "title",
    "engines",
    "rows",
  ]
  static readonly ROW_KEYS: readonly string[] = ["row"]
  static readonly WIDGET_KEYS: readonly string[] = ["widget", "props"]
  static readonly WIDGETS: readonly BoardWidgetType[] = [
    "counter",
    "instanceList",
    "incidentSummary",
  ]
  static readonly PROPS: Readonly<Record<BoardWidgetType, readonly string[]>> = {
    counter: ["title", "engines", "filter", "warnAbove"],
    instanceList: ["title", "engines", "filter", "columns"],
    incidentSummary: ["title", "engines", "groupBy"],
  }
  static readonly FILTER_KEYS: readonly string[] = [
    "process",
    "activeElement",
    "state",
    "withIncident",
    "businessKey",
  ]
  static readonly STATES: readonly BoardState[] = ["running", "ended"]
  static readonly GROUPINGS: readonly IncidentGrouping[] = ["engine", "process"]
  static readonly COLUMNS: readonly BoardColumn[] = [
    "engine",
    "process",
    "version",
    "businessKey",
    "state",
    "startedAt",
    "endedAt",
    "incident",
  ]
  static readonly DEFAULT_COLUMNS: readonly BoardColumn[] = [
    "businessKey",
    "process",
    "state",
    "startedAt",
  ]
}
