import type {
  BoardColumn,
  BoardFilter,
  CountData,
  CounterData,
  DefinitionData,
  IncidentListData,
  IncidentSummaryData,
  IncidentSummaryRowData,
  InstanceListData,
  ProcessDiagramData,
  TileData,
} from "@miragon/pulse-board"
import { formatCount } from "@miragon/pulse-ui"
import type { Words } from "../messages/translate.js"
import type { BoardInstancesTarget } from "./slots.js"

/** The sign of a count no engine gave. */
const NO_VALUE = "—"

/** A count as a figure, `≥ 10,000` where an engine stopped counting. */
export function countText(count: CountData): string {
  return formatCount(count.atLeast === true ? { atLeast: count.count } : count.count)
}

/** The title of a widget the file names none for: from its filter, its process or its kind. */
export function filterTitle(t: Words, filter: BoardFilter): string {
  const parts = [
    t(filter.state === "running" ? "filter.running" : "filter.ended"),
    filter.withIncident === true ? t("filter.withIncident") : undefined,
    filter.withIncident === false ? t("filter.withoutIncident") : undefined,
    filter.process === undefined ? undefined : t("filter.process", { process: filter.process }),
    filter.activeElement === undefined
      ? undefined
      : t("filter.element", { element: filter.activeElement }),
    filter.businessKey === undefined
      ? undefined
      : t("filter.businessKey", { key: filter.businessKey }),
  ]
  return parts.filter((part) => part !== undefined).join(" ")
}

function untitled(t: Words, tile: Exclude<TileData, { kind: "refused" }>): string {
  switch (tile.kind) {
    case "counter":
    case "instanceList":
      return filterTitle(t, tile.widget.filter)
    case "incidentSummary":
      return t("title.instanceSummary")
    case "processDiagram":
      return tile.latest?.name ?? tile.widget.process
    case "incidentList":
      return tile.widget.process === undefined
        ? t("title.openIncidents")
        : t("title.openIncidentsOf", { process: tile.widget.process })
  }
}

/** A tile's title: the widget's, else from its filter, its process or its kind. */
export function tileTitle(t: Words, tile: TileData): string {
  if (tile.kind === "refused") {
    if (tile.title !== undefined) return tile.title
    return tile.widget === undefined
      ? t("title.widget")
      : t("title.widgetNamed", { widget: tile.widget })
  }
  return tile.widget.title ?? untitled(t, tile)
}

/**
 * Whether an incident list's title names its process: the untitled list of one process
 * (`title.openIncidentsOf`). A title the file gives names what its author chose instead.
 */
export function titleNamesProcess(tile: IncidentListData): boolean {
  return tile.widget.process !== undefined && tile.widget.title === undefined
}

/** A list's columns: the engine first over several engines, unless the file places it. */
export function listColumns(tile: InstanceListData): readonly BoardColumn[] {
  const { columns, engines } = tile.widget
  return engines.length > 1 && !columns.includes("engine") ? ["engine", ...columns] : columns
}

/** A process by its name, else by its BPMN id. */
export function processName(definition: DefinitionData): string {
  return definition.name ?? definition.bpmnProcessId
}

/**
 * A summary row by its process, named with its tenant where it has one (a key in two tenants is a
 * row each), or by its engine when the summary groups by engine.
 */
export function summaryLabel(t: Words, row: IncidentSummaryRowData): string {
  const { process } = row
  if (process === undefined) return row.engine
  const name = processName(process)
  return process.tenantId === undefined
    ? name
    : t("summary.inTenant", { process: name, tenant: process.tenantId })
}

/** The key of a summary row among the tile's rows: its engine, its process's key and tenant. */
export function summaryKey(row: IncidentSummaryRowData): string {
  return JSON.stringify([row.engine, row.process?.bpmnProcessId ?? "", row.process?.tenantId ?? ""])
}

/** How many engines a total comes from, when some were not read. */
export function partial(t: Words, tile: CounterData | IncidentSummaryData): string | undefined {
  const engines = tile.kind === "counter" ? tile.readings.length : tile.engines
  return tile.known < engines
    ? t("counter.partial", { known: formatCount(tile.known), engines: formatCount(engines) })
    : undefined
}

/** The title of a count that opens its process or its engine. */
export function openTitle(t: Words, target: BoardInstancesTarget, toSide: boolean): string {
  const title =
    target.bpmnProcessId === undefined
      ? t("open.engine", { engine: target.engine })
      : t("open.process", { engine: target.engine })
  return toSideTitle(t, title, toSide)
}

/** A title with the way beside the view, where the surface opens there. */
export function toSideTitle(t: Words, title: string, toSide: boolean): string {
  return toSide ? t("open.toSide", { title }) : title
}

/** Which engines a counter found above its threshold. */
export function above(t: Words, tile: CounterData): string | undefined {
  const engines = tile.readings.filter((reading) => reading.above === true)
  const warnAbove = tile.widget.warnAbove
  const [first] = engines
  if (warnAbove === undefined || first === undefined) {
    return undefined
  }
  const limit = formatCount(warnAbove)
  return engines.length === 1
    ? t("counter.engineAbove", { engine: first.engine, limit })
    : t("counter.enginesAbove", { count: formatCount(engines.length), limit })
}

function undecided(t: Words, tile: CounterData): string | undefined {
  const engines = tile.readings.filter((reading) => reading.undecided === true)
  const [first] = engines
  const warnAbove = tile.widget.warnAbove
  if (warnAbove === undefined || first === undefined) {
    return undefined
  }
  const stopped =
    engines.length === 1
      ? t("counter.engineStopped", {
          engine: first.engine,
          count: formatCount(first.count?.count ?? 0),
        })
      : t("counter.enginesStopped", { count: formatCount(engines.length) })
  return `${stopped} · ${t("counter.warnsAbove", { limit: formatCount(warnAbove) })}`
}

/** A counter's warning: the engines above its threshold and those that stopped counting. */
export function warning(t: Words, tile: CounterData): string | undefined {
  const parts = [above(t, tile), undecided(t, tile)].filter((part) => part !== undefined)
  return parts.length === 0 ? undefined : parts.join(" · ")
}

/** Why a diagram tile draws nothing. */
export function diagramMissing(t: Words, tile: ProcessDiagramData): string {
  return tile.notDeployed === true
    ? t("diagram.notDeployed", { process: tile.widget.process, engine: tile.engine })
    : t("diagram.notRead", { engine: tile.engine })
}

/** An engine's count in a list of engines: the figure, or that it was not read. */
export function entryCount(t: Words, count: CountData | undefined): string {
  return count === undefined ? t("notRead") : countText(count)
}

/** A tile's total: the figure, or the sign of none. */
export function totalCount(count: CountData | undefined): string {
  return count === undefined ? NO_VALUE : countText(count)
}
