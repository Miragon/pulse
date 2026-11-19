/**
 * The model's view of a board (`engine_open_cockpit` view `board`): its ids, titles and numbers
 * under English keys, as the other routes' facts (`routes.ts`). A number that was not read is
 * null, never 0; a field without a value is left out of the JSON. Titles come from the board file,
 * the operator's text, clipped like engine text.
 */

import type { CountData, EngineData, ProblemData, TileData } from "@miragon/pulse-board"
import type { BoardStartData } from "../view-models.board.js"

export type BoardFacts = Record<string, unknown>

/** File text is the operator's: flattened and capped, absent stays absent. */
function clipped(text: string | undefined, max = 80): string | undefined {
  if (text === undefined) return undefined
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** A count as the model reads it: the number, and whether it is a lower bound. */
function countFact(count: CountData | undefined): number | null {
  return count?.count ?? null
}

function atLeast(count: CountData | undefined): true | undefined {
  return count?.atLeast
}

function engineFact(engine: EngineData) {
  switch (engine.state) {
    case "ready":
      return {
        name: engine.name,
        state: engine.state,
        product: engine.product,
        running: engine.totals?.running ?? null,
        withIncident: engine.totals?.withIncident ?? null,
      }
    case "failed":
      return { name: engine.name, state: engine.state, failure: engine.failure.code }
    case "notConfigured":
      return { name: engine.name, state: engine.state }
  }
}

const codes = (problems: readonly ProblemData[]) => problems.map((problem) => problem.code)

/** A tile's facts: its kind, its title and process, and its numbers. */
function tileFact(tile: TileData): BoardFacts {
  switch (tile.kind) {
    case "counter":
      return {
        kind: tile.kind,
        title: clipped(tile.widget.title),
        process: tile.widget.filter.process,
        count: countFact(tile.total),
        atLeast: atLeast(tile.total),
        enginesRead: tile.known,
        engines: tile.readings.length,
        above: tile.readings.some((reading) => reading.above === true) || undefined,
      }
    case "instanceList":
      return {
        kind: tile.kind,
        title: clipped(tile.widget.title),
        process: tile.widget.filter.process,
        shown: tile.groups.reduce((sum, group) => sum + (group.instances?.length ?? 0), 0),
        groups: tile.groups.map((group) => ({
          engine: group.engine,
          total: group.instances === undefined ? null : countFact(group.total),
        })),
      }
    case "incidentSummary":
      return {
        kind: tile.kind,
        title: clipped(tile.widget.title),
        groupBy: tile.widget.groupBy,
        withIncident: tile.total ?? null,
        enginesRead: tile.known,
        engines: tile.engines,
      }
    case "processDiagram":
      return {
        kind: tile.kind,
        title: clipped(tile.widget.title),
        process: tile.widget.process,
        engine: tile.engine,
        version: tile.latest?.version ?? null,
        notDeployed: tile.notDeployed,
      }
    case "incidentList":
      return {
        kind: tile.kind,
        title: clipped(tile.widget.title),
        process: tile.widget.process,
        groups: tile.groups.map((group) => ({
          engine: group.engine,
          shown: group.incidents?.length ?? null,
          more: group.more,
        })),
      }
    case "refused":
      return { kind: tile.kind, widget: tile.widget, problems: codes(tile.problems) }
  }
}

/** The board `id` as the model reads it: the engines in their state, each tile's numbers. */
export function boardFacts(id: string, data: BoardStartData): BoardFacts {
  return {
    board: id,
    title: clipped(data.title),
    asOf: data.asOf,
    engines: data.engines.map(engineFact),
    tiles: data.rows.flat().map(tileFact),
    notes: data.notes.length > 0 ? codes(data.notes) : undefined,
  }
}
