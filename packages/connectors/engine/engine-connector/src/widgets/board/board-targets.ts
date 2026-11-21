import type { BoardTarget } from "@miragon/pulse-blocks"
import type { BoardStartData } from "../../view-models.board.js"
import type { CockpitView } from "../../view-models.js"

/** Where a tile's click goes: a route of the cockpit on one of the board's engines. */
export interface EngineTarget {
  readonly engine: string
  readonly view: CockpitView
}

type Tile = BoardStartData["rows"][number][number]
type Instance = NonNullable<
  Extract<Tile, { kind: "instanceList" }>["groups"][number]["instances"]
>[number]
type Incident = NonNullable<
  Extract<Tile, { kind: "incidentList" }>["groups"][number]["incidents"]
>[number]
type Definition = Instance["definition"]

/** The states of an instance that no longer runs: its history shows it, its detail does not. */
const ENDED: ReadonlySet<string> = new Set(["completed", "terminated"])

const tilesOf = (data: BoardStartData): readonly Tile[] => data.rows.flat()

/** The instances a tile lists on `engine`. */
function instancesOn(tile: Tile, engine: string): readonly Instance[] {
  if (tile.kind !== "instanceList") return []
  return tile.groups.filter((group) => group.engine === engine).flatMap((g) => g.instances ?? [])
}

/** The incidents a tile lists on `engine`. */
function incidentsOn(tile: Tile, engine: string): readonly Incident[] {
  if (tile.kind !== "incidentList") return []
  return tile.groups.filter((group) => group.engine === engine).flatMap((g) => g.incidents ?? [])
}

/** The process versions a tile names on `engine`: its rows', its summary's or its diagram's. */
function definitionsOn(tile: Tile, engine: string): readonly Definition[] {
  switch (tile.kind) {
    case "incidentSummary":
      return tile.rows.flatMap((row) => (row.engine === engine && row.process ? [row.process] : []))
    case "processDiagram":
      return tile.engine === engine && tile.latest ? [tile.latest] : []
    default:
      return [
        ...instancesOn(tile, engine).map((instance) => instance.definition),
        ...incidentsOn(tile, engine).map((incident) => incident.definition),
      ]
  }
}

/** The instances of `instanceId` the board lists on `engine`. */
function listed(data: BoardStartData, engine: string, instanceId: string): readonly Instance[] {
  return tilesOf(data)
    .flatMap((tile) => instancesOn(tile, engine))
    .filter((instance) => instance.id === instanceId)
}

/** The crumb's name of an incident: the element it waits at, as the cockpit's lists name it. */
function incidentLabel(data: BoardStartData, engine: string, incidentId: string) {
  const incident = tilesOf(data)
    .flatMap((tile) => incidentsOn(tile, engine))
    .find((candidate) => candidate.id === incidentId)
  return incident === undefined ? {} : { label: incident.elementId }
}

/** The crumb's name of a process: its name where a tile of the board gives one. */
function processLabel(data: BoardStartData, engine: string, bpmnProcessId: string) {
  const name = tilesOf(data)
    .flatMap((tile) => definitionsOn(tile, engine))
    .find((definition) => definition.bpmnProcessId === bpmnProcessId && definition.name)?.name
  return name === undefined ? {} : { label: name }
}

function instanceView(
  target: Extract<BoardTarget, { kind: "instance" }>,
  data: BoardStartData,
  incidents: boolean,
): CockpitView {
  const { engine, instanceId, incidentId } = target
  if (incidentId !== undefined && incidents) {
    return { section: "incident-detail", incidentId, ...incidentLabel(data, engine, incidentId) }
  }
  const instances = listed(data, engine, instanceId)
  if (instances.some((instance) => ENDED.has(instance.state))) {
    return { section: "history", processInstanceId: instanceId }
  }
  const businessKey = instances.find((instance) => instance.businessKey)?.businessKey
  return {
    section: "instance-detail",
    processInstanceId: instanceId,
    ...(businessKey === undefined ? {} : { label: businessKey }),
  }
}

function instancesView(
  target: Extract<BoardTarget, { kind: "instances" }>,
  data: BoardStartData,
): CockpitView {
  const incidents = target.filter.scope === "withIncident"
  if (target.bpmnProcessId === undefined) {
    return incidents ? { section: "incidents" } : { section: "overview" }
  }
  return {
    section: "process-detail",
    processDefinitionKey: target.bpmnProcessId,
    ...(incidents ? { focus: "incidents" as const } : {}),
    ...processLabel(data, target.engine, target.bpmnProcessId),
  }
}

/**
 * A tile's target on the cockpit's own routes (the board's list filter does not carry over, a
 * difference docs/vscode/parity.md names): an incident opens its detail, an instance its detail
 * or, ended, its history; the instances of a process open the process, with incident on its
 * incidents; an engine's count opens its overview, with incident its incidents. A drill carries
 * the name the board's tiles give for its crumb, as the cockpit's own drills do: an instance's
 * business key, a process's name, an incident's element. Where the cockpit's incident view does
 * not read the engine (`incidents` false: Camunda 8, whose incidents the web app's instance screen
 * shows), an incident opens the instance that holds it, which a Camunda 8 cluster never copies.
 */
export function engineTargetOf(
  target: BoardTarget,
  data: BoardStartData,
  incidents = true,
): EngineTarget {
  return {
    engine: target.engine,
    view:
      target.kind === "instance"
        ? instanceView(target, data, incidents)
        : instancesView(target, data),
  }
}
