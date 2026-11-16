import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type {
  CockpitSection,
  CockpitStart,
  CockpitStartData,
  CockpitView,
} from "../../view-models.js"
import { BoardView } from "../board/board-view.js"
import { ClusterDetailWidget } from "../cluster-detail.js"
import { ProcessDefinitionsTable } from "../cockpit-dashboard/definitions-table.js"
import { EngineHealthVerdict } from "../engine-health.js"
import { HistoryTimelineWidget } from "../history-timeline.js"
import { IncidentDetailWidget } from "../incident-detail.js"
import { IncidentsDashboard } from "../incidents-dashboard/view.js"
import { InstanceDetailWidget } from "../instance-detail.js"
import { JobPanelWidget } from "../job-panel.js"
import { ProcessDefinitionView } from "../process-incidents/view.js"
import { ProcessInstancesWidget } from "../process-instances/list.js"

/** The start data of `section`, or null: a seed of another route never reaches this one. */
function seedOf<S extends CockpitSection>(
  seed: CockpitStart | null,
  section: S,
): CockpitStartData[S] | null {
  return seed?.view.section === section ? (seed.data as CockpitStartData[S]) : null
}

/** A view of one engine's routes: every section but the board's. */
type EngineView = Exclude<CockpitView, { section: "board" }>

/**
 * One cockpit view: an app route (a board, which reads the engines it names) or a route of
 * `engine`, seeded with the start view's data (`engine_open_cockpit`) while it is the view on
 * screen. A new route adds its section to `CockpitView` and a case here or in `EngineRoute`; the
 * exhaustive switches fail to compile until it does.
 */
export function CockpitRoute({
  view,
  engine,
  seed = null,
}: {
  view: CockpitView
  /** The engine an engine route reads; none on a board. */
  engine: string | null
  seed?: CockpitStart | null
}) {
  if (view.section === "board") {
    return <BoardView board={view.board} data={seedOf(seed, "board")} />
  }
  // The cockpit opens an engine's routes only with its engine.
  return engine === null ? null : <EngineRoute view={view} engine={engine} seed={seed} />
}

/** One engine's view: self-fetching widgets scoped to `engine`. */
function EngineRoute({
  view,
  engine,
  seed,
}: {
  view: EngineView
  engine: string
  seed: CockpitStart | null
}) {
  switch (view.section) {
    // The definitions table carries per-definition health; a second KPI grid would duplicate it.
    case "overview": {
      const overview = seedOf(seed, "overview")
      return (
        <ViewStack>
          <EngineHealthVerdict data={overview?.health ?? null} engine={engine} />
          <ProcessDefinitionsTable data={overview?.definitions ?? null} engine={engine} />
        </ViewStack>
      )
    }
    case "incidents":
      return <IncidentsDashboard data={seedOf(seed, "incidents")} engine={engine} />
    case "cluster-detail":
      return (
        <ClusterDetailWidget
          data={seedOf(seed, "cluster-detail")}
          engine={engine}
          activityId={view.activityId}
          incidentType={view.incidentType}
          messageSignature={view.messageSignature}
        />
      )
    case "process-detail":
      return (
        <ProcessDefinitionView
          data={seedOf(seed, "process-detail")}
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
          focus={view.focus}
        />
      )
    case "process-instances":
      return (
        <ProcessInstancesWidget
          data={seedOf(seed, "process-instances")}
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
        />
      )
    case "instance-detail":
      return (
        <InstanceDetailWidget
          data={seedOf(seed, "instance-detail")}
          processInstanceId={view.processInstanceId}
          engine={engine}
        />
      )
    case "incident-detail":
      return (
        <IncidentDetailWidget
          data={seedOf(seed, "incident-detail")}
          incidentId={view.incidentId}
          engine={engine}
        />
      )
    case "jobs":
      return (
        <JobPanelWidget
          data={seedOf(seed, "jobs")}
          engine={engine}
          processDefinitionKey={view.processDefinitionKey}
          failedOnly={view.failedOnly}
        />
      )
    case "history":
      return (
        <HistoryTimelineWidget
          data={seedOf(seed, "history")}
          processInstanceId={view.processInstanceId}
          engine={engine}
        />
      )
  }
  return view satisfies never
}
